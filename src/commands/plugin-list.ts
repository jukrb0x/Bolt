import { defineCommand } from "citty";
import { loadProjectConfigOrExit } from "../project-config";
import { buildRegistry } from "../plugin-registry";
import { builtinPlugins } from "../plugins";
import path from "path";
import pc from "picocolors";

export default defineCommand({
  meta: { name: "list", description: "List active plugins and their handlers" },
  async run() {
    const { configPath, cfg } = await loadProjectConfigOrExit();
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
