import { spawnSync } from "child_process";
import {
  PLUGIN_API_VERSION,
  assertPluginApiVersion,
  brandPlugin,
  hasManifestGetter,
  isBrandedPlugin,
  isDefinedPlugin,
  markDefinedPlugin,
  reflectObjectManifest,
  type BoltPlugin,
} from "./plugin";
import path from "path";
import { existsSync, readdirSync, statSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import os from "os";

/** Legacy decorator emit. Compiled binaries do not read a project tsconfig. */
const DECORATOR_TSCONFIG = JSON.stringify({
  compilerOptions: {
    experimentalDecorators: true,
    useDefineForClassFields: false,
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
  },
});

const HOST_EXTERNALS = ["boltstack", "zod"];

/** Get the max mtime of all .ts files in a directory (non-recursive). */
function maxSourceMtime(dir: string): number {
  let max = 0;
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      const mt = statSync(path.join(dir, entry)).mtimeMs;
      if (mt > max) max = mt;
    }
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

function pluginDirectory(resolved: string): string {
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

export class PluginRegistry {
  private plugins = new Map<string, BoltPlugin>();

  /**
   * Branded plugins keep the manifest their copy already built.
   * Plain handler maps are reflected here (ai: false, no params).
   */
  private normalize(plugin: BoltPlugin): BoltPlugin {
    if (isBrandedPlugin(plugin) || isDefinedPlugin(plugin)) {
      assertPluginApiVersion(plugin);
      return plugin;
    }
    if (hasManifestGetter(plugin)) {
      throw new Error(
        `Plugin "${plugin.namespace}" is missing Symbol.for("boltstack.plugin") and apiVersion ${PLUGIN_API_VERSION}.`,
      );
    }
    plugin.manifest = reflectObjectManifest(plugin);
    return plugin;
  }

  register(plugin: BoltPlugin): void {
    const loaded = this.normalize(plugin);
    this.plugins.set(loaded.namespace, loaded);
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
    const cacheDir = path.join(cacheRoot, ".bolt", ".cache", "plugins", pluginName);
    const cachedJs = path.join(cacheDir, "index.js");

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

    return cachedJs;
  }

  /**
   * Load a plugin from a path. Handles both pre-compiled JS and raw TS.
   * For class exports, instantiates with no config.
   */
  async loadFromPath(namespace: string, pluginPath: string, cacheRoot?: string): Promise<void> {
    const file = isTypeScript(pluginPath)
      ? await this.compilePlugin(namespace, pluginPath, cacheRoot ?? path.dirname(pluginPath))
      : pluginPath;
    const mod = await import(file);
    const exported = mod.default ?? mod;

    const plugin = this.resolvePluginExport(exported, namespace);
    this.register(plugin);
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
    if (branded) {
      brandPlugin(plugin, typeof apiVersion === "number" ? apiVersion : PLUGIN_API_VERSION);
    }
    return plugin;
  }

  /**
   * Load all plugins from a directory (auto-discovery).
   * Supports JIT compilation for .ts plugins when projectRoot is provided.
   */
  async loadDirectory(dir: string, projectRoot?: string): Promise<void> {
    if (!existsSync(dir)) return;

    for (const entry of readdirSync(dir)) {
      const entryPath = path.join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      // Prefer compiled .js over .ts (backward compat)
      const jsFile = path.join(entryPath, "index.js");
      const tsFile = path.join(entryPath, "index.ts");

      let candidate: string | null = null;

      if (existsSync(tsFile) && projectRoot) {
        try {
          candidate = await this.compilePlugin(entry, tsFile, projectRoot);
        } catch (e: unknown) {
          throw pluginLoadError(entry, entryPath, e);
        }
      } else if (existsSync(jsFile)) {
        candidate = jsFile;
      } else if (existsSync(tsFile)) {
        // loadFromPath compiles this, with the plugin directory as the cache root.
        candidate = tsFile;
      }

      if (candidate) {
        try {
          await this.loadFromPath(entry, candidate);
        } catch (e: unknown) {
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
  ): Promise<void> {
    const file = isTypeScript(pluginPath)
      ? await this.compilePlugin(namespace, pluginPath, cacheRoot ?? path.dirname(pluginPath))
      : pluginPath;
    const mod = await import(file);
    const exported = mod.default ?? mod;
    const plugin = this.resolvePluginExport(exported, namespace, config, deps);
    this.register(plugin);
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
  await reg.loadDirectory(userPluginsDir);

  // 3. Project-scope auto-discovery: <project_root>/.bolt/plugins/
  const projectPluginsDir = path.join(configDir, ".bolt", "plugins");
  await reg.loadDirectory(projectPluginsDir, configDir);

  // 4. Project-scope explicit declarations (highest priority).
  // Pathless entries are builtin config (for example ue metadata) and are not imported.
  for (const entry of cfg.plugins ?? []) {
    if (!entry.path) continue;
    const resolved = path.resolve(configDir, entry.path);
    const dir = pluginDirectory(resolved);
    try {
      if (entry.config) {
        await reg.loadAndInstantiate(entry.namespace, resolved, entry.config, undefined, configDir);
      } else {
        await reg.loadFromPath(entry.namespace, resolved, configDir);
      }
    } catch (e: unknown) {
      throw pluginLoadError(entry.namespace, dir, e);
    }
  }

  return reg;
}
