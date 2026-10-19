import type { BoltConfig } from "./config";
import type { Runtime } from "./runtime/types";
import type { ZodType, ZodTypeAny } from "zod";
import type { BoltEvent, HandlerResult, JsonValue } from "./handler-result";
import {
  CAPABILITY_PATTERN,
  ENV_CHECK_CAPABILITY,
  normalizeCapabilities,
  type Capability,
} from "./capabilities";
import {
  PLUGIN_API_VERSION,
  SUPPORTED_PLUGIN_API_VERSIONS,
  isSupportedPluginApi,
  pluginApi2Requirement,
} from "./plugin-compat";

export {
  ok,
  warn,
  fail,
  skipped,
  createTestContext,
  type Artifact,
  type BoltEvent,
  type Diagnostic,
  type HandlerResult,
  type HandlerStatus,
  type JsonValue,
  type NextStep,
} from "./handler-result";
export type { Capability, KnownCapability } from "./capabilities";
export { PLUGIN_API_VERSION, SUPPORTED_PLUGIN_API_VERSIONS } from "./plugin-compat";

/** Subset of Logger exposed to plugin handlers. */
export interface BoltLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  cmd(msg: string): void;
}

/** Declaration `bolt env probe` or `bolt env ensure` passes for one check. Optional on older bolts. */
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

export interface BoltPluginContext {
  cfg: BoltConfig;
  configDir: string;
  dryRun: boolean;
  logger: BoltLogger;
  runtime: Runtime;
  /**
   * Report a progress or log event. Always present on a bolt that supports plugin
   * API v2, absent on older ones, so plugins that support older bolts call
   * `ctx.emit?.(...)`. It stays optional until the next plugin API major.
   */
  emit?: (event: BoltEvent) => void;
  /**
   * The declared check when core invokes an `env.check` handler for probe or ensure.
   * Absent on older bolts and on every other call. Plugins read `ctx.envCheck?.id`.
   */
  envCheck?: EnvCheckContext;
}

/** Context with a required `emit`, for plugins that declare `apiVersion: 2`. */
export type BoltPluginContextV2 = BoltPluginContext & { emit: (event: BoltEvent) => void };

/**
 * A handler. Plugin API v1 return values are ignored; v2 return values are
 * validated as a {@link HandlerResult}.
 */
export type BoltPluginHandler = (
  params: Record<string, string>,
  ctx: BoltPluginContext,
) => Promise<void | HandlerResult>;

export type AiMode = false | true | "confirm";

/** Plugin-level fields for class plugins. Not a manifest, and not a plugin object. */
export interface PluginMeta<TMeta = unknown> {
  namespace: string;
  version: string;
  description: string;
  metadata?: ZodType<TMeta>;
}

export interface HandlerManifest {
  description?: string;
  ai: AiMode;
  params?: ZodTypeAny;
  /** Draft-07 JSON Schema emitted from the flat zod subset. */
  paramsSchema?: Record<string, unknown>;
  /** Sorted, deduped capability tags. Omitted when empty. */
  capabilities?: string[];
  /** Stable id for capability `env.check`. Omitted on every other handler. */
  checkId?: string;
}

/**
 * Normalized plugin metadata. Built when the plugin is defined or loaded.
 * There is no manifest file.
 */
export interface PluginManifest {
  namespace: string;
  version: string;
  description: string;
  metadata?: ZodTypeAny;
  handlers: Record<string, HandlerManifest>;
  /** Plugin API version the plugin declared. Absent on reflected object plugins (treated as 1). */
  pluginApi?: number;
}

export interface HandlerDef<T = Record<string, unknown>> {
  description?: string;
  ai: AiMode;
  params?: ZodType<T>;
  /** Requires plugin API v2 on the owning plugin. */
  capabilities?: string[];
  fn: (params: T, ctx: BoltPluginContext) => Promise<void | HandlerResult>;
}

export interface HandlerOptions {
  description?: string;
  ai?: AiMode;
  params?: ZodTypeAny;
  alias?: string;
  /** Requires the class field `apiVersion = 2`. */
  capability?: Capability | Capability[];
  /** Stable id required when `capability` includes `env.check`. */
  checkId?: string;
}

/** One problem reported by `validateConfig` or by core metadata validation. */
export interface ConfigIssue {
  path: string;
  message: string;
  code?: string;
  hint?: string;
}

