import type { BoltPlugin } from "./plugin";
import path from "path";
import { existsSync, readdirSync, statSync, readFileSync, mkdirSync } from "fs";
import os from "os";

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

export class PluginRegistry {
  private plugins = new Map<string, BoltPlugin>();

  register(plugin: BoltPlugin): void {
    this.plugins.set(plugin.namespace, plugin);
  }

  get(namespace: string): BoltPlugin | undefined {
    return this.plugins.get(namespace);
  }

  listNamespaces(): string[] {
    return [...this.plugins.keys()];
  }

  /**
   * Compile a plugin's TypeScript source to a cached JS file using Bun.build().
   * Returns the path to the cached JS file.
   */
  private async jitCompile(pluginName: string, sourceDir: string, projectRoot: string): Promise<string> {
    const cacheDir = path.join(projectRoot, ".bolt", ".cache", "plugins", pluginName);
    const cachedJs = path.join(cacheDir, "index.js");
    const entryTs = path.join(sourceDir, "index.ts");

    // Check if cache is fresh
    if (existsSync(cachedJs)) {
      const cacheMtime = statSync(cachedJs).mtimeMs;
      const sourceMtime = maxSourceMtime(sourceDir);
      if (cacheMtime >= sourceMtime) {
        return cachedJs; // Cache is fresh
      }
    }

    // Auto-install runtime deps if needed
    if (hasRuntimeDeps(sourceDir) && !hasNodeModules(sourceDir)) {
      const { spawnSync } = await import("child_process");
      const result = spawnSync("bun", ["install"], { cwd: sourceDir, stdio: "inherit" });
      if (result.status !== 0) {
        throw new Error(`Failed to install dependencies for plugin "${pluginName}"`);
      }
    }

    // Compile with Bun.build()
    mkdirSync(cacheDir, { recursive: true });
    const buildResult = await Bun.build({
      entrypoints: [entryTs],
      outdir: cacheDir,
      target: "bun",
      external: ["boltstack"],
      naming: "index.js",
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
  async loadFromPath(namespace: string, pluginPath: string): Promise<void> {
    const mod = await import(pluginPath);
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
          `Ensure methods are decorated with @handler().`
        );
      }
      // Return the instance directly — it implements BoltPlugin and keeps
      // prototype methods (describe, handlers getter) working correctly
      if (!instance.namespace) instance.namespace = namespace;
      return instance;
    }

    // POJO plugin (backward compatible)
    if (!exported || !exported.handlers) {
      throw new Error(
        `Plugin "${namespace}" has no default export with handlers.\n` +
        `For class-based plugins, ensure you export a class extending PluginBase.`
      );
    }
    return { ...exported, namespace: exported.namespace || namespace };
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
        // JIT compile .ts → cached .js
        try {
          candidate = await this.jitCompile(entry, entryPath, projectRoot);
        } catch (e: any) {
          console.warn(`[Bolt] JIT compilation failed for plugin "${entry}": ${e.message}`);
          // Fall back to pre-compiled JS if available
          if (existsSync(jsFile)) candidate = jsFile;
        }
      } else if (existsSync(jsFile)) {
        candidate = jsFile;
      } else if (existsSync(tsFile)) {
        // No projectRoot for caching — try direct import (Bun handles .ts)
        candidate = tsFile;
      }

      if (candidate) {
        try {
          await this.loadFromPath(entry, candidate);
        } catch (e: any) {
          console.warn(`[Bolt] Failed to load plugin "${entry}" from ${candidate}: ${e.message}`);
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
  ): Promise<void> {
    const mod = await import(pluginPath);
    const exported = mod.default ?? mod;

    // Validate config against descriptor schema if available
    let validatedConfig = config;
    if (typeof exported === "function" && exported.prototype) {
      // Construct a temporary instance to access the descriptor
      const temp = new exported();
      if (temp.descriptor?.configSchema && config !== undefined) {
        const result = temp.descriptor.configSchema.safeParse(config);
        if (!result.success) {
          const issues = result.error.issues.map((i: any) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
          throw new Error(`Invalid config for plugin "${namespace}":\n${issues}`);
        }
        validatedConfig = result.data; // Use parsed (with defaults applied)
      }
    }

    const plugin = this.resolvePluginExport(exported, namespace, validatedConfig, deps);
    this.register(plugin);
  }
}

export async function buildRegistry(
  cfg: { plugins?: { namespace: string; path: string; config?: Record<string, unknown> }[] },
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

  // 4. Project-scope explicit declarations (highest priority)
  for (const entry of cfg.plugins ?? []) {
    const resolved = path.resolve(configDir, entry.path);
    if (entry.config) {
      await reg.loadAndInstantiate(entry.namespace, resolved, entry.config);
    } else {
      await reg.loadFromPath(entry.namespace, resolved);
    }
  }

  return reg;
}
