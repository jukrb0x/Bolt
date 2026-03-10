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

const OpSchema = z.record(z.string(), z.array(StepSchema));
export type OpDef = Record<string, Step[]>;
export type OpsMap = Record<string, OpDef>;

/** Get steps from a variant value. */
export function getOpVariant(op: OpDef, variant: string): Step[] | undefined {
  return op[variant];
}

/** Get variant names from an op definition. */
export function getOpVariants(op: OpDef): string[] {
  return Object.keys(op);
}

const GoPipelineSchema = z.object({
  order: z.array(z.string()).default([]),
  fail_stops: z.array(z.string()).default([]),
});
export type GoPipeline = z.infer<typeof GoPipelineSchema>;

const PluginEntrySchema = z.object({
  namespace: z.string(),
  path: z.string(),
});
export type PluginEntry = z.infer<typeof PluginEntrySchema>;

const ActionSchema = z.object({
  description: z.string().optional(),
  depends: z.array(z.string()).optional(),
  steps: z.array(StepSchema),
});
export type Action = z.infer<typeof ActionSchema>;

const TargetSchema = z.object({
  kind: TargetKindSchema,
  name: z.string().optional(),
  config: BuildConfigSchema.default("development"),
});
export type Target = z.infer<typeof TargetSchema>;

const RepoConfigSchema = z.object({
  path: z.string(),
  vcs: VcsTypeSchema.optional().default("git"),
  url: z.string().optional(),
  branch: z.string().optional(),
});
export type RepoConfig = z.infer<typeof RepoConfigSchema>;

const ProjectSchema = z
  .object({
    name: z.string(),
    engine_repo: RepoConfigSchema,
    project_repo: RepoConfigSchema,
    uproject: z.string(),  // path to .uproject file
    use_tortoise: z.boolean().optional(),
  })
  .catchall(z.union([z.string(), z.boolean(), RepoConfigSchema]))
  .transform((v) => {
    // Spread extra fields through to the output
    const known = new Set(["name", "engine_repo", "project_repo", "uproject", "use_tortoise"]);
    const extras = Object.fromEntries(Object.entries(v).filter(([k]) => !known.has(k)));
    return {
      name: v.name,
      engine_repo: v.engine_repo,
      project_repo: v.project_repo,
      uproject: v.uproject,
      use_tortoise: v.use_tortoise,
      ...extras,
    };
  });

// Manual type with index signature (Zod can't infer this from catchall+transform)
export interface Project {
  name: string;
  engine_repo: RepoConfig;
  project_repo: RepoConfig;
  uproject: string;
  use_tortoise?: boolean;
  /** Any extra string fields defined in bolt.yaml are preserved and available as ${{ project.<key> }} in interpolation. */
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

const BoltConfigSchema = z.object({
  project: ProjectSchema,
  vars: z.record(z.string()).default({}),
  targets: z.record(TargetSchema).default({}),
  actions: z.record(ActionSchema).default({}),
  ops: z.record(z.string(), OpSchema).default({}),
  "go-pipeline": GoPipelineSchema.default({ order: [], fail_stops: [] }),
  plugins: z.array(PluginEntrySchema).default([]),
  timeout_hours: z.number().positive().optional(),
  notifications: NotificationsSchema.optional(),
});

// Manual BoltConfig to use Project interface with index signature
export interface BoltConfig {
  project: Project;
  vars: Record<string, string>;
  targets: Record<string, Target>;
  actions: Record<string, Action>;
  ops: OpsMap;
  "go-pipeline": GoPipeline;
  plugins: PluginEntry[];
  timeout_hours?: number;
  notifications?: NotificationsConfig;
}

// Runtime-only type (not from Zod validation)
export interface BuildContext {
  buildId: string; // e.g. "20260303_142035"
  projectName: string; // from cfg.project.name
  mode: "go" | "run"; // bolt go (pipeline) vs bolt run (action)
  gitBranch?: string; // auto-detected, omitted if not a git repo
  logPath?: string; // optional, passed in from runner opts
  startTime: number; // Date.now()
}

// ============================================================================
// Runtime Functions
// ============================================================================

export async function loadConfig(filepath: string, runtime?: Runtime): Promise<BoltConfig> {
  const rt = runtime ?? createRuntime();
  const raw = readFileSync(filepath, "utf8");
  const parsed = rt.parseYaml(raw);
  const cfg = BoltConfigSchema.parse(parsed);

  // Resolve relative paths against the directory containing bolt.yaml
  const configDir = path.dirname(path.resolve(filepath));
  const resolve = (p: string) => path.isAbsolute(p) ? p : path.resolve(configDir, p);

  cfg.project.engine_repo.path = resolve(cfg.project.engine_repo.path);
  cfg.project.project_repo.path = resolve(cfg.project.project_repo.path);
  cfg.project.uproject = resolve(cfg.project.uproject);

  return cfg;
}

export interface ConfigCheckResult {
  ok: boolean;
  errors: Array<{ path: string; message: string }>;
}

export async function checkConfig(filepath: string, runtime?: Runtime): Promise<ConfigCheckResult> {
  const rt = runtime ?? createRuntime();
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
  if (result.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "<root>",
      message: issue.message,
    })),
  };
}
