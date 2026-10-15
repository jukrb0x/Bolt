import { mkdirSync } from "fs";
import path from "path";
import { envAgentOn } from "./agent-mode";
import { loadVerifiedPlugins } from "./agent-loader";
import { assessCapabilities } from "./capability-selection";
import {
  DENIED_EXIT_CODE,
  CONFIG_EXIT_CODE,
  TASK_FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "./exit-codes";
import { findConfig } from "./discover";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  issue,
  issueFromCliMessage,
  loadConfigForJson,
  type JsonIssue,
} from "./json-envelope";
import { Logger } from "./logger";
import { Notifier } from "./notify";
import { artefactIntegrity } from "./plugin-cache";
import { builtinPlugins } from "./plugins";
import { previewPlan, type AiReason, type InspectPreview } from "./plan-preview";
import { loadUsageConfig, missingNameMessage, unknownNamesMessage } from "./commands/run";
import { capabilityUsesInPlan, resolveRunPlan, type PlanRequest, type RunPlan } from "./run-plan";
import { Runner } from "./runner";

export interface JsonRunArgs {
  names: string[];
  params: Record<string, string>;
  dryRun: boolean;
  simulate: boolean;
  execute: boolean;
  agent: boolean;
  json: boolean;
  confirmedByUser: boolean;
  plan?: string;
}

/** True when this argv or BOLT_AGENT should answer with a JSON envelope. */
export function requestsJson(raw: string[], env: NodeJS.ProcessEnv = process.env): boolean {
  if (envAgentOn(env)) return true;
  for (const arg of raw) {
    if (arg === "--") break;
    if (
      arg === "--agent" ||
      arg === "--execute" ||
      arg === "--json" ||
      arg === "--json=v1" ||
      arg === "--confirmed-by-user" ||
      arg === "--plan" ||
      arg.startsWith("--plan=")
    ) {
      return true;
    }
  }
  return false;
}

export function semanticProblem(args: JsonRunArgs): string | undefined {
  if (args.plan === "") return "`--plan` needs a plan_hash.";
  if (args.execute && args.dryRun) return "`--execute` cannot be combined with `--dry-run`.";
  if (args.execute && args.simulate) return "`--execute` cannot be combined with `--simulate`.";
  if (args.simulate && (args.agent || envAgentOn())) {
    return "`--simulate` cannot be used in agent mode.";
  }
  if (args.execute && !args.plan) return "`--execute` requires `--plan=<plan_hash>`.";
  if (args.plan !== undefined && !args.execute) return "`--plan` requires `--execute`.";
  return undefined;
}

function previewHint(names: string[], params: Record<string, string>): string {
  const bits = ["bolt", "run", "--dry-run", ...names];
  for (const [key, value] of Object.entries(params)) bits.push(`--${key}=${value}`);
  bits.push("--agent", "--json");
  return bits.join(" ");
}

function humanHint(names: string[], params: Record<string, string>): string {
  const bits = ["bolt", "run", ...names];
  for (const [key, value] of Object.entries(params)) bits.push(`--${key}=${value}`);
  return bits.join(" ");
}

interface Stage1Stop {
  errors: JsonIssue[];
  reasons: AiReason[];
}

