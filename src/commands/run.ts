import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig, type BoltConfig } from "../config";
import { Runner, wasReported } from "../runner";
import { Logger } from "../logger";
import { Notifier } from "../notify";
import path from "path";
import { mkdirSync } from "fs";
import { VERSION } from "../version";
import { closestFlagMatches, closestMatches, formatDidYouMean, shellQuote } from "../suggest";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export interface ParsedRun {
  /** Positional task/flow names, in the order typed. */
  names: string[];
  /** `--k=v` flags (and `k=v` after a bare `--`) collected as global params. */
  params: Record<string, string>;
  dryRun: boolean;
}

/** Exit code for command-line usage errors (unknown flag, malformed param). */
export const USAGE_EXIT_CODE = 2;

/**
 * Print a usage error. `[ERROR]` prefixes only the actual error lines; indented
 * supplementary lines (Commands:/Tasks:/Flows:/Run …) are printed as-is.
 */
export function printUsageError(message: string): void {
  for (const line of message.split("\n")) {
    if (/^[ \t]/.test(line)) console.error(line);
    else console.error(`[ERROR] ${line}`);
  }
}

/** A command-line usage error. Callers print the message and exit with USAGE_EXIT_CODE. */
export class UsageError extends Error {
  readonly code = "USAGE";
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface ParseRunOptions {
  /** Boolean flags this command accepts (without the leading `--`). Default: `["dry-run"]`. */
  flags?: string[];
  /** Command name used in error messages. Default: `run`. */
  command?: string;
}

/**
 * Flag names reserved by Bolt (design §3, 0.4). They are never accepted as user params,
 * neither as `--name[=v]` nor as `name=v` after `--`. Only `dry-run` is implemented today.
 */
export const RESERVED_FLAGS = [
  "dry-run",
  "simulate",
  "json",
  "agent",
  "execute",
  "plan",
  "confirmed-by-user",
] as const;

const IMPLEMENTED_FLAGS = new Set<string>(["dry-run"]);

function isReserved(name: string): boolean {
  return (RESERVED_FLAGS as readonly string[]).includes(name);
}

const INSPECT_PREVIEW = "bolt inspect never executes, it is already a side-effect-free preview";

function reservedError(name: string, command: string, known: string[]): UsageError {
  if (IMPLEMENTED_FLAGS.has(name)) {
    if (command === "inspect" && name === "dry-run") {
      return new UsageError(
        `Unknown flag "--${name}" for "bolt inspect": ${INSPECT_PREVIEW}. Remove --${name}.`,
      );
    }
    return new UsageError(`Unknown flag "--${name}" for "bolt ${command}".${suggest(name, known)}`);
  }
  return new UsageError(
    `--${name} is reserved by bolt and not supported yet. Remove it from the command.`,
  );
}

const FALSY = new Set(["false", "0", "no", "off", ""]);

/**
 * The rename suggested for a param that clashes with a reserved name: `plan` -> `my_plan`,
 * `dry-run` -> `my_dry_run`, `help` -> `my_help`. One neutral form for every name.
 */
export function renamedParam(name: string): string {
  return `my_${name.replace(/-/g, "_")}`;
}

export interface ReservedParamContext {
  /** Command name used in messages (`run`, `inspect`). */
  command: string;
  /** Boolean flags the current command accepts. */
  flags: string[];
  /** True for `-- name=value`, false for `--name=value`. */
  afterSeparator: boolean;
}

/**
 * A reserved name given with a value: `--plan=x`, `--help=1`, or `-- plan=x` / `-- help=x`.
 * The message says what is wrong and how to fix it, including a rename example in case
 * the user meant a task param.
 */
export function reservedParamError(
  name: string,
  value: string,
  ctx: ReservedParamContext,
): UsageError {
  const rename = renamedParam(name);
  const pass = `-- ${rename}=${shellQuote(value)}`;
  const renameHint = `rename it, e.g. in bolt.yaml use ${rename} and pass ${pass}.`;

  if (name === "help" && ctx.afterSeparator) {
    return new UsageError(
      `"help" cannot be used as a param name (it is a bolt flag). ` +
        `Rename the param, e.g. in bolt.yaml use ${rename} and pass ${pass}.`,
    );
  }
  if (name === "help") {
    return new UsageError(
      `--help takes no value. Use: bolt ${ctx.command} --help. ` +
        `If this is a task param, ${renameHint}`,
    );
  }

  if (IMPLEMENTED_FLAGS.has(name) && ctx.flags.includes(name) && FALSY.has(value.toLowerCase())) {
    return new UsageError(
      `"${name}=${value}" is not a param: --${name} is a bolt flag and takes no value. ` +
        `To run for real, just remove --${name}. If this is a task param, ${renameHint}`,
    );
  }

  let flagHint = "";
  if (IMPLEMENTED_FLAGS.has(name)) {
    if (ctx.flags.includes(name)) {
      flagHint = ` To preview the run instead, pass --${name} without a value before "--".`;
    } else if (ctx.command === "inspect") {
      flagHint = ` No --${name} is needed: ${INSPECT_PREVIEW}.`;
    }
  }

  if (!ctx.afterSeparator && !IMPLEMENTED_FLAGS.has(name)) {
    return new UsageError(
      `--${name} is reserved by bolt and not supported yet. If this is a task param, ${renameHint}`,
    );
  }
  const reservation = IMPLEMENTED_FLAGS.has(name)
    ? `it is a bolt flag`
    : `--${name} is reserved by bolt and not supported yet`;
  return new UsageError(
    `"${name}" cannot be used as a param name (${reservation}). ` +
      `Rename the param, e.g. in bolt.yaml use ${rename} and pass ${pass}.${flagHint}`,
  );
}

/** Flags citty handles itself before `run()` is called. */
const HELP_FLAGS = new Set(["--help", "-h"]);

function suggest(name: string, known: string[]): string {
  const bare = name.replace(/^-+/, "");
  const matches = closestFlagMatches(bare, known).map((m) => `--${m}`);
  return formatDidYouMean(matches);
}

function parseParam(text: string, origin: string): [string, string] {
  const eq = text.indexOf("=");
  const key = eq === -1 ? "" : text.slice(0, eq);
  if (eq === -1 || key === "" || key.startsWith("-")) {
    throw new UsageError(`Malformed param "${origin}". Params must look like key=value.`);
  }
  return [key, text.slice(eq + 1)];
}

/**
 * Parse raw argv into positional names + `--k=v` params + known boolean flags.
 * Names are collected in typed order (that order IS execution order — spec D3).
 * `--k=v` flags apply to the whole invocation (spec D4). No `:variant`, no shared-param fill.
 *
 * Strict: unknown flags (long or short), values on boolean flags, and param values
 * starting with `--` throw a UsageError. Everything after a bare `--` is parsed only as
 * `key=value` params, so values there may start with `--` (e.g. `-- extra=--verbose`).
 */
export function parseRunArgs(rawArgs: string[], opts: ParseRunOptions = {}): ParsedRun {
  const flags = opts.flags ?? ["dry-run"];
  const command = opts.command ?? "run";
  const known = [...flags, "help"];
  const names: string[] = [];
  const params: Record<string, string> = {};
  let dryRun = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg === "--") {
      for (const rest of rawArgs.slice(i + 1)) {
        const [k, v] = parseParam(rest, rest);
        if (isReserved(k) || k === "help") {
          throw reservedParamError(k, v, { command, flags, afterSeparator: true });
        }
        params[k] = v;
      }
      break;
    }
    if (HELP_FLAGS.has(arg)) continue;

