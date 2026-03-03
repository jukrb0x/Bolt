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

const RepoConfigSchema = z.object({
  path: z.string(),
  vcs: z.enum(["git", "svn"]).optional().default("git"),
  url: z.string().optional(),
  branch: z.string().optional(),
});

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
  on_start: z.boolean().default(true),
  on_op_complete: z.boolean().default(true),
  on_failure: z.boolean().default(true),
  on_complete: z.boolean().default(true),
  providers: z.array(NotifyProviderSchema).default([]),
});

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
  BuildContext,
  RepoConfig,
  VcsType,
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
