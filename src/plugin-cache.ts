import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  renameSync,
} from "fs";
import os from "os";
import path from "path";
import type { AiMode, BoltPlugin } from "./plugin";
import { getParamMap } from "./plugin";
import { PLUGIN_COMPILER_OPTIONS } from "./plugin-tsconfig";
import {
  pluginDirectory,
  rewritePluginLocation,
  type PluginOrigin,
  type PluginRegistry,
  type PluginSource,
} from "./plugin-registry";
import { staticFileFromLivePlugin, writeStaticPluginFile } from "./static-plugin-manifest";

export const PLUGIN_MANIFEST_SCHEMA = "bolt.plugin-manifest/v1";
/** Class plugins with no config, and every function/object plugin. */
export const NO_CONFIG = "noconfig";

const HOST_EXTERNALS = ["boltstack", "zod"];

export interface CacheHandler {
  ai: AiMode;
  description?: string;
  params_schema?: Record<string, unknown>;
  params_schema_hash?: string;
}

export interface CacheManifest {
  schema: typeof PLUGIN_MANIFEST_SCHEMA;
  namespace: string;
  version?: string;
  description?: string;
  source_kind: "ts" | "js";
  entry: string;
  artefact_hash: string;
  source_hash: string;
  config_hash: string;
  /** Class plugins key manifests by config. Function and object plugins use noconfig. */
  export_kind: "class" | "value";
  handlers: Record<string, CacheHandler>;
}

export interface BundleBlock {
  module: string;
  reason: string;
}

export class PluginBundleError extends Error {
  readonly namespace: string;
  readonly module: string;

  constructor(namespace: string, block: BundleBlock) {
    super(
      `Plugin "${namespace}" cannot be bundled: ${block.reason} (${block.module}). ` +
        `Native addons and dynamic require/import cannot be content-addressed. ` +
        `Move that work into a spawned helper binary. No manifest was written. ` +
        `Human bolt run can still load this plugin unbundled.`,
    );
    this.name = "PluginBundleError";
    this.namespace = namespace;
    this.module = block.module;
  }
}

