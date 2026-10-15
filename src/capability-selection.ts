/**
 * Capability selection map (BOLT-EXT-2).
 *
 * Singleton tags resolve to one handler. Fan-out tags in the map are ignored
 * with one warning. `capabilitySelectionHash` is the digest BOLT-AI-2 must
 * feed into `plan_hash` as `capability_selection`.
 *
 * TODO(BOLT-AI-2): pass `capabilitySelectionHash(effectiveCapabilitySelection(map))`
 * into `plan_hash`. Do not add a second hash field or a parallel plan hash.
 */
import { createHash } from "crypto";
import { existsSync, readdirSync, statSync } from "fs";
import os from "os";
import path from "path";
import { CAPABILITY_PATTERN, CORE_CAPABILITIES, type KnownCapability } from "./capabilities";
import { CONFIG_EXIT_CODE } from "./exit-codes";
import type { BoltPlugin } from "./plugin";
import { PluginRegistry, pluginDirectory, type PluginSource } from "./plugin-registry";
import { builtinPlugins } from "./plugins";
import { formatDidYouMean, closestMatches } from "./suggest";
import {
  readAndVerifyStaticManifest,
  stubPluginFromStatic,
  StaticManifestError,
} from "./static-plugin-manifest";

export class CapabilitySelectionError extends Error {
  readonly exitCode = CONFIG_EXIT_CODE;
  constructor(message: string) {
    super(message);
    this.name = "CapabilitySelectionError";
  }
}

export type SelectionFile = "bolt.yaml" | "bolt.local.yaml";
export type SelectionSource = SelectionFile | "auto: only match";

export type CapabilityFailureCode =
  | "CAPABILITY_AMBIGUOUS"
  | "CAPABILITY_MISSING"
  | "CAPABILITY_SELECTION_INVALID";

export interface CapabilityIssue {
  capability: string;
  /** Absolute config path when known: `/abs/bolt.yaml: capabilities.vcs.sync`. */
  path: string;
  message: string;
  code?: CapabilityFailureCode;
}

export interface ResolvedCapability {
  capability: string;
  ref: string;
  source: SelectionSource;
}

export interface CapabilityReport {
  warnings: string[];
  /** `vcs.sync: git/pull (bolt.yaml)` lines. */
  lines: string[];
  errors: CapabilityIssue[];
  resolved: ResolvedCapability[];
}

export interface UnbuiltPlugin {
  namespace: string;
  /** Noun phrase, e.g. `project plugin .bolt/plugins/p4`. */
  where: string;
}

interface BuiltHandler {
  ref: string;
  tags: string[];
}

export interface CapabilityIndex {
  registry: PluginRegistry;
  built: BuiltHandler[];
  unbuilt: UnbuiltPlugin[];
}

export interface CapabilityConfigView {
  capabilities?: Record<string, string>;
  capabilitySources?: Partial<Record<string, SelectionFile>>;
  plugins?: Array<{ namespace: string; path?: string }>;
  tasks?: Record<string, Array<{ uses?: string }>>;
}

const FAN_OUT_NOTE = "A selection does not apply to fan-out tags.";

function definedMap(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!map || Object.keys(map).length === 0) return undefined;
  return map;
}

/** Per-key overlay. An empty map is the same as omitting the key. Local wins. */
export function mergeCapabilityMaps(
  base: Record<string, string> | undefined,
  local: Record<string, string> | undefined,
): { map: Record<string, string>; sources: Record<string, SelectionFile> } {
  const map: Record<string, string> = {};
  const sources: Record<string, SelectionFile> = {};
  const shared = definedMap(base);
  const over = definedMap(local);
  if (shared) {
    for (const key of Object.keys(shared)) {
      map[key] = shared[key];
      sources[key] = "bolt.yaml";
    }
  }
  if (over) {
    for (const key of Object.keys(over)) {
      map[key] = over[key];
      sources[key] = "bolt.local.yaml";
    }
  }
  return { map, sources };
}

/** Map that `plan_hash` will hash: fan-out keys dropped. */
export function effectiveCapabilitySelection(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    if (capabilityKind(key) === "fan-out") continue;
    out[key] = value;
  }
  return out;
}

/**
 * SHA-256 hex of a selection map.
 * Canonical bytes: keys sorted by UTF-16 code unit, each `key=value\n`.
 * An empty map hashes the empty string (same digest as omitting the map).
 */
export function capabilitySelectionHash(map: Record<string, string>): string {
  const canonical = Object.keys(map)
    .sort()
    .map((key) => `${key}=${map[key]}\n`)
    .join("");
  return createHash("sha256").update(canonical).digest("hex");
}

