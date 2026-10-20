import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig, type BoltConfig } from "../config";
import { Runner, wasReported } from "../runner";
import { AI_FORBIDDEN_EXIT_CODE, BoltStepError } from "../handler-result";
import {
  assessCapabilities,
  CapabilitySelectionError,
  formatCapabilityErrors,
} from "../capability-selection";
import {
  capabilityUsesInPlan,
  formatPlanErrors,
  resolveRunPlan,
  type PlanRequest,
} from "../run-plan";
import { Logger } from "../logger";
import { Notifier } from "../notify";
import path from "path";
import { mkdirSync } from "fs";
import { VERSION } from "../version";
import { CONFIG_EXIT_CODE, USAGE_EXIT_CODE } from "../exit-codes";
import { isAgentMode } from "../agent-mode";
import { dispatchJsonRun, requestsJson, semanticProblem, type JsonRunArgs } from "../agent-run";
import {
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  issueFromCliMessage,
  JSON_SCHEMA,
} from "../json-envelope";
import { loadProjectConfigOrExit } from "../project-config";
import { DRY_RUN_HEADER, dryRunFooter, renderDryRun } from "../dry-run";
import { previewPlan } from "../plan-preview";
import { invocationEntry, openRunSession } from "../session";
import { closestMatches, formatDidYouMean } from "../suggest";
import {
  printUsageError,
  parseStrictArgs,
  parseStrictArgsOrExit,
  specFromCittyArgs,
  UsageError,
  type StrictArgSpec,
} from "../strict-args";
export {
  UsageError,
  printUsageError,
  renamedParam,
  reservedParamError,
  RESERVED_FLAGS,
} from "../strict-args";
export type { ReservedParamContext } from "../strict-args";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export interface ParsedRun {
  /** Positional task/flow names, in the order typed. */
  names: string[];
  /** `--k=v` flags (and `k=v` after a bare `--`) collected as global params. */
  params: Record<string, string>;
  dryRun: boolean;
  /** `--simulate`: run with plugins loaded in dry-run mode (side effects allowed). */
  simulate: boolean;
  /** Set when the command declares the flag. Omitted by the default parser. */
  agent?: boolean;
  execute?: boolean;
  json?: boolean;
  confirmedByUser?: boolean;
  /** Set when `--plan` is declared. Undefined when the flag was not passed. */
  plan?: string;
}

/** Flags `bolt run` accepts. `plan` is a string; the rest are booleans. */
export const RUN_PARSE_FLAGS = [
  "dry-run",
  "simulate",
  "json",
  "agent",
  "execute",
  "confirmed-by-user",
  "plan",
];

export { CONFIG_EXIT_CODE, USAGE_EXIT_CODE };

export interface ParseRunOptions {
  /** Boolean flags this command accepts (without the leading `--`). Default: `["dry-run", "simulate"]`. */
  flags?: string[];
  /** Command name used in error messages. Default: `run`. */
  command?: string;
}

function runSpec(opts: ParseRunOptions = {}): StrictArgSpec {
  const command = opts.command ?? "run";
  const flags = opts.flags ?? ["dry-run", "simulate"];
  const args: Record<string, { type: string }> = {};
  for (const f of flags) args[f] = { type: f === "plan" ? "string" : "boolean" };
  return specFromCittyArgs(command, args, { allowParams: true });
}

function toJsonArgs(parsed: ParsedRun): JsonRunArgs {
  return {
    names: parsed.names,
    params: parsed.params,
    dryRun: parsed.dryRun,
    simulate: parsed.simulate,
    execute: parsed.execute === true,
    agent: parsed.agent === true,
    json: parsed.json === true,
    confirmedByUser: parsed.confirmedByUser === true,
    plan: parsed.plan,
  };
}

function toParsedRun(result: ReturnType<typeof parseStrictArgs>, opts: ParseRunOptions): ParsedRun {
  const flags = new Set(opts.flags ?? ["dry-run", "simulate"]);
  const parsed: ParsedRun = {
    names: result.positionals,
    params: result.params,
    dryRun: result.booleans["dry-run"] === true,
    simulate: result.booleans.simulate === true,
  };
  if (flags.has("agent")) parsed.agent = result.booleans.agent === true;
  if (flags.has("execute")) parsed.execute = result.booleans.execute === true;
  if (flags.has("json")) parsed.json = result.booleans.json === true;
  if (flags.has("confirmed-by-user")) {
    parsed.confirmedByUser = result.booleans["confirmed-by-user"] === true;
  }
  if (flags.has("plan") && result.strings.plan !== undefined) parsed.plan = result.strings.plan;
  return parsed;
}