export function userHome(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable JSON: sorted object keys, array order preserved, undefined object values omitted. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(",")}}`;
}

export function pluginExportKind(plugin: object): "class" | "value" {
  const ctor = (plugin as { constructor?: unknown }).constructor;
  return typeof ctor === "function" && ctor !== Object ? "class" : "value";
}

export function configRecord(config: unknown): Record<string, unknown> | undefined {
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  if (Object.keys(config as Record<string, unknown>).length === 0) return undefined;
  return config as Record<string, unknown>;
}

export function configKey(
  kind: "class" | "value",
  config: Record<string, unknown> | undefined,
): string {
  if (kind === "class" && config) return sha256(canonicalJson(config));
  return NO_CONFIG;
}

/**
 * SHA-256 of a plugin source tree. Sorted relative paths (forward slashes) plus contents.
 * Skips `node_modules` and `.bolt`. package.json and lockfiles are included.
 */
export function sourceHashOf(root: string): string {
  const files: Array<{ rel: string; abs: string }> = [];
  const walk = (dir: string, rel: string) => {
    let entries: import("fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".bolt") continue;
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, child);
      else if (entry.isFile()) files.push({ rel: child, abs });
    }
  };
  walk(root, "");
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.rel);
    hash.update("\0");
    hash.update(readFileSync(file.abs));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * ponytail: fail closed when Bun leaves a runtime require or a non-literal import().
 * A string that merely mentions import.meta.require also fails. Upgrade path: trust
 * Bun.build logs once they name the dynamic specifier and the .node addon.
 */
export function findBundleBlock(code: string): BundleBlock | undefined {
  const nodeCall = code.match(
    /(?:__require|import\.meta\.require|require)\(\s*(['"`])([^'"`]*\.node)\1\s*\)/,
  );
  if (nodeCall) {
    return {
      module: nodeCall[2],
      reason: "native .node addon cannot be bundled into one file",
    };
  }
  const dynamicRequire = code.match(/(?:__require|import\.meta\.require)\(\s*(?!['"`])([^)]*)\)/);
  if (dynamicRequire) {
    return {
      module: dynamicRequire[1].trim() || "(non-literal)",
      reason: "dynamic require() with a non-literal specifier cannot be bundled",
    };
  }
  const dynamicImport = code.match(/(^|[^\w.])import\s*\(\s*(?!['"`])([^)]*)\)/);
  if (dynamicImport) {
    return {
      module: dynamicImport[2].trim() || "(non-literal)",
      reason: "dynamic import() with a non-literal specifier cannot be bundled",
    };
  }
  if (code.includes("import.meta.require")) {
    return {
      module: "import.meta.require",
      reason: "dynamic load was not inlined into the bundle",
    };
  }
  return undefined;
}

/** Bundle one entry to a single file. Throws PluginBundleError and writes nothing on failure. */
export async function bundlePlugin(namespace: string, entry: string): Promise<string> {
  const outdir = mkdtempSync(path.join(os.tmpdir(), "bolt-bundle-"));
  try {
    const tsconfigPath = path.join(outdir, "tsconfig.json");
    writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: PLUGIN_COMPILER_OPTIONS }));
    const result = await Bun.build({
      entrypoints: [entry],
      outdir,
      target: "bun",
      external: HOST_EXTERNALS,
      packages: "bundle",
      naming: "index.js",
      tsconfig: tsconfigPath,
    });
    if (!result.success) {
      const errors = result.logs.map((log) => log.message ?? String(log)).join("\n");
      throw new PluginBundleError(namespace, {
        module: path.basename(entry),
        reason: errors || "Bun.build failed",
      });
    }
    const outfile = path.join(outdir, "index.js");
    if (!existsSync(outfile)) {
      throw new PluginBundleError(namespace, {
        module: path.basename(entry),
        reason: "Bun.build produced no index.js",
      });
    }
    const rewritten = rewritePluginLocation(readFileSync(outfile, "utf8"), entry);
    const block = findBundleBlock(rewritten);
    if (block) throw new PluginBundleError(namespace, block);
    return rewritten;
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
}

function relativeEntry(root: string, entry: string): string {
  const rel = path.relative(root, entry);
  if (!rel || rel.startsWith("..")) return path.basename(entry);
  return rel.split(path.sep).join("/");
}

function sourceKind(entry: string): "ts" | "js" {
  return entry.endsWith(".ts") || entry.endsWith(".tsx") ? "ts" : "js";
}

export function cacheHandlersFrom(plugin: BoltPlugin): Record<string, CacheHandler> {
  const manifest = plugin.manifest?.handlers ?? {};
  const out: Record<string, CacheHandler> = {};
  for (const name of Object.keys(manifest).sort()) {
    const entry = manifest[name];
    const row: CacheHandler = { ai: entry?.ai ?? false };
    if (entry?.description) row.description = entry.description;
    let schema = entry?.paramsSchema;
    if (!schema) {
      const map = getParamMap(plugin as { constructor: unknown }, name);
      if (map && map.size > 0) {
        const properties: Record<string, unknown> = {};
        for (const [param, meta] of map) {
          properties[param] = { type: "string", description: meta.description };
        }
        schema = { type: "object", properties };
      }
    }
    if (schema && typeof schema === "object") {
      row.params_schema = schema as Record<string, unknown>;
      row.params_schema_hash = sha256(canonicalJson(schema));
    }
    out[name] = row;
  }
  return out;
}

export interface PublishInput {
  namespace: string;
  root: string;
  entry: string;
  cacheRoot: string;
  plugin: BoltPlugin;
  config?: unknown;
  code: string;
}

export interface PublishResult {
  manifestPath: string;
  artefactPath: string;
  sourceHash: string;
  configHash: string;
  artefactHash: string;
}

/**
 * Write bolt.plugin.json, then the content-addressed artefact and the
 * (source_hash, config_hash) manifest. The source hash includes bolt.plugin.json.
 * An existing artefact directory is left untouched.
 */
export function publishBuiltPlugin(input: PublishInput): PublishResult {
  writeStaticPluginFile(input.root, staticFileFromLivePlugin(input.plugin, input.root));
  const sourceHash = sourceHashOf(input.root);
  const kind = pluginExportKind(input.plugin);
  const config = configRecord(input.config);
  const configHash = configKey(kind, config);
  const bytes = Buffer.from(input.code);
  const artefactHash = sha256(bytes);
  const artefactDir = path.join(
    input.cacheRoot,
    "plugins",
    input.namespace,
    "artefacts",
    artefactHash,
  );
  const artefactPath = path.join(artefactDir, "index.js");
  if (!existsSync(artefactPath)) {
    mkdirSync(artefactDir, { recursive: true });
    const tmp = path.join(artefactDir, `.index.${process.pid}.tmp`);
    writeFileSync(tmp, bytes);
    renameSync(tmp, artefactPath);
  }
  const version = input.plugin.manifest?.version?.trim();
  const description = input.plugin.manifest?.description?.trim();
  const manifest: CacheManifest = {
    schema: PLUGIN_MANIFEST_SCHEMA,
    namespace: input.namespace,
    ...(version ? { version } : {}),
    ...(description ? { description } : {}),
    source_kind: sourceKind(input.entry),
    entry: relativeEntry(input.root, input.entry),
    artefact_hash: artefactHash,
    source_hash: sourceHash,
    config_hash: configHash,
    export_kind: kind,
    handlers: cacheHandlersFrom(input.plugin),
  };
  const manifestPath = path.join(
    input.cacheRoot,
    "plugins",
    input.namespace,
    "manifests",
    `${sourceHash}-${configHash}.json`,
  );
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, artefactPath, sourceHash, configHash, artefactHash };
}

export interface ManifestLookup {
  built: boolean;
  manifest?: CacheManifest;
  manifestPath?: string;
}

/** Read-only. Recomputes nothing itself: the caller passes the current source hash and config. */
export function lookupManifest(
  cacheRoot: string,
  namespace: string,
  sourceHash: string,
  config: unknown,
): ManifestLookup {
  const dir = path.join(cacheRoot, "plugins", namespace, "manifests");
  if (!existsSync(dir)) return { built: false };
  const found: CacheManifest[] = [];
  for (const name of readdirSync(dir)) {
    const match = name.match(/^([0-9a-f]{64})-(noconfig|[0-9a-f]{64})\.json$/);
    if (!match || match[1] !== sourceHash) continue;
    try {
      const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as CacheManifest;
      if (parsed.source_hash !== sourceHash || parsed.config_hash !== match[2]) continue;
      if (parsed.schema !== PLUGIN_MANIFEST_SCHEMA) continue;
      found.push(parsed);
    } catch {
      continue;
    }
  }
  if (found.length === 0) return { built: false };
  const kinds = new Set(found.map((item) => item.export_kind));
  if (kinds.size !== 1) return { built: false };
  const kind = [...kinds][0];
  const want = configKey(kind, configRecord(config));
  const hit = found.find((item) => item.config_hash === want);
  if (!hit) return { built: false };
  return {
    built: true,
    manifest: hit,
    manifestPath: path.join(dir, `${sourceHash}-${want}.json`),
  };
}

export function artefactFile(cacheRoot: string, namespace: string, artefactHash: string): string {
  return path.join(cacheRoot, "plugins", namespace, "artefacts", artefactHash, "index.js");
}

/** Read the content-addressed file as bytes. Does not import it. */
export function artefactIntegrity(
  file: string,
  artefactHash: string,
): "ok" | "missing" | "tampered" {
  if (!existsSync(file)) return "missing";
  try {
    return sha256(readFileSync(file)) === artefactHash ? "ok" : "tampered";
  } catch {
    return "missing";
  }
}

/**
 * Live handler set, `ai`, and params schema hash versus the built manifest.
 * Undefined means they match. Used by execute Stage 2.
 */
export function handlersDiffer(plugin: BoltPlugin, manifest: CacheManifest): string | undefined {
  const live = cacheHandlersFrom(plugin);
  const cached = manifest.handlers ?? {};
  const liveNames = Object.keys(live).sort();
  const cachedNames = Object.keys(cached).sort();
  if (liveNames.join("\0") !== cachedNames.join("\0")) {
    return `handlers ${liveNames.join(",") || "(none)"} != ${cachedNames.join(",") || "(none)"}`;
  }
  for (const name of liveNames) {
    if ((live[name].ai ?? false) !== (cached[name].ai ?? false)) {
      return `${name} ai ${String(live[name].ai)} != ${String(cached[name].ai)}`;
    }
    if ((live[name].params_schema_hash ?? "") !== (cached[name].params_schema_hash ?? "")) {
      return `${name} params_schema_hash`;
    }
  }
  return undefined;
}

export function lookupPluginManifest(
  root: string,
  cacheRoot: string,
  namespace: string,
  config: unknown,
): ManifestLookup {
  if (!existsSync(root)) return { built: false };
  return lookupManifest(cacheRoot, namespace, sourceHashOf(root), config);
}

/** Drop manifests for other source hashes, broken manifests, and artefacts nothing references. */
export function prunePluginCache(
  cacheRoot: string,
  namespace: string,
  sourceHash: string,
): { manifests: number; artefacts: number } {
  const base = path.join(cacheRoot, "plugins", namespace);
  const manDir = path.join(base, "manifests");
  const artDir = path.join(base, "artefacts");
  let manifests = 0;
  let artefacts = 0;
  const keep = new Set<string>();
  if (existsSync(manDir)) {
    for (const name of readdirSync(manDir)) {
      const file = path.join(manDir, name);
      let drop = true;
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as CacheManifest;
        const artefact = path.join(artDir, parsed.artefact_hash ?? "", "index.js");
        if (parsed.source_hash === sourceHash && parsed.artefact_hash && existsSync(artefact)) {
          keep.add(parsed.artefact_hash);
          drop = false;
        }
      } catch {
        drop = true;
      }
      if (drop) {
        rmSync(file, { force: true });
        manifests += 1;
      }
    }
  }
  if (existsSync(artDir)) {
    for (const name of readdirSync(artDir)) {
      const artefact = path.join(artDir, name);
      if (!statSync(artefact).isDirectory()) continue;
      if (keep.has(name)) continue;
      rmSync(artefact, { recursive: true, force: true });
      artefacts += 1;
    }
  }
  return { manifests, artefacts };
}

export interface LocatedPlugin {
  namespace: string;
  root: string;
  entry: string;
  source: Exclude<PluginSource, "builtin">;
  /** Content-addressed root: `<project>/.bolt/.cache` or `~/.bolt/.cache`. */
  cacheRoot: string;
  /** Directory `compilePlugin` treats as the project root (JIT cache stays where it is today). */
  jitRoot: string;
}

function isDir(target: string): boolean {
  try {
    return existsSync(target) && statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function preferTs(root: string): string | undefined {
  const ts = path.join(root, "index.ts");
  const js = path.join(root, "index.js");
  if (existsSync(ts)) return ts;
  if (existsSync(js)) return js;
  return undefined;
}

/** User plugins prefer index.js when both exist, matching loadDirectory without a project root. */
function preferJs(root: string): string | undefined {
  const ts = path.join(root, "index.ts");
  const js = path.join(root, "index.js");
  if (existsSync(js)) return js;
  if (existsSync(ts)) return ts;
  return undefined;
}

/**
 * Plugins a project would load, highest priority last so it wins:
 * user, then project `.bolt/plugins`, then bolt.yaml `path`.
 */
export function discoverPlugins(
  configDir: string,
  plugins: ReadonlyArray<{ namespace: string; path?: string }> | undefined,
  home = userHome(),
): LocatedPlugin[] {
  const map = new Map<string, LocatedPlugin>();
  const userDir = path.join(home, ".bolt", "plugins");
  const userCache = path.join(home, ".bolt", ".cache");
  if (isDir(userDir)) {
    for (const name of readdirSync(userDir)) {
      const root = path.join(userDir, name);
      if (!isDir(root)) continue;
      const entry = preferJs(root);
      if (!entry) continue;
      map.set(name, {
        namespace: name,
        root,
        entry,
        source: "user",
        cacheRoot: userCache,
        jitRoot: root,
      });
    }
  }
  const projectCache = path.join(configDir, ".bolt", ".cache");
  const projectDir = path.join(configDir, ".bolt", "plugins");
  if (isDir(projectDir)) {
    for (const name of readdirSync(projectDir)) {
      const root = path.join(projectDir, name);
      if (!isDir(root)) continue;
      const entry = preferTs(root);
      if (!entry) continue;
      map.set(name, {
        namespace: name,
        root,
        entry,
        source: "project",
        cacheRoot: projectCache,
        jitRoot: configDir,
      });
    }
  }
  for (const declared of plugins ?? []) {
    if (!declared.path) continue;
    const resolved = path.resolve(configDir, declared.path);
    const root = pluginDirectory(resolved);
    let entry = resolved;
    if (isDir(resolved)) {
      const picked = preferTs(resolved);
      if (!picked) continue;
      entry = picked;
    } else if (!existsSync(resolved)) {
      continue;
    }
    map.set(declared.namespace, {
      namespace: declared.namespace,
      root,
      entry,
      source: "path",
      cacheRoot: projectCache,
      jitRoot: configDir,
    });
  }
  return [...map.values()].sort((a, b) => (a.namespace < b.namespace ? -1 : 1));
}

export function locateUserPlugin(name: string, home = userHome()): LocatedPlugin | undefined {
  const root = path.join(home, ".bolt", "plugins", name);
  const entry = preferJs(root);
  if (!entry) return undefined;
  return {
    namespace: name,
    root,
    entry,
    source: "user",
    cacheRoot: path.join(home, ".bolt", ".cache"),
    jitRoot: root,
  };
}

export async function refreshLoadedPlugins(
  registry: PluginRegistry,
  plugins: ReadonlyArray<{ namespace: string; config?: unknown }> | undefined,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const namespace of registry.listNamespaces()) {
    const origin: PluginOrigin | undefined = registry.origin(namespace);
    const plugin = registry.get(namespace);
    if (!origin || !plugin) continue;
    try {
      const code = await bundlePlugin(namespace, origin.entry);
      const config = plugins?.find((entry) => entry.namespace === namespace)?.config;
      publishBuiltPlugin({
        namespace,
        root: origin.root,
        entry: origin.entry,
        cacheRoot: origin.cacheRoot,
        plugin,
        config,
        code,
      });
    } catch (error) {
      if (error instanceof PluginBundleError) {
        warnings.push(error.message);
        continue;
      }
      throw error;
    }
  }
  return warnings;
}