export function capabilityKind(tag: string): "singleton" | "fan-out" | undefined {
  if (!(tag in CORE_CAPABILITIES)) return undefined;
  return CORE_CAPABILITIES[tag as KnownCapability];
}

/** A `uses:` value that names a capability instead of `namespace/handler`. */
export function isCapabilityRef(ref: string): boolean {
  if (ref.startsWith("./") || ref.startsWith("../") || ref.includes("/")) return false;
  if (!CAPABILITY_PATTERN.test(ref)) return false;
  if (ref in CORE_CAPABILITIES) return true;
  return ref.includes(".");
}

export function capabilityUsesInTasks(tasks: CapabilityConfigView["tasks"]): string[] {
  const out: string[] = [];
  for (const steps of Object.values(tasks ?? {})) {
    for (const step of steps) {
      if (typeof step.uses === "string" && isCapabilityRef(step.uses)) out.push(step.uses);
    }
  }
  return [...new Set(out)];
}

function selectionPath(
  key: string,
  source: SelectionFile | undefined,
  configDir: string | undefined,
): string {
  const tail = `capabilities.${key}`;
  const file = source ?? (configDir ? "bolt.yaml" : undefined);
  if (!file) return tail;
  const located = configDir ? path.resolve(configDir, file) : file;
  return `${located}: ${tail}`;
}

function remember(built: BuiltHandler[], plugin: BoltPlugin): void {
  const prefix = `${plugin.namespace}/`;
  for (let i = built.length - 1; i >= 0; i--) {
    if (built[i].ref.startsWith(prefix)) built.splice(i, 1);
  }
  for (const [name, entry] of Object.entries(plugin.manifest?.handlers ?? {})) {
    built.push({ ref: `${plugin.namespace}/${name}`, tags: [...(entry.capabilities ?? [])] });
  }
}

function hasPluginEntry(root: string): boolean {
  return existsSync(path.join(root, "index.ts")) || existsSync(path.join(root, "index.js"));
}

function considerRoot(
  registry: PluginRegistry,
  built: BuiltHandler[],
  unbuilt: UnbuiltPlugin[],
  namespace: string,
  root: string,
  where: string,
  source: PluginSource,
): void {
  if (!existsSync(root) || !statSync(root).isDirectory() || !hasPluginEntry(root)) return;
  try {
    const file = readAndVerifyStaticManifest(namespace, root);
    const plugin = stubPluginFromStatic(file);
    registry.register(plugin, source);
    remember(built, plugin);
  } catch (error) {
    if (error instanceof StaticManifestError) {
      if (!unbuilt.some((item) => item.namespace === namespace)) {
        unbuilt.push({ namespace, where });
      }
      return;
    }
    throw error;
  }
}

function walkPluginDir(
  registry: PluginRegistry,
  built: BuiltHandler[],
  unbuilt: UnbuiltPlugin[],
  dir: string,
  whereFor: (name: string) => string,
  source: PluginSource,
): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const root = path.join(dir, entry);
    try {
      if (!statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }
    considerRoot(registry, built, unbuilt, entry, root, whereFor(entry), source);
  }
}

export function loadCapabilityIndex(
  cfg: CapabilityConfigView,
  configDir: string,
  opts: { home?: string; builtins?: Record<string, BoltPlugin> } = {},
): CapabilityIndex {
  const registry = new PluginRegistry();
  const built: BuiltHandler[] = [];
  const unbuilt: UnbuiltPlugin[] = [];
  const builtins =
    opts.builtins ?? Object.fromEntries(builtinPlugins.map((plugin) => [plugin.namespace, plugin]));
  for (const plugin of Object.values(builtins)) {
    registry.register(plugin, "builtin");
    remember(built, plugin);
  }
  const home = opts.home ?? process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
  walkPluginDir(
    registry,
    built,
    unbuilt,
    path.join(home, ".bolt", "plugins"),
    (name) => `user plugin ~/.bolt/plugins/${name}`,
    "user",
  );
  walkPluginDir(
    registry,
    built,
    unbuilt,
    path.join(configDir, ".bolt", "plugins"),
    (name) => `project plugin .bolt/plugins/${name}`,
    "project",
  );
  registry.setConfigOrder((cfg.plugins ?? []).map((entry) => entry.namespace));
  for (const entry of cfg.plugins ?? []) {
    if (!entry.path) continue;
    const resolved = path.resolve(configDir, entry.path);
    const root = pluginDirectory(resolved);
    considerRoot(
      registry,
      built,
      unbuilt,
      entry.namespace,
      root,
      `plugin "${entry.namespace}" (${entry.path})`,
      "path",
    );
  }
  return { registry, built, unbuilt };
}

