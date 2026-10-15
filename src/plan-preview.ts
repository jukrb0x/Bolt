import path from "path";
import type { BoltConfig } from "./config";
import { contextHashForProject } from "./ai-context";
import { assessCapabilities, isCapabilityRef, type CapabilityReport } from "./capability-selection";
import type { AiMode, BoltPlugin } from "./plugin";
import { issue, type JsonIssue } from "./json-envelope";
import {
  hashSegments,
  hashLocalTree,
  interpolateSegments,
  maskSegments,
  type InterpSegment,
} from "./interpolate";
import {
  artefactFile,
  canonicalJson,
  configRecord,
  discoverPlugins,
  lookupPluginManifest,
  sha256,
  userHome,
  type CacheManifest,
  type LocatedPlugin,
} from "./plugin-cache";
import { builtinPlugins } from "./plugins";
import { readProvenance, type PlanNode, type RunPlan } from "./run-plan";
import { VERSION } from "./version";

export { maskedTree } from "./interpolate";

function rank(ai: AiMode): number {
  if (ai === false) return 2;
  if (ai === "confirm") return 1;
  return 0;
}

export interface AiReason {
  node: string;
  ai: AiMode;
  code?: "PLUGIN_NOT_BUILT" | "PLUGIN_SHADOWS_BUILTIN" | "ARTEFACT_TAMPERED";
  message: string;
}

export interface PreviewWarning {
  namespace: string;
}

function stricter(a: AiMode, b: AiMode): AiMode {
  return rank(a) >= rank(b) ? a : b;
}

function segmentsOfRun(node: Extract<PlanNode, { kind: "run" }>): InterpSegment[] {
  const provenance = readProvenance(node);
  if (provenance?.kind === "run") return provenance.segments;
  return [{ kind: "literal", text: node.command }];
}

function maskedParams(node: Extract<PlanNode, { kind: "uses" }>): Record<string, string> {
  const provenance = readProvenance(node);
  const out: Record<string, string> = {};
  for (const key of Object.keys(node.params).sort()) {
    const segments = provenance?.kind === "uses" ? provenance.params[key] : undefined;
    out[key] = segments ? maskSegments(segments) : node.params[key];
  }
  return out;
}

function hashedParams(node: Extract<PlanNode, { kind: "uses" }>): Record<string, string> {
  const provenance = readProvenance(node);
  const out: Record<string, string> = {};
  for (const key of Object.keys(node.params).sort()) {
    const segments = provenance?.kind === "uses" ? provenance.params[key] : undefined;
    out[key] = segments ? hashSegments(segments, sha256) : node.params[key];
  }
  return out;
}

interface Place {
  namespace: string;
  source: "builtin" | "user" | "project" | "path";
  located?: LocatedPlugin;
}

function placeFor(
  namespace: string,
  discovered: Map<string, LocatedPlugin>,
  builtins: Record<string, BoltPlugin>,
): Place | undefined {
  const located = discovered.get(namespace);
  if (located) return { namespace, source: located.source, located };
  if (builtins[namespace]) return { namespace, source: "builtin" };
  return undefined;
}

function pluginConfig(cfg: BoltConfig, namespace: string): unknown {
  return cfg.plugins?.find((entry) => entry.namespace === namespace)?.config;
}

interface HandlerHit {
  ai: AiMode;
  code?: "PLUGIN_NOT_BUILT" | "PLUGIN_SHADOWS_BUILTIN";
  plugin_source?: Place["source"];
  artefact_hash?: string | null;
  config_hash?: string | null;
  /** Non-builtin namespace that replaces a built-in of the same name. */
  shadow?: string;
  /** Declared `true` lowered to `confirm` because the namespace is not trusted. */
  capped?: boolean;
}

export interface PreviewParticipant {
  namespace: string;
  source: "builtin" | "user" | "project" | "path";
  built: boolean;
  artefactHash: string | null;
  configHash: string | null;
  artefactPath: string | null;
  manifest?: CacheManifest;
  config: unknown;
}

