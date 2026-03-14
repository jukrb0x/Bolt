import type { BoltPlugin } from "./plugin";
import path from "path";
import { existsSync, readdirSync, statSync } from "fs";
import os from "os";

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

  async loadFromPath(namespace: string, pluginPath: string): Promise<void> {
    // Try to load the plugin directly
    // This works for:
    // 1. Object-based plugins (import type is erased)
    // 2. Pre-compiled JS plugins
    const mod = await import(pluginPath);
    const plugin: BoltPlugin = mod.default ?? mod;

    if (!plugin || !plugin.handlers) {
      throw new Error(
        `Plugin at "${pluginPath}" has no default export with handlers.\n` +
        `For class-based plugins, run: bolt plugin build ${namespace}`
      );
    }

    this.register({ ...plugin, namespace: plugin.namespace || namespace });
  }

  async loadDirectory(dir: string): Promise<void> {
    if (!existsSync(dir)) return;

    for (const entry of readdirSync(dir)) {
      const entryPath = path.join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      // Prefer compiled .js over .ts
      const jsFile = path.join(entryPath, "index.js");
      const tsFile = path.join(entryPath, "index.ts");

      let candidate: string | null = null;
      if (existsSync(jsFile)) {
        candidate = jsFile;
      } else if (existsSync(tsFile)) {
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
}

export async function buildRegistry(
  cfg: { plugins?: { namespace: string; path: string }[] },
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
  await reg.loadDirectory(projectPluginsDir);

  // 4. Project-scope explicit declarations (highest priority)
  for (const entry of cfg.plugins ?? []) {
    const resolved = path.resolve(configDir, entry.path);
    await reg.loadFromPath(entry.namespace, resolved);
  }

  return reg;
}