/** Stage 1 refusals, in order. Does not import plugin code. */
export function stage1Stop(
  preview: InspectPreview,
  args: JsonRunArgs,
  aiRun: "never" | "confirm" | undefined,
): Stage1Stop | undefined {
  const third = preview.participants.filter((item) => item.source !== "builtin");
  const unbuilt = third.filter((item) => !item.built);
  if (unbuilt.length > 0) {
    return {
      reasons: [],
      errors: unbuilt.map((item) =>
        issue(
          "PLUGIN_NOT_BUILT",
          `Plugin "${item.namespace}" is not built for the current source and config.`,
          `bolt plugin build ${item.namespace}`,
        ),
      ),
    };
  }
  for (const item of third) {
    const state =
      item.artefactPath && item.artefactHash
        ? artefactIntegrity(item.artefactPath, item.artefactHash)
        : "missing";
    if (state === "ok") continue;
    return {
      reasons: [
        {
          node: item.namespace,
          ai: preview.ai,
          code: "ARTEFACT_TAMPERED",
          message: state === "missing" ? "artefact missing" : "artefact hash mismatch",
        },
      ],
      errors: [
        issue(
          "PLAN_MISMATCH",
          state === "missing"
            ? `Built artefact for "${item.namespace}" is missing.`
            : `Built artefact for "${item.namespace}" does not match its manifest.`,
          previewHint(args.names, args.params),
        ),
      ],
    };
  }
  if ((aiRun ?? "confirm") === "never") {
    return {
      reasons: [],
      errors: [
        issue(
          "AGENT_EXECUTION_DISABLED",
          "bolt.local.yaml sets ai.run: never, so agent execute is refused.",
          "Remove ai.run: never from bolt.local.yaml to allow agent execute.",
        ),
      ],
    };
  }
  if (args.plan !== preview.plan_hash) {
    return {
      reasons: [],
      errors: [
        issue(
          "PLAN_MISMATCH",
          "The plan does not match --plan. Preview again and pass the new plan_hash.",
          previewHint(args.names, args.params),
        ),
      ],
    };
  }
  if (preview.ai === false) {
    return {
      reasons: [],
      errors: [
        issue(
          "AI_FORBIDDEN",
          "This plan is ai:false. An agent cannot execute it.",
          humanHint(args.names, args.params),
        ),
      ],
    };
  }
  if (preview.ai === "confirm" && !args.confirmedByUser) {
    return {
      reasons: [],
      errors: [
        issue(
          "CONFIRM_REQUIRED",
          "This plan needs confirmation.",
          "Re-run with --confirmed-by-user after the user approves.",
        ),
      ],
    };
  }
  return undefined;
}

