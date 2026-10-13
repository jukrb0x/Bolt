import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig, type BoltConfig } from "../config";
import { formatPlanNodes } from "../inspect-utils";
import { formatPlanErrors, resolveRunPlan, type PlanRequest } from "../run-plan";
import {
  missingNameMessage,
  parseRunArgsOrExit,
  loadUsageConfig,
  unknownNamesMessage,
  USAGE_EXIT_CODE,
} from "./run";

export default defineCommand({
  meta: {
    name: "inspect",
    description: "Inspect resolved steps for a task or flow without executing",
  },
  args: {},
  async run({ rawArgs }) {
    const { names, params } = parseRunArgsOrExit(rawArgs ?? [], { flags: [], command: "inspect" });
    if (names.length === 0) {
      console.error(`[ERROR] ${missingNameMessage("inspect", await loadUsageConfig())}`);
      process.exit(USAGE_EXIT_CODE);
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

    const unknown = unknownNamesMessage(cfg, names, "inspect");
    if (unknown) {
      console.error(`[ERROR] ${unknown}`);
      process.exit(USAGE_EXIT_CODE);
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
