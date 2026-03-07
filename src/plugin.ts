import type { BoltConfig } from "./config";
import type { Runtime } from "./runtime/types";

/** Subset of Logger exposed to plugin handlers. */
export interface BoltLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  cmd(msg: string): void;
}

export interface BoltPluginContext {
  cfg: BoltConfig;
  configDir: string;
  dryRun: boolean;
  logger: BoltLogger;
  runtime: Runtime;
}

export type BoltPluginHandler = (
  params: Record<string, string>,
  ctx: BoltPluginContext,
) => Promise<void>;

export interface BoltPlugin {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
}
