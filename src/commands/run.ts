import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig, type BoltConfig } from "../config";
import { Runner } from "../runner";
import { Logger } from "../logger";
import { Notifier } from "../notify";
import path from "path";
import { mkdirSync } from "fs";
import { VERSION } from "../version";

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

function reservedError(name: string, command: string, known: string[]): UsageError {
  if (IMPLEMENTED_FLAGS.has(name)) {
    return new UsageError(`Unknown flag "--${name}" for "bolt ${command}".${suggest(name, known)}`);
  }
  return new UsageError(
    `--${name} is reserved by bolt and not supported yet. Remove it from the command.`,
  );
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
  const rename = name === "help" ? "my_help" : `build_${name.replace(/-/g, "_")}`;
  const renameHint = `rename it, e.g. in bolt.yaml use ${rename} and pass -- ${rename}=${value}.`;

  if (name === "help") {
    return new UsageError(
      `--help takes no value. Use: bolt ${ctx.command} --help. ` +
        `If this is a task param, ${renameHint}`,
    );
  }

  let flagHint = "";
  if (IMPLEMENTED_FLAGS.has(name)) {
    if (ctx.flags.includes(name)) {
      flagHint = ` To preview the run instead, pass --${name} without a value before "--".`;
    } else if (ctx.command === "inspect") {
      flagHint = ` No --${name} is needed: bolt inspect never executes, it is already a side-effect-free preview.`;
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
      `Rename the param, e.g. in bolt.yaml use ${rename} and pass -- ${rename}=${value}.${flagHint}`,
  );
}

/** Flags citty handles itself before `run()` is called. */
const HELP_FLAGS = new Set(["--help", "-h"]);

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function suggest(name: string, known: string[]): string {
  const clean = name.replace(/^-+/, "").toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const flag of known) {
    const score = editDistance(clean, flag);
    if (score < bestScore) {
      best = flag;
      bestScore = score;
    }
  }
  if (best && bestScore <= Math.max(2, Math.floor(best.length / 3))) {
    return ` Did you mean "--${best}"?`;
  }
  return "";
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
        if (eq !== -1) throw new UsageError(`Flag "--${name}" does not take a value.`);
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
            `Pass it after a "--" separator instead: bolt ${command} ... -- ${k}=${v}`,
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
      console.error(`[ERROR] ${e.message}`);
      process.exit(USAGE_EXIT_CODE);
    }
    throw e;
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
  if (names.length === 0) {
    throw new Error("No task or flow specified. Example: bolt run build start");
  }

  if (names.length === 1 && cfg.flows[names[0]]) {
    await runner.runFlow(names[0], params);
    return;
  }

  const unknown = names.filter((n) => !cfg.tasks[n]);
  if (unknown.length > 0) {
    const tasks = Object.keys(cfg.tasks).sort().join(", ") || "(none)";
    const flows = Object.keys(cfg.flows).sort().join(", ") || "(none)";
    throw new Error(
      `Unknown task or flow: ${unknown.map((n) => `"${n}"`).join(", ")}\n` +
        `  Tasks: ${tasks}\n  Flows: ${flows}`,
    );
  }

  await runner.runTasks(names, params);
}

export default defineCommand({
  meta: { description: "Run tasks (in typed order) or a flow defined in bolt.yaml" },
  args: {
    "dry-run": { type: "boolean", default: false, description: "Print steps without executing" },
  },
  async run({ rawArgs }) {
    const { names, params, dryRun } = parseRunArgsOrExit(rawArgs ?? []);

    if (names.length === 0) {
      console.error("[ERROR] No task or flow specified. Example: bolt run build start");
      process.exit(1);
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

    const configDir = path.dirname(configPath);
    const logDir = path.join(configDir, ".bolt", "logs");
    mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `bolt_${timestamp()}.log`);
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
      logger.info(`Log: ${logFile}`);
      logger.close();
      process.exit(0);
    } catch (e: any) {
      logger.error(e.message);
      logger.info(`Log: ${logFile}`);
      logger.close();
      process.exit(1);
    }
  },
});
