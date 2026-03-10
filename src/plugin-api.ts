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

export type DescribeFunction = (
  handler: string,
  params: Record<string, string>,
) => string | undefined;

export interface BoltPlugin {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
  describe?: DescribeFunction;
}

export interface RunOptions {
  config?: BoltPluginConfig;
  configPath?: string;
  cwd?: string;
  dryRun?: boolean;
}

// --- Public type declarations for decorator & base class ---
// The actual implementations live in plugin.ts and are available at runtime
// via the bundled binary. We declare types here so dts-bundle-generator
// doesn't pull internal types (BoltConfig/Zod) into the public .d.ts.

/**
 * Method decorator — mark a method as a plugin handler.
 * Only decorated methods are exposed as handlers by PluginBase.
 *
 * @param description  Optional description template for `bolt ai`.
 * @param alias        Optional handler name override (defaults to method name).
 */
export declare function handler(description?: string, alias?: string): (
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) => void;

/**
 * Base class for class-based plugins.
 * Only methods decorated with @handler() are exposed as handlers.
 */
export declare abstract class PluginBase implements BoltPlugin {
  abstract namespace: string;
  get handlers(): Record<string, BoltPluginHandler>;
  describe(handler: string, params: Record<string, string>): string | undefined;
}