function knownTags(built: BuiltHandler[]): string[] {
  const tags = new Set<string>(Object.keys(CORE_CAPABILITIES));
  for (const handler of built) for (const tag of handler.tags) tags.add(tag);
  return [...tags];
}

function isHandlerRef(ref: string): boolean {
  const slash = ref.indexOf("/");
  return slash > 0 && slash === ref.lastIndexOf("/") && slash < ref.length - 1 && !/\s/.test(ref);
}

function refHint(ref: string, providers: string[]): string {
  if (providers.length === 0) return "";
  const close = closestMatches(ref, providers);
  return formatDidYouMean(close.length > 0 ? close : providers.slice(0, 3));
}

function quoteList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return `"${items[0]}"`;
  if (items.length === 2) return `"${items[0]}" and "${items[1]}"`;
  return `${items
    .slice(0, -1)
    .map((item) => `"${item}"`)
    .join(", ")}, and "${items[items.length - 1]}"`;
}

function fanOutWarning(keys: string[]): string | undefined {
  if (keys.length === 0) return undefined;
  const names = quoteList([...keys].sort());
  const verb = keys.length === 1 ? "is" : "are";
  return `capabilities: fan-out ${names} ${verb} ignored. ${FAN_OUT_NOTE}`;
}

function incompleteMessage(unbuilt: UnbuiltPlugin[]): string {
  const hints = unbuilt.map(
    (item) => `plugin "${item.namespace}" not built (Run: bolt plugin build ${item.namespace})`,
  );
  return `capability unknown — ${hints.join("; ")}`;
}

function ambiguousMessage(key: string, matches: string[]): string {
  const candidate = matches[0];
  return `CAPABILITY_AMBIGUOUS: matches ${quoteList(matches)}. Add to bolt.yaml (or bolt.local.yaml): capabilities: { ${key}: ${candidate} }`;
}

function missingMessage(key: string): string {
  return `CAPABILITY_MISSING: no handler provides "${key}". Enable a provider by tagging a handler with "${key}", then run bolt plugin build <namespace> for that plugin.`;
}

export interface ResolveSelectionInput {
  map: Record<string, string>;
  sources?: Partial<Record<string, SelectionFile>>;
  index: CapabilityIndex;
  /** Directory of bolt.yaml. Issue paths use this when it is known. */
  configDir?: string;
  /** Capability `uses:` refs in the plan or, for `bolt check`, in every task. */
  requested?: string[];
  /** List singleton tags that have exactly one built handler. */
  catalog?: boolean;
}

export function resolveCapabilitySelection(input: ResolveSelectionInput): CapabilityReport {
  const map = input.map;
  const sources = input.sources ?? {};
  const requested = new Set(input.requested ?? []);
  const { registry, built, unbuilt } = input.index;
  const tags = knownTags(built);
  const warnings: string[] = [];
  const fanout = Object.keys(map).filter((key) => capabilityKind(key) === "fan-out");
  const warning = fanOutWarning(fanout);
  if (warning) warnings.push(warning);

  const errors: CapabilityIssue[] = [];
  const resolved: ResolvedCapability[] = [];
  const seen = new Set<string>();

  const keys = [
    ...Object.keys(map).filter((key) => capabilityKind(key) !== "fan-out"),
    ...requested,
  ];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const source = sources[key];
    const inMap = Object.prototype.hasOwnProperty.call(map, key);
    const outcome = resolveOne({
      key,
      source,
      inMap,
      ref: inMap ? map[key] : undefined,
      requested: requested.has(key),
      registry,
      tags,
      unbuilt,
      configDir: input.configDir,
    });
    if (outcome.kind === "resolved") resolved.push(outcome.resolved);
    else if (outcome.kind === "error") errors.push(outcome.issue);
  }

  if (input.catalog && unbuilt.length === 0) {
    const byTag = new Map<string, string[]>();
    for (const handler of built) {
      for (const tag of handler.tags) {
        if (capabilityKind(tag) === "fan-out") continue;
        const list = byTag.get(tag) ?? [];
        list.push(handler.ref);
        byTag.set(tag, list);
      }
    }
    for (const [tag, refs] of byTag) {
      if (refs.length !== 1 || seen.has(tag)) continue;
      resolved.push({ capability: tag, ref: refs[0], source: "auto: only match" });
    }
  }

  resolved.sort((a, b) => (a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0));
  const lines = resolved.map((item) => `${item.capability}: ${item.ref} (${item.source})`);
  return { warnings, lines, errors, resolved };
}