function handlerHit(
  cfg: BoltConfig,
  ref: string,
  discovered: Map<string, LocatedPlugin>,
  builtins: Record<string, BoltPlugin>,
): HandlerHit {
  const slash = ref.indexOf("/");
  const namespace = slash === -1 ? ref : ref.slice(0, slash);
  const handler = slash === -1 ? "" : ref.slice(slash + 1);
  const place = placeFor(namespace, discovered, builtins);
  if (!place) return { ai: false };
  if (place.source === "builtin") {
    const plugin = builtins[namespace];
    const entry = plugin?.manifest?.handlers?.[handler];
    if (!entry) return { ai: false, plugin_source: "builtin" };
    return { ai: entry.ai, plugin_source: "builtin" };
  }
  const located = place.located!;
  const lookup = lookupPluginManifest(
    located.root,
    located.cacheRoot,
    namespace,
    pluginConfig(cfg, namespace),
  );
  const shadow = builtins[namespace] ? namespace : undefined;
  if (!lookup.built || !lookup.manifest) {
    return {
      ai: false,
      code: "PLUGIN_NOT_BUILT",
      plugin_source: place.source,
      artefact_hash: null,
      config_hash: null,
      shadow,
    };
  }
  const entry = lookup.manifest.handlers[handler];
  if (!entry || shadow) {
    return {
      ai: false,
      ...(shadow ? { code: "PLUGIN_SHADOWS_BUILTIN" as const, shadow } : {}),
      plugin_source: place.source,
      artefact_hash: lookup.manifest.artefact_hash,
      config_hash: lookup.manifest.config_hash,
    };
  }
  const trust = new Set(cfg.trustPlugins ?? []);
  const capped = entry.ai === true && !trust.has(namespace);
  return {
    ai: capped ? "confirm" : entry.ai,
    capped,
    plugin_source: place.source,
    artefact_hash: lookup.manifest.artefact_hash,
    config_hash: lookup.manifest.config_hash,
  };
}

interface RatedNode {
  ai: AiMode;
  reasons: AiReason[];
  display: unknown;
  hashed: unknown;
  plugins: string[];
  shadows: string[];
}

function rateNodes(
  nodes: PlanNode[],
  trail: string,
  cfg: BoltConfig,
  selection: CapabilityReport,
  discovered: Map<string, LocatedPlugin>,
  builtins: Record<string, BoltPlugin>,
): RatedNode[] {
  const rated: RatedNode[] = [];
  for (const node of nodes) {
    if (node.kind === "call") {
      const inner = rateNodes(
        node.nodes,
        `${trail} > ${node.name}`,
        cfg,
        selection,
        discovered,
        builtins,
      );
      const ai = inner.reduce<AiMode>((acc, item) => stricter(acc, item.ai), true);
      rated.push({
        ai,
        reasons: inner.flatMap((item) => item.reasons),
        display: { kind: "call", name: node.name, nodes: inner.map((item) => item.display) },
        hashed: { kind: "call", name: node.name, nodes: inner.map((item) => item.hashed) },
        plugins: inner.flatMap((item) => item.plugins),
        shadows: inner.flatMap((item) => item.shadows),
      });
      continue;
    }
    if (node.kind === "run") {
      const segments = segmentsOfRun(node);
      const shown = maskSegments(segments);
      const where = `${trail} > run`;
      const reason: AiReason = { node: where, ai: "confirm", message: `run: ${shown}` };
      rated.push({
        ai: "confirm",
        reasons: [reason],
        display: {
          kind: "run",
          command: shown,
          continueOnError: node.continueOnError,
          continue_on_error: node.continueOnError,
        },
        hashed: {
          kind: "run",
          command: hashSegments(segments, sha256),
          continueOnError: node.continueOnError,
        },
        plugins: [],
        shadows: [],
      });
      continue;
    }

    const local = node.ref.startsWith("./") || node.ref.startsWith("../");
    if (local) {
      const where = `${trail} > ${node.ref}`;
      const params = maskedParams(node);
      rated.push({
        ai: "confirm",
        reasons: [{ node: where, ai: "confirm", message: `local: ${node.ref}` }],
        display: { kind: "uses", ref: node.ref, params, ai: "confirm" },
        hashed: { kind: "uses", ref: node.ref, params: hashedParams(node), ai: "confirm" },
        plugins: [],
        shadows: [],
      });
      continue;
    }

    let ref = node.ref;
    if (isCapabilityRef(ref)) {
      const hit = selection.resolved.find((item) => item.capability === ref);
      if (hit) ref = hit.ref;
    }
    const resolved = handlerHit(cfg, ref, discovered, builtins);
    const where = `${trail} > ${node.ref}`;
    const namespaceForMsg = ref.slice(0, Math.max(ref.indexOf("/"), 0));
    const reason: AiReason = {
      node: where,
      ai: resolved.ai,
      ...(resolved.code ? { code: resolved.code } : {}),
      message:
        resolved.code === "PLUGIN_NOT_BUILT"
          ? `plugin "${namespaceForMsg}" is not built for the current source and config`
          : resolved.code === "PLUGIN_SHADOWS_BUILTIN"
            ? `plugin "${namespaceForMsg}" shadows a built-in namespace`
            : resolved.capped
              ? `${ref} ai confirm (non-builtin cap)`
              : `${ref} ai ${String(resolved.ai)}`,
    };
    const slash = ref.indexOf("/");
    const namespace = slash === -1 ? ref : ref.slice(0, slash);
    rated.push({
      ai: resolved.ai,
      reasons: [reason],
      display: {
        kind: "uses",
        ref: node.ref,
        params: maskedParams(node),
        ai: resolved.ai,
        ...(resolved.plugin_source ? { plugin_source: resolved.plugin_source } : {}),
      },
      hashed: {
        kind: "uses",
        ref: node.ref,
        // Capability steps keep the label in `ref` and bind the handler execute will call.
        ...(ref !== node.ref ? { handler: ref } : {}),
        params: hashedParams(node),
        ai: resolved.ai,
        ...(resolved.plugin_source ? { plugin_source: resolved.plugin_source } : {}),
      },
      plugins:
        resolved.plugin_source && resolved.plugin_source !== "builtin"
          ? [namespace]
          : namespace && resolved.plugin_source === "builtin"
            ? [`builtin:${namespace}`]
            : [],
      shadows: resolved.shadow ? [resolved.shadow] : [],
    });
  }
  return rated;
}

