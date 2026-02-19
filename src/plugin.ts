import type { BoltConfig } from "./config";
import type { Logger } from "./logger";

export interface BoltPluginContext {
  cfg: BoltConfig;
  dryRun: boolean;
  logger: Logger;
}

export type BoltPluginHandler = (
  params: Record<string, string>,
  ctx: BoltPluginContext,
) => Promise<void>;

export interface BoltPlugin {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
}