function resolveOne(args: {
  key: string;
  source: SelectionFile | undefined;
  inMap: boolean;
  ref: string | undefined;
  requested: boolean;
  registry: PluginRegistry;
  tags: string[];
  unbuilt: UnbuiltPlugin[];
  configDir: string | undefined;
}):
  | { kind: "resolved"; resolved: ResolvedCapability }
  | { kind: "error"; issue: CapabilityIssue }
  | { kind: "skip" } {
  const { key, source, inMap, ref, requested, registry, tags, unbuilt, configDir } = args;
  const pathFor = selectionPath(key, source, configDir);
  if (capabilityKind(key) === "fan-out") {
    if (!requested) return { kind: "skip" };
    return {
      kind: "error",
      issue: {
        capability: key,
        path: pathFor,
        message: `fan-out capability "${key}" is not a single handler. Call a specific handler with uses: instead. ${FAN_OUT_NOTE}`,
      },
    };
  }

  const known = key in CORE_CAPABILITIES || tags.includes(key);
  if (!known) {
    const suggestions = closestMatches(key, tags);
    if (!CAPABILITY_PATTERN.test(key) || suggestions.length > 0) {
      return {
        kind: "error",
        issue: {
          capability: key,
          path: pathFor,
          message: `unknown capability "${key}".${formatDidYouMean(suggestions)}`,
        },
      };
    }
    if (unbuilt.length > 0) {
      return {
        kind: "error",
        issue: { capability: key, path: pathFor, message: incompleteMessage(unbuilt) },
      };
    }
    return {
      kind: "error",
      issue: {
        capability: key,
        path: pathFor,
        code: "CAPABILITY_MISSING",
        message: missingMessage(key),
      },
    };
  }

  const matches = registry.findByCapability(key).map((match) => match.ref);
  if (inMap && ref !== undefined) {
    if (!isHandlerRef(ref)) {
      return {
        kind: "error",
        issue: {
          capability: key,
          path: pathFor,
          code: "CAPABILITY_SELECTION_INVALID",
          message: `CAPABILITY_SELECTION_INVALID: "${ref}" is not a handler ref (expected "namespace/handler").${refHint(ref, matches)}`,
        },
      };
    }
    if (matches.includes(ref)) {
      return {
        kind: "resolved",
        resolved: { capability: key, ref, source: source ?? "bolt.yaml" },
      };
    }
    const namespace = ref.slice(0, ref.indexOf("/"));
    const blocked = unbuilt.filter((item) => item.namespace === namespace);
    if (blocked.length > 0) {
      return {
        kind: "error",
        issue: { capability: key, path: pathFor, message: incompleteMessage(blocked) },
      };
    }
    return {
      kind: "error",
      issue: {
        capability: key,
        path: pathFor,
        code: "CAPABILITY_SELECTION_INVALID",
        message: `CAPABILITY_SELECTION_INVALID: "${ref}" does not provide "${key}".${refHint(ref, matches)}`,
      },
    };
  }

  // No selection. A unique built match wins even when some other plugin is unbuilt.
  if (matches.length === 1) {
    return {
      kind: "resolved",
      resolved: { capability: key, ref: matches[0], source: "auto: only match" },
    };
  }
  if (unbuilt.length > 0) {
    if (!requested && !inMap) return { kind: "skip" };
    return {
      kind: "error",
      issue: { capability: key, path: pathFor, message: incompleteMessage(unbuilt) },
    };
  }
  if (matches.length === 0) {
    return {
      kind: "error",
      issue: {
        capability: key,
        path: pathFor,
        code: "CAPABILITY_MISSING",
        message: missingMessage(key),
      },
    };
  }
  if (!requested && !inMap) return { kind: "skip" };
  return {
    kind: "error",
    issue: {
      capability: key,
      path: pathFor,
      code: "CAPABILITY_AMBIGUOUS",
      message: ambiguousMessage(key, matches),
    },
  };
}

export function assessCapabilities(
  cfg: CapabilityConfigView,
  configDir: string,
  opts: {
    requested?: string[];
    home?: string;
    builtins?: Record<string, BoltPlugin>;
    catalog?: boolean;
  } = {},
): CapabilityReport {
  const index = loadCapabilityIndex(cfg, configDir, opts);
  return resolveCapabilitySelection({
    map: cfg.capabilities ?? {},
    sources: cfg.capabilitySources,
    index,
    configDir,
    requested: opts.requested,
    catalog: opts.catalog,
  });
}

export function formatCapabilityIssue(issue: CapabilityIssue): string {
  return `${issue.path}: ${issue.message}`;
}

/** Joined issue lines for exit 3. */
export function formatCapabilityErrors(report: CapabilityReport): string {
  return report.errors.map(formatCapabilityIssue).join("\n");
}
