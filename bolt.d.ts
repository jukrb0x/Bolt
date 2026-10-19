/**
 * Type declarations for Bolt plugins.
 * Import as: import { PluginBase, handler } from "boltstack";
 *
 * Plugin API v2 is frozen. Until a plugin API v3, which requires a bolt major
 * version, this module is append-only. See PLUGIN_API_VERSION.
 */

declare module "boltstack" {
  export interface SpawnResult {
    exitCode: number;
    stdout: string;
    stderr: string;
  }
  export interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string>;
    /** Called with each chunk of stdout/stderr output, for logging to file. */
    onOutput?: (text: string) => void;
  }
  export interface Runtime {
    /** Spawn a process and wait for completion */
    spawn(cmd: string[], opts?: SpawnOptions): Promise<SpawnResult>;
    /** Spawn a process synchronously */
    spawnSync(cmd: string[], opts?: SpawnOptions): SpawnResult;
    /** Execute a shell command */
    shell(command: string, opts?: SpawnOptions): Promise<SpawnResult>;
    /** Parse YAML string */
    parseYaml(text: string): unknown;
  }
  /** Subset of Logger exposed to plugin handlers. */
  export interface BoltLogger {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
    cmd(msg: string): void;
  }
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
  export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | {
        [key: string]: JsonValue;
      };
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
    progress?: {
      current: number;
      total?: number;
      unit?: string;
    };
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
    | "artifact.store"
    | "env.check";
  export type Capability = KnownCapability | (string & {});
  /** Declaration passed to an `env.check` handler. Absent on older bolts; read `ctx.envCheck?.id`. */
  export interface EnvCheckContext {
    id: string;
    require: boolean;
    version?: string;
    params?: Record<string, unknown>;
    /**
     * Set by `bolt env ensure` when it asks the handler to fill this gap.
     * Absent on probe and on older bolts. `"ensure"` is the only value.
     */
    action?: "ensure";
  }
  /** Public plugin context — uses narrow BoltPluginConfig to avoid leaking internals. */
  export interface BoltPluginContext {
    cfg: BoltPluginConfig;
    configDir: string;
    dryRun: boolean;
    logger: BoltLogger;
    runtime: Runtime;
    /**
     * Report a progress or log event. Present on every bolt that lists
     * `plugin-api-2` in `bolt version --json`, absent on older ones. Plugins that
     * support older bolts call `ctx.emit?.(...)`. Optional until the next plugin API major.
     */
    emit?: (event: BoltEvent) => void;
    /**
     * Set when `bolt env probe` or `bolt env ensure` calls an `env.check` handler.
     * Absent on older bolts and on every other call. Plugins that support older bolts
     * read `ctx.envCheck?.id`. Additive on plugin API v2. It does not change the handler signature.
     */
    envCheck?: EnvCheckContext;
  }
  /** Context with a required `emit`, for plugins that declare `apiVersion: 2`. */
  export type BoltPluginContextV2 = BoltPluginContext & {
    emit: (event: BoltEvent) => void;
  };
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
    /** Stable id for capability `env.check`. Omitted on every other handler. */
    checkId?: string;
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
  /**
   * Highest plugin API version this bolt implements. Plugins declare their own version.
   *
   * Plugin API v2 is frozen. Until a plugin API v3, which requires a bolt major
   * version, this module is append-only: existing fields, hook signatures, and
   * HandlerResult.status values keep their meaning. bolt version --json lists
   * plugin-api-2. This freeze does not add a config-hooks capability.
   */
  export declare const PLUGIN_API_VERSION: 2;
  /** Every plugin API version this bolt accepts. */
  export declare const SUPPORTED_PLUGIN_API_VERSIONS: readonly number[];
  /** One problem reported by `validateConfig`. */
  export interface ConfigIssue {
    path: string;
    message: string;
    code?: string;
    hint?: string;
  }
  /** Argument to `validateConfig`. Bolt calls the method when it exists, not only for apiVersion 2. */
  export interface ValidateConfigInput {
    namespace: string;
    /** This namespace's yaml `config`. Undefined when the entry is missing or has no config. */
    config: unknown | undefined;
    /** True when `plugins[]` has an entry for this namespace (builtin config or a path plugin). */
    present: boolean;
    tasks: Record<string, unknown>;
    configPath: string;
  }
  /**
   * Plugin API v2 config hooks. Implement them on a plugin that sets `apiVersion` to 2.
   * Bolt calls a hook when the method exists. `bolt check` warns when a hook is present
   * and `apiVersion` is not 2. `initDetect` is reserved: `bolt init` does not call it.
   * `aiContext` and `aiPathRoots` are part of this type surface.
   */
  export interface PluginConfigHooks {
    validateConfig?(input: ValidateConfigInput): ConfigIssue[];
    aiContext?(input: { cfg: BoltPluginConfig; configDir: string }): {
      markdown?: string[];
      info?: Record<string, unknown>;
    };
    /** Roots for a later path confinement. Not a replacement for core path restrictions. */
    aiPathRoots?(input: { cfg: BoltPluginConfig; configDir: string }): Array<{
      refs: string[];
      params: string[];
      root: string;
      label: string;
    }>;
    initDetect?(dir: string): {
      kind: string;
      summary: string;
    } | null;
  }
  export interface BoltPlugin extends PluginConfigHooks {
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
    /** Stable id required when `capability` includes `env.check`. */
    checkId?: string;
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
    /** Requires `apiVersion` 2. Called from config load when the method exists. */
    validateConfig?(input: ValidateConfigInput): ConfigIssue[];
    aiContext?(input: { cfg: BoltPluginConfig; configDir: string }): {
      markdown?: string[];
      info?: Record<string, unknown>;
    };
    aiPathRoots?(input: { cfg: BoltPluginConfig; configDir: string }): Array<{
      refs: string[];
      params: string[];
      root: string;
      label: string;
    }>;
    /** Reserved. `bolt init` does not call this. */
    initDetect?(dir: string): {
      kind: string;
      summary: string;
    } | null;
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
  export declare function defineHandler<
    T = Record<string, string>,
    D extends JsonValue = JsonValue,
  >(
    meta: {
      description?: string;
      ai?: AiMode;
      params?: import("zod").ZodType<T>;
      /** Requires `apiVersion: 2` on definePlugin. */
      capability?: Capability | Capability[];
      /** Stable id required when `capability` includes `env.check`. */
      checkId?: string;
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
     * Declare 2 for capability tags, returned results, and config hooks; check that
     * `bolt version --json` lists "plugin-api-2" first.
     */
    apiVersion?: 1 | 2;
    metadata?: import("zod").ZodType<TMeta>;
    handlers: Record<string, HandlerDef<any>>;
    validateConfig?: PluginConfigHooks["validateConfig"];
    aiContext?: PluginConfigHooks["aiContext"];
    aiPathRoots?: PluginConfigHooks["aiPathRoots"];
    initDetect?: PluginConfigHooks["initDetect"];
  }): BoltPlugin & {
    manifest: PluginManifest;
  };
  /** Optional lifecycle hooks for class-based plugins. Not part of PluginManifest. */
  export interface PluginLifecycleHooks extends PluginConfigHooks {
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
  export type ResultExtra<D extends JsonValue> = Partial<
    Omit<HandlerResult<D>, "status" | "summary">
  >;
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
  ): BoltPluginContextV2 & {
    events: BoltEvent[];
  };
}