/** Argument to `validateConfig`. Called when the method exists, not only for apiVersion 2. */
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
 * Plugin API v2 config hooks. Bolt calls a hook when the method exists.
 * Docs require `apiVersion` 2; `bolt check` warns when a hook is present without it.
 * `initDetect` is reserved: `bolt init` does not call it.
 */
export interface PluginConfigHooks {
  validateConfig?(input: ValidateConfigInput): ConfigIssue[];
  aiContext?(input: { cfg: BoltConfig; configDir: string }): {
    markdown?: string[];
    info?: Record<string, unknown>;
  };
  /** Roots for a later path confinement. Not a replacement for core `AI_PATH_RESTRICTED`. */
  aiPathRoots?(input: { cfg: BoltConfig; configDir: string }): Array<{
    refs: string[];
    params: string[];
    root: string;
    label: string;
  }>;
  initDetect?(dir: string): { kind: string; summary: string } | null;
}

// ---------------------------------------------------------------------------
// Legacy @param storage — reader kept so ai-context can still call getParamMap.
// New params are zod schemas on the handler, not this map.
// ---------------------------------------------------------------------------

export const PARAMS = Symbol.for("bolt:params");

interface ParamMeta {
  description: string;
}

type ParamMap = Map<string, ParamMeta>;
type ClassParamMap = Map<string, ParamMap>;

export function getParamMap(
  plugin: { constructor: any },
  methodName: string,
): ParamMap | undefined {
  const ctor = plugin.constructor;
  const classMap = ctor?.[PARAMS] as ClassParamMap | undefined;
  return classMap?.get(methodName);
}

// ---------------------------------------------------------------------------
// Handler metadata shared by @handler and defineHandler
// ---------------------------------------------------------------------------

const HANDLERS = Symbol.for("bolt:handlers");
const HANDLER_DEF = Symbol.for("bolt:handler-def");
const DEFINED_PLUGIN = Symbol.for("bolt:defined-plugin");
const MANIFEST_CACHE = Symbol.for("bolt:manifest-cache");
const RAW_CAPABILITY = Symbol.for("bolt:raw-capability");
const RAW_CHECK_ID = Symbol.for("bolt:raw-check-id");

/** Cross-realm brand. `instanceof PluginBase` is false for another bundled copy. */
export const PLUGIN_BRAND = Symbol.for("boltstack.plugin");

interface StoredHandler {
  alias: string;
  description?: string;
  ai: AiMode;
  params?: ZodTypeAny;
  /** Raw tags. Validated at registration, when the instance apiVersion is known. */
  capability?: unknown;
  /** Raw `env.check` id. Validated with the capability tags. */
  checkId?: unknown;
}

type HandlerMap = Map<string, StoredHandler>;

interface ZodLike {
  description?: string;
  safeParse?: (data: unknown) => {
    success: boolean;
    data?: unknown;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  };
  _def: {
    typeName?: string;
    checks?: unknown[];
    coerce?: boolean;
    values?: readonly string[];
    innerType?: ZodLike;
    defaultValue?: () => unknown;
    shape?: (() => Record<string, ZodLike>) | Record<string, ZodLike>;
    unknownKeys?: string;
    catchall?: ZodLike;
  };
}

const PARAMS_SCHEMA_HELP =
  "Use a flat z.object of z.string(), z.enum(), z.coerce.number(), or z.coerce.boolean(), with optional(), default(), and describe() only.";

function assertAi(ai: unknown, label: string): asserts ai is AiMode {
  if (ai !== false && ai !== true && ai !== "confirm") {
    throw new Error(`${label}: ai must be false, true, or "confirm"`);
  }
}

function asZod(schema: ZodTypeAny): ZodLike {
  return schema as unknown as ZodLike;
}

function unsupportedParams(field: string, kind: string): never {
  const where = field ? ` at "${field}"` : "";
  throw new Error(`Unsupported params schema${where} (${kind}). ${PARAMS_SCHEMA_HELP}`);
}

