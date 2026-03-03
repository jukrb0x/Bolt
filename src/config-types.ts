/**
 * Pure TypeScript type declarations for Bolt's public config surface.
 * No Zod, no Bun, no runtime imports — safe to emit as bolt.d.ts via tsc.
 */

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
  engine_root: string;
  project_root: string;
  project_name: string;
  engine_vcs?: "git" | "svn";
  project_vcs?: "git" | "svn";
  git_branch?: string;
  use_tortoise?: boolean;
  /** Any extra string fields defined in bolt.yaml are preserved and available as ${{ project.<key> }} in interpolation. */
  [key: string]: string | boolean | undefined;
}

export interface BuildContext {
  buildId: string;        // e.g. "20260303_142035"
  projectName: string;    // from cfg.project.name
  gitBranch?: string;     // auto-detected, omitted if not a git repo
  logPath?: string;       // optional, passed in from runner opts
  startTime: number;      // Date.now()
}

export type NotifyProviderCfg =
  | { type: "wecom"; webhook_url: string; chat_id?: string }
  | { type: "telegram"; bot_token: string; chat_id: string };

export interface NotificationsConfig {
  on_start: boolean;       // flight plan message before first op
  on_op_complete: boolean; // one message per op that finishes (success)
  on_failure: boolean;     // immediate alert when any op fails
  on_complete: boolean;    // final summary after all ops
  providers: NotifyProviderCfg[];
}

export interface BoltConfig {
  project: Project;
  vars: Record<string, string>;
  targets: Record<string, Target>;
  actions: Record<string, { depends?: string[]; steps: Step[] }>;
  ops: OpsMap;
  "go-pipeline": GoPipeline;
  plugins: PluginEntry[];
  timeout_hours?: number;
  notifications?: NotificationsConfig;
}
