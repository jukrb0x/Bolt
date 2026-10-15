import { defineCommand } from "citty";
import path from "path";
import pc from "picocolors";
import { aiContextPlugins, collectAiContext } from "../ai-context";
import { loadProjectConfigOrExit } from "../project-config";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  loadConfigForJson,
} from "../json-envelope";
import { maskedTree, maskedVars } from "../plan-preview";
import { PluginRegistry } from "../plugin-registry";
import { builtinPlugins } from "../plugins";

function row(label: string, value: string) {
  console.log(`  ${pc.cyan(label.padEnd(13))}${value}`);
}

export default defineCommand({
  meta: { name: "info", description: "Print project config summary from bolt.yaml" },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.info/v1 JSON document on stdout",
    },
  },
  async run({ args }) {
    if (args?.json) {
      installJsonStdoutGuard();
      const { configPath, cfg } = await loadConfigForJson(JSON_SCHEMA.info);
      const builtins = new Set(Object.keys(builtinPlugins));
      const registry = new PluginRegistry();
      for (const plugin of Object.values(builtinPlugins)) registry.register(plugin);
      const data = {
        version: cfg.version,
        project: { name: cfg.project.name },
        vars: maskedVars(cfg),
        plugins: (cfg.plugins ?? []).map((plugin) => ({
          namespace: plugin.namespace,
          source: plugin.path ? "path" : builtins.has(plugin.namespace) ? "builtin" : "project",
          ...(plugin.path ? { path: plugin.path } : {}),
          ...(plugin.config
            ? { config: maskedTree(plugin.config, cfg, `plugins.${plugin.namespace}`) }
            : {}),
        })),
        tasks: Object.keys(cfg.tasks),
        flows: Object.entries(cfg.flows).map(([name, flow]) => ({
          name,
          steps: flow.steps,
        })),
      };
      // info does not import path plugins. Built-ins are what it can call;
      // aiContextPlugins appends a path plugin when that registry already has it.
      Object.assign(
        data,
        collectAiContext(aiContextPlugins(cfg, registry), {
          cfg,
          configDir: path.dirname(configPath),
        }).info,
      );
      emitJsonAndExit({
        schema: JSON_SCHEMA.info,
        exitCode: 0,
        config: configRef(configPath),
        data,
      });
    }

    const { configPath, cfg } = await loadProjectConfigOrExit();

    console.log(pc.dim(`bolt.yaml: ${configPath}`));
    console.log("");
    console.log(`${pc.underline(pc.bold("PROJECT"))}`);
    console.log("");
    row("version", String(cfg.version));
    row("name", cfg.project.name);

    console.log("");
    console.log(`${pc.underline(pc.bold("TASKS"))}`);
    console.log("");
    if (Object.keys(cfg.tasks).length === 0) {
      console.log(pc.dim("  (none)"));
    } else {
      for (const name of Object.keys(cfg.tasks)) {
        console.log(`  ${pc.cyan(name)}`);
      }
    }

    console.log("");
    console.log(`${pc.underline(pc.bold("FLOWS"))}`);
    console.log("");
    if (Object.keys(cfg.flows).length === 0) {
      console.log(pc.dim("  (none)"));
    } else {
      for (const [name, flow] of Object.entries(cfg.flows)) {
        console.log(`  ${pc.cyan(name.padEnd(24))}${pc.dim(flow.steps.join(" → "))}`);
      }
    }

    console.log("");
  },
});