function unwrapField(
  schema: ZodLike,
  field: string,
): {
  schema: ZodLike;
  optional: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
  description?: string;
} {
  let optional = false;
  let hasDefault = false;
  let defaultValue: unknown;
  let description: string | undefined;
  let current = schema;
  const seen = new Set<ZodLike>();

  while (current && !seen.has(current)) {
    seen.add(current);
    if (description === undefined && typeof current.description === "string") {
      description = current.description;
    }
    const typeName = current._def?.typeName;
    if (typeName === "ZodOptional") {
      optional = true;
      current = current._def.innerType!;
      continue;
    }
    if (typeName === "ZodDefault") {
      if (!hasDefault) {
        hasDefault = true;
        defaultValue = current._def.defaultValue?.();
      }
      current = current._def.innerType!;
      continue;
    }
    if (
      typeName === "ZodEffects" ||
      typeName === "ZodNullable" ||
      typeName === "ZodCatch" ||
      typeName === "ZodPipeline" ||
      typeName === "ZodBranded" ||
      typeName === "ZodLazy" ||
      typeName === "ZodPromise" ||
      typeName === "ZodArray" ||
      typeName === "ZodUnion" ||
      typeName === "ZodDiscriminatedUnion" ||
      typeName === "ZodTuple" ||
      typeName === "ZodRecord" ||
      typeName === "ZodIntersection" ||
      typeName === "ZodObject"
    ) {
      unsupportedParams(field, typeName);
    }
    break;
  }

  return { schema: current, optional, hasDefault, defaultValue, description };
}

function fieldToJson(
  schema: ZodLike,
  field: string,
): {
  json: Record<string, unknown>;
  optional: boolean;
  hasDefault: boolean;
} {
  const unwrapped = unwrapField(schema, field);
  const typeName = unwrapped.schema._def?.typeName;
  const json: Record<string, unknown> = {};

  if (typeName === "ZodString") {
    if (unwrapped.schema._def.coerce) unsupportedParams(field, "ZodString coerce");
    if (unwrapped.schema._def.checks?.length) unsupportedParams(field, "ZodString check");
    json.type = "string";
  } else if (typeName === "ZodEnum") {
    json.type = "string";
    json.enum = [...(unwrapped.schema._def.values ?? [])];
  } else if (typeName === "ZodNumber") {
    if (!unwrapped.schema._def.coerce) unsupportedParams(field, "ZodNumber");
    if (unwrapped.schema._def.checks?.length) unsupportedParams(field, "ZodNumber check");
    json.type = "number";
  } else if (typeName === "ZodBoolean") {
    if (!unwrapped.schema._def.coerce) unsupportedParams(field, "ZodBoolean");
    if (unwrapped.schema._def.checks?.length) unsupportedParams(field, "ZodBoolean check");
    json.type = "boolean";
  } else {
    unsupportedParams(field, typeName ?? "unknown");
  }

  if (unwrapped.description !== undefined) json.description = unwrapped.description;
  if (unwrapped.hasDefault) json.default = unwrapped.defaultValue;
  return { json, optional: unwrapped.optional, hasDefault: unwrapped.hasDefault };
}

function objectShape(schema: ZodLike): Record<string, ZodLike> {
  if (schema._def?.typeName !== "ZodObject") return {};
  const shape = schema._def.shape;
  return typeof shape === "function" ? shape() : (shape ?? {});
}

/**
 * Step params arrive as strings. Zod's boolean coerce uses JS Boolean(), so
 * the string "false" would become true. Map the two textual booleans first.
 */
export function normalizeTextualBooleans(
  schema: ZodTypeAny,
  raw: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const [key, field] of Object.entries(objectShape(asZod(schema)))) {
    if (unwrapField(field, key).schema._def?.typeName !== "ZodBoolean") continue;
    if (raw[key] === "true") out[key] = true;
    else if (raw[key] === "false") out[key] = false;
  }
  return out;
}

/** Emit draft-07 JSON Schema for the allowed flat zod subset. Throws on anything else. */
export function zodParamsToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const root = asZod(schema);
  if (root._def?.typeName !== "ZodObject") {
    throw new Error(`params must be a flat z.object(...). ${PARAMS_SCHEMA_HELP}`);
  }
  if (root._def.unknownKeys !== "strip") {
    unsupportedParams("", `ZodObject ${root._def.unknownKeys ?? "unknownKeys"}`);
  }
  if (root._def.catchall && root._def.catchall._def?.typeName !== "ZodNever") {
    unsupportedParams("", "ZodObject catchall");
  }

  const shape = objectShape(root);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(shape)) {
    const converted = fieldToJson(field, key);
    properties[key] = converted.json;
    if (!converted.optional && !converted.hasDefault) required.push(key);
  }

  const out: Record<string, unknown> = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties,
  };
  if (required.length > 0) out.required = required;
  return out;
}

