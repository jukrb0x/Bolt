// src/api.ts
import { loadConfig, type BoltConfig } from "./config";
import { Runner } from "./runner";
import { Logger } from "./logger";
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
 * Run a named task (params applied to every step).
 * @example await run("build", { configPath: "./bolt.yaml" })
 */
export async function run(
  taskName: string,
  opts: RunOptions & { params?: Record<string, string> } = {},
): Promise<void> {
  const runtime = opts.runtime ?? createRuntime();
  const config = opts.config ?? await loadConfig(
    opts.configPath ?? await findConfig(opts.cwd ?? process.cwd()),
    runtime
  );
  const logger = opts.logger ?? new Logger();
  const runner = new Runner(config, { logger, dryRun: opts.dryRun, runtime });
  await runner.runTask(taskName, opts.params ?? {});
}

export interface CreateContextOptions {
  project: Project;
  vars?: Record<string, string>;
  dryRun?: boolean;
  logger?: BoltLogger;
  runtime?: Runtime;
  configDir?: string;
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
      tasks: {},
      flows: {},
      plugins: [],
    },
    configDir: opts.configDir ?? process.cwd(),
    dryRun: opts.dryRun ?? false,
    logger: opts.logger ?? new Logger(),
    runtime: opts.runtime ?? createRuntime(),
  };
}
