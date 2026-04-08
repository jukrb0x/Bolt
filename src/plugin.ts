import type { BoltConfig } from "./config";
import type { Runtime } from "./runtime/types";
import type { ZodType } from "zod";

/** Subset of Logger exposed to plugin handlers. */
export interface BoltLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  cmd(msg: string): void;
}

export interface BoltPluginContext {
  cfg: BoltConfig;
  configDir: string;
  dryRun: boolean;
  logger: BoltLogger;
  runtime: Runtime;
}

export type BoltPluginHandler = (
  params: Record<string, string>,
  ctx: BoltPluginContext,
) => Promise<void>;

// ---------------------------------------------------------------------------
// @handler decorator — marks a method as a plugin handler
// ---------------------------------------------------------------------------

/** Symbol key for storing handler metadata on the class. */
const HANDLERS = Symbol.for("bolt:handlers");

/** Symbol key for storing parameter metadata on the class. */
export const PARAMS = Symbol.for("bolt:params");

interface ParamMeta {
  description: string;
}

type ParamMap = Map<string, ParamMeta>;
type ClassParamMap = Map<string, ParamMap>;

/**
 * Parameter decorator — attach metadata to a handler parameter.
 * Stores a `Map<methodName, Map<paramName, { description }>>` on the class constructor.
 *
 * @param name         Logical parameter name (key in the `with:` block).
 * @param description  Human-readable description for `bolt ai`.
 */
export function param(name: string, description: string) {
  return function (_target: any, propertyKey: string, _parameterIndex: number) {
    const ctor = _target.constructor;
    if (!ctor[PARAMS]) ctor[PARAMS] = new Map<string, ParamMap>();
    const classMap = ctor[PARAMS] as ClassParamMap;
    if (!classMap.has(propertyKey)) classMap.set(propertyKey, new Map());
    classMap.get(propertyKey)!.set(name, { description });
  };
}

/**
 * Retrieve the param metadata map for a specific method on a plugin instance.
 */
export function getParamMap(plugin: { constructor: any }, methodName: string): ParamMap | undefined {
  const ctor = plugin.constructor;
  const classMap = ctor?.[PARAMS] as ClassParamMap | undefined;
  return classMap?.get(methodName);
}

interface HandlerMeta {
  /** The public handler name (defaults to method name). */
  alias: string;
  /** Description template for `bolt ai`. Use ${paramName} for interpolation. */
  description?: string;
}

type HandlerMap = Map<string, HandlerMeta>;

/**
 * Method decorator — mark a method as a plugin handler.
 * Only decorated methods are exposed as handlers by PluginBase.
 *
 * @param description  Optional description template for `bolt ai`.
 *                     Use `${paramName}` for interpolation with step's `with:` params.
 * @param alias        Optional handler name override (defaults to method name).
 *
 * @example
 *   @handler("Build ${target} (${config})")
 *   async build(params, ctx) { ... }
 *
 *   @handler("Override INI ${file}", "ini-override")
 *   async iniOverride(params, ctx) { ... }
 *
 *   @handler()  // no description, method name as handler name
 *   async kill(params, ctx) { ... }
 */
export function handler(description?: string, alias?: string) {
  return function (_target: any, propertyKey: string, _descriptor: PropertyDescriptor) {
    const ctor = _target.constructor;
    if (!ctor[HANDLERS]) ctor[HANDLERS] = new Map<string, HandlerMeta>();
    (ctor[HANDLERS] as HandlerMap).set(propertyKey, {
      alias: alias ?? propertyKey,
      description,
    });
  };
}

/**
 * Get handler metadata for all decorated methods on a plugin class.
 */
function getHandlerMap(plugin: BoltPlugin): HandlerMap | undefined {
  const ctor = (plugin as any).constructor;
  return ctor?.[HANDLERS] as HandlerMap | undefined;
}

/**
 * Resolve a description template with actual params.
 * "${target}" in template + { target: "editor" } → "editor"
 */
export function resolveDescription(
  plugin: BoltPlugin,
  handlerName: string,
  params: Record<string, string>,
): string | undefined {
  const map = getHandlerMap(plugin);
  if (!map) return undefined;
  // Find by alias match (handlerName is the public name)
  for (const [, meta] of map) {
    if (meta.alias === handlerName && meta.description) {
      return meta.description.replace(/\$\{([\w-]+)\}/g, (_, key) => params[key] ?? key);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Plugin interface & base class
// ---------------------------------------------------------------------------

export interface BoltPlugin {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
  /** Return a human-readable description for a handler call, or undefined if none. */
  describe?: (handler: string, params: Record<string, string>) => string | undefined;
}

/**
 * Base class for class-based plugins.
 * Only methods decorated with @handler() are exposed as handlers.
 * Subclasses must set `namespace`.
 */
export abstract class PluginBase implements BoltPlugin {
  abstract namespace: string;

  private _handlers?: Record<string, BoltPluginHandler>;

  get handlers(): Record<string, BoltPluginHandler> {
    if (this._handlers) return this._handlers;
    const map = getHandlerMap(this);
    const result: Record<string, BoltPluginHandler> = {};
    if (map) {
      for (const [methodName, meta] of map) {
        result[meta.alias] = (params, ctx) => (this as any)[methodName](params, ctx);
      }
    }
    this._handlers = result;
    return result;
  }

  describe(handlerName: string, params: Record<string, string>): string | undefined {
    return resolveDescription(this, handlerName, params);
  }
}

// ---------------------------------------------------------------------------
// definePlugin() — typed plugin descriptor
// ---------------------------------------------------------------------------

export interface PluginDescriptor<TConfig = unknown> {
  namespace: string;
  version: string;
  description: string;
  configSchema?: ZodType<TConfig>;
  deps?: string[];
}

/**
 * Define a plugin descriptor. Pass the result to `PluginBase.withDescriptor()`.
 *
 * @example
 *   const descriptor = definePlugin({
 *     namespace: "deploy",
 *     version: "1.0.0",
 *     description: "Deployment automation",
 *     configSchema: z.object({ host: z.string() }),
 *     deps: ["git"],
 *   });
 */
export function definePlugin<TConfig = unknown>(
  opts: PluginDescriptor<TConfig>,
): PluginDescriptor<TConfig> {
  if (!opts.namespace) throw new Error("definePlugin: namespace is required");
  if (!opts.version) throw new Error("definePlugin: version is required");
  if (!opts.description) throw new Error("definePlugin: description is required");
  return { ...opts };
}
