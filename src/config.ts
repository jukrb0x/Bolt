import { z } from "zod";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import os from "os";
import path from "path";
import { createRuntime, type Runtime } from "./runtime";
import type { BoltPlugin, ConfigIssue, ValidateConfigInput } from "./plugin";
import { PluginRegistry } from "./plugin-registry";
import { builtinPlugins } from "./plugins";
import { findLegacyKeys, unknownProjectRefs } from "./legacy-config";
import {
  assessCapabilities,
  capabilityUsesInTasks,
  mergeCapabilityMaps,
  type SelectionFile,
} from "./capability-selection";
import {
  WorkspaceSchema,
  codeForZodIssue,
  formatZodConfigError,
  workspaceFromParsed,
  type WorkspaceConfig,
} from "./workspace";

/** bolt.yaml schema version. Unknown versions are rejected; there is no migrator. */
export const CONFIG_VERSION = 1;

// ============================================================================
// Schemas (single source of truth) + Derived Types
// ============================================================================

// --- Core Schemas ---
const StepOptionsSchema = z.object({
  with: z.record(z.string()).optional(),
  "continue-on-error": z.boolean().optional(),
});

const UsesStepSchema = StepOptionsSchema.extend({
  uses: z.string().superRefine((value, ctx) => {
    if (!value.startsWith("task/")) return;
    const name = value.slice("task/".length);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `legacy task reference "${value}"; replace with "call: ${name}"`,
    });
  }),
  call: z.never().optional(),
  run: z.never().optional(),
});

const CallStepSchema = StepOptionsSchema.extend({
  call: z.string().min(1),
  uses: z.never().optional(),
  run: z.never().optional(),
});

const RunStepSchema = z.object({
  run: z.string().min(1),
  "continue-on-error": z.boolean().optional(),
  with: z.never().optional(),
  uses: z.never().optional(),
  call: z.never().optional(),
});

const StepSchema = z.union([UsesStepSchema, CallStepSchema, RunStepSchema]);
export type Step = z.infer<typeof StepSchema>;

/** A task is a named list of steps (was: ops + actions). */
const TaskSchema = z.array(StepSchema);
export type TasksMap = Record<string, Step[]>;

/**
 * A flow is a named, ordered set of tasks (was: go-pipeline). Fail-fast by
 * default: the first failing task aborts the flow. Tasks listed in
 * `continue_on_fail` are allowed to fail without aborting.
 */
const FlowSchema = z.object({
  description: z.string().optional(),
  steps: z.array(z.string()),
  continue_on_fail: z.array(z.string()).default([]),
});
export type Flow = z.infer<typeof FlowSchema>;

