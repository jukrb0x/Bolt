import { defineCommand } from "citty";
import { existsSync, statSync } from "fs";
import { homedir as osHomedir } from "os";

function homedir(): string {
  return process.env.HOME || process.env.USERPROFILE || osHomedir();
}
import path from "path";
import pc from "picocolors";
import { loadConfig } from "../config";
import { findConfig } from "../discover";
import { CONFIG_EXIT_CODE, USAGE_EXIT_CODE } from "../exit-codes";
import { PluginRegistry, pluginDirectory } from "../plugin-registry";
import { staticFileFromLivePlugin, writeStaticPluginFile } from "../static-plugin-manifest";

function preferEntry(root: string): string {
  const ts = path.join(root, "index.ts");
  const js = path.join(root, "index.js");
  if (existsSync(ts)) return ts;
  if (existsSync(js)) return js;
  throw new Error(`No index.ts or index.js in ${root}`);
}

function isDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

interface LocatedPlugin {
  root: string;
  cacheRoot: string;
  entry: string;
  source: "user" | "project" | "path";
}

async function locatePlugin(name: string, user: boolean): Promise<LocatedPlugin> {
  const configPath = await findConfig(process.cwd());
  const configDir = configPath ? path.dirname(path.resolve(configPath)) : null;

  if (user) {
    const root = path.join(homedir(), ".bolt", "plugins", name);
    if (!existsSync(root)) {
      throw new Error(`User plugin not found: ${root}`);
    }
    return { root, cacheRoot: root, entry: preferEntry(root), source: "user" };
  }

  if (configDir) {
    const projectRoot = path.join(configDir, ".bolt", "plugins", name);
    if (existsSync(projectRoot)) {
      return {
        root: projectRoot,
        cacheRoot: configDir,
        entry: preferEntry(projectRoot),
        source: "project",
      };
    }

    const cfg = await loadConfig(configPath!);
    const entry = (cfg.plugins ?? []).find((p) => p.namespace === name && p.path);
    if (entry?.path) {
      const resolved = path.resolve(configDir, entry.path);
      const root = pluginDirectory(resolved);
      const fileEntry = existsSync(resolved) && !isDir(resolved) ? resolved : preferEntry(root);
      return { root, cacheRoot: configDir, entry: fileEntry, source: "path" };
    }
  }

  const userRoot = path.join(homedir(), ".bolt", "plugins", name);
  if (existsSync(userRoot)) {
    return {
      root: userRoot,
      cacheRoot: userRoot,
      entry: preferEntry(userRoot),
      source: "user",
    };
  }

  if (!configPath) {
    throw new Error(
      "bolt.yaml not found — run from a project directory, or use --user for user-scope",
    );
  }
  throw new Error(
    `Plugin "${name}" not found under .bolt/plugins/${name}, bolt.yaml plugins[].path, or ~/.bolt/plugins/${name}`,
  );
}

export default defineCommand({
  meta: {
    name: "build",
    description: "Compile a plugin once and write bolt.plugin.json for bolt ai",
  },
  args: {
    name: {
      type: "positional" as const,
      required: true,
      description: "Plugin namespace to build",
    },
    user: {
      type: "boolean",
      default: false,
      description: "Build from user scope (~/.bolt/plugins/)",
    },
  },
  async run({ args }) {
    const name = args.name as string;
    if (!name) {
      console.error(pc.red("Usage: bolt plugin build <namespace> [--user]"));
      process.exit(USAGE_EXIT_CODE);
    }

    let located: LocatedPlugin;
    try {
      located = await locatePlugin(name, !!args.user);
    } catch (e: unknown) {
      console.error(pc.red(e instanceof Error ? e.message : String(e)));
      process.exit(CONFIG_EXIT_CODE);
    }

    const reg = new PluginRegistry();
    try {
      await reg.loadFromPath(name, located.entry, located.cacheRoot, located.source);
    } catch (e: unknown) {
      console.error(pc.red(e instanceof Error ? e.message : String(e)));
      process.exit(1);
    }

    const plugin = reg.get(name);
    if (!plugin) {
      console.error(pc.red(`Plugin "${name}" did not register after load`));
      process.exit(1);
    }

    const file = staticFileFromLivePlugin(plugin, located.root);
    const out = writeStaticPluginFile(located.root, file);
    console.log(pc.green(`✓ Wrote ${out}`));
    console.log(pc.dim(`  sourcesHash ${file.sourcesHash.slice(0, 16)}…`));
  },
});
