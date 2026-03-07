// src/plugin-api.ts
/**
 * Public API types for Bolt plugins and library users.
 * This file is the entry point for dts-bundle-generator (build:types).
 * Re-exports canonical types where possible; defines narrowed shims
 * for types that would otherwise leak internal details (e.g. BoltConfig
 * pulling in every Zod schema).
 */

// Re-export canonical types that are safe to expose as-is (no Zod leakage)
export type { SpawnResult, SpawnOptions, Runtime } from "./runtime/types";
export type { BoltLogger } from "./plugin";

// --- Narrowed public-API types ---
// Project/RepoConfig are defined locally to avoid pulling in Zod schemas
// from config.ts. Keep in sync with the canonical definitions there.

import type { Runtime } from "./runtime/types";
import type { BoltLogger } from "./plugin";

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

/** Subset of BoltConfig exposed to external plugin/library consumers. */
export interface BoltPluginConfig {
  project: Project;
  vars: Record<string, string>;
}

/** Public plugin context — uses narrow BoltPluginConfig to avoid leaking internals. */
export interface BoltPluginContext {
  cfg: BoltPluginConfig;
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

export interface RunOptions {
  config?: BoltPluginConfig;
  configPath?: string;
  cwd?: string;
  dryRun?: boolean;
}
