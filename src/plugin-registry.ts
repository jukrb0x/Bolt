import { createHash } from "crypto";
import { spawnSync } from "child_process";
import {
  PLUGIN_BRAND,
  assertClassCapabilities,
  assertPluginApiVersion,
  checkStaticApiVersion,
  hasManifestGetter,
  isBrandedPlugin,
  isDefinedPlugin,
  markDefinedPlugin,
  reflectObjectManifest,
  type AiMode,
  type BoltPlugin,
} from "./plugin";
import path from "path";
import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
} from "fs";
import os from "os";
import { pathToFileURL } from "url";
import { PLUGIN_COMPILER_OPTIONS } from "./plugin-tsconfig";

/** Legacy decorator emit. Compiled binaries do not read a project tsconfig. */
const DECORATOR_TSCONFIG = JSON.stringify({ compilerOptions: PLUGIN_COMPILER_OPTIONS });

const HOST_EXTERNALS = ["boltstack", "zod"];

/**
 * Compile inputs for a plugin directory: non-recursive `.ts` / `.tsx` basenames,
 * sorted. Same set `compilePlugin` / `maxSourceMtime` and `sourcesHash` use.
 */
export function listCompileSources(pluginDir: string): string[] {
  if (!existsSync(pluginDir)) return [];
  return readdirSync(pluginDir)
    .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((entry) => path.join(pluginDir, entry));
}

/** Get the max mtime of all .ts files in a directory (non-recursive). */
function maxSourceMtime(dir: string): number {
  let max = 0;
  for (const file of listCompileSources(dir)) {
    const mt = statSync(file).mtimeMs;
    if (mt > max) max = mt;
  }
  return max;
}

/** Check if a plugin directory has non-dev dependencies that need installing. */
function hasRuntimeDeps(pluginDir: string): boolean {
  const pkgPath = path.join(pluginDir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const deps = pkg.dependencies;
    return deps && Object.keys(deps).length > 0;
  } catch {
    return false;
  }
}

/** Check if node_modules exists in the plugin directory. */
function hasNodeModules(pluginDir: string): boolean {
  return existsSync(path.join(pluginDir, "node_modules"));
}

export function pluginDirectory(resolved: string): string {
  try {
    if (existsSync(resolved) && statSync(resolved).isDirectory()) return resolved;
  } catch {
    // Missing path: report the parent directory with the import error.
  }
  return path.dirname(resolved);
}

