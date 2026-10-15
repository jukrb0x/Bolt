import { defineCommand } from "citty";
import { loadProjectConfigOrExit } from "../project-config";
import { CONFIG_EXIT_CODE, USAGE_EXIT_CODE } from "../exit-codes";
import { formatPlanNodes } from "../inspect-utils";
import { assessCapabilities, formatCapabilityErrors } from "../capability-selection";
import {
  capabilityUsesInPlan,
  formatPlanErrors,
  resolveRunPlan,
  type PlanRequest,
} from "../run-plan";
import path from "path";
import { findConfig } from "../discover";
import { previewPlan } from "../plan-preview";
import { UsageError } from "../strict-args";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  issue,
  issueFromCliMessage,
  loadConfigForJson,
} from "../json-envelope";
import {
  missingNameMessage,
  parseRunArgs,
  parseRunArgsOrExit,
  loadUsageConfig,
  printUsageError,
  unknownNamesMessage,
} from "./run";

export default defineCommand({
  meta: {
    name: "inspect",
    description: "Inspect resolved steps for a task or flow without executing",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.inspect/v1 JSON document on stdout",
    },
  },
  async run({ args, rawArgs }) {
    if (args?.json) {
      installJsonStdoutGuard();
      await runInspectJson(rawArgs ?? []);
      return;
    }
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

async function runInspectJson(rawArgs: string[]): Promise<never> {
  let names: string[];
  let params: Record<string, string>;
  try {
    const parsed = parseRunArgs(rawArgs, { flags: ["json"], command: "inspect" });
    names = parsed.names;
    params = parsed.params;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    emitJsonAndExit({
      schema: JSON_SCHEMA.inspect,
      exitCode: USAGE_EXIT_CODE,
      config: configRef(await findConfig(process.cwd())),
      data: null,
      errors: [issueFromCliMessage("USAGE", e.message)],
    });
  }

  if (names.length === 0) {
    emitJsonAndExit({
      schema: JSON_SCHEMA.inspect,
      exitCode: USAGE_EXIT_CODE,
      config: configRef(await findConfig(process.cwd())),
      data: null,
      errors: [
        issueFromCliMessage("USAGE", missingNameMessage("inspect", await loadUsageConfig())),
      ],
    });
  }

  const { configPath, cfg } = await loadConfigForJson(JSON_SCHEMA.inspect);
  const unknown = unknownNamesMessage(cfg, names, "inspect");
  if (unknown) {
    emitJsonAndExit({
      schema: JSON_SCHEMA.inspect,
      exitCode: USAGE_EXIT_CODE,
      config: configRef(configPath),
      data: null,
      errors: [issueFromCliMessage("UNKNOWN_NAME", unknown)],
    });
  }

  const request: PlanRequest =
    names.length === 1 && cfg.flows[names[0]]
      ? { kind: "flow", name: names[0], params }
      : { kind: "tasks", names, params };
  const result = resolveRunPlan(cfg, request);
  if (!result.ok) {
    emitJsonAndExit({
      schema: JSON_SCHEMA.inspect,
      exitCode: CONFIG_EXIT_CODE,
      config: configRef(configPath),
      data: null,
      errors: result.errors.map((error) =>
        issue(
          "PLAN_INVALID",
          error.path ? `${error.path}: ${error.message}` : error.message,
          "Fix bolt.yaml, then run bolt inspect again.",
        ),
      ),
    });
  }

  const configDir = path.dirname(configPath);
  const report = assessCapabilities(cfg, configDir, {
    requested: capabilityUsesInPlan(result.plan),
    catalog: true,
  });
  const preview = previewPlan({
    cfg,
    configPath,
    configDir,
    plan: result.plan,
    names,
    params,
  });
  const failed = report.errors.length > 0;
  const warnings = [
    ...report.warnings.map((message) => issue("CAPABILITY_WARNING", message)),
    ...preview.warnings,
  ];
  emitJsonAndExit({
    schema: JSON_SCHEMA.inspect,
    exitCode: failed ? CONFIG_EXIT_CODE : 0,
    config: configRef(configPath),
    data: {
      kind: result.plan.kind,
      name: result.plan.name ?? null,
      names: preview.names,
      params,
      context_hash: preview.context_hash,
      plan_hash: preview.plan_hash,
      ai: preview.ai,
      ai_reasons: preview.ai_reasons,
      tasks: preview.tasks,
      capabilities: report.resolved,
    },
    warnings,
    errors: report.errors.map((error) =>
      issue(
        error.code ?? "CAPABILITY_ERROR",
        error.path ? `${error.path}: ${error.message}` : error.message,
        "Fix bolt.yaml or bolt.local.yaml, then run bolt inspect again.",
      ),
    ),
  });
}
