import { defineCommand } from "citty";
import { loadProjectConfigOrExit } from "../project-config";
import { CONFIG_EXIT_CODE } from "../exit-codes";
import { formatPlanNodes } from "../inspect-utils";
import { assessCapabilities, formatCapabilityErrors } from "../capability-selection";
import {
  capabilityUsesInPlan,
  formatPlanErrors,
  resolveRunPlan,
  type PlanRequest,
} from "../run-plan";
import path from "path";
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

    const report = assessCapabilities(cfg, path.dirname(configPath), {
      requested: capabilityUsesInPlan(result.plan),
      catalog: true,
    });
    for (const warning of report.warnings) console.log(warning);
    for (const line of report.lines) console.log(line);
    if (report.warnings.length > 0 || report.lines.length > 0) console.log();
    if (report.errors.length > 0) {
      printUsageError(
        `${formatCapabilityErrors(report)}\n  Fix bolt.yaml or bolt.local.yaml, then run bolt inspect again.`,
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
