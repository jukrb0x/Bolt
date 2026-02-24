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
  actions: Record<string, { depends?: string[]; steps: Step[] }>;
  ops: OpsMap;
  "go-pipeline": GoPipeline;
  plugins: PluginEntry[];
  timeout_hours?: number;
  notifications?: NotificationsConfig;
}