    if (arg.startsWith("--")) {
      const inner = arg.slice(2);
      const eq = inner.indexOf("=");
      const name = eq === -1 ? inner : inner.slice(0, eq);
      if (flags.includes(name)) {
        if (eq !== -1) {
          const value = inner.slice(eq + 1);
          const fix =
            name === "dry-run" && FALSY.has(value.toLowerCase())
              ? " To run for real, just remove --dry-run."
              : ` Use --${name} on its own.`;
          throw new UsageError(`Flag "--${name}" does not take a value.${fix}`);
        }
        if (name === "dry-run") dryRun = true;
        continue;
      }
      if (name === "help" && eq !== -1) {
        throw reservedParamError(name, inner.slice(eq + 1), {
          command,
          flags,
          afterSeparator: false,
        });
      }
      if (isReserved(name)) {
        if (eq !== -1 && !IMPLEMENTED_FLAGS.has(name)) {
          throw reservedParamError(name, inner.slice(eq + 1), {
            command,
            flags,
            afterSeparator: false,
          });
        }
        throw reservedError(name, command, known);
      }
      if (eq === -1) {
        throw new UsageError(
          `Unknown flag "${arg}" for "bolt ${command}".${suggest(name, known)} ` +
            `Params must be given as --key=value.`,
        );
      }
      const [k, v] = parseParam(inner, arg);
      if (v.startsWith("--")) {
        throw new UsageError(
          `Param value for "--${k}" may not start with "--". ` +
            `Pass it after a "--" separator instead: bolt ${command} ... -- ${k}=${shellQuote(v)}`,
        );
      }
      params[k] = v;
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      throw new UsageError(`Unknown flag "${arg}" for "bolt ${command}".${suggest(arg, known)}`);
    }
    names.push(arg);
  }

  return { names, params, dryRun };
}

