import { z } from "zod";
import { YAML } from "bun";
import { readFileSync } from "fs";
import type { BoltConfig } from "./config-types";

const StepSchema = z.object({
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string()).optional(),
  "continue-on-error": z.boolean().optional(),
});

const OpVariantSchema = z.array(StepSchema);
const OpSchema = z.record(z.string(), OpVariantSchema);

const GoPipelineSchema = z.object({
  order: z.array(z.string()).default([]),
  fail_stops: z.array(z.string()).default([]),
});

const PluginEntrySchema = z.object({
  namespace: z.string(),
  path: z.string(),
});

const ActionSchema = z.object({
  depends: z.array(z.string()).optional(),
  steps: z.array(StepSchema),
});

const TargetSchema = z.object({
  kind: z.enum(["editor", "program", "game", "client", "server"]),
  name: z.string().optional(),
  config: z.enum(["development", "debug", "shipping", "test"]).default("development"),
});

const ProjectSchema = z
  .object({
    name: z.string(),
    // new canonical names
    engine_root: z.string().optional(),
    project_root: z.string().optional(),
    // legacy aliases — accepted and discarded after transform
    ue_path: z.string().optional(),
    project_path: z.string().optional(),
    svn_root: z.string().optional(),
    project_name: z.string(),
    engine_vcs: z.enum(["git", "svn"]).optional().default("git"),
    project_vcs: z.enum(["git", "svn"]).optional().default("svn"),
    git_branch: z.string().optional(),
    use_tortoise: z.boolean().optional(),
  })
  .catchall(z.string())
  .transform((v) => {
    const engine_root = v.engine_root ?? v.ue_path;
    const project_root = v.project_root ?? v.project_path ?? v.svn_root;
    if (!engine_root) throw new Error("project.engine_root (or ue_path) is required");
    if (!project_root) throw new Error("project.project_root (or project_path / svn_root) is required");
    // Spread extra string fields (anything not in the known set) through to the output
    const known = new Set(["name", "engine_root", "project_root", "ue_path", "project_path", "svn_root", "project_name", "engine_vcs", "project_vcs", "git_branch", "use_tortoise"]);
    const extras = Object.fromEntries(Object.entries(v).filter(([k]) => !known.has(k)));
    return {
      name: v.name,
      engine_root,
      project_root,
      project_name: v.project_name,
      engine_vcs: v.engine_vcs,
      project_vcs: v.project_vcs,
      git_branch: v.git_branch,
      use_tortoise: v.use_tortoise,
      ...extras,
    };
  });

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

const NotificationsSchema = z.object({
  on_start: z.boolean().default(false),
  on_complete: z.boolean().default(false),
  on_failure: z.boolean().default(false),
  providers: z.array(NotifyProviderSchema).default([]),
});

const BoltConfigSchema = z.object({
  project: ProjectSchema,
  targets: z.record(TargetSchema).default({}),
  actions: z.record(ActionSchema).default({}),
  ops: z.record(z.string(), OpSchema).default({}),
  "go-pipeline": GoPipelineSchema.default({ order: [], fail_stops: [] }),
  plugins: z.array(PluginEntrySchema).default([]),
  timeout_hours: z.number().positive().optional(),
  notifications: NotificationsSchema.optional(),
});

export type {
  BoltConfig,
  Target,
  TargetKind,
  Step,
  GoPipeline,
  OpVariant,
  OpsMap,
  PluginEntry,
  NotificationsConfig,
  NotifyProviderCfg,
} from "./config-types";

export async function loadConfig(filepath: string) {
  const raw = readFileSync(filepath, "utf8");
  const parsed = YAML.parse(raw);
  return BoltConfigSchema.parse(parsed);
}

export interface ConfigCheckResult {
  ok: boolean;
  errors: Array<{ path: string; message: string }>;
}

export async function checkConfig(filepath: string): Promise<ConfigCheckResult> {
  let raw: string;
  try {
    raw = readFileSync(filepath, "utf8");
  } catch (e: any) {
    return { ok: false, errors: [{ path: "<file>", message: e.message }] };
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
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
