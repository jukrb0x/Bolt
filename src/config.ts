import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { createRuntime, type Runtime } from "./runtime";
import { svnMetadataErrors } from "./plugins/svn";
import { tasksReferenceUe, ueMetadataErrors } from "./plugins/ue";

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

/** Per-machine overrides from bolt.local.yaml (gitignored). Optional. */
const LocalConfigSchema = z
  .object({
    vars: z.record(z.string()).optional(),
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
   * Directory containing the bolt.yaml this config was loaded from.
   * Set by loadConfig. Not a bolt.yaml field. Relative plugin paths resolve against it.
   */
  configDir?: string;
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
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`${LOCAL_FILENAME} missing or invalid (${detail})`);
  }
  return result.data;
}

export async function loadConfig(filepath: string, runtime?: Runtime): Promise<BoltConfig> {
  const rt = runtime ?? createRuntime();
  const raw = readFileSync(filepath, "utf8");
  const parsed = rt.parseYaml(raw);
  const sharedResult = BoltConfigSchema.safeParse(parsed);
  if (!sharedResult.success) {
    const detail = sharedResult.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`bolt.yaml invalid (${detail})`);
  }
  const shared = sharedResult.data;
  const configDir = path.dirname(path.resolve(filepath));
  const local = loadLocalConfig(path.join(configDir, LOCAL_FILENAME), rt);

  return {
    version: CONFIG_VERSION,
    project: shared.project,
    vars: { ...shared.vars, ...(local.vars ?? {}) },
    tasks: shared.tasks,
    flows: shared.flows,
    plugins: shared.plugins,
    configDir,
    timeout_hours: shared.timeout_hours,
    notifications: shared.notifications,
  };
}

export interface ConfigCheckResult {
  ok: boolean;
  errors: Array<{ path: string; message: string }>;
}

/** Plugin metadata failures. Core schema errors stay in BoltConfigSchema. */
export function pluginMetadataErrors(parsed: unknown): Array<{ path: string; message: string }> {
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as { plugins?: unknown; tasks?: unknown };
  const errors = [...ueMetadataErrors(record.plugins), ...svnMetadataErrors(record.plugins)];
  const hasUe = Array.isArray(record.plugins)
    ? record.plugins.some(
        (item) =>
          !!item &&
          typeof item === "object" &&
          (item as { namespace?: unknown }).namespace === "ue",
      )
    : false;
  if (tasksReferenceUe(record.tasks) && !hasUe) {
    errors.push({
      path: "plugins.ue",
      message:
        "ue metadata is required when a task uses a ue/ handler (plugins: namespace ue, with engine, project, uproject, targets)",
    });
  }
  return errors;
}

export async function checkConfig(filepath: string, runtime?: Runtime): Promise<ConfigCheckResult> {
  const rt = runtime ?? createRuntime();
  const errors: Array<{ path: string; message: string }> = [];

  let raw: string;
  try {
    raw = readFileSync(filepath, "utf8");
  } catch (e: any) {
    return { ok: false, errors: [{ path: "<file>", message: e.message }] };
  }
  let parsed: unknown;
  try {
    parsed = rt.parseYaml(raw);
  } catch (e: any) {
    return { ok: false, errors: [{ path: "<yaml>", message: `YAML parse error: ${e.message}` }] };
  }

  const result = BoltConfigSchema.safeParse(parsed);
  if (!result.success) {
    errors.push(
      ...result.error.issues.map((issue) => ({
        path: issue.path.join(".") || "<root>",
        message: issue.message,
      })),
    );
  }
  errors.push(...pluginMetadataErrors(parsed));

  // Optional per-machine file. Missing is fine; invalid content is an error.
  const configDir = path.dirname(path.resolve(filepath));
  const localPath = path.join(configDir, LOCAL_FILENAME);
  if (existsSync(localPath)) {
    let localRaw: string;
    try {
      localRaw = readFileSync(localPath, "utf8");
    } catch (e: any) {
      errors.push({ path: LOCAL_FILENAME, message: e.message });
      return { ok: false, errors };
    }
    try {
      const localParsed = rt.parseYaml(localRaw);
      const localResult = LocalConfigSchema.safeParse(localParsed ?? {});
      if (!localResult.success) {
        errors.push(
          ...localResult.error.issues.map((issue) => ({
            path: `${LOCAL_FILENAME}.${issue.path.join(".") || "<root>"}`,
            message: issue.message,
          })),
        );
      }
    } catch (e: any) {
      errors.push({ path: LOCAL_FILENAME, message: `YAML parse error: ${e.message}` });
    }
  }

  return { ok: errors.length === 0, errors };
}
