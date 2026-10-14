import { defineCommand } from "citty";
import pc from "picocolors";
import { loadProjectConfigOrExit } from "../project-config";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  loadConfigForJson,
} from "../json-envelope";

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
      emitJsonAndExit({
        schema: JSON_SCHEMA.info,
        exitCode: 0,
        config: configRef(configPath),
        data: {
          version: cfg.version,
          project: { name: cfg.project.name },
          tasks: Object.keys(cfg.tasks),
          flows: Object.entries(cfg.flows).map(([name, flow]) => ({
            name,
            steps: flow.steps,
          })),
        },
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
