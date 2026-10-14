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

export default defineCommand({
  meta: { name: "list", description: "List tasks and flows defined in bolt.yaml" },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.list/v1 JSON document on stdout",
    },
  },
  async run({ args }) {
    if (args?.json) {
      installJsonStdoutGuard();
      const { configPath, cfg } = await loadConfigForJson(JSON_SCHEMA.list);
      emitJsonAndExit({
        schema: JSON_SCHEMA.list,
        exitCode: 0,
        config: configRef(configPath),
        data: {
          tasks: Object.keys(cfg.tasks),
          flows: Object.entries(cfg.flows).map(([name, flow]) => {
            const item: { name: string; steps: string[]; description?: string } = {
              name,
              steps: flow.steps,
            };
            if (flow.description) item.description = flow.description;
            return item;
          }),
        },
      });
    }

    const { configPath, cfg } = await loadProjectConfigOrExit();

    const tasks = Object.keys(cfg.tasks);
    const flows = Object.entries(cfg.flows);

    console.log(pc.dim(`bolt.yaml: ${configPath}`));

    console.log("");
    console.log(`${pc.underline(pc.bold("TASKS"))} ${pc.dim("(bolt run <task...>)")}`);
    console.log("");
    if (tasks.length === 0) {
      console.log(pc.dim("  (none)"));
    } else {
      for (const name of tasks) {
        console.log(`  ${pc.cyan(name)}`);
      }
    }

    console.log("");
    console.log(`${pc.underline(pc.bold("FLOWS"))} ${pc.dim("(bolt run <flow>)")}`);
    console.log("");
    if (flows.length === 0) {
      console.log(pc.dim("  (none)"));
    } else {
      for (const [name, flow] of flows) {
        console.log(`  ${pc.cyan(name)}${pc.dim(`  ${flow.steps.join(" → ")}`)}`);
        if (flow.description) console.log(`    ${pc.dim(flow.description)}`);
      }
    }

    console.log("");
  },
});
