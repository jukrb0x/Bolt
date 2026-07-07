import { z } from "zod";
import { readFileSync } from "fs";
import path from "path";
import { createRuntime, type Runtime } from "./runtime";

// ============================================================================
// Schemas (single source of truth) + Derived Types
// ============================================================================

// --- Enums ---
const TargetKindSchema = z.enum(["editor", "program", "game", "client", "server"]);
const BuildConfigSchema = z.enum(["development", "debug", "shipping", "test"]);
const VcsTypeSchema = z.enum(["git", "svn"]);

export type TargetKind = z.infer<typeof TargetKindSchema>;
export type BuildConfig = z.infer<typeof BuildConfigSchema>;
export type VcsType = z.infer<typeof VcsTypeSchema>;

// --- Core Schemas ---
const StepSchema = z.object({
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string()).optional(),
  "continue-on-error": z.boolean().optional(),
});
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
  path: z.string(),
  config: z.record(z.unknown()).optional(),
});
export type PluginEntry = z.infer<typeof PluginEntrySchema>;

const TargetSchema = z.object({
  kind: TargetKindSchema,
  name: z.string().optional(),
  config: BuildConfigSchema.default("development"),
});
export type Target = z.infer<typeof TargetSchema>;

// --- Project: shared identity (bolt.yaml) vs local paths (bolt.local.yaml) ---

/** Repo identity as declared in the shared, committed bolt.yaml (NO machine path). */
const RepoIdentitySchema = z.object({
  vcs: VcsTypeSchema.default("git"),
  url: z.string().optional(),
  branch: z.string().optional(),
});
export type RepoIdentity = z.infer<typeof RepoIdentitySchema>;

/** Shared project block in bolt.yaml. Extra string/bool fields pass through for interpolation. */
const ProjectSchema = z
  .object({
    name: z.string(),
    engine: RepoIdentitySchema,
    project: RepoIdentitySchema,
  })
  .catchall(z.union([z.string(), z.boolean()]));

/** Parsed shared project shape (manual — Zod catchall + objects don't infer cleanly). */
interface SharedProject {
  name: string;
  engine: RepoIdentity;
  project: RepoIdentity;
  [key: string]: string | boolean | RepoIdentity;
}

/** Per-machine config from bolt.local.yaml (gitignored). */
const LocalConfigSchema = z.object({
  engine_path: z.string(),
  project_path: z.string(),
  uproject: z.string(),
  use_tortoise: z.boolean().optional(),
  vars: z.record(z.string()).optional(),
});
export type LocalConfig = z.infer<typeof LocalConfigSchema>;

// --- Merged runtime types (what runner.ts + plugins read) ---

/** Merged runtime repo shape: shared identity + local path. */
export interface RepoConfig {
  path: string;
  vcs: VcsType;
  url?: string;
  branch?: string;
}

/** Merged runtime project shape. Reconstructed by loadConfig so downstream is unaffected. */
export interface Project {
  name: string;
  engine_repo: RepoConfig;
  project_repo: RepoConfig;
  uproject: string;
  use_tortoise?: boolean;
  /** Extra string fields from bolt.yaml are preserved, available as ${{ project.<key> }}. */
  [key: string]: string | boolean | undefined | RepoConfig;
}

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
const BoltConfigSchema = z.object({
  project: ProjectSchema,
  vars: z.record(z.string()).default({}),
  targets: z.record(TargetSchema).default({}),
  tasks: z.record(TaskSchema).default({}),
  flows: z.record(FlowSchema).default({}),
  plugins: z.array(PluginEntrySchema).default([]),
  timeout_hours: z.number().positive().optional(),
  notifications: NotificationsSchema.optional(),
});

/** Merged runtime config returned by loadConfig (project is the reconstructed shape). */
export interface BoltConfig {
  project: Project;
  vars: Record<string, string>;
  targets: Record<string, Target>;
  tasks: TasksMap;
  flows: Record<string, Flow>;
  plugins: PluginEntry[];
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
const LOCAL_HINT = "copy bolt.local.example.yaml or run bolt init";

/** Load + validate bolt.local.yaml next to bolt.yaml. Throws with an actionable message. */
function loadLocalConfig(localPath: string, rt: Runtime): LocalConfig {
  let raw: string;
  try {
    raw = readFileSync(localPath, "utf8");
  } catch {
    throw new Error(`${LOCAL_FILENAME} missing or invalid (not found at ${localPath}) — ${LOCAL_HINT}`);
  }
  let parsed: unknown;
  try {
    parsed = rt.parseYaml(raw);
  } catch (e: any) {
    throw new Error(`${LOCAL_FILENAME} missing or invalid (YAML parse error: ${e.message}) — ${LOCAL_HINT}`);
  }
  const result = LocalConfigSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`${LOCAL_FILENAME} missing or invalid (${detail}) — ${LOCAL_HINT}`);
  }
  return result.data;
}

export async function loadConfig(filepath: string, runtime?: Runtime): Promise<BoltConfig> {
  const rt = runtime ?? createRuntime();
  const raw = readFileSync(filepath, "utf8");
  const parsed = rt.parseYaml(raw);
  const shared = BoltConfigSchema.parse(parsed);

  // Resolve relative paths against the directory containing bolt.yaml
  const configDir = path.dirname(path.resolve(filepath));
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(configDir, p));

  const local = loadLocalConfig(path.join(configDir, LOCAL_FILENAME), rt);

  // Reconstruct the runtime project shape handlers expect: identity + local paths.
  const sharedProject = shared.project as unknown as SharedProject;
  const { name, engine, project: projectIdentity, ...rest } = sharedProject;
  const extras = rest as Record<string, string | boolean>;

  const project: Project = {
    ...extras,
    name,
    engine_repo: { path: resolve(local.engine_path), ...engine },
    project_repo: { path: resolve(local.project_path), ...projectIdentity },
    uproject: resolve(local.uproject),
    use_tortoise: local.use_tortoise,
  };

  // local.vars shallow-override bolt.yaml vars
  const vars = { ...shared.vars, ...(local.vars ?? {}) };

  return {
    project,
    vars,
    targets: shared.targets,
    tasks: shared.tasks,
    flows: shared.flows,
    plugins: shared.plugins,
    timeout_hours: shared.timeout_hours,
    notifications: shared.notifications,
  };
}

export interface ConfigCheckResult {
  ok: boolean;
  errors: Array<{ path: string; message: string }>;
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

  // Validate the per-machine local file (surface problems as errors, never throw).
  const configDir = path.dirname(path.resolve(filepath));
  const localPath = path.join(configDir, LOCAL_FILENAME);
  let localRaw: string | undefined;
  try {
    localRaw = readFileSync(localPath, "utf8");
  } catch {
    errors.push({ path: LOCAL_FILENAME, message: `missing — ${LOCAL_HINT}` });
  }
  if (localRaw !== undefined) {
    try {
      const localParsed = rt.parseYaml(localRaw);
      const localResult = LocalConfigSchema.safeParse(localParsed);
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
