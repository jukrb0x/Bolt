import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig } from "../config";
import { buildRegistry } from "../plugin-registry";
import { builtinPlugins } from "../plugins";
import path from "path";
import pc from "picocolors";

export default defineCommand({
  meta: { description: "List active plugins and their handlers" },
  async run() {
    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error(pc.red("bolt.yaml not found"));
      process.exit(1);
    }
    const cfg = await loadConfig(configPath);
    const configDir = path.dirname(configPath);
    const registry = await buildRegistry(cfg, configDir, Object.values(builtinPlugins));

    const namespaces = registry.listNamespaces();
    if (namespaces.length === 0) {
      console.log(pc.dim("No plugins loaded."));
      return;
    }

    console.log("");
    for (const ns of namespaces) {
      const plugin = registry.get(ns)!;
      const handlers = Object.keys(plugin.handlers);
      console.log(`  ${pc.cyan(pc.bold(ns))}`);
      for (const h of handlers) {
        console.log(`    ${pc.dim(ns + "/")}${h}`);
      }
    }
    console.log("");
  },
});