/**
 * Parse raw argv into positional names + `--k=v` params + known boolean flags.
 * Thin wrapper over shared `parseStrictArgs` (BOLT-CLI-1).
 */
export function parseRunArgs(rawArgs: string[], opts: ParseRunOptions = {}): ParsedRun {
  return toParsedRun(parseStrictArgs(rawArgs, runSpec(opts)), opts);
}

/** Parse argv for a command, printing usage errors and exiting with USAGE_EXIT_CODE. */
export function parseRunArgsOrExit(rawArgs: string[], opts: ParseRunOptions = {}): ParsedRun {
  return toParsedRun(parseStrictArgsOrExit(rawArgs, runSpec(opts)), opts);
}

/** Max names shown on a Tasks:/Flows: line before truncating. */
const NAME_LIST_LIMIT = 10;

/** Join names in bolt.yaml declaration order (Object key order), truncating after `limit`. */
function nameList(names: string[], limit = NAME_LIST_LIMIT): string {
  if (names.length === 0) return "(none)";
  if (names.length <= limit) return names.join(", ");
  const more = names.length - limit;
  return `${names.slice(0, limit).join(", ")}, and ${more} more (see bolt list)`;
}

/**
 * Error for names that are neither a task nor a flow: one line per name with a "Did you
 * mean" hint (plus "Task names are case-sensitive." when the only match differs only by
 * case). Uses `Unknown flow` when the best match is a flow, otherwise `Unknown task`.
 * Then lists the project's tasks and flows (truncated). Returns undefined if all known.
 */
export function unknownNamesMessage(
  cfg: BoltConfig,
  names: string[],
  command = "run",
): string | undefined {
  const tasks = Object.keys(cfg.tasks);
  const flows = Object.keys(cfg.flows);
  const taskSet = new Set(tasks);
  const flowSet = new Set(flows);
  const isFlow = names.length === 1 && cfg.flows[names[0]];
  if (isFlow) return undefined;
  const unknown = names.filter((n) => !cfg.tasks[n]);
  if (unknown.length === 0) return undefined;
  const lines = unknown.map((n) => {
    if (cfg.flows[n]) {
      return `"${n}" is a flow; a flow runs on its own: bolt ${command} ${n}`;
    }
    const matches = closestMatches(n, [...tasks, ...flows]);
    const best = matches.length === 1 ? matches[0] : undefined;
    const caseOnly = best !== undefined && best.toLowerCase() === n.toLowerCase();
    const kind = best !== undefined && flowSet.has(best) && !taskSet.has(best) ? "flow" : "task";
    const hint = formatDidYouMean(matches) + (caseOnly ? " Task names are case-sensitive." : "");
    return `Unknown ${kind} "${n}".${hint}`;
  });
  return (
    `${lines.join("\n")}\n  Tasks: ${nameList(tasks)}\n  Flows: ${nameList(flows)}\n` +
    `  Run bolt list for details.`
  );
}

/** Result of loading bolt.yaml only to build a usage message. */
export type UsageConfig =
  | { kind: "loaded"; cfg: BoltConfig }
  | { kind: "missing" }
  | { kind: "invalid"; path: string };

/**
 * Usage message when `bolt run` / `bolt inspect` gets no task. Lists the project's actual
 * tasks and flows when bolt.yaml loads; otherwise points to `bolt init` or `bolt check`.
 */
export function missingNameMessage(command: string, project: UsageConfig): string {
  const head = `No task or flow specified. Usage: bolt ${command} <task...|flow> [--key=value ...]`;
  if (project.kind === "missing") {
    return `${head}\n  No bolt.yaml found in this directory or its parents. Run bolt list inside a bolt project to see its tasks, or bolt init to create one.`;
  }
  if (project.kind === "invalid") {
    return `${head}\n  ${project.path} could not be loaded. Run bolt check to see what is wrong, then bolt list to see its tasks.`;
  }
  const tasks = Object.keys(project.cfg.tasks);
  const flows = Object.keys(project.cfg.flows);
  if (tasks.length === 0 && flows.length === 0) {
    return `${head}\n  This project defines no tasks or flows yet. Add one under tasks: in bolt.yaml, then check with bolt list.`;
  }
  const example = tasks[0] ?? flows[0];
  return (
    `${head}\n  Tasks: ${nameList(tasks)}\n  Flows: ${nameList(flows)}\n` +
    `  Example: bolt ${command} ${example}`
  );
}