function hashConfig(cfg: BoltConfig, namespace: string): unknown {
  const config = configRecord(pluginConfig(cfg, namespace)) ?? null;
  const local = new Set(cfg.localPluginPaths ?? []);
  return hashLocalTree(config, local, sha256, canonicalJson, `plugins.${namespace}`);
}

function participantRecord(
  namespace: string,
  cfg: BoltConfig,
  discovered: Map<string, LocatedPlugin>,
  builtins: Record<string, BoltPlugin>,
): Record<string, unknown> {
  const place = placeFor(namespace, discovered, builtins);
  if (!place || place.source === "builtin") {
    return { namespace, source: "builtin", bolt: VERSION };
  }
  const lookup = lookupPluginManifest(
    place.located!.root,
    place.located!.cacheRoot,
    namespace,
    pluginConfig(cfg, namespace),
  );
  return {
    namespace,
    source: place.source,
    artefact_hash: lookup.manifest?.artefact_hash ?? null,
    config_hash: lookup.manifest?.config_hash ?? null,
    config: hashConfig(cfg, namespace),
  };
}

export interface InspectPreview {
  names: string[];
  context_hash: string;
  plan_hash: string;
  ai: AiMode;
  ai_reasons: AiReason[];
  tasks: Array<{
    name: string;
    ai: AiMode;
    continueOnFailure: boolean;
    nodes: unknown[];
  }>;
  warnings: JsonIssue[];
  participants: PreviewParticipant[];
}

export function planHashFor(payload: unknown): string {
  return sha256(canonicalJson(payload));
}

/** inspect --json additions and the plan_hash payload. Read-only: no plugin import, no writes. */
export function previewPlan(opts: {
  cfg: BoltConfig;
  configPath: string;
  configDir: string;
  plan: RunPlan;
  names: string[];
  params: Record<string, string>;
  home?: string;
}): InspectPreview {
  const home = opts.home ?? userHome();
  const builtins = builtinPlugins as Record<string, BoltPlugin>;
  const discovered = new Map(
    discoverPlugins(opts.configDir, opts.cfg.plugins, home).map((item) => [item.namespace, item]),
  );
  const requested: string[] = [];
  const walkRefs = (nodes: PlanNode[]) => {
    for (const node of nodes) {
      if (node.kind === "call") walkRefs(node.nodes);
      else if (node.kind === "uses" && isCapabilityRef(node.ref)) requested.push(node.ref);
    }
  };
  for (const task of opts.plan.tasks) walkRefs(task.nodes);
  const selectionFull = assessCapabilities(opts.cfg, opts.configDir, {
    requested,
    home,
    builtins,
    catalog: true,
  });

  const tasks = opts.plan.tasks.map((task) => {
    const rated = rateNodes(task.nodes, task.name, opts.cfg, selectionFull, discovered, builtins);
    const ai = rated.reduce<AiMode>((acc, item) => stricter(acc, item.ai), true);
    return { task, rated, ai };
  });
  const ai = tasks.reduce<AiMode>((acc, item) => stricter(acc, item.ai), true);
  const reasons = tasks
    .flatMap((item) => item.rated.flatMap((node) => node.reasons))
    .filter((reason) => reason.ai === ai);

  const pluginIds = new Set<string>();
  for (const task of tasks) {
    for (const node of task.rated) {
      for (const id of node.plugins) pluginIds.add(id);
    }
  }
  const participants: Array<Record<string, unknown> & { namespace: string }> = [...pluginIds].map(
    (id) => {
      if (id.startsWith("builtin:")) {
        return {
          namespace: id.slice("builtin:".length),
          source: "builtin",
          bolt: VERSION,
        };
      }
      return participantRecord(id, opts.cfg, discovered, builtins) as Record<string, unknown> & {
        namespace: string;
      };
    },
  );
  participants.sort((a, b) => (a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1 : 0));

  const loaded: PreviewParticipant[] = [...pluginIds].map((id) =>
    participantFromId(id, opts.cfg, discovered),
  );
  loaded.sort((a, b) => (a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1 : 0));

  const hashedTasks = tasks.map((item) => ({
    name: item.task.name,
    ai: item.ai,
    continueOnFailure: item.task.continueOnFailure,
    nodes: item.rated.map((node) => node.hashed),
  }));
  const payload = {
    bolt: VERSION,
    ai,
    ai_reasons: reasons,
    policy: { ai_run: opts.cfg.aiRun ?? "confirm" },
    plugins: participants,
    plan: {
      kind: opts.plan.kind,
      name: opts.plan.name ?? null,
      names: opts.names,
      params: opts.params,
      tasks: hashedTasks,
    },
  };

  const unbuilt = new Set<string>();
  const shadows = new Set<string>();
  for (const reason of tasks.flatMap((item) => item.rated.flatMap((node) => node.reasons))) {
    const match = reason.message.match(/^plugin "([^"]+)"/);
    if (!match) continue;
    if (reason.code === "PLUGIN_NOT_BUILT") unbuilt.add(match[1]);
    if (reason.code === "PLUGIN_SHADOWS_BUILTIN") shadows.add(match[1]);
  }
  for (const task of tasks) {
    for (const node of task.rated) {
      for (const namespace of node.shadows) shadows.add(namespace);
    }
  }

  return {
    names: opts.names,
    context_hash: contextHashForProject(opts.cfg, opts.configPath, opts.configDir),
    plan_hash: planHashFor(payload),
    ai,
    ai_reasons: reasons,
    tasks: tasks.map((item) => ({
      name: item.task.name,
      ai: item.ai,
      continueOnFailure: item.task.continueOnFailure,
      nodes: item.rated.map((node) => node.display),
    })),
    warnings: [
      ...[...unbuilt]
        .sort()
        .map((namespace) =>
          issue(
            "PLUGIN_NOT_BUILT",
            `Plugin "${namespace}" is not built for the current source and config.`,
            `bolt plugin build ${namespace}`,
          ),
        ),
      ...[...shadows]
        .sort()
        .map((namespace) =>
          issue(
            "PLUGIN_SHADOWS_BUILTIN",
            `Plugin "${namespace}" shadows a built-in namespace. Its handlers count as ai:false in agent mode.`,
          ),
        ),
    ],
    participants: loaded,
  };
}

