import { defineCommand } from "citty";
import { normalizeBuildConfig } from "../build-config";
import { findConfig } from "../discover";
import { loadConfig, type BoltConfig } from "../config";
import { Runner } from "../runner";
import { Logger } from "../logger";
import { Notifier } from "../notify";
import path from "path";
import { mkdirSync } from "fs";
import pkg from "../../package.json";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export interface ParsedRun {
  /** Positional task/flow names, in the order typed. */
  names: string[];
  /** Trailing `--k=v` flags collected as global params. */
  params: Record<string, string>;
  dryRun: boolean;
}

/**
 * Parse raw argv into positional names + `--k=v` params + `--dry-run`.
 * Names are collected in typed order (that order IS execution order — spec D3).
 * `--k=v` flags apply to the whole invocation (spec D4). No `:variant`, no shared-param fill.
 */
export function parseRunArgs(rawArgs: string[]): ParsedRun {
  const names: string[] = [];
  const params: Record<string, string> = {};
  let dryRun = false;

  for (const arg of rawArgs) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const inner = arg.slice(2);
      const eq = inner.indexOf("=");
      if (eq === -1) continue; // unknown boolean-style flag — ignore
      const k = inner.slice(0, eq);
      const v = inner.slice(eq + 1);
      if (k === "dry-run") continue;
      const normalized = k === "config" ? normalizeBuildConfig(v) : undefined;
      params[k] = normalized?.ok ? normalized.value : v;
      continue;
    }
    if (arg.startsWith("-")) continue; // ignore other short flags
    names.push(arg);
  }

  return { names, params, dryRun };
}

/**
 * Resolve + execute parsed names against a Runner (spec D3 resolution):
 * - exactly one name that is a flow → `runFlow`
 * - otherwise every name must be a task → `runTask` in listed order (params applied to each)
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
    await runner.runFlow(names[0]);
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

  for (const name of names) {
    await runner.runTask(name, params);
  }
}

export default defineCommand({
  meta: { description: "Run tasks (in typed order) or a flow defined in bolt.yaml" },
  args: {
    "dry-run": { type: "boolean", default: false, description: "Print steps without executing" },
  },
  async run({ rawArgs }) {
    const { names, params, dryRun } = parseRunArgs(rawArgs ?? []);

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
    logger.info(`bolt ${pkg.version}`);
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
