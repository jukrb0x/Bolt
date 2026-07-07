import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig } from "../config";
import pc from "picocolors";

export default defineCommand({
  meta: { description: "List tasks and flows defined in bolt.yaml" },
  async run() {
    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error("bolt.yaml not found");
      process.exit(1);
    }
    const cfg = await loadConfig(configPath);

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