const PluginEntrySchema = z.object({
  namespace: z.string(),
  path: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

/** Plugin entries returned by loadConfig. A missing path is config for a builtin. */
export interface PluginEntry {
  namespace: string;
  path?: string;
  config?: Record<string, unknown>;
}

/** Generic project label. Engine/repo identity belongs to the plugin that uses it. */
const ProjectSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();

export interface Project {
  name: string;
}

/**
 * Per-machine overrides from bolt.local.yaml (gitignored). Optional.
 * `plugins` maps a namespace declared in bolt.yaml to config that is deep-merged
 * over that plugin's config before validation, e.g. `plugins: { ue: { engine: { path: D:/UE } } }`.
 */
/** Singleton capability → `namespace/handler`. `{}` is the same as omitting the key. */
const CapabilitySelectionSchema = z.record(z.string().min(1)).optional();

const LocalConfigSchema = z
  .object({
    vars: z.record(z.string()).optional(),
    plugins: z.record(z.record(z.unknown())).optional(),
    capabilities: CapabilitySelectionSchema,
    /** Machine policy. `run: never` refuses agent execute. `trust_plugins` lifts the confirm cap. */
    ai: z
      .object({
        run: z.enum(["never", "confirm"]).optional(),
        trust_plugins: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LocalConfig = z.infer<typeof LocalConfigSchema>;

const NotifyProviderSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("wecom"),
    webhook_url: z.string(),
    chat_id: z.string().optional(),
  }),
  z.object({
    type: z.literal("telegram"),
    bot_token: z.string(),
    chat_id: z.string(),
  }),
]);
export type NotifyProviderCfg = z.infer<typeof NotifyProviderSchema>;

const NotificationsSchema = z.object({
  on_start: z.boolean().default(true),
  on_op_complete: z.boolean().default(true),
  on_failure: z.boolean().default(true),
  on_complete: z.boolean().default(true),
  providers: z.array(NotifyProviderSchema).default([]),
});
export type NotificationsConfig = z.infer<typeof NotificationsSchema>;

// --- Top-level shared config (bolt.yaml) ---
const BoltConfigSchema = z
  .object({
    version: z
      .number({
        required_error: "config version is required (expected 1)",
        invalid_type_error: "config version must be 1",
      })
      .refine((value) => value === CONFIG_VERSION, { message: "config version must be 1" }),
    project: ProjectSchema,
    vars: z.record(z.string()).default({}),
    tasks: z.record(TaskSchema).default({}),
    flows: z.record(FlowSchema).default({}),
    plugins: z.array(PluginEntrySchema).default([]),
    capabilities: CapabilitySelectionSchema,
    workspace: WorkspaceSchema.optional(),
    timeout_hours: z.number().positive().optional(),
    notifications: NotificationsSchema.optional(),
  })
  .strict();

/** Runtime config returned by loadConfig. */
export interface BoltConfig {
  version: typeof CONFIG_VERSION;
  project: Project;
  vars: Record<string, string>;
  tasks: TasksMap;
  flows: Record<string, Flow>;
  plugins: PluginEntry[];
  /**
   * Merged singleton selection. `bolt.local.yaml` wins per key. Empty when omitted.
   * Not required on hand-built configs; `loadConfig` always sets it.
   */
  capabilities?: Record<string, string>;
  /** Which file supplied each key in `capabilities`. */
  capabilitySources?: Partial<Record<string, SelectionFile>>;
  /** Var names set in bolt.local.yaml. Omitted on hand-built configs; loadConfig sets it. */
  localVarKeys?: string[];
  /** Dotted leaves supplied by bolt.local.yaml `plugins`, e.g. `plugins.ue.engine.path`. */
  localPluginPaths?: string[];
  /** bolt.local.yaml `ai.run`. Defaults to `confirm` when the block is absent. */
  aiRun?: "never" | "confirm";
  /**
   * bolt.local.yaml `ai.trust_plugins`. Lifts the non-builtin confirm cap.
   * Does not lift `ai: false` or a plugin that shadows a built-in namespace.
   */
  trustPlugins?: string[];
  /**
   * Directory containing the bolt.yaml this config was loaded from.
   * Set by loadConfig. Not a bolt.yaml field. Relative plugin paths resolve against it.
   */
  configDir?: string;
  /** Parsed `workspace` block. Absent when bolt.yaml omits it. */
  workspace?: WorkspaceConfig;
  timeout_hours?: number;
  notifications?: NotificationsConfig;
}

// Runtime-only type (not from Zod validation)
export interface BuildContext {
  buildId: string; // e.g. "20260303_142035"
  projectName: string; // from cfg.project.name
  mode: "go" | "run"; // legacy pipeline vs run
  gitBranch?: string; // auto-detected, omitted if not a git repo
  logPath?: string; // optional, passed in from runner opts
  startTime: number; // Date.now()
}

// ============================================================================
// Runtime Functions
// ============================================================================

const LOCAL_FILENAME = "bolt.local.yaml";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Dotted paths of every leaf in a bolt.local.yaml `plugins` map. */
export function collectLocalPluginPaths(plugins: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  const walk = (value: unknown, prefix: string) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        out.push(prefix);
        return;
      }
      for (const [key, child] of entries) walk(child, `${prefix}.${key}`);
      return;
    }
    out.push(prefix);
  };
  if (!plugins) return out;
  for (const [namespace, config] of Object.entries(plugins)) {
    walk(config, `plugins.${namespace}`);
  }
  return out.sort();
}

/** Deep-merge objects. Arrays and scalars in `override` replace the base value. */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

/**
 * Apply bolt.local.yaml `plugins.<namespace>` over the parsed bolt.yaml plugin
 * entries with that namespace. Returns the merged copy and errors for
 * namespaces that bolt.yaml does not declare.
 */
