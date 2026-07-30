import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig, type BoltConfig } from "../config";
import { formatPlanNodes } from "../inspect-utils";
import { formatPlanErrors, resolveRunPlan, type PlanRequest } from "../run-plan";
import { parseRunArgs } from "./run";

export default defineCommand({
  meta: { description: "Inspect resolved steps for a task or flow without executing" },
  args: {},
  async run({ rawArgs }) {
    const { names, params } = parseRunArgs(rawArgs ?? []);
    if (names.length === 0) {
      console.error("[ERROR] Usage: bolt inspect <task|flow> [--k=v ...]");
      process.exit(1);
    }

    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error("[ERROR] bolt.yaml not found");
      process.exit(1);
    }

    let cfg: BoltConfig;
    try {
      cfg = await loadConfig(configPath);
    } catch (e: any) {
      console.error(`[ERROR] ${e.message}`);
      process.exit(1);
    }

    console.log(`Config: ${configPath}`);
    console.log();

    const request: PlanRequest =
      names.length === 1 && cfg.flows[names[0]]
        ? { kind: "flow", name: names[0], params }
        : { kind: "tasks", names, params };
    const result = resolveRunPlan(cfg, request);
    if (!result.ok) {
      console.error(`[ERROR] ${formatPlanErrors(result.errors)}`);
      process.exit(1);
    }

    for (const task of result.plan.tasks) {
      console.log(`>> ${task.name}`);
      for (const line of formatPlanNodes(task.nodes, 1)) console.log(line);
      console.log();
    }
  },
});
