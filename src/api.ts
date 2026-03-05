// src/api.ts
import { loadConfig, type BoltConfig } from "./config";
import { Runner } from "./runner";
import { Logger } from "./logger";
import { parseGoArgs, resolveOps } from "./go";
import { findConfig } from "./discover";
import { createRuntime, type Runtime } from "./runtime";
import type { BoltPluginContext, BoltLogger } from "./plugin";
import type { Project } from "./config";

export interface RunOptions {
  /** Pre-loaded config (mutually exclusive with configPath) */
  config?: BoltConfig;
  /** Path to bolt.yaml (mutually exclusive with config) */
  configPath?: string;
  /** Working directory for config discovery */
  cwd?: string;
  /** Skip actual execution */
  dryRun?: boolean;
  /** Custom logger */
  logger?: Logger;
  /** Custom runtime */
  runtime?: Runtime;
}

/**
 * Run a named action.
 * @example await run("build", { configPath: "./bolt.yaml" })
 */
export async function run(actionName: string, opts: RunOptions = {}): Promise<void> {
  const runtime = opts.runtime ?? createRuntime();
  const config = opts.config ?? await loadConfig(
    opts.configPath ?? await findConfig(opts.cwd ?? process.cwd()),
    runtime
  );
  const logger = opts.logger ?? new Logger();
  const runner = new Runner(config, { logger, dryRun: opts.dryRun, runtime });
  await runner.run(actionName);
}

/**
 * Run go pipeline with ops.
 * @example await go(["update", "build"], { configPath: "./bolt.yaml" })
 */
export async function go(args: string[], opts: RunOptions = {}): Promise<void> {
  const runtime = opts.runtime ?? createRuntime();
  const config = opts.config ?? await loadConfig(
    opts.configPath ?? await findConfig(opts.cwd ?? process.cwd()),
    runtime
  );
  const logger = opts.logger ?? new Logger();
  const runner = new Runner(config, { logger, dryRun: opts.dryRun, runtime });

  const parsed = parseGoArgs(args);
  const resolved = resolveOps(parsed, config);
  await runner.runOps(resolved, config["go-pipeline"]);
}

export interface CreateContextOptions {
  project: Project;
  vars?: Record<string, string>;
  dryRun?: boolean;
  logger?: BoltLogger;
  runtime?: Runtime;
}

/**
 * Create execution context for direct plugin calls.
 */
export function createContext(opts: CreateContextOptions): BoltPluginContext {
  return {
    cfg: {
      project: opts.project,
      vars: opts.vars ?? {},
      targets: {},
      actions: {},
      ops: {},
      "go-pipeline": { order: [], fail_stops: [] },
      plugins: [],
    },
    dryRun: opts.dryRun ?? false,
    logger: opts.logger ?? new Logger(),
    runtime: opts.runtime ?? createRuntime(),
  };
}