function participantFromId(
  id: string,
  cfg: BoltConfig,
  discovered: Map<string, LocatedPlugin>,
): PreviewParticipant {
  if (id.startsWith("builtin:")) {
    const namespace = id.slice("builtin:".length);
    return {
      namespace,
      source: "builtin",
      built: true,
      artefactHash: null,
      configHash: null,
      artefactPath: null,
      config: pluginConfig(cfg, namespace),
    };
  }
  const config = pluginConfig(cfg, id);
  const located = discovered.get(id);
  if (!located) {
    return {
      namespace: id,
      source: "project",
      built: false,
      artefactHash: null,
      configHash: null,
      artefactPath: null,
      config,
    };
  }
  const lookup = lookupPluginManifest(located.root, located.cacheRoot, id, config);
  const artefactHash = lookup.manifest?.artefact_hash ?? null;
  return {
    namespace: id,
    source: located.source,
    built: Boolean(lookup.built && lookup.manifest),
    artefactHash,
    configHash: lookup.manifest?.config_hash ?? null,
    artefactPath: artefactHash ? artefactFile(located.cacheRoot, id, artefactHash) : null,
    manifest: lookup.manifest,
    config,
  };
}

export function statusPlugins(
  cfg: BoltConfig,
  configDir: string,
  home = userHome(),
): Array<{ namespace: string; built: boolean }> {
  return discoverPlugins(configDir, cfg.plugins, home).map((plugin) => ({
    namespace: plugin.namespace,
    built: lookupPluginManifest(
      plugin.root,
      plugin.cacheRoot,
      plugin.namespace,
      pluginConfig(cfg, plugin.namespace),
    ).built,
  }));
}

export function maskedVars(cfg: BoltConfig): Record<string, string> {
  const local = new Set(cfg.localVarKeys ?? []);
  const out: Record<string, string> = {};
  for (const key of Object.keys(cfg.vars).sort()) {
    const value = cfg.vars[key];
    if (local.has(key)) out[key] = `«local:${key}»`;
    else if (value.includes("${{"))
      out[key] = maskSegments(interpolateSegments(value, envCtx(cfg)));
    else out[key] = value;
  }
  return out;
}

function envCtx(cfg: BoltConfig) {
  return {
    project: cfg.project as unknown as Record<string, string>,
    vars: cfg.vars,
    env: process.env as Record<string, string>,
    params: {},
    localVars: new Set(cfg.localVarKeys ?? []),
  };
}

export function configDirFrom(configPath: string): string {
  return path.dirname(configPath);
}
