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
// Project is defined locally to avoid pulling Zod schemas from config.ts.
// Keep in sync with the canonical definition there.

import type { Runtime } from "./runtime/types";
import type { BoltLogger } from "./plugin";

export interface Project {
  name: string;
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

export type AiMode = false | true | "confirm";

export interface HandlerManifest {
  description?: string;
  ai: AiMode;
  params?: import("zod").ZodTypeAny;
  /** Draft-07 JSON Schema emitted from the flat zod subset. */
  paramsSchema?: Record<string, unknown>;
}

/**
 * Normalized plugin metadata generated from plugin code at load time.
 * Not a file, and `deps` is intentionally absent.
 */
export interface PluginManifest {
  namespace: string;
  version: string;
  description: string;
  metadata?: import("zod").ZodTypeAny;
  handlers: Record<string, HandlerManifest>;
}

export interface BoltPlugin {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
  manifest?: PluginManifest;
  describe?: DescribeFunction;
}

export interface RunOptions {
  config?: BoltPluginConfig;
  configPath?: string;
  cwd?: string;
  dryRun?: boolean;
}

export interface HandlerDef<T = Record<string, unknown>> {
  description?: string;
  ai: AiMode;
  params?: import("zod").ZodType<T>;
  fn: (params: T, ctx: BoltPluginContext) => Promise<void>;
}

export interface PluginMeta<TMeta = unknown> {
  namespace: string;
  version: string;
  description: string;
  metadata?: import("zod").ZodType<TMeta>;
}

// --- Public type declarations for decorator & base class ---
// The actual implementations live in plugin.ts and are available at runtime
// via the bundled binary. We declare types here so dts-bundle-generator
// doesn't pull internal types (BoltConfig/Zod) into the public .d.ts.

/**
 * Method decorator — mark a method as a plugin handler.
 * The string form remains valid. The object form carries ai and params.
 */
export declare function handler(
  description?: string,
  alias?: string,
): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void;

export declare function handler(options: {
  description?: string;
  ai?: AiMode;
  params?: import("zod").ZodTypeAny;
  alias?: string;
}): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void;

/**
 * Base class for class-based plugins.
 * Only methods decorated with @handler() are exposed as handlers.
 * Lifecycle hooks stay on the instance and are not part of PluginManifest.
 */
export declare abstract class PluginBase implements BoltPlugin {
  abstract namespace: string;
  version: string;
  description: string;
  metadata?: import("zod").ZodTypeAny;
  config?: unknown;
  deps?: Record<string, BoltPlugin>;
  get handlers(): Record<string, BoltPluginHandler>;
  get manifest(): PluginManifest;
  describe(handler: string, params: Record<string, string>): string | undefined;

  onInit?(ctx: BoltPluginContext): Promise<void>;
  onBeforeStep?(
    handlerName: string,
    params: Record<string, string>,
    ctx: BoltPluginContext,
  ): Promise<void>;
  onAfterStep?(
    handlerName: string,
    params: Record<string, string>,
    ctx: BoltPluginContext,
  ): Promise<void>;

  static withDescriptor<TMeta = unknown>(
    meta: PluginMeta<TMeta>,
  ): {
    new (
      config?: unknown,
      deps?: Record<string, BoltPlugin>,
    ): PluginBase & {
      config: unknown;
      deps: Record<string, BoltPlugin> | undefined;
      metadata?: import("zod").ZodType<TMeta>;
      manifest: PluginManifest;
    };
  };
}

/**
 * Build one handler definition. `ai` defaults to false.
 * `params` must be the flat zod subset; the registry stores its JSON Schema.
 */
export declare function defineHandler<T = Record<string, string>>(
  meta: {
    description?: string;
    ai?: AiMode;
    params?: import("zod").ZodType<T>;
  },
  fn: (params: T, ctx: BoltPluginContext) => Promise<void>,
): HandlerDef<T>;

/**
 * Define a plugin object. This used to return a descriptor for
 * `PluginBase.withDescriptor`; it now returns the plugin (public API break).
 * Class plugins pass `PluginMeta` to `withDescriptor` instead.
 */
export declare function definePlugin<TMeta = unknown>(def: {
  namespace: string;
  version: string;
  description: string;
  metadata?: import("zod").ZodType<TMeta>;
  handlers: Record<string, HandlerDef<any>>;
}): BoltPlugin & { manifest: PluginManifest };

/** Optional lifecycle hooks for class-based plugins. Not part of PluginManifest. */
export interface PluginLifecycleHooks {
  onInit?(ctx: BoltPluginContext): Promise<void>;
  onBeforeStep?(
    handlerName: string,
    params: Record<string, string>,
    ctx: BoltPluginContext,
  ): Promise<void>;
  onAfterStep?(
    handlerName: string,
    params: Record<string, string>,
    ctx: BoltPluginContext,
  ): Promise<void>;
}