/** Parse argv for a command, printing usage errors and exiting with USAGE_EXIT_CODE. */
export function parseRunArgsOrExit(rawArgs: string[], opts: ParseRunOptions = {}): ParsedRun {
  try {
    return parseRunArgs(rawArgs, opts);
  } catch (e) {
    if (e instanceof UsageError) {
      printUsageError(e.message);
      process.exit(USAGE_EXIT_CODE);
    }
    throw e;
  }
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
        "Print steps. Skips run: steps and local actions, but still loads plugins and calls plugin hooks and handlers (with ctx.dryRun=true)",
    },
  },
  async run({ rawArgs }) {
    const { names, params, dryRun } = parseRunArgsOrExit(rawArgs ?? []);

    if (names.length === 0) {
      printUsageError(missingNameMessage("run", await loadUsageConfig()));
      process.exit(USAGE_EXIT_CODE);
    }

    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error("[ERROR] bolt.yaml not found (searched up from cwd)");
      process.exit(1);
    }

    let cfg: BoltConfig;
    try {
      cfg = await loadConfig(configPath);
    } catch (e: any) {
      console.error(`[ERROR] ${e.message}`);
      process.exit(1);
    }

    const unknown = unknownNamesMessage(cfg, names);
    if (unknown) {
      printUsageError(unknown);
      process.exit(USAGE_EXIT_CODE);
    }

    const configDir = path.dirname(configPath);
    // Dry-run is a preview: it must not create .bolt/logs or write a log file.
    let logFile: string | undefined;
    if (!dryRun) {
      const logDir = path.join(configDir, ".bolt", "logs");
      mkdirSync(logDir, { recursive: true });
      logFile = path.join(logDir, `bolt_${timestamp()}.log`);
    }
    const logger = new Logger({ logFile });

    const isFlow = names.length === 1 && !!cfg.flows[names[0]];
    logger.info(`bolt ${VERSION}`);
    logger.info(`Config: ${configPath}`);
    logger.info(`${isFlow ? "Flow" : "Tasks"}: ${names.join(" ")}${dryRun ? " (dry-run)" : ""}`);

    const runner = new Runner(cfg, {
      dryRun,
      logger,
      configDir,
      notifier: dryRun ? Notifier.fromConfig(undefined) : Notifier.fromConfig(cfg.notifications),
    });

    const start = Date.now();
    try {
      await dispatchRun(runner, cfg, names, params);
      logger.info(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
      if (logFile) logger.info(`Log: ${logFile}`);
      logger.close();
      process.exit(0);
    } catch (e: any) {
      // A failed step is already printed by the runner; print only other errors.
      if (!wasReported(e)) logger.error(e.message);
      if (logFile) logger.info(`Log: ${logFile}`);
      logger.close();
      process.exit(1);
    }
  },
});