/** Load bolt.yaml from cwd only to build a usage message; never throws. */
export async function loadUsageConfig(): Promise<UsageConfig> {
  const configPath = await findConfig(process.cwd());
  if (!configPath) return { kind: "missing" };
  try {
    return { kind: "loaded", cfg: await loadConfig(configPath) };
  } catch {
    return { kind: "invalid", path: configPath };
  }
}

/**
 * Resolve + execute parsed names against a Runner (spec D3 resolution):
 * - exactly one name that is a flow → `runFlow`
 * - otherwise every name must be a task → one `runTasks` call in listed order
 *
 * Throws (never exits) so callers/tests own the process lifecycle.
 */
export async function dispatchRun(
  runner: Runner,
  cfg: BoltConfig,
  names: string[],
  params: Record<string, string>,
): Promise<void> {
  if (names.length === 0) throw new Error(missingNameMessage("run", { kind: "loaded", cfg }));

  if (names.length === 1 && cfg.flows[names[0]]) {
    await runner.runFlow(names[0], params);
    return;
  }

  const unknown = unknownNamesMessage(cfg, names);
  if (unknown) throw new Error(unknown);

  await runner.runTasks(names, params);
}

export default defineCommand({
  meta: { name: "run", description: "Run tasks (in typed order) or a flow defined in bolt.yaml" },
  args: {
    "dry-run": {
      type: "boolean",
      default: false,
      description:
        "Show what would run without running anything: no commands, plugins, hooks, or file writes",
    },
    simulate: {
      type: "boolean",
      default: false,
      description:
        "Load plugins and run hooks and handlers in dry-run mode; writes a log file and may have side effects",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.run/v1 JSON document on stdout",
    },
    agent: {
      type: "boolean",
      default: false,
      description: "Agent mode: JSON preview unless --execute is set. Also BOLT_AGENT=1",
    },
    execute: {
      type: "boolean",
      default: false,
      description: "Execute a previewed plan. Requires --plan=<plan_hash>. Implies agent mode",
    },
    plan: {
      type: "string",
      description: "plan_hash from a previous --dry-run --json preview",
    },
    "confirmed-by-user": {
      type: "boolean",
      default: false,
      description: "User approved a confirm-mode plan. Implies agent mode",
    },
  },
  async run({ rawArgs }) {
    const raw = rawArgs ?? [];
    const jsonish = requestsJson(raw);
    let parsed: ParsedRun;
    try {
      parsed = parseRunArgs(raw, { flags: RUN_PARSE_FLAGS });
    } catch (e) {
      if (!(e instanceof UsageError)) throw e;
      if (jsonish) {
        installJsonStdoutGuard();
        emitJsonAndExit({
          schema: JSON_SCHEMA.run,
          exitCode: USAGE_EXIT_CODE,
          config: configRef(await findConfig(process.cwd())),
          data: null,
          errors: [issueFromCliMessage("USAGE", e.message)],
        });
      }
      printUsageError(e.message);
      process.exit(USAGE_EXIT_CODE);
    }

    const args = toJsonArgs(parsed);
    const problem = semanticProblem(args);
    if (problem) {
      if (jsonish || isAgentMode(args)) {
        installJsonStdoutGuard();
        emitJsonAndExit({
          schema: JSON_SCHEMA.run,
          exitCode: USAGE_EXIT_CODE,
          config: configRef(await findConfig(process.cwd())),
          data: null,
          errors: [issueFromCliMessage("USAGE", problem)],
        });
      }
      printUsageError(problem);
      process.exit(USAGE_EXIT_CODE);
    }

    const agent = isAgentMode(args);
    const preview = parsed.dryRun || ((agent || parsed.json === true) && !parsed.execute);
    if (agent || parsed.json || parsed.execute) {
      if (preview || parsed.execute) {
        installJsonStdoutGuard();
        await dispatchJsonRun(args);
      }
    }

    const { names, params, dryRun, simulate } = parsed;

    if (names.length === 0) {
      printUsageError(missingNameMessage("run", await loadUsageConfig()));
      process.exit(USAGE_EXIT_CODE);
    }

    const { configPath, cfg } = await loadProjectConfigOrExit();

    const unknown = unknownNamesMessage(cfg, names);
    if (unknown) {
      printUsageError(unknown);
      process.exit(USAGE_EXIT_CODE);
    }

    const isFlow = names.length === 1 && !!cfg.flows[names[0]];
    const request: PlanRequest = isFlow
      ? { kind: "flow", name: names[0], params }
      : { kind: "tasks", names, params };
    const planned = resolveRunPlan(cfg, request);
    if (!planned.ok) {
      printUsageError(
        `${formatPlanErrors(planned.errors)}\n  Fix bolt.yaml, then check with \`bolt inspect ${names.join(" ")}\`.`,
      );
      process.exit(CONFIG_EXIT_CODE);
    }

    const configDir = path.dirname(configPath);
    const selection = assessCapabilities(cfg, configDir, {
      requested: capabilityUsesInPlan(planned.plan),
      catalog: dryRun,
    });
    if (!dryRun && selection.errors.length > 0) {
      printUsageError(
        `${formatCapabilityErrors(selection)}\n  Fix bolt.yaml or bolt.local.yaml, then run bolt check.`,
      );
      process.exit(CONFIG_EXIT_CODE);
    }

    if (dryRun) {
      // Pure static preview: no Runner, no logger file, no plugin registry, no notifier.
      const report = renderDryRun(cfg, planned.plan, { configDir });
      console.log(DRY_RUN_HEADER);
      console.log(`Config: ${configPath}`);
      console.log(`${isFlow ? "Flow" : "Tasks"}: ${names.join(" ")}`);
      console.log();
      for (const line of report.lines) console.log(line);
      for (const line of dryRunFooter(report.problems.length)) console.log(line);
      process.exit(report.problems.length > 0 ? CONFIG_EXIT_CODE : 0);
    }

    const logDir = path.join(configDir, ".bolt", "logs");
    mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `bolt_${timestamp()}.log`);
    const logRunId = path.basename(logFile, ".log");
    const logger = new Logger({ logFile });

    for (const warning of selection.warnings) logger.warn(warning);
    logger.info(`bolt ${VERSION}`);
    logger.info(`Config: ${configPath}`);
    logger.info(`${isFlow ? "Flow" : "Tasks"}: ${names.join(" ")}${simulate ? " (simulate)" : ""}`);
    if (simulate) {
      logger.warn(
        "--simulate loads plugins and runs their hooks and handlers with ctx.dryRun = true. " +
          "run: steps and local actions are skipped. Plugins may still have side effects.",
      );
    }

    const planPreview = simulate
      ? undefined
      : previewPlan({
          cfg,
          configPath,
          configDir,
          plan: planned.plan,
          names,
          params,
        });
    let session: ReturnType<typeof openRunSession> | undefined;
    if (planPreview) {
      try {
        session = openRunSession({
          configDir,
          configPath,
          cwd: process.cwd(),
          names,
          planHash: planPreview.plan_hash,
          tasks: planPreview.tasks,
          argv: process.argv.slice(2),
          entry: invocationEntry(false),
          logRunId,
          pid: process.pid,
        });
      } catch {
        session = undefined;
      }
    }
    const runner = new Runner(cfg, {
      dryRun: simulate,
      logger,
      configDir,
      refreshPluginCache: true,
      notifier: simulate ? Notifier.fromConfig(undefined) : Notifier.fromConfig(cfg.notifications),
      session,
    });

    const start = Date.now();
    try {
      await dispatchRun(runner, cfg, names, params);
      logger.info(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
      if (logFile) logger.info(`Log: ${logFile}`);
      await logger.close();
      try {
        session?.finish("ok");
      } catch {
        /* a session write must not fail the run */
      }
      process.exit(0);
    } catch (e: any) {
      // A failed step is already printed by the runner; print only other errors.
      if (!wasReported(e)) logger.error(e.message);
      if (logFile) logger.info(`Log: ${logFile}`);
      await logger.close();
      try {
        session?.finish("failed");
      } catch {
        /* a session write must not fail the run */
      }
      process.exit(
        e instanceof BoltStepError && e.code === "AI_FORBIDDEN"
          ? AI_FORBIDDEN_EXIT_CODE
          : e instanceof CapabilitySelectionError
            ? CONFIG_EXIT_CODE
            : 1,
      );
    }
  },
});
