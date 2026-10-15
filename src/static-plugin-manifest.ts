import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import type { AiMode, BoltPlugin, HandlerManifest, PluginManifest } from "./plugin";
import { brandPlugin, markDefinedPlugin } from "./plugin";
import {
  listCompileSources,
  pluginDirectory,
  PluginRegistry,
  type PluginSource,
} from "./plugin-registry";

/** Prefer HOME so tests can isolate user plugins without mocking os.homedir(). */
function userHome(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** On-disk catalog file next to a project/user/path plugin root. */
export const PLUGIN_MANIFEST_FILENAME = "bolt.plugin.json";

export type StaticManifestReason = "missing" | "hash mismatch" | "invalid";

/** Serializable catalog / paramsSchema shape written by `bolt plugin build`. */
export interface StaticHandlerManifest {
  ai?: AiMode;
  description?: string;
  capabilities?: string[];
  paramsSchema?: Record<string, unknown>;
  /** Optional static step text for describeUses; may be thinner than live describe(). */
  describe?: string;
}

export interface StaticPluginFile {
  namespace: string;
  description?: string;
  sourcesHash: string;
  handlers: Record<string, StaticHandlerManifest>;
}

export class StaticManifestError extends Error {
  readonly reason: StaticManifestReason;
  readonly namespace: string;
  readonly manifestPath: string;

  constructor(opts: {
    namespace: string;
    manifestPath: string;
    reason: StaticManifestReason;
    detail?: string;
  }) {
    const abs = path.resolve(opts.manifestPath);
    const reasonText =
      opts.reason === "missing"
        ? "missing"
        : opts.reason === "hash mismatch"
          ? "sourcesHash mismatch"
          : "invalid JSON";
    const detail = opts.detail ? ` (${opts.detail})` : "";
    super(
      `Static plugin manifest ${reasonText} for "${opts.namespace}": ${abs}${detail}\n` +
        `Run: bolt plugin build ${opts.namespace}`,
    );
    this.name = "StaticManifestError";
    this.reason = opts.reason;
    this.namespace = opts.namespace;
    this.manifestPath = abs;
  }
}

export function staticManifestPath(pluginRoot: string): string {
  return path.join(pluginRoot, PLUGIN_MANIFEST_FILENAME);
}

/**
 * SHA-256 hex of compile source file contents (same `.ts`/`.tsx` set JIT compile uses).
 * For each file in sorted basename order: basename + NUL + contents + NUL.
 */
export function computeSourcesHash(pluginDir: string): string {
  const hash = createHash("sha256");
  for (const file of listCompileSources(pluginDir)) {
    hash.update(path.basename(file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function fillTemplate(
  template: string | undefined,
  params: Record<string, string>,
): string | undefined {
  if (!template) return undefined;
  return template.replace(/\$\{([\w-]+)\}/g, (_, key: string) => params[key] ?? key);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

function normalizeAi(ai: unknown): AiMode | undefined {
  if (ai === false || ai === true || ai === "confirm") return ai;
  return undefined;
}

/** Parse and lightly validate bolt.plugin.json. Does not verify sourcesHash. */
export function parseStaticPluginFile(
  raw: string,
  namespace: string,
  manifestPath: string,
): StaticPluginFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new StaticManifestError({
      namespace,
      manifestPath,
      reason: "invalid",
      detail: msg,
    });
  }
  const obj = asRecord(parsed);
  if (!obj) {
    throw new StaticManifestError({
      namespace,
      manifestPath,
      reason: "invalid",
      detail: "root must be an object",
    });
  }
  const ns = clean(obj.namespace) ?? namespace;
  const sourcesHash = clean(obj.sourcesHash);
  if (!sourcesHash) {
    throw new StaticManifestError({
      namespace,
      manifestPath,
      reason: "invalid",
      detail: "missing sourcesHash",
    });
  }
  const handlersRaw = asRecord(obj.handlers);
  if (!handlersRaw) {
    throw new StaticManifestError({
      namespace,
      manifestPath,
      reason: "invalid",
      detail: "handlers must be an object",
    });
  }
  const handlers: Record<string, StaticHandlerManifest> = {};
  for (const [name, entry] of Object.entries(handlersRaw)) {
    const meta = asRecord(entry) ?? {};
    const ai = normalizeAi(meta.ai);
    const handler: StaticHandlerManifest = {};
    if (ai !== undefined) handler.ai = ai;
    const description = clean(meta.description);
    if (description) handler.description = description;
    const describe = clean(meta.describe);
    if (describe) handler.describe = describe;
    if (Array.isArray(meta.capabilities)) {
      const caps = meta.capabilities.filter((c): c is string => typeof c === "string");
      if (caps.length > 0) handler.capabilities = caps;
    }
    const schema = asRecord(meta.paramsSchema);
    if (schema) handler.paramsSchema = schema;
    // Reject Zod-looking dumps (params with _def) — catalog shape only.
    if (meta.params !== undefined && asRecord(meta.params)?._def) {
      throw new StaticManifestError({
        namespace,
        manifestPath,
        reason: "invalid",
        detail: "handlers must use paramsSchema (JSON Schema), not Zod params",
      });
    }
    handlers[name] = handler;
  }
  return {
    namespace: ns,
    description: clean(obj.description),
    sourcesHash,
    handlers,
  };
}

export function readAndVerifyStaticManifest(
  namespace: string,
  pluginRoot: string,
): StaticPluginFile {
  const manifestPath = staticManifestPath(pluginRoot);
  if (!existsSync(manifestPath)) {
    throw new StaticManifestError({ namespace, manifestPath, reason: "missing" });
  }
  const raw = readFileSync(manifestPath, "utf8");
  const file = parseStaticPluginFile(raw, namespace, manifestPath);
  const actual = computeSourcesHash(pluginRoot);
  if (actual !== file.sourcesHash) {
    throw new StaticManifestError({ namespace, manifestPath, reason: "hash mismatch" });
  }
  return file;
}

/** Build an in-memory BoltPlugin from a verified static file (no executable handlers). */
export function stubPluginFromStatic(file: StaticPluginFile): BoltPlugin {
  const handlers: Record<string, BoltPlugin["handlers"][string]> = {};
  const manifestHandlers: PluginManifest["handlers"] = {};
  for (const [name, entry] of Object.entries(file.handlers)) {
    handlers[name] = async () => {
      throw new Error(
        `Static AI stub for "${file.namespace}/${name}" cannot run. Use bolt run after loading plugins.`,
      );
    };
    const ai = entry.ai ?? false;
    const hm: HandlerManifest = { ai };
    if (entry.description) hm.description = entry.description;
    if (entry.paramsSchema) hm.paramsSchema = entry.paramsSchema;
    if (entry.capabilities && entry.capabilities.length > 0) {
      hm.capabilities = [...entry.capabilities];
    }
    manifestHandlers[name] = hm;
  }
  const manifest: PluginManifest = {
    namespace: file.namespace,
    version: "",
    description: file.description ?? "",
    handlers: manifestHandlers,
    pluginApi: 1,
  };
  const describes = new Map(
    Object.entries(file.handlers).map(([name, entry]) => [
      name,
      entry.describe ?? entry.description,
    ]),
  );
  const plugin: BoltPlugin = {
    namespace: file.namespace,
    handlers,
    manifest,
    describe(handlerName, params) {
      return fillTemplate(describes.get(handlerName), params);
    },
  };
  markDefinedPlugin(plugin);
  brandPlugin(plugin, 1);
  return plugin;
}

function pluginEntryCandidate(pluginRoot: string): string | null {
  const tsFile = path.join(pluginRoot, "index.ts");
  const jsFile = path.join(pluginRoot, "index.js");
  if (existsSync(tsFile)) return tsFile;
  if (existsSync(jsFile)) return jsFile;
  return null;
}

function loadStaticDirectory(
  reg: PluginRegistry,
  dir: string,
  source: PluginSource,
  lenient: boolean,
): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    if (!pluginEntryCandidate(entryPath)) continue;
    try {
      const file = readAndVerifyStaticManifest(entry, entryPath);
      reg.register(stubPluginFromStatic(file), source);
    } catch (error) {
      if (lenient && error instanceof StaticManifestError) continue;
      throw error;
    }
  }
}

/**
 * Assemble a registry for `bolt ai` from built-ins (in-process) plus static
 * `bolt.plugin.json` files. Never compiles, imports, or executes project/user plugins.
 */
export function buildStaticAiRegistry(
  cfg: { plugins?: { namespace: string; path?: string; config?: Record<string, unknown> }[] },
  configDir: string,
  builtins: BoltPlugin[],
  opts: { lenient?: boolean } = {},
): PluginRegistry {
  const lenient = opts.lenient === true;
  const reg = new PluginRegistry();
  for (const p of builtins) reg.register(p);

  const userPluginsDir = path.join(userHome(), ".bolt", "plugins");
  loadStaticDirectory(reg, userPluginsDir, "user", lenient);

  const projectPluginsDir = path.join(configDir, ".bolt", "plugins");
  loadStaticDirectory(reg, projectPluginsDir, "project", lenient);

  reg.setConfigOrder((cfg.plugins ?? []).map((entry) => entry.namespace));

  for (const entry of cfg.plugins ?? []) {
    if (!entry.path) continue;
    const resolved = path.resolve(configDir, entry.path);
    const root = pluginDirectory(resolved);
    try {
      const file = readAndVerifyStaticManifest(entry.namespace, root);
      reg.register(stubPluginFromStatic(file), "path");
    } catch (error) {
      if (lenient && error instanceof StaticManifestError) continue;
      throw error;
    }
  }

  return reg;
}

/** Serialize a live loaded plugin into the on-disk catalog JSON shape. */
export function staticFileFromLivePlugin(plugin: BoltPlugin, pluginRoot: string): StaticPluginFile {
  const manifest = plugin.manifest;
  if (!manifest) {
    throw new Error(`Plugin "${plugin.namespace}" has no manifest after load`);
  }
  const handlers: Record<string, StaticHandlerManifest> = {};
  for (const [name, entry] of Object.entries(manifest.handlers ?? {})) {
    const row: StaticHandlerManifest = { ai: entry.ai };
    if (entry.description) row.description = entry.description;
    if (entry.paramsSchema) row.paramsSchema = entry.paramsSchema;
    if (entry.capabilities && entry.capabilities.length > 0) {
      row.capabilities = [...entry.capabilities];
    }
    handlers[name] = row;
  }
  return {
    namespace: plugin.namespace,
    description: clean(manifest.description),
    sourcesHash: computeSourcesHash(pluginRoot),
    handlers,
  };
}

export function writeStaticPluginFile(pluginRoot: string, file: StaticPluginFile): string {
  const out = staticManifestPath(pluginRoot);
  const payload = {
    namespace: file.namespace,
    ...(file.description ? { description: file.description } : {}),
    sourcesHash: file.sourcesHash,
    handlers: file.handlers,
  };
  writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return out;
}

/** Minimal scaffold catalog matching `bolt plugin new` index.ts. */
export function scaffoldStaticManifest(namespace: string, pluginRoot: string): StaticPluginFile {
  return {
    namespace,
    description: "TODO: describe your plugin",
    sourcesHash: computeSourcesHash(pluginRoot),
    handlers: {
      run: {
        ai: false,
        description: "Run ${input}",
        paramsSchema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: {
            input: { type: "string", description: "Input value to process" },
          },
          required: ["input"],
        },
      },
    },
  };
}