export function applyLocalPluginOverrides(
  shared: unknown,
  overrides: Record<string, Record<string, unknown>> | undefined,
): { merged: unknown; errors: Array<{ path: string; message: string }> } {
  const errors: Array<{ path: string; message: string }> = [];
  if (!overrides || Object.keys(overrides).length === 0 || !isPlainObject(shared)) {
    return { merged: shared, errors };
  }
  const plugins = Array.isArray(shared.plugins) ? shared.plugins : [];
  const nextPlugins = plugins.map((entry) => {
    if (!isPlainObject(entry) || typeof entry.namespace !== "string") return entry;
    const override = overrides[entry.namespace];
    if (!override) return entry;
    return { ...entry, config: deepMerge(entry.config ?? {}, override) };
  });
  for (const namespace of Object.keys(overrides)) {
    const declared = plugins.some((e) => isPlainObject(e) && e.namespace === namespace);
    if (!declared) {
      errors.push({
        path: localLabel(["plugins", namespace]),
        message: `bolt.yaml has no plugins entry with namespace ${namespace}. Add "- namespace: ${namespace}" under plugins in bolt.yaml.`,
      });
    }
  }
  return { merged: { ...shared, plugins: nextPlugins }, errors };
}

/** "bolt.local.yaml" for the root, else "bolt.local.yaml: a.b". */
function localLabel(parts: Array<string | number>): string {
  return parts.length === 0 ? LOCAL_FILENAME : `${LOCAL_FILENAME}: ${parts.join(".")}`;
}

const MIGRATE_HINT = "Run `bolt migrate` to convert a v2.0 config.";

/**
 * Relabel a merged-config error path that points into a value bolt.local.yaml supplied,
 * e.g. `plugins.0.config.engine.path` becomes `bolt.local.yaml: plugins.ue.engine.path`.
 */
function labelOverridePath(
  errorPath: string,
  shared: unknown,
  overrides: Record<string, Record<string, unknown>> | undefined,
): string {
  if (!overrides || !isPlainObject(shared) || !Array.isArray(shared.plugins)) return errorPath;
  const parts = errorPath.split(".");
  if (parts[0] !== "plugins" || parts[2] !== "config") return errorPath;
  let namespace: string | undefined;
  const index = Number(parts[1]);
  if (Number.isInteger(index)) {
    const entry = shared.plugins[index];
    if (isPlainObject(entry) && typeof entry.namespace === "string") namespace = entry.namespace;
  } else {
    namespace = parts[1];
  }
  if (!namespace || !overrides[namespace]) return errorPath;
  const rest = parts.slice(3);
  let cur: unknown = overrides[namespace];
  for (const key of rest) {
    if (!isPlainObject(cur) || !(key in cur)) return errorPath;
    cur = cur[key];
  }
  return localLabel(["plugins", namespace, ...rest]);
}

