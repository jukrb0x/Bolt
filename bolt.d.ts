/**
 * Bolt plugin type declarations.
 *
 * Add to your plugin project's tsconfig.json:
 *
 *   {
 *     "compilerOptions": {
 *       "paths": {
 *         "bolt": ["path/to/bolt.d.ts"]
 *       }
 *     }
 *   }
 *
 * Then in your plugin:
 *
 *   import type { BoltPlugin } from "bolt";
 *
 *   const plugin: BoltPlugin = {
 *     namespace: "myplugin",
 *     handlers: {
 *       mytask: async (params, ctx) => {
 *         ctx.logger.info(`running with target=${params.target}`);
 *         if (!ctx.dryRun) { ... }
 *       },
 *     },
 *   };
 *
 *   export default plugin;
 */

// ---------------------------------------------------------------------------
// Logger (subset exposed to plugins via ctx.logger)
// ---------------------------------------------------------------------------

export interface BoltLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

// ---------------------------------------------------------------------------
// Config types (available on ctx.cfg)
// ---------------------------------------------------------------------------

export type TargetKind = "editor" | "program" | "game" | "client" | "server";
export type BuildConfig = "development" | "debug" | "shipping" | "test";

export interface Target {
  kind: TargetKind;
  name?: string;
  config: BuildConfig;
}

export interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  "continue-on-error"?: boolean;
}

export interface Action {
  depends?: string[];
  steps: Step[];
}

export type OpVariant = Step[];
export type OpsMap = Record<string, Record<string, OpVariant>>;

export interface GoPipeline {
  order: string[];
  fail_stops: string[];
}

export interface PluginEntry {
  namespace: string;
  path: string;
}

export interface Project {
  name: string;
  ue_path: string;
  project_path: string;
  project_name: string;
  svn_root?: string;
  git_branch?: string;
  use_tortoise?: boolean;
}

export type NotifyProviderCfg =
  | { type: "wecom"; webhook_url: string; chat_id?: string }
  | { type: "telegram"; bot_token: string; chat_id: string };

export interface NotificationsConfig {
  on_start: boolean;
  on_complete: boolean;
  on_failure: boolean;
  providers: NotifyProviderCfg[];
}

export interface BoltConfig {
  project: Project;
  targets: Record<string, Target>;
  actions: Record<string, Action>;
  ops: OpsMap;
  "go-pipeline": GoPipeline;
  plugins: PluginEntry[];
  timeout_hours?: number;
  notifications?: NotificationsConfig;
}

// ---------------------------------------------------------------------------
// Plugin API
// ---------------------------------------------------------------------------

export interface BoltPluginContext {
  cfg: BoltConfig;
  dryRun: boolean;
  logger: BoltLogger;
}

export type BoltPluginHandler = (
  params: Record<string, string>,
  ctx: BoltPluginContext,
) => Promise<void>;

export interface BoltPlugin {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
}