function errorText(error: unknown): string {
  if (error instanceof AggregateError) {
    const inner = error.errors.map((item) => (item instanceof Error ? item.message : String(item)));
    const parts = [error.message, ...inner].filter(
      (part, index, all) => part && all.indexOf(part) === index,
    );
    if (parts.length > 0) return parts.join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

function pluginLoadError(name: string, dir: string, error: unknown): Error {
  return new Error(`Failed to load plugin "${name}" from ${dir}:\n${errorText(error)}`);
}

function isTypeScript(file: string): boolean {
  return file.endsWith(".ts") || file.endsWith(".tsx");
}

/** Stable path so two spellings of one file share a cache and two files do not. */
export function canonicalPluginEntry(entryTs: string): string {
  const abs = path.resolve(entryTs);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** Cache file for one source. The namespace alone is not unique. */
export function pluginCacheFile(cacheRoot: string, pluginName: string, entryTs: string): string {
  const id = createHash("sha256").update(canonicalPluginEntry(entryTs)).digest("hex").slice(0, 16);
  return path.join(cacheRoot, ".bolt", ".cache", "plugins", pluginName, id, "index.js");
}

/**
 * Bun.build leaves import.meta.* pointing at the emitted file.
 * Rewrite those reads to the plugin source so adjacent assets still resolve.
 */
export function rewritePluginLocation(source: string, entryTs: string): string {
  const abs = canonicalPluginEntry(entryTs);
  const values: Record<string, string> = {
    url: pathToFileURL(abs).href,
    dir: path.dirname(abs),
    path: abs,
    file: path.basename(abs),
  };
  let out = source;
  for (const [prop, value] of Object.entries(values)) {
    out = out.replace(new RegExp(`import\\.meta\\.${prop}\\b`, "g"), JSON.stringify(value));
  }
  return out;
}

/** Copy the brand and the export's own apiVersion. Never substitute the host version. */
function retainPluginBrand(plugin: object, apiVersion: unknown): void {
  Object.defineProperty(plugin, PLUGIN_BRAND, { value: true });
  if (apiVersion !== undefined) {
    Object.defineProperty(plugin, "apiVersion", {
      value: apiVersion,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

/**
 * Install plugin dependencies with this process, not a `bun` binary on PATH.
 * Compiled bolt accepts bun's CLI when BUN_BE_BUN=1.
 */
export function pluginInstallInvocation(env: NodeJS.ProcessEnv = process.env): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  return {
    command: process.execPath,
    args: ["install"],
    env: { ...env, BUN_BE_BUN: "1" },
  };
}

function installPluginDependencies(pluginName: string, sourceDir: string): void {
  const invocation = pluginInstallInvocation();
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: sourceDir,
    stdio: "inherit",
    env: invocation.env,
  });
  if (result.status !== 0) {
    const detail = result.error ? `\n${result.error.message}` : "";
    throw new Error(`Failed to install dependencies for plugin "${pluginName}"${detail}`);
  }
}

export type PluginSource = "builtin" | "user" | "project" | "path";

/** Where a loaded non-builtin plugin came from, for the content-addressed cache. */
export interface PluginOrigin {
  /** Plugin source directory (the folder that contains the entry). */
  root: string;
  /** Source entry that was loaded (`index.ts` / `index.js`), not the JIT cache file. */
  entry: string;
  source: Exclude<PluginSource, "builtin">;
  /** `<project>/.bolt/.cache` or `~/.bolt/.cache`. */
  cacheRoot: string;
}

const SOURCE_RANK: Record<PluginSource, number> = { path: 0, project: 1, user: 2, builtin: 3 };

export interface CapabilityMatch {
  ref: string;
  namespace: string;
  handler: string;
  ai: AiMode;
  source: PluginSource;
  capabilities: string[];
}

export class PluginRegistry {
  private plugins = new Map<string, BoltPlugin>();
  private sources = new Map<string, PluginSource>();
  /** Namespace order of `plugins[]` in bolt.yaml, used to order capability matches. */
  private configOrder: string[] = [];
  /** Non-fatal registration notes, e.g. a redundant `static apiVersion`. */
  readonly warnings: string[] = [];
  private origins = new Map<string, PluginOrigin>();
  /** Set immediately before a load so `register` can record the source path. */
  private pendingOrigin: PluginOrigin | undefined;

  prepareOrigin(origin: PluginOrigin | undefined): void {
    this.pendingOrigin = origin;
  }

  origin(namespace: string): PluginOrigin | undefined {
    return this.origins.get(namespace);
  }

  /**
   * Branded plugins keep the manifest their copy already built.
   * Plain handler maps are reflected here (ai: false, no params).
   */
  private normalize(plugin: BoltPlugin): BoltPlugin {
    if (isBrandedPlugin(plugin) || isDefinedPlugin(plugin)) {
      const note = checkStaticApiVersion(plugin);
      if (note) this.warnings.push(note);
      assertPluginApiVersion(plugin);
      // Class plugins: tags are checked here because decorators run before the
      // instance apiVersion is known. definePlugin already checked its own.
      if (hasManifestGetter(plugin)) assertClassCapabilities(plugin);
      return plugin;
    }
    if (hasManifestGetter(plugin)) {
      throw new Error(
        `Plugin "${plugin.namespace}" has a manifest getter but is missing Symbol.for("boltstack.plugin") and an apiVersion (1 or 2). Fix: extend PluginBase or use definePlugin() from boltstack instead of a hand-written manifest getter.`,
      );
    }
    plugin.manifest = reflectObjectManifest(plugin);
    return plugin;
  }

  register(plugin: BoltPlugin, source: PluginSource = "builtin"): void {
    const loaded = this.normalize(plugin);
    this.plugins.set(loaded.namespace, loaded);
    this.sources.set(loaded.namespace, source);
    if (this.pendingOrigin) {
      this.origins.set(loaded.namespace, {
        ...this.pendingOrigin,
        source: this.pendingOrigin.source,
      });
      this.pendingOrigin = undefined;
    }
  }

  setConfigOrder(namespaces: string[]): void {
    this.configOrder = [...namespaces];
  }

  /**
   * Handlers that carry a capability tag. Exact match by default; `exact: false`
   * also matches tags below `cap` on dot boundaries (`vcs` matches `vcs.sync`).
   * Order: bolt.yaml `plugins[]` order, then source precedence, then ref.
   * A shadowed namespace contributes nothing because only the winner is registered.
   */
  findByCapability(cap: string, opts: { exact?: boolean } = {}): CapabilityMatch[] {
    const exact = opts.exact ?? true;
    const hit = (tag: string) => tag === cap || (!exact && tag.startsWith(`${cap}.`));
    const matches: CapabilityMatch[] = [];
    for (const [namespace, plugin] of this.plugins) {
      const handlers = plugin.manifest?.handlers ?? {};
      for (const [handler, entry] of Object.entries(handlers)) {
        const tags = entry.capabilities ?? [];
        if (!tags.some(hit)) continue;
        matches.push({
          ref: `${namespace}/${handler}`,
          namespace,
          handler,
          ai: entry.ai,
          source: this.sources.get(namespace) ?? "builtin",
          capabilities: [...tags],
        });
      }
    }
    const configRank = (ns: string) => {
      const i = this.configOrder.indexOf(ns);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return matches.sort(
      (a, b) =>
        configRank(a.namespace) - configRank(b.namespace) ||
        SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
        (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
    );
  }

  get(namespace: string): BoltPlugin | undefined {
    return this.plugins.get(namespace);
  }

  listNamespaces(): string[] {
    return [...this.plugins.keys()];
  }

  /**
   * Compile a plugin entry to cached JS. boltstack and zod stay external so the
   * virtual module can supply the host instances. Decorators are always legacy.
   */
  private async compilePlugin(
    pluginName: string,
    entryTs: string,
    cacheRoot: string,
  ): Promise<string> {
    const sourceDir = path.dirname(entryTs);
    const cachedJs = pluginCacheFile(cacheRoot, pluginName, entryTs);
    const cacheDir = path.dirname(cachedJs);

    if (existsSync(cachedJs)) {
      const cacheMtime = statSync(cachedJs).mtimeMs;
      const sourceMtime = Math.max(maxSourceMtime(sourceDir), statSync(entryTs).mtimeMs);
      if (cacheMtime >= sourceMtime) return cachedJs;
    }

    if (hasRuntimeDeps(sourceDir) && !hasNodeModules(sourceDir)) {
      installPluginDependencies(pluginName, sourceDir);
    }

    mkdirSync(cacheDir, { recursive: true });
    const tsconfigPath = path.join(cacheRoot, ".bolt", ".cache", "decorator-tsconfig.json");
    mkdirSync(path.dirname(tsconfigPath), { recursive: true });
    writeFileSync(tsconfigPath, DECORATOR_TSCONFIG);
    const buildResult = await Bun.build({
      entrypoints: [entryTs],
      outdir: cacheDir,
      target: "bun",
      external: HOST_EXTERNALS,
      naming: "index.js",
      tsconfig: tsconfigPath,
    });

    if (!buildResult.success) {
      const errors = buildResult.logs.map((l: any) => l.message ?? String(l)).join("\n");
      throw new Error(`Failed to compile plugin "${pluginName}":\n${errors}`);
    }

    writeFileSync(cachedJs, rewritePluginLocation(readFileSync(cachedJs, "utf8"), entryTs));
    return cachedJs;
  }

  /**
   * Load a plugin from a path. Handles both pre-compiled JS and raw TS.
   * For class exports, instantiates with no config.
   */
  async loadFromPath(
    namespace: string,
    pluginPath: string,
    cacheRoot?: string,
    source: PluginSource = "path",
  ): Promise<void> {
    const file = isTypeScript(pluginPath)
      ? await this.compilePlugin(namespace, pluginPath, cacheRoot ?? path.dirname(pluginPath))
      : pluginPath;
    const mod = await import(file);
    const exported = mod.default ?? mod;

    const plugin = this.resolvePluginExport(exported, namespace);
    this.register(plugin, source);
  }

  /**
   * Detect whether an export is a class (constructor) or a POJO plugin instance.
   * If class, instantiate it. If POJO, use directly.
   */
  private resolvePluginExport(
    exported: any,
    namespace: string,
    config?: unknown,
    deps?: Record<string, BoltPlugin>,
  ): BoltPlugin {
    // Class detection: has .prototype and is a function (constructor)
    if (typeof exported === "function" && exported.prototype) {
      const instance = new exported(config, deps);
      // Trigger the lazy handlers getter so _handlers is populated as an own property
      const _h = instance.handlers;
      if (!_h || Object.keys(_h).length === 0) {
        throw new Error(
          `Class plugin "${namespace}" has no handlers. ` +
            `Ensure methods are decorated with @handler().`,
        );
      }
      // Return the instance directly — it implements BoltPlugin and keeps
      // prototype methods (describe, handlers getter) working correctly
      if (!instance.namespace) instance.namespace = namespace;
      return instance;
    }

    // POJO plugin (backward compatible). definePlugin() objects keep their manifest.
    if (!exported || !exported.handlers) {
      throw new Error(
        `Plugin "${namespace}" has no default export with handlers.\n` +
          `For class-based plugins, ensure you export a class extending PluginBase. ` +
          `New plugins should export definePlugin().`,
      );
    }
    const defined = isDefinedPlugin(exported);
    const branded = isBrandedPlugin(exported);
    const apiVersion = (exported as { apiVersion?: unknown }).apiVersion;
    const plugin: BoltPlugin = { ...exported, namespace: exported.namespace || namespace };
    if (defined) markDefinedPlugin(plugin);
    if (branded) retainPluginBrand(plugin, apiVersion);
    return plugin;
  }

  /**
   * Load all plugins from a directory (auto-discovery).
   * Supports JIT compilation for .ts plugins when projectRoot is provided.
   */
  async loadDirectory(
    dir: string,
    projectRoot?: string,
    source: PluginSource = "project",
  ): Promise<void> {
    if (!existsSync(dir)) return;

    for (const entry of readdirSync(dir)) {
      const entryPath = path.join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      // Prefer compiled .js over .ts (backward compat)
      const jsFile = path.join(entryPath, "index.js");
      const tsFile = path.join(entryPath, "index.ts");

      let candidate: string | null = null;
      let sourceEntry: string | null = null;

      if (existsSync(tsFile) && projectRoot) {
        sourceEntry = tsFile;
        try {
          candidate = await this.compilePlugin(entry, tsFile, projectRoot);
        } catch (e: unknown) {
          throw pluginLoadError(entry, entryPath, e);
        }
      } else if (existsSync(jsFile)) {
        sourceEntry = jsFile;
        candidate = jsFile;
      } else if (existsSync(tsFile)) {
        // loadFromPath compiles this, with the plugin directory as the cache root.
        sourceEntry = tsFile;
        candidate = tsFile;
      }

      if (candidate && sourceEntry) {
        const cacheRoot =
          source === "user"
            ? path.join(os.homedir(), ".bolt", ".cache")
            : path.join(projectRoot ?? path.dirname(dir), ".bolt", ".cache");
        this.prepareOrigin({
          root: entryPath,
          entry: sourceEntry,
          source: source === "builtin" ? "project" : source,
          cacheRoot,
        });
        try {
          await this.loadFromPath(entry, candidate, undefined, source);
        } catch (e: unknown) {
          this.prepareOrigin(undefined);
          throw pluginLoadError(entry, entryPath, e);
        }
      }
    }
  }

  /**
   * Load and instantiate a class-based plugin with config and deps.
   * Used by buildRegistry for plugins declared in bolt.yaml with config blocks.
   */
  async loadAndInstantiate(
    namespace: string,
    pluginPath: string,
    config?: unknown,
    deps?: Record<string, BoltPlugin>,
    cacheRoot?: string,
    source: PluginSource = "path",
  ): Promise<void> {
    const file = isTypeScript(pluginPath)
      ? await this.compilePlugin(namespace, pluginPath, cacheRoot ?? path.dirname(pluginPath))
      : pluginPath;
    const mod = await import(file);
    const exported = mod.default ?? mod;
    const plugin = this.resolvePluginExport(exported, namespace, config, deps);
    this.register(plugin, source);
  }
}

export async function buildRegistry(
  cfg: { plugins?: { namespace: string; path?: string; config?: Record<string, unknown> }[] },
  configDir: string,
  builtins: BoltPlugin[],
): Promise<PluginRegistry> {
  const reg = new PluginRegistry();

  // 1. Built-ins (lowest priority)
  for (const p of builtins) reg.register(p);

  // 2. User-scope: ~/.bolt/plugins/
  const userPluginsDir = path.join(os.homedir(), ".bolt", "plugins");
  await reg.loadDirectory(userPluginsDir, undefined, "user");

  // 3. Project-scope auto-discovery: <project_root>/.bolt/plugins/
  const projectPluginsDir = path.join(configDir, ".bolt", "plugins");
  await reg.loadDirectory(projectPluginsDir, configDir, "project");

  reg.setConfigOrder((cfg.plugins ?? []).map((entry) => entry.namespace));

  // 4. Project-scope explicit declarations (highest priority).
  // Pathless entries are builtin config (for example ue metadata) and are not imported.
  for (const entry of cfg.plugins ?? []) {
    if (!entry.path) continue;
    const resolved = path.resolve(configDir, entry.path);
    const dir = pluginDirectory(resolved);
    let sourceEntry = resolved;
    try {
      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        const ts = path.join(resolved, "index.ts");
        const js = path.join(resolved, "index.js");
        sourceEntry = existsSync(ts) ? ts : js;
      }
    } catch {
      // Missing path: loadAndInstantiate reports it.
    }
    reg.prepareOrigin({
      root: dir,
      entry: sourceEntry,
      source: "path",
      cacheRoot: path.join(configDir, ".bolt", ".cache"),
    });
    try {
      if (entry.config) {
        await reg.loadAndInstantiate(entry.namespace, resolved, entry.config, undefined, configDir);
      } else {
        await reg.loadFromPath(entry.namespace, resolved, configDir);
      }
    } catch (e: unknown) {
      reg.prepareOrigin(undefined);
      throw pluginLoadError(entry.namespace, dir, e);
    }
  }

  return reg;
}
