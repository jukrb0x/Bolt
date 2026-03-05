// src/plugin-api.ts
/**
 * Public API types for Bolt plugins and library users.
 */

// Runtime types
export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Runtime {
  spawn(cmd: string[], opts?: { cwd?: string }): Promise<SpawnResult>;
  spawnSync(cmd: string[]): SpawnResult;
  shell(command: string, opts?: { cwd?: string }): Promise<SpawnResult>;
  parseYaml(text: string): unknown;
}

// Config types
export interface RepoConfig {
  path: string;
  vcs: "git" | "svn";
  url?: string;
  branch?: string;
}

export interface Project {
  name: string;
  engine_repo: RepoConfig;
  project_repo: RepoConfig;
  uproject: string;
  use_tortoise?: boolean;
  [key: string]: string | boolean | undefined | RepoConfig;
}

export interface BoltPluginConfig {
  project: Project;
  vars: Record<string, string>;
}

// Logger
export interface BoltLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  cmd(msg: string): void;
}

// Plugin context
export interface BoltPluginContext {
  cfg: BoltPluginConfig;
  dryRun: boolean;
  logger: BoltLogger;
  runtime: Runtime;
}

// Plugin types
export type BoltPluginHandler = (
  params: Record<string, string>,
  ctx: BoltPluginContext,
) => Promise<void>;

export interface BoltPlugin {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
}

// High-level API types
export interface RunOptions {
  config?: BoltPluginConfig;
  configPath?: string;
  cwd?: string;
  dryRun?: boolean;
}