function toManifestHandler(stored: {
  description?: string;
  ai: AiMode;
  params?: ZodTypeAny;
  capabilities?: string[];
}): HandlerManifest {
  const entry: HandlerManifest = { ai: stored.ai };
  if (stored.description !== undefined) entry.description = stored.description;
  if (stored.params) {
    entry.params = stored.params;
    entry.paramsSchema = zodParamsToJsonSchema(stored.params);
  }
  if (stored.capabilities && stored.capabilities.length > 0) {
    entry.capabilities = [...stored.capabilities];
  }
  return entry;
}

/** Error for a capability on a plugin that did not declare plugin API v2. */
export function capabilityNeedsApi2(label: string, classForm: boolean): Error {
  const fix = classForm
    ? "add the instance field `apiVersion = 2;` to the class (not `static`)"
    : "add `apiVersion: 2` to definePlugin({ ... })";
  return new Error(
    `${label} uses capability, which requires plugin API v2. Fix: ${fix}. ${pluginApi2Requirement()}`,
  );
}

function assertZodSchema(value: unknown, label: string): ZodTypeAny {
  const schema = value as ZodLike;
  if (
    !schema ||
    typeof schema !== "object" ||
    typeof schema.safeParse !== "function" ||
    typeof schema._def?.typeName !== "string"
  ) {
    throw new Error(`${label} must be a zod schema`);
  }
  return value as ZodTypeAny;
}

function rejectRetiredFields(opts: object, label: string): void {
  if ("deps" in opts || "configSchema" in opts) {
    throw new Error(
      `${label}: deps and configSchema are not supported. deps is not implemented and must not appear on the manifest. Use metadata for the schema this plugin owns.`,
    );
  }
}

export function isHandlerDef(value: unknown): value is HandlerDef<any> {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { [HANDLER_DEF]?: boolean })[HANDLER_DEF] === true
  );
}

export function isDefinedPlugin(value: object): boolean {
  return (value as { [DEFINED_PLUGIN]?: boolean })[DEFINED_PLUGIN] === true;
}

export function markDefinedPlugin(plugin: object): void {
  Object.defineProperty(plugin, DEFINED_PLUGIN, { value: true });
}

export function isBrandedPlugin(value: object): boolean {
  return (value as { [PLUGIN_BRAND]?: boolean })[PLUGIN_BRAND] === true;
}