function planBody(
  preview: InspectPreview,
  plan: RunPlan,
  params: Record<string, string>,
  capabilities: unknown,
) {
  return {
    kind: plan.kind,
    name: plan.name ?? null,
    names: preview.names,
    params,
    context_hash: preview.context_hash,
    plan_hash: preview.plan_hash,
    ai: preview.ai,
    ai_reasons: preview.ai_reasons,
    tasks: preview.tasks,
    capabilities,
  };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function slash(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Agent / `--json` path for `bolt run`. Preview, or Stage 1 then Stage 2. */
export async function dispatchJsonRun(args: JsonRunArgs): Promise<never> {
  const schema = JSON_SCHEMA.run;
  if (args.names.length === 0) {
    emitJsonAndExit({
      schema,
      exitCode: USAGE_EXIT_CODE,
      config: configRef(await findConfig(process.cwd())),
      data: null,
      errors: [issueFromCliMessage("USAGE", missingNameMessage("run", await loadUsageConfig()))],
    });
  }

  const { configPath, cfg } = await loadConfigForJson(schema);
  const unknown = unknownNamesMessage(cfg, args.names, "run");
  if (unknown) {
    emitJsonAndExit({
      schema,
      exitCode: USAGE_EXIT_CODE,
      config: configRef(configPath),
      data: null,
      errors: [issueFromCliMessage("UNKNOWN_NAME", unknown)],
    });
  }

  const isFlow = args.names.length === 1 && !!cfg.flows[args.names[0]];
  const request: PlanRequest = isFlow
    ? { kind: "flow", name: args.names[0], params: args.params }
    : { kind: "tasks", names: args.names, params: args.params };
  const planned = resolveRunPlan(cfg, request);
  if (!planned.ok) {
    emitJsonAndExit({
      schema,
      exitCode: CONFIG_EXIT_CODE,
      config: configRef(configPath),
      data: null,
      errors: planned.errors.map((error) =>
        issue(
          error.message.toLowerCase().includes("cycle") ? "PLAN_CYCLE" : "PLAN_INVALID",
          error.path ? `${error.path}: ${error.message}` : error.message,
          "Fix bolt.yaml, then check with bolt inspect.",
        ),
      ),
    });
  }

  const configDir = path.dirname(configPath);
  const selection = assessCapabilities(cfg, configDir, {
    requested: capabilityUsesInPlan(planned.plan),
    catalog: true,
  });
  const preview = previewPlan({
    cfg,
    configPath,
    configDir,
    plan: planned.plan,
    names: args.names,
    params: args.params,
  });
  const capErrors = selection.errors.map((error) =>
    issue(
      error.code ?? "CAPABILITY_ERROR",
      error.path ? `${error.path}: ${error.message}` : error.message,
      "Fix bolt.yaml or bolt.local.yaml, then run bolt check.",
    ),
  );
  const warnings = [
    ...selection.warnings.map((message) => issue("CAPABILITY_WARNING", message)),
    ...preview.warnings,
  ];
  const body = planBody(preview, planned.plan, args.params, selection.resolved);

  if (!args.execute) {
    emitJsonAndExit({
      schema,
      exitCode: capErrors.length > 0 ? CONFIG_EXIT_CODE : 0,
      config: configRef(configPath),
      data: {
        preview: true,
        plan_hash: preview.plan_hash,
        ai: preview.ai,
        ai_reasons: preview.ai_reasons,
        plan: body,
      },
      warnings,
      errors: capErrors,
    });
  }

  if (capErrors.length > 0) {
    emitJsonAndExit({
      schema,
      exitCode: CONFIG_EXIT_CODE,
      config: configRef(configPath),
      data: {
        preview: false,
        plan_hash: preview.plan_hash,
        ai: preview.ai,
        ai_reasons: preview.ai_reasons,
      },
      warnings,
      errors: capErrors,
    });
  }

  const stop = stage1Stop(preview, args, cfg.aiRun);
  if (stop) {
    const codes = new Set(stop.errors.map((item) => item.code));
    emitJsonAndExit({
      schema,
      exitCode: DENIED_EXIT_CODE,
      config: configRef(configPath),
      data: {
        preview: false,
        plan_hash: preview.plan_hash,
        ai: preview.ai,
        ai_reasons: [...preview.ai_reasons, ...stop.reasons],
      },
      warnings: warnings.filter((item) => !codes.has(item.code)),
      errors: stop.errors,
    });
  }

  const loaded = await loadVerifiedPlugins(preview.participants, Object.values(builtinPlugins));
  if (!loaded.ok) {
    emitJsonAndExit({
      schema,
      exitCode: DENIED_EXIT_CODE,
      config: configRef(configPath),
      data: {
        preview: false,
        plan_hash: preview.plan_hash,
        ai: preview.ai,
        ai_reasons: preview.ai_reasons,
      },
      warnings,
      errors: [
        issue(
          "PLAN_MISMATCH",
          `Plugin "${loaded.namespace}" does not match its manifest (${loaded.detail}).`,
          previewHint(args.names, args.params),
        ),
      ],
    });
  }

  const logDir = path.join(configDir, ".bolt", "logs");
  mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `bolt_${timestamp()}.log`);
  const logger = new Logger({ logFile });
  logger.info(`agent=true confirmed_by_user=${args.confirmedByUser ? "true" : "false"}`);
  logger.info(
    args.confirmedByUser ? "started by agent; confirmation asserted" : "started by agent",
  );
  const runner = new Runner(cfg, {
    logger,
    configDir,
    aiInvocation: true,
    refreshPluginCache: false,
    notifier: Notifier.fromConfig(cfg.notifications),
  });
  try {
    await runner.executeResolved(planned.plan, loaded.registry);
    await logger.close();
    emitJsonAndExit({
      schema,
      exitCode: 0,
      config: configRef(configPath),
      data: {
        preview: false,
        plan_hash: preview.plan_hash,
        outcome: "ok",
        log: slash(logFile),
      },
      warnings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logger.close();
    emitJsonAndExit({
      schema,
      exitCode: TASK_FAILURE_EXIT_CODE,
      config: configRef(configPath),
      data: {
        preview: false,
        plan_hash: preview.plan_hash,
        outcome: "failed",
        ...(runner.failedTask ? { failed_task: runner.failedTask } : {}),
        log: slash(logFile),
      },
      warnings,
      errors: [issue("RUN_FAILED", message)],
    });
  }
}
