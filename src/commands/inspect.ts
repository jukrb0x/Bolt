import { defineCommand } from "citty";
import { loadProjectConfigOrExit } from "../project-config";
import { CONFIG_EXIT_CODE } from "../exit-codes";
import { formatPlanNodes } from "../inspect-utils";
import { formatPlanErrors, resolveRunPlan, type PlanRequest } from "../run-plan";
import {
  missingNameMessage,
  parseRunArgsOrExit,
  loadUsageConfig,
  printUsageError,
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
      printUsageError(missingNameMessage("inspect", await loadUsageConfig()));
      process.exit(USAGE_EXIT_CODE);
    }

    const { configPath, cfg } = await loadProjectConfigOrExit();

    const unknown = unknownNamesMessage(cfg, names, "inspect");
    if (unknown) {
      printUsageError(unknown);
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
      printUsageError(
        `${formatPlanErrors(result.errors)}\n  Fix bolt.yaml, then run bolt inspect again.`,
      );
      process.exit(CONFIG_EXIT_CODE);
    }

    for (const task of result.plan.tasks) {
      console.log(`>> ${task.name}`);
      for (const line of formatPlanNodes(task.nodes, 1)) console.log(line);
      console.log();
    }
  },
});
