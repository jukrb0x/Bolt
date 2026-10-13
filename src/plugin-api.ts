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

/**
 * One `plugins[]` entry. Same shape `loadConfig` returns.
 * Omit `path` for a builtin. `config` is that plugin's own metadata.
 */
export interface BoltPluginEntry {
  namespace: string;
  path?: string;
  config?: Record<string, unknown>;
}

/** Subset of BoltConfig exposed to external plugin/library consumers. */
export interface BoltPluginConfig {
  project: Project;
  vars: Record<string, string>;
  plugins: BoltPluginEntry[];
}

// --- Handler results and events (plugin API v2) ---

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type HandlerStatus = "ok" | "warn" | "fail" | "skipped";

export interface Diagnostic {
  level: "info" | "warn" | "error";
  /** Upper snake case, e.g. `DDC_SHARED_MISSING`. */
  code?: string;
  message: string;
  /** Core normalises `\` to `/`. */
  file?: string;
  line?: number;
  /** A hint for the user. Never executed. */
  fix?: string;
}

export interface Artifact {
  kind: string;
  path: string;
  sha256?: string;
  size?: number;
  label?: string;
}

/** Display-only suggestion. Core never executes it. */
export interface NextStep {
  ref: string;
  params?: Record<string, string>;
  reason?: string;
}

/**
 * Structured outcome of a handler. Core acts on it only for plugins that declare
 * `apiVersion: 2`; plugin API v1 return values are ignored.
 */
export interface HandlerResult<D extends JsonValue = JsonValue> {
  status: HandlerStatus;
  /** One line, at most 200 characters. */
  summary?: string;
  data?: D;
  artifacts?: Artifact[];
  diagnostics?: Diagnostic[];
  next?: NextStep[];
  /** Reserved, e.g. "bolt.doctor/v1". Not enforced by core. */
  schema?: string;
}

export interface BoltEvent {
  /** Lowercase dot-separated words, e.g. "progress" or "log". */
  type: string;
  message?: string;
  data?: JsonValue;
  progress?: { current: number; total?: number; unit?: string };
}

/** Core capability tags. Plugins may also use `x-<vendor>.<name>` or `<namespace>.<name>`. */
export type KnownCapability =
  | "doctor"
  | "diagnose"
  | "detect"
  | "notify"
  | "vcs.sync"
  | "vcs.info"
  | "vcs.revision"
  | "artifact.store";
export type Capability = KnownCapability | (string & {});

/** Public plugin context — uses narrow BoltPluginConfig to avoid leaking internals. */
export interface BoltPluginContext {
  cfg: BoltPluginConfig;
  configDir: string;
  dryRun: boolean;
  /**
   * True when an AI agent invoked this step through bolt's AI permission path;
   * false or absent for human runs. Handlers may be stricter for AI invocations
   * (e.g. `git/info` rejects paths outside the project).
   */
  aiInvocation?: boolean;
  logger: BoltLogger;
  runtime: Runtime;
  /**
   * Report a progress or log event. Present on every bolt that lists
   * `plugin-api-2` in `bolt version --json`, absent on older ones. Plugins that
   * support older bolts call `ctx.emit?.(...)`. Optional until the next plugin API major.
   */
  emit?: (event: BoltEvent) => void;
}

/** Context with a required `emit`, for plugins that declare `apiVersion: 2`. */
export type BoltPluginContextV2 = BoltPluginContext & { emit: (event: BoltEvent) => void };

export type BoltPluginHandler = (
  params: Record<string, string>,
  ctx: BoltPluginContext,
) => Promise<void | HandlerResult>;

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
  /** Sorted, deduped capability tags. Omitted when empty. */
  capabilities?: string[];
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
  /** Plugin API version the plugin declared. Absent on plain object plugins (treated as 1). */
  pluginApi?: number;
}

/** Highest plugin API version this bolt implements. Plugins declare their own version. */
export declare const PLUGIN_API_VERSION: 2;
/** Every plugin API version this bolt accepts. */
export declare const SUPPORTED_PLUGIN_API_VERSIONS: readonly number[];

export interface BoltPlugin {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
  /** Declared plugin API version (1 or 2). Plain handler maps omit it and are treated as 1. */
  apiVersion?: number;
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
  fn: (params: T, ctx: BoltPluginContext) => Promise<void | HandlerResult>;
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
  /** Requires the instance field `apiVersion = 2;` on the class (not `static`). */
  capability?: Capability | Capability[];
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
  /** Defaults to 1. Declare v2 with the instance field `apiVersion = 2;` (not `static`). */
  apiVersion: number;
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
export declare function defineHandler<T = Record<string, string>, D extends JsonValue = JsonValue>(
  meta: {
    description?: string;
    ai?: AiMode;
    params?: import("zod").ZodType<T>;
    /** Requires `apiVersion: 2` on definePlugin. */
    capability?: Capability | Capability[];
  },
  fn: (params: T, ctx: BoltPluginContext) => Promise<void | HandlerResult<D>>,
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
  /**
   * Plugin API version this plugin is written against. Omitted means 1.
   * Declare 2 for capability tags and returned results; check that
   * `bolt version --json` lists "plugin-api-2" first.
   */
  apiVersion?: 1 | 2;
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

type ResultExtra<D extends JsonValue> = Partial<Omit<HandlerResult<D>, "status" | "summary">>;

/** Plugin API v2 only. Older bolts do not export these; v1 plugins return object literals. */
export declare function ok<D extends JsonValue = JsonValue>(
  summary?: string,
  extra?: ResultExtra<D>,
): HandlerResult<D>;
export declare function warn<D extends JsonValue = JsonValue>(
  summary: string,
  extra?: ResultExtra<D>,
): HandlerResult<D>;
export declare function fail<D extends JsonValue = JsonValue>(
  summary: string,
  extra?: ResultExtra<D>,
): HandlerResult<D>;
export declare function skipped<D extends JsonValue = JsonValue>(
  summary?: string,
  extra?: ResultExtra<D>,
): HandlerResult<D>;

/**
 * Plugin context for unit tests: records `ctx.emit` calls in `.events`, uses a
 * silent logger and a runtime stub whose spawns fail. Pass overrides as needed.
 */
export declare function createTestContext(
  overrides?: Partial<BoltPluginContext>,
): BoltPluginContextV2 & { events: BoltEvent[] };