/** Load bolt.local.yaml when it exists. A missing file means "no local overrides". */
function loadLocalConfig(localPath: string, rt: Runtime): LocalConfig {
  if (!existsSync(localPath)) return {};
  let raw: string;
  try {
    raw = readFileSync(localPath, "utf8");
  } catch (e: any) {
    throw new Error(`${LOCAL_FILENAME} missing or invalid (${e.message})`);
  }
  let parsed: unknown;
  try {
    parsed = rt.parseYaml(raw);
  } catch (e: any) {
    throw new Error(`${LOCAL_FILENAME} missing or invalid (YAML parse error: ${e.message})`);
  }
  const result = LocalConfigSchema.safeParse(parsed ?? {});
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${localLabel(i.path)}: ${i.message}`).join("; ");
    const hint = findLegacyKeys(undefined, parsed).length > 0 ? ` ${MIGRATE_HINT}` : "";
    throw new Error(`${LOCAL_FILENAME} missing or invalid (${detail})${hint}`);
  }
  return result.data;
}

export async function loadConfig(filepath: string, runtime?: Runtime): Promise<BoltConfig> {
  const rt = runtime ?? createRuntime();
  const raw = readFileSync(filepath, "utf8");
  const parsed = rt.parseYaml(raw);
  const configDir = path.dirname(path.resolve(filepath));
  const local = loadLocalConfig(path.join(configDir, LOCAL_FILENAME), rt);
  const { merged, errors: overrideErrors } = applyLocalPluginOverrides(parsed, local.plugins);
  if (overrideErrors.length > 0) {
    throw new Error(
      `${LOCAL_FILENAME} invalid (${overrideErrors.map((e) => `${e.path}: ${e.message}`).join("; ")})`,
    );
  }
  const sharedResult = BoltConfigSchema.safeParse(merged);
  if (!sharedResult.success) {
    const detail = sharedResult.error.issues
      .map(
        (issue) =>
          `${labelOverridePath(issue.path.join(".") || "<root>", parsed, local.plugins)}: ${issue.message}`,
      )
      .join("; ");
    const legacy = findLegacyKeys(parsed, undefined).length > 0 ? ` ${MIGRATE_HINT}` : "";
    throw formatZodConfigError(sharedResult.error.issues, `bolt.yaml invalid (${detail})${legacy}`);
  }
  const shared = sharedResult.data;
  const { map: capabilities, sources: capabilitySources } = mergeCapabilityMaps(
    shared.capabilities,
    local.capabilities,
  );
  const loaded = await loadValidationPlugins(shared.plugins, configDir);
  const pluginIssues = pluginMetadataErrors(
    { plugins: shared.plugins, tasks: shared.tasks },
    loaded,
    filepath,
  );
  if (pluginIssues.length > 0) {
    throw new Error(`bolt.yaml invalid (${formatConfigIssues(pluginIssues)})`);
  }

  return {
    version: CONFIG_VERSION,
    project: shared.project,
    vars: { ...shared.vars, ...(local.vars ?? {}) },
    tasks: shared.tasks,
    flows: shared.flows,
    plugins: shared.plugins,
    capabilities,
    capabilitySources,
    localVarKeys: Object.keys(local.vars ?? {}).sort(),
    localPluginPaths: collectLocalPluginPaths(local.plugins as Record<string, unknown> | undefined),
    aiRun: local.ai?.run ?? "confirm",
    trustPlugins: local.ai?.trust_plugins ?? [],
    configDir,
    ...(shared.workspace ? { workspace: workspaceFromParsed(shared.workspace) } : {}),
    timeout_hours: shared.timeout_hours,
    notifications: shared.notifications,
  };
}

export interface ConfigCheckResult {
  ok: boolean;
  errors: ConfigIssue[];
}

const CONFIG_HOOKS = ["validateConfig", "aiContext", "aiPathRoots", "initDetect"] as const;

interface DeclaredPlugin {
  namespace: string;
  config?: unknown;
  /** True when the yaml entry has a `config` key. An omitted config stays undefined. */
  hasConfig: boolean;
}

interface ParseableSchema {
  safeParse(data: unknown): {
    success: boolean;
    error?: { issues: Array<{ path: Array<string | number>; message: string }> };
  };
}

function declaredPlugins(plugins: unknown): DeclaredPlugin[] {
  if (!Array.isArray(plugins)) return [];
  const out: DeclaredPlugin[] = [];
  for (const item of plugins) {
    if (!item || typeof item !== "object") continue;
    const record = item as { namespace?: unknown; config?: unknown };
    if (typeof record.namespace !== "string" || record.namespace === "") continue;
    const declared: DeclaredPlugin = {
      namespace: record.namespace,
      hasConfig: Object.prototype.hasOwnProperty.call(record, "config"),
    };
    if (declared.hasConfig) declared.config = record.config;
    out.push(declared);
  }
  return out;
}

function metadataSchema(plugin: BoltPlugin): ParseableSchema | undefined {
  const schema = (plugin as { metadata?: unknown }).metadata ?? plugin.manifest?.metadata;
  if (
    schema &&
    typeof schema === "object" &&
    typeof (schema as { safeParse?: unknown }).safeParse === "function"
  ) {
    return schema as ParseableSchema;
  }
  return undefined;
}

function isConfigIssue(value: unknown): value is ConfigIssue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.path !== "string" || typeof record.message !== "string") return false;
  if (record.code !== undefined && typeof record.code !== "string") return false;
  if (record.hint !== undefined && typeof record.hint !== "string") return false;
  return true;
}

/** `namespace/handler`. Relative paths and any other shape are not handler refs. */
function handlerNamespace(uses: string): string | undefined {
  if (uses.startsWith("./") || uses.startsWith("../")) return undefined;
  const slash = uses.indexOf("/");
  if (slash <= 0 || slash !== uses.lastIndexOf("/")) return undefined;
  const namespace = uses.slice(0, slash);
  const handler = uses.slice(slash + 1);
  if (!namespace || !handler) return undefined;
  return namespace;
}

function hasPluginEntry(root: string): boolean {
  return existsSync(path.join(root, "index.ts")) || existsSync(path.join(root, "index.js"));
}

/** Namespaces bolt would load from `.bolt/plugins` without importing them. */
function discoveredNamespaces(configDir: string): Set<string> {
  const found = new Set<string>();
  for (const dir of [
    path.join(configDir, ".bolt", "plugins"),
    path.join(os.homedir(), ".bolt", "plugins"),
  ]) {
    if (!existsSync(dir)) continue;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const root = path.join(dir, name);
      try {
        if (!statSync(root).isDirectory() || !hasPluginEntry(root)) continue;
      } catch {
        continue;
      }
      found.add(name);
    }
  }
  return found;
}

function referencedNamespaces(tasks: unknown): string[] {
  if (!tasks || typeof tasks !== "object") return [];
  const seen: string[] = [];
  const have = new Set<string>();
  for (const steps of Object.values(tasks as Record<string, unknown>)) {
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const uses = (step as { uses?: unknown }).uses;
      if (typeof uses !== "string") continue;
      const namespace = handlerNamespace(uses);
      if (!namespace || have.has(namespace)) continue;
      have.add(namespace);
      seen.push(namespace);
    }
  }
  return seen;
}

function hookIssues(plugin: BoltPlugin, input: ValidateConfigInput): ConfigIssue[] {
  if (typeof plugin.validateConfig !== "function") return [];
  let returned: unknown;
  try {
    returned = plugin.validateConfig(input);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return [
      {
        path: `plugins.${plugin.namespace}`,
        message: `validateConfig threw: ${message}`,
        code: "CONFIG_PLUGIN_HOOK",
      },
    ];
  }
  if (!Array.isArray(returned) || !returned.every(isConfigIssue)) {
    return [
      {
        path: `plugins.${plugin.namespace}`,
        message: "validateConfig must return ConfigIssue[]",
        code: "CONFIG_PLUGIN_HOOK",
      },
    ];
  }
  return returned;
}

function pluginHasConfigHook(plugin: BoltPlugin): boolean {
  const record = plugin as unknown as Record<string, unknown>;
  return CONFIG_HOOKS.some((name) => typeof record[name] === "function");
}

/** `bolt check` warns. The hook still runs. */
function pluginHookApiWarnings(plugins: readonly BoltPlugin[]): string[] {
  const warnings: string[] = [];
  for (const plugin of plugins) {
    if (pluginHasConfigHook(plugin) && plugin.apiVersion !== 2) {
      warnings.push(`Set apiVersion = 2 on plugin ${plugin.namespace}`);
    }
  }
  return warnings;
}

/**
 * Builtins, plus `plugins[]` entries that declare `path` and actually load.
 * A missing or broken file is skipped. The yaml entry still counts as declared,
 * so core does not report that namespace as unregistered.
 */
async function loadValidationPlugins(
  entries: readonly { namespace: string; path?: string; config?: unknown }[],
  configDir: string,
): Promise<BoltPlugin[]> {
  const byNs = new Map<string, BoltPlugin>();
  for (const plugin of builtinPlugins) byNs.set(plugin.namespace, plugin);
  for (const entry of entries) {
    if (!entry.path) continue;
    const loaded = await loadPathPlugin(entry, configDir);
    if (loaded) byNs.set(entry.namespace, loaded);
  }
  return [...byNs.values()];
}

async function loadPathPlugin(
  entry: { namespace: string; path?: string; config?: unknown },
  configDir: string,
): Promise<BoltPlugin | undefined> {
  if (!entry.path) return undefined;
  const reg = new PluginRegistry();
  const resolved = path.resolve(configDir, entry.path);
  try {
    if (entry.config !== undefined) {
      await reg.loadAndInstantiate(
        entry.namespace,
        resolved,
        entry.config,
        undefined,
        configDir,
        "path",
      );
    } else {
      await reg.loadFromPath(entry.namespace, resolved, configDir, "path");
    }
  } catch {
    return undefined;
  }
  return reg.get(entry.namespace);
}

function formatConfigIssues(issues: ConfigIssue[]): string {
  return issues
    .map((issue) => {
      const hint = issue.hint ? ` (${issue.hint})` : "";
      const code = issue.code ? ` [${issue.code}]` : "";
      return `${issue.path}: ${issue.message}${hint}${code}`;
    })
    .join("; ");
}

/**
 * Metadata Zod failures, `validateConfig` results, and the unregistered-namespace check.
 * Core schema errors stay in BoltConfigSchema. Domain rules stay in the plugin hook.
 */
export function pluginMetadataErrors(
  parsed: unknown,
  plugins: readonly BoltPlugin[] = builtinPlugins,
  configPath = "",
): ConfigIssue[] {
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as { plugins?: unknown; tasks?: unknown };
  const entries = declaredPlugins(record.plugins);
  const tasks =
    record.tasks && typeof record.tasks === "object"
      ? (record.tasks as Record<string, unknown>)
      : {};
  const errors: ConfigIssue[] = [];
  const registered = new Set<string>();

  for (const plugin of plugins) {
    registered.add(plugin.namespace);
    const entry = entries.find((item) => item.namespace === plugin.namespace);
    const present = entry !== undefined;
    const config = present && entry.hasConfig ? entry.config : undefined;
    if (present) {
      const schema = metadataSchema(plugin);
      if (schema) {
        const result = schema.safeParse(config === undefined ? {} : config);
        if (!result.success) {
          for (const issue of result.error?.issues ?? []) {
            const rest = issue.path.map(String).filter((part) => part !== "");
            errors.push({
              path: ["plugins", plugin.namespace, "config", ...rest].join("."),
              message: issue.message,
              code: "CONFIG_PLUGIN_INVALID",
            });
          }
        }
      }
    }
    errors.push(
      ...hookIssues(plugin, {
        namespace: plugin.namespace,
        config,
        present,
        tasks,
        configPath,
      }),
    );
  }

  const declared = new Set(entries.map((entry) => entry.namespace));
  const discovered = configPath
    ? discoveredNamespaces(path.dirname(path.resolve(configPath)))
    : new Set<string>();
  for (const namespace of referencedNamespaces(tasks)) {
    if (registered.has(namespace) || declared.has(namespace) || discovered.has(namespace)) continue;
    errors.push({
      path: `plugins.${namespace}`,
      message: `tasks use "${namespace}/…" but plugin "${namespace}" is not registered`,
      code: "CONFIG_PLUGIN_REQUIRED",
      hint: `Add a plugins entry for "${namespace}" or install the plugin.`,
    });
  }
  return errors;
}

export interface ConfigCheckResultWithLegacy extends ConfigCheckResult {
  /** v2.0 keys found in bolt.yaml or bolt.local.yaml. Empty for a version 1 config. */
  legacy: ReturnType<typeof findLegacyKeys>;
  /** Fan-out keys in `capabilities:` (ignored, not an error). */
  warnings: string[];
}

export async function checkConfig(
  filepath: string,
  runtime?: Runtime,
): Promise<ConfigCheckResultWithLegacy> {
  const rt = runtime ?? createRuntime();
  const errors: ConfigIssue[] = [];

  let raw: string;
  try {
    raw = readFileSync(filepath, "utf8");
  } catch (e: any) {
    const denied = e?.code === "EACCES" || e?.code === "EPERM";
    const message = denied
      ? `Permission denied reading ${filepath}. Check the file permissions (it must be readable by the current user).`
      : e.message;
    return {
      ok: false,
      errors: [
        {
          path: "<file>",
          message,
          ...(denied ? { code: "CONFIG_UNREADABLE" } : {}),
        },
      ],
      legacy: [],
      warnings: [],
    };
  }
  let parsed: unknown;
  try {
    parsed = rt.parseYaml(raw);
  } catch (e: any) {
    return {
      ok: false,
      errors: [{ path: "<yaml>", message: `YAML parse error: ${e.message}` }],
      legacy: [],
      warnings: [],
    };
  }

  // Optional per-machine file. Missing is fine; invalid content is an error.
  const configDir = path.dirname(path.resolve(filepath));
  const localPath = path.join(configDir, LOCAL_FILENAME);
  let localParsed: unknown = undefined;
  let localOverrides: Record<string, Record<string, unknown>> | undefined;
  let localCapabilities: Record<string, string> | undefined;
  let trustPlugins: string[] = [];
  if (existsSync(localPath)) {
    try {
      localParsed = rt.parseYaml(readFileSync(localPath, "utf8")) ?? {};
      const localResult = LocalConfigSchema.safeParse(localParsed);
      if (!localResult.success) {
        errors.push(
          ...localResult.error.issues.map((issue) => ({
            path: localLabel(issue.path),
            message: issue.message,
          })),
        );
      } else {
        localOverrides = localResult.data.plugins;
        localCapabilities = localResult.data.capabilities;
        trustPlugins = localResult.data.ai?.trust_plugins ?? [];
      }
    } catch (e: any) {
      errors.push({ path: LOCAL_FILENAME, message: `YAML parse error: ${e.message}` });
    }
  }

  const { merged, errors: overrideErrors } = applyLocalPluginOverrides(parsed, localOverrides);
  errors.push(...overrideErrors);
  const result = BoltConfigSchema.safeParse(merged);
  if (!result.success) {
    errors.push(
      ...result.error.issues.map((issue) => {
        const code = codeForZodIssue(issue);
        return {
          path: labelOverridePath(issue.path.join(".") || "<root>", parsed, localOverrides),
          message: issue.message,
          ...(code ? { code } : {}),
        };
      }),
    );
  }
  let hookWarnings: string[] = [];
  if (result.success) {
    const loaded = await loadValidationPlugins(result.data.plugins, configDir);
    hookWarnings = pluginHookApiWarnings(loaded);
    errors.push(
      ...pluginMetadataErrors(
        { plugins: result.data.plugins, tasks: result.data.tasks },
        loaded,
        filepath,
      ).map((issue) => ({
        path: labelOverridePath(issue.path, parsed, localOverrides),
        message: issue.message,
        ...(issue.code ? { code: issue.code } : {}),
        ...(issue.hint ? { hint: issue.hint } : {}),
      })),
    );
  }
  for (const ref of unknownProjectRefs(parsed)) {
    errors.push({
      path: ref.path,
      message: `unknown reference \${{ project.${ref.ref} }}: only project.name exists. Use a var instead (bolt migrate rewrites v2.0 project references).`,
    });
  }

  let warnings: string[] = hookWarnings;
  if (errors.length === 0 && result.success) {
    const { map, sources } = mergeCapabilityMaps(result.data.capabilities, localCapabilities);
    const report = assessCapabilities(
      {
        capabilities: map,
        capabilitySources: sources,
        plugins: result.data.plugins,
        tasks: result.data.tasks,
      },
      configDir,
      { requested: capabilityUsesInTasks(result.data.tasks) },
    );
    warnings = [...hookWarnings, ...report.warnings];
    const known = new Set([
      "ue",
      "fs",
      "json",
      "git",
      "svn",
      ...result.data.plugins.map((entry) => entry.namespace),
    ]);
    for (const namespace of trustPlugins) {
      if (!known.has(namespace)) {
        warnings.push(
          `ai.trust_plugins names "${namespace}", which is not a built-in or a plugins entry in bolt.yaml.`,
        );
      }
    }
    for (const issue of report.errors) {
      errors.push({
        path: issue.path,
        message: issue.message,
        ...(issue.code ? { code: issue.code } : {}),
      });
    }
  }

  const legacy = findLegacyKeys(parsed, localParsed);
  return { ok: errors.length === 0, errors, legacy, warnings };
}