/** Stamp the cross-copy brand and the protocol version the registry checks. */
export function brandPlugin(plugin: object, apiVersion: number = 1): void {
  Object.defineProperty(plugin, PLUGIN_BRAND, { value: true });
  Object.defineProperty(plugin, "apiVersion", {
    value: apiVersion,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** "plugin API v1 and v2" */
function supportedText(): string {
  const list = SUPPORTED_PLUGIN_API_VERSIONS.map((v) => `v${v}`);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
}

/**
 * Registration check for branded plugins. A branded export without any
 * apiVersion is still an error: only a forged brand can produce one.
 */
export function assertPluginApiVersion(plugin: { namespace?: string; apiVersion?: unknown }): void {
  if (isSupportedPluginApi(plugin.apiVersion)) return;
  const version = plugin.apiVersion;
  const name = plugin.namespace ?? "(unknown)";
  if (version === undefined) {
    throw new Error(
      `Plugin "${name}" requires plugin API none, but this bolt supports plugin API ${supportedText()}. The export carries Symbol.for("boltstack.plugin") without an apiVersion. Fix: create the plugin with definePlugin() or PluginBase from boltstack instead of setting the brand by hand.`,
    );
  }
  const found = typeof version === "number" ? `v${version}` : JSON.stringify(version);
  const newer = typeof version === "number" && version > PLUGIN_API_VERSION;
  const fix = newer
    ? ` Run \`bolt self-update\` to get a bolt that supports plugin API v${version}; \`bolt version --json\` lists the supported versions under plugin_api.`
    : ` Fix: set apiVersion to one of ${SUPPORTED_PLUGIN_API_VERSIONS.join(", ")} (or omit it for v1).`;
  throw new Error(
    `Plugin "${name}" requires plugin API ${found}, but this bolt supports plugin API ${supportedText()}.${fix}`,
  );
}

/**
 * Class plugins declare the version with the instance field. A `static apiVersion`
 * is invisible to older bolts, so it is rejected when it disagrees with the
 * instance field and warned about when it agrees. A conflict fails plugin loading
 * (the whole run), not just the tasks that use the plugin: the registry loads every
 * plugin up front, the same as for an unsupported apiVersion, so a broken plugin is
 * reported before any step runs instead of part-way through a flow.
 */
export function checkStaticApiVersion(plugin: object): string | undefined {
  const ctor = (plugin as { constructor?: unknown }).constructor;
  if (typeof ctor !== "function" || ctor === Object || !Object.hasOwn(ctor, "apiVersion")) {
    return undefined;
  }
  const name = (plugin as { namespace?: string }).namespace ?? "(unknown)";
  const staticVersion = (ctor as { apiVersion?: unknown }).apiVersion;
  const instanceVersion = (plugin as { apiVersion?: unknown }).apiVersion;
  if (staticVersion !== instanceVersion) {
    throw new Error(
      `Plugin "${name}": static apiVersion conflicts with the instance field (static ${JSON.stringify(staticVersion)}, instance ${JSON.stringify(instanceVersion)}). Fix: remove the static field and use the instance field \`apiVersion = ${JSON.stringify(staticVersion)};\`.`,
    );
  }
  return `Plugin "${name}": static apiVersion is redundant (bolt reads only the instance field). Remove it; the instance field \`apiVersion = ${JSON.stringify(instanceVersion)};\` already declares the version.`;
}

/**
 * Validate capability tags of a class plugin at registration, when the
 * instance apiVersion is known. Returns the plugin's manifest unchanged.
 */
export function assertClassCapabilities(plugin: BoltPlugin): void {
  const map = getHandlerMap(plugin);
  if (!map) return;
  const handlers: Record<string, HandlerManifest> = {};
  for (const [, stored] of map) {
    if (stored.capability === undefined && stored.checkId === undefined) continue;
    const label = `handler "${plugin.namespace}/${stored.alias}"`;
    if (plugin.apiVersion !== 2) {
      if (stored.capability !== undefined) throw capabilityNeedsApi2(label, true);
      throw checkIdNeedsApi2(label);
    }
    const capabilities =
      stored.capability === undefined
        ? []
        : normalizeCapabilities(stored.capability, plugin.namespace, label);
    const entry: HandlerManifest = { ai: stored.ai };
    if (capabilities.length > 0) entry.capabilities = capabilities;
    attachCheckId(entry, stored.checkId, label);
    handlers[stored.alias] = entry;
  }
  assertUniqueCheckIds(handlers, plugin.namespace);
}

/** True when `manifest` is a getter. Without the brand this is not a plugin. */
export function hasManifestGetter(plugin: object): boolean {
  let current: object | null = plugin;
  while (current && current !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(current, "manifest");
    if (desc?.get) return true;
    current = Object.getPrototypeOf(current);
  }
  return false;
}

/**
 * Object plugins (git, svn, fs, json) have no authoring metadata.
 * Reflect their handler names into a manifest with ai:false and no params.
 * A hand-written manifest property is ignored.
 */
export function reflectObjectManifest(plugin: BoltPlugin): PluginManifest {
  const handlers: PluginManifest["handlers"] = {};
  for (const name of Object.keys(plugin.handlers ?? {})) {
    handlers[name] = { ai: false };
  }
  const record = plugin as BoltPlugin & { version?: unknown; description?: unknown };
  return {
    namespace: plugin.namespace,
    version: typeof record.version === "string" ? record.version : "",
    description: typeof record.description === "string" ? record.description : "",
    handlers,
  };
}

function storeHandler(ctor: any, propertyKey: string, stored: StoredHandler): void {
  if (!ctor[HANDLERS]) ctor[HANDLERS] = new Map<string, StoredHandler>();
  (ctor[HANDLERS] as HandlerMap).set(propertyKey, stored);
}

function toStored(
  methodName: string,
  descriptionOrOptions?: string | HandlerOptions,
  alias?: string,
): StoredHandler {
  if (descriptionOrOptions && typeof descriptionOrOptions === "object") {
    const ai = descriptionOrOptions.ai ?? false;
    assertAi(ai, `@handler ${methodName}`);
    if (descriptionOrOptions.params) zodParamsToJsonSchema(descriptionOrOptions.params);
    const stored: StoredHandler = {
      alias: descriptionOrOptions.alias ?? methodName,
      description: descriptionOrOptions.description,
      ai,
      params: descriptionOrOptions.params,
    };
    if (descriptionOrOptions.capability !== undefined) {
      stored.capability = descriptionOrOptions.capability;
    }
    if (descriptionOrOptions.checkId !== undefined) {
      stored.checkId = descriptionOrOptions.checkId;
    }
    return stored;
  }
  return {
    alias: alias ?? methodName,
    description: descriptionOrOptions,
    ai: false,
  };
}

/**
 * Method decorator — mark a method as a plugin handler.
 * String form stays compatible with existing `@handler("...")` plugins.
 * Object form fills the same handler metadata as `defineHandler`.
 */
export function handler(description?: string, alias?: string): MethodDecorator;
export function handler(options: HandlerOptions): MethodDecorator;
export function handler(descriptionOrOptions?: string | HandlerOptions, alias?: string) {
  return function (_target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) {
    const methodName = String(propertyKey);
    storeHandler(
      (_target as { constructor: any }).constructor,
      methodName,
      toStored(methodName, descriptionOrOptions, alias),
    );
  };
}

function getHandlerMap(plugin: object): HandlerMap | undefined {
  const ctor = (plugin as { constructor?: any }).constructor;
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
  for (const [, meta] of map) {
    if (meta.alias === handlerName && meta.description) {
      return meta.description.replace(/\$\{([\w-]+)\}/g, (_, key) => params[key] ?? key);
    }
  }
  return undefined;
}

function fillDescription(
  description: string | undefined,
  params: Record<string, string>,
): string | undefined {
  if (!description) return undefined;
  return description.replace(/\$\{([\w-]+)\}/g, (_, key) => params[key] ?? key);
}

export function defineHandler<T = Record<string, string>, D extends JsonValue = JsonValue>(
  meta: {
    description?: string;
    ai?: AiMode;
    params?: ZodType<T>;
    capability?: Capability | Capability[];
    /** Stable id required when `capability` includes `env.check`. */
    checkId?: string;
  },
  fn: (params: T, ctx: BoltPluginContext) => Promise<void | HandlerResult<D>>,
): HandlerDef<T> {
  if (!meta || typeof meta !== "object") throw new Error("defineHandler: meta object is required");
  if (typeof fn !== "function") throw new Error("defineHandler: fn must be a function");
  const ai = meta.ai ?? false;
  assertAi(ai, "defineHandler");
  if (meta.params) zodParamsToJsonSchema(meta.params as ZodTypeAny);
  const def: HandlerDef<T> = {
    description: meta.description,
    ai,
    params: meta.params,
    fn,
  };
  // Tags are validated by definePlugin, which knows the namespace and apiVersion.
  if (meta.capability !== undefined) {
    Object.defineProperty(def, RAW_CAPABILITY, { value: meta.capability });
  }
  if (meta.checkId !== undefined) {
    Object.defineProperty(def, RAW_CHECK_ID, { value: meta.checkId });
  }
  Object.defineProperty(def, HANDLER_DEF, { value: true });
  return def;
}

function checkIdNeedsApi2(label: string): Error {
  return new Error(
    `${label}: checkId requires plugin API v2. Fix: add \`apiVersion: 2\` to definePlugin({ ... }). ${pluginApi2Requirement()}`,
  );
}

/** Attach `checkId` when the handler provides `env.check`. Throws on a mismatch. */
export function attachCheckId(entry: HandlerManifest, checkId: unknown, label: string): void {
  const tagged = entry.capabilities?.includes(ENV_CHECK_CAPABILITY) ?? false;
  if (checkId === undefined) {
    if (tagged) {
      throw new Error(`${label}: capability "${ENV_CHECK_CAPABILITY}" requires checkId.`);
    }
    return;
  }
  if (!tagged) {
    throw new Error(`${label}: checkId requires capability "${ENV_CHECK_CAPABILITY}".`);
  }
  if (typeof checkId !== "string" || !CAPABILITY_PATTERN.test(checkId)) {
    throw new Error(
      `${label}: checkId ${JSON.stringify(checkId)} is not a stable id. Use lowercase dot-separated words such as "fixture.tool.a".`,
    );
  }
  entry.checkId = checkId;
}

function assertUniqueCheckIds(handlers: Record<string, HandlerManifest>, namespace: string): void {
  const seen = new Map<string, string>();
  for (const [name, entry] of Object.entries(handlers)) {
    if (!entry.checkId) continue;
    const prev = seen.get(entry.checkId);
    if (prev) {
      throw new Error(
        `Plugin "${namespace}": checkId "${entry.checkId}" is declared on ${prev} and ${name}.`,
      );
    }
    seen.set(entry.checkId, name);
  }
}

export interface DefinePluginOptions<TMeta = unknown> extends PluginConfigHooks {
  namespace: string;
  version: string;
  description: string;
  /**
   * Plugin API version this plugin is written against: 1 or 2. Omitted means 1.
   * Declare 2 to use capability tags, returned results, and config hooks.
   */
  apiVersion?: 1 | 2;
  metadata?: ZodType<TMeta>;
  handlers: Record<string, HandlerDef<any>>;
}

/**
 * Define a plugin object. This used to return a descriptor for `withDescriptor`;
 * it now returns the plugin itself (public API break).
 */
export function definePlugin<TMeta = unknown>(
  opts: DefinePluginOptions<TMeta>,
): BoltPlugin & { manifest: PluginManifest } {
  if (!opts || typeof opts !== "object")
    throw new Error("definePlugin: options object is required");
  rejectRetiredFields(opts, "definePlugin");
  if (!opts.namespace) throw new Error("definePlugin: namespace is required");
  if (!opts.version) throw new Error("definePlugin: version is required");
  if (!opts.description) throw new Error("definePlugin: description is required");
  const apiVersion: number = opts.apiVersion ?? 1;
  if (!isSupportedPluginApi(apiVersion)) {
    const newer = typeof apiVersion === "number" && apiVersion > PLUGIN_API_VERSION;
    const fix = newer
      ? ` Run \`bolt self-update\` to get a bolt that supports plugin API v${apiVersion}; \`bolt version --json\` lists the supported versions under plugin_api.`
      : ` Fix: use apiVersion ${SUPPORTED_PLUGIN_API_VERSIONS.join(" or ")}, or omit it for v1.`;
    throw new Error(
      `definePlugin: apiVersion ${JSON.stringify(apiVersion)} is not supported. This bolt implements plugin API ${supportedText()}.${fix}`,
    );
  }
  if (!opts.handlers || typeof opts.handlers !== "object" || Array.isArray(opts.handlers)) {
    throw new Error("definePlugin: handlers is required");
  }
  const names = Object.keys(opts.handlers);
  if (names.length === 0) throw new Error("definePlugin: at least one handler is required");

  const handlers: Record<string, BoltPluginHandler> = {};
  const manifestHandlers: PluginManifest["handlers"] = {};
  for (const name of names) {
    const def = opts.handlers[name];
    if (!isHandlerDef(def)) {
      throw new Error(`definePlugin: handlers.${name} must be created with defineHandler()`);
    }
    handlers[name] = def.fn as BoltPluginHandler;
    const label = `handler "${opts.namespace}/${name}"`;
    const raw = (def as { [RAW_CAPABILITY]?: unknown })[RAW_CAPABILITY];
    const rawCheckId = (def as { [RAW_CHECK_ID]?: unknown })[RAW_CHECK_ID];
    if (raw !== undefined && apiVersion !== 2) throw capabilityNeedsApi2(label, false);
    if (rawCheckId !== undefined && apiVersion !== 2) throw checkIdNeedsApi2(label);
    const capabilities = normalizeCapabilities(raw, opts.namespace, label);
    const entry = toManifestHandler({
      description: def.description,
      ai: def.ai,
      params: def.params as ZodTypeAny | undefined,
      capabilities,
    });
    attachCheckId(entry, rawCheckId, label);
    manifestHandlers[name] = entry;
  }
  assertUniqueCheckIds(manifestHandlers, opts.namespace);

  const manifest: PluginManifest = {
    namespace: opts.namespace,
    version: opts.version,
    description: opts.description,
    handlers: manifestHandlers,
    pluginApi: apiVersion,
  };
  if (opts.metadata) manifest.metadata = assertZodSchema(opts.metadata, "definePlugin metadata");

  const plugin: BoltPlugin & { manifest: PluginManifest } = {
    namespace: opts.namespace,
    handlers,
    manifest,
    describe(handlerName, params) {
      return fillDescription(manifest.handlers[handlerName]?.description, params);
    },
  };
  if (opts.validateConfig) plugin.validateConfig = opts.validateConfig;
  if (opts.aiContext) plugin.aiContext = opts.aiContext;
  if (opts.aiPathRoots) plugin.aiPathRoots = opts.aiPathRoots;
  if (opts.initDetect) plugin.initDetect = opts.initDetect;
  markDefinedPlugin(plugin);
  brandPlugin(plugin, apiVersion);
  return plugin;
}

// ---------------------------------------------------------------------------
// Plugin interface & base class
// ---------------------------------------------------------------------------

/** Optional lifecycle hooks that class-based plugins can implement. */
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

export interface BoltPlugin extends PluginConfigHooks {
  namespace: string;
  handlers: Record<string, BoltPluginHandler>;
  /** Stamped by definePlugin() and PluginBase. Plain handler maps omit it. */
  apiVersion?: number;
  /** Present once the plugin is defined (class or definePlugin) or registered (object). */
  manifest?: PluginManifest;
  /** Return a human-readable description for a handler call, or undefined if none. */
  describe?: (handler: string, params: Record<string, string>) => string | undefined;
}

function buildClassManifest(plugin: PluginBase): PluginManifest {
  const map = getHandlerMap(plugin);
  const handlers: PluginManifest["handlers"] = {};
  if (map) {
    for (const [, stored] of map) {
      const label = `handler "${plugin.namespace}/${stored.alias}"`;
      if (stored.checkId !== undefined && plugin.apiVersion !== 2) throw checkIdNeedsApi2(label);
      const capabilities =
        stored.capability === undefined || plugin.apiVersion !== 2
          ? []
          : normalizeCapabilities(stored.capability, plugin.namespace, label);
      const entry = toManifestHandler({ ...stored, capabilities });
      attachCheckId(entry, stored.checkId, label);
      handlers[stored.alias] = entry;
    }
  }
  assertUniqueCheckIds(handlers, plugin.namespace);
  const manifest: PluginManifest = {
    namespace: plugin.namespace,
    version: plugin.version ?? "",
    description: plugin.description ?? "",
    handlers,
    pluginApi: typeof plugin.apiVersion === "number" ? plugin.apiVersion : 1,
  };
  if (plugin.metadata) manifest.metadata = plugin.metadata;
  return manifest;
}

/**
 * Base class for class-based plugins.
 * Only methods decorated with @handler() are exposed as handlers.
 * Subclasses must set `namespace`.
 */
export abstract class PluginBase implements BoltPlugin {
  abstract namespace: string;
  version = "";
  description = "";
  /** Plugin API version. Override with the instance field `apiVersion = 2;` (not `static`). */
  apiVersion: number = 1;
  /** Zod schema this plugin owns. Checked when a plugins[] entry for this namespace is present. */
  metadata?: ZodTypeAny;
  config?: unknown;
  /** Accepted by withDescriptor's constructor. The registry does not inject deps. */
  deps?: Record<string, BoltPlugin>;

  private _handlers?: Record<string, BoltPluginHandler>;

  constructor() {
    Object.defineProperty(this, PLUGIN_BRAND, { value: true });
  }

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

  get manifest(): PluginManifest {
    const cached = (this as { [MANIFEST_CACHE]?: PluginManifest })[MANIFEST_CACHE];
    if (cached) return cached;
    const built = buildClassManifest(this);
    (this as { [MANIFEST_CACHE]?: PluginManifest })[MANIFEST_CACHE] = built;
    return built;
  }

  describe(handlerName: string, params: Record<string, string>): string | undefined {
    return resolveDescription(this, handlerName, params);
  }

  static withDescriptor<TMeta = unknown>(
    meta: PluginMeta<TMeta>,
  ): {
    new (
      config?: unknown,
      deps?: Record<string, BoltPlugin>,
    ): PluginBase & {
      config: unknown;
      deps: Record<string, BoltPlugin> | undefined;
      metadata?: ZodType<TMeta>;
      manifest: PluginManifest;
    };
  } {
    if (!meta?.namespace || !meta.version || !meta.description) {
      throw new Error("withDescriptor: namespace, version, and description are required");
    }
    rejectRetiredFields(meta, "withDescriptor");
    if (meta.metadata) assertZodSchema(meta.metadata, "withDescriptor metadata");

    abstract class BoundPlugin extends PluginBase {
      namespace = meta.namespace;
      override version = meta.version;
      override description = meta.description;
      override metadata = meta.metadata as ZodTypeAny | undefined;
      override config: unknown;
      override deps: Record<string, BoltPlugin> | undefined;

      constructor(config?: unknown, deps?: Record<string, BoltPlugin>) {
        super();
        this.config = config;
        this.deps = deps;
      }
    }
    return BoundPlugin as any;
  }
}
