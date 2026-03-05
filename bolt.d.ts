/**
 * Type declarations for Bolt plugins.
 * Import as: import type { BoltPlugin, BoltPluginContext } from "bolt";
 *
 * Generated — do not edit by hand. Run: bun run build:types
 */

declare module "bolt" {
  export type TargetKind = "editor" | "program" | "game" | "client" | "server";
  export type BuildConfig = "development" | "debug" | "shipping" | "test";
  export type VcsType = "git" | "svn";
  export interface RepoConfig {
      path: string;
      vcs?: VcsType;
      url?: string;
      branch?: string;
  }
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
      engine_repo: RepoConfig;
      project_repo: RepoConfig;
      uproject: string;
      use_tortoise?: boolean;
      /** Any extra string fields defined in bolt.yaml are preserved and available as ${{ project.<key> }} in interpolation. */
      [key: string]: string | boolean | undefined | RepoConfig;
  }
  export interface BuildContext {
      buildId: string;
      projectName: string;
      mode: "go" | "run";
      gitBranch?: string;
      logPath?: string;
      startTime: number;
  }
  export type NotifyProviderCfg = {
      type: "wecom";
      webhook_url: string;
      chat_id?: string;
  } | {
      type: "telegram";
      bot_token: string;
      chat_id: string;
  };
  export interface NotificationsConfig {
      on_start: boolean;
      on_op_complete: boolean;
      on_failure: boolean;
      on_complete: boolean;
      providers: NotifyProviderCfg[];
  }
  export interface BoltConfig {
      project: Project;
      vars: Record<string, string>;
      targets: Record<string, Target>;
      actions: Record<string, {
          depends?: string[];
          steps: Step[];
      }>;
      ops: OpsMap;
      "go-pipeline": GoPipeline;
      plugins: PluginEntry[];
      timeout_hours?: number;
      notifications?: NotificationsConfig;
  }

  export interface BoltLogger {
      info(msg: string): void;
      warn(msg: string): void;
      error(msg: string): void;
      debug(msg: string): void;
  }
  export interface BoltPluginContext {
      cfg: BoltConfig;
      dryRun: boolean;
      logger: BoltLogger;
  }
  export type BoltPluginHandler = (params: Record<string, string>, ctx: BoltPluginContext) => Promise<void>;
  export interface BoltPlugin {
      namespace: string;
      handlers: Record<string, BoltPluginHandler>;
  }
}
