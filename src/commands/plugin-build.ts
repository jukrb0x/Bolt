import { defineCommand } from "citty";
import pc from "picocolors";
import { loadConfig } from "../config";
import { findConfig } from "../discover";
import { CONFIG_EXIT_CODE, USAGE_EXIT_CODE } from "../exit-codes";
import { PluginRegistry } from "../plugin-registry";
import {
  bundlePlugin,
  discoverPlugins,
  locateUserPlugin,
  PluginBundleError,
  prunePluginCache,
  publishBuiltPlugin,
  type LocatedPlugin,
} from "../plugin-cache";
import { parseStrictArgs, printUsageError, UsageError } from "../strict-args";

async function loadLocated(located: LocatedPlugin, config: unknown): Promise<PluginRegistry> {
  const reg = new PluginRegistry();
  const hasConfig =
    !!config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    Object.keys(config).length > 0;
  if (hasConfig) {
    await reg.loadAndInstantiate(
      located.namespace,
      located.entry,
      config,
      undefined,
      located.jitRoot,
      located.source,
    );
  } else {
    await reg.loadFromPath(located.namespace, located.entry, located.jitRoot, located.source);
  }
  return reg;
}

function userTargets(names: string[]): LocatedPlugin[] {
  const selected =
    names.length > 0
      ? names
      : discoverPlugins(process.cwd(), undefined)
          .filter((item) => item.source === "user")
          .map((item) => item.namespace);
  const targets: LocatedPlugin[] = [];
  for (const name of selected) {
    const located = locateUserPlugin(name);
    if (!located) {
      console.error(pc.red(`User plugin not found: ~/.bolt/plugins/${name}`));
      process.exit(CONFIG_EXIT_CODE);
    }
    targets.push(located);
  }
  return targets;
}

export default defineCommand({
  meta: {
    name: "build",
    description: "Bundle plugins and write content-addressed manifests for the current config",
  },
  args: {
    user: {
      type: "boolean",
      default: false,
      description: "Build from user scope (~/.bolt/plugins/) only",
    },
    prune: {
      type: "boolean",
      default: false,
      description: "Delete manifests for other source hashes and unreferenced artefacts",
    },
  },
  async run({ args, rawArgs }) {
    let names: string[];
    try {
      const parsed = parseStrictArgs(rawArgs ?? [], {
        command: "plugin build",
        booleans: ["user", "prune"],
        strings: [],
        booleanLookup: new Map([
          ["user", "user"],
          ["prune", "prune"],
        ]),
        stringLookup: new Map(),
        allowParams: false,
      });
      names = parsed.positionals;
    } catch (error) {
      if (error instanceof UsageError) {
        printUsageError(error.message);
        process.exit(USAGE_EXIT_CODE);
      }
      throw error;
    }

    const userOnly = !!args.user;
    const prune = !!args.prune;
    const configPath = await findConfig(process.cwd());
    let cfg: Awaited<ReturnType<typeof loadConfig>> | undefined;
    if (configPath) {
      try {
        cfg = await loadConfig(configPath);
      } catch (error) {
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        process.exit(CONFIG_EXIT_CODE);
      }
    } else if (!userOnly && names.length === 0) {
      console.error(
        pc.red("bolt.yaml not found — run from a project directory, or use --user for user-scope"),
      );
      process.exit(CONFIG_EXIT_CODE);
    }

    const configDir = cfg?.configDir;
    let targets: LocatedPlugin[];
    if (userOnly) {
      targets = userTargets(names);
    } else if (names.length === 0) {
      targets = discoverPlugins(configDir!, cfg?.plugins);
    } else {
      const all = discoverPlugins(configDir ?? process.cwd(), cfg?.plugins);
      targets = [];
      for (const name of names) {
        const located = all.find((item) => item.namespace === name) ?? locateUserPlugin(name);
        if (!located) {
          console.error(
            pc.red(
              `Plugin "${name}" not found under .bolt/plugins/${name}, bolt.yaml plugins[].path, or ~/.bolt/plugins/${name}`,
            ),
          );
          process.exit(CONFIG_EXIT_CODE);
        }
        targets.push(located);
      }
    }

    if (targets.length === 0) {
      console.log("No project or user plugins to build.");
      return;
    }

    for (const located of targets) {
      const config = cfg?.plugins?.find((entry) => entry.namespace === located.namespace)?.config;
      let code: string;
      try {
        code = await bundlePlugin(located.namespace, located.entry);
      } catch (error) {
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        process.exit(error instanceof PluginBundleError ? 1 : 1);
      }

      let reg: PluginRegistry;
      try {
        reg = await loadLocated(located, config);
      } catch (error) {
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
      const plugin = reg.get(located.namespace);
      if (!plugin) {
        console.error(pc.red(`Plugin "${located.namespace}" did not register after load`));
        process.exit(1);
      }

      const published = publishBuiltPlugin({
        namespace: located.namespace,
        root: located.root,
        entry: located.entry,
        cacheRoot: located.cacheRoot,
        plugin,
        config,
        code,
      });
      console.log(
        pc.green(
          `✓ ${located.namespace}  ${published.configHash}  ${published.artefactHash.slice(0, 16)}…`,
        ),
      );
      console.log(pc.dim(`  manifest ${published.manifestPath}`));
      console.log(pc.dim(`  artefact ${published.artefactPath}`));

      if (prune) {
        const removed = prunePluginCache(
          located.cacheRoot,
          located.namespace,
          published.sourceHash,
        );
        if (removed.manifests > 0 || removed.artefacts > 0) {
          console.log(
            pc.dim(`  pruned ${removed.manifests} manifest(s), ${removed.artefacts} artefact(s)`),
          );
        }
      }
    }
  },
});
