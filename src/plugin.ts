import type { BoltConfig } from "./config";
import type { Runtime } from "./runtime/types";

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
// Decorator-based description for `bolt ai`
// ---------------------------------------------------------------------------

/** Symbol key for storing per-handler description templates on the class. */
const DESCRIPTIONS = Symbol.for("bolt:descriptions");

type DescriptionMap = Map<string, string>;

/**
 * Method decorator — attach a description template to a handler.
 * Use `${paramName}` for interpolation with the step's `with:` params at generation time.
 *
 * @example
 *   @describe("Build ${target} (${config})")
 *   async build(params, ctx) { ... }
 */
export function describe(template: string) {
  return function (_target: any, propertyKey: string, _descriptor: PropertyDescriptor) {
    const ctor = _target.constructor;
    if (!ctor[DESCRIPTIONS]) ctor[DESCRIPTIONS] = new Map<string, string>();
    (ctor[DESCRIPTIONS] as DescriptionMap).set(propertyKey, template);
  };
}

/**
 * Get the description template for a handler on a plugin class.
 * Returns undefined if no @describe decorator was used.
 */
export function getDescriptionTemplate(plugin: BoltPlugin, handlerName: string): string | undefined {
  const ctor = (plugin as any).constructor;
  const map = ctor?.[DESCRIPTIONS] as DescriptionMap | undefined;
  return map?.get(handlerName);
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
  const template = getDescriptionTemplate(plugin, handlerName);
  if (!template) return undefined;
  return template.replace(/\$\{([\w-]+)\}/g, (_, key) => params[key] ?? key);
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
 * Methods become handlers automatically. Use @describe() to annotate them.
 * Subclasses must set `namespace`.
 */
export abstract class PluginBase implements BoltPlugin {
  abstract namespace: string;

  private _handlers?: Record<string, BoltPluginHandler>;

  get handlers(): Record<string, BoltPluginHandler> {
    if (this._handlers) return this._handlers;
    const proto = Object.getPrototypeOf(this);
    const names = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== "constructor" && typeof proto[n] === "function",
    );
    const result: Record<string, BoltPluginHandler> = {};
    for (const name of names) {
      result[name] = (params, ctx) => (this as any)[name](params, ctx);
    }
    this._handlers = result;
    return result;
  }

  describe(handler: string, params: Record<string, string>): string | undefined {
    return resolveDescription(this, handler, params);
  }
}
