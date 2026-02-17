import { z } from "zod"
import { YAML } from "bun"
import { readFileSync } from "fs"

const StepSchema = z.object({
  uses: z.string().optional(),
  run:  z.string().optional(),
  with: z.record(z.string()).optional(),
  "continue-on-error": z.boolean().optional(),
})

const OpVariantSchema = z.array(StepSchema)
const OpSchema        = z.record(z.string(), OpVariantSchema)

const GoPipelineSchema = z.object({
  order:      z.array(z.string()).default([]),
  fail_stops: z.array(z.string()).default([]),
})

const PluginEntrySchema = z.object({
  namespace: z.string(),
  path:      z.string(),
})

const ActionSchema = z.object({
  depends: z.array(z.string()).optional(),
  steps:   z.array(StepSchema),
})

const TargetSchema = z.object({
  type:       z.enum(["editor", "program"]),
  name:       z.string().optional(),
  build_type: z.enum(["development", "debug", "shipping", "test"]).default("development"),
})

const ProjectSchema = z.object({
  name:         z.string(),
  ue_path:      z.string(),
  project_path: z.string(),
  project_name: z.string(),
  svn_root:     z.string().optional(),
  git_branch:   z.string().optional(),
})

const BoltConfigSchema = z.object({
  project:  ProjectSchema,
  targets:  z.record(TargetSchema).default({}),
  actions:  z.record(ActionSchema).default({}),
  ops:          z.record(z.string(), OpSchema).default({}),
  "go-pipeline": GoPipelineSchema.default({ order: [], fail_stops: [] }),
  plugins:       z.array(PluginEntrySchema).default([]),
  timeout_hours: z.number().positive().optional(),
})

export type BoltConfig  = z.infer<typeof BoltConfigSchema>
export type Step        = z.infer<typeof StepSchema>
export type Target      = z.infer<typeof TargetSchema>
export type GoPipeline  = z.infer<typeof GoPipelineSchema>
export type OpVariant   = z.infer<typeof OpVariantSchema>
export type OpsMap      = Record<string, Record<string, OpVariant>>
export type PluginEntry = z.infer<typeof PluginEntrySchema>

export async function loadConfig(filepath: string): Promise<BoltConfig> {
  const raw = readFileSync(filepath, "utf8")
  const parsed = YAML.parse(raw)
  return BoltConfigSchema.parse(parsed)
}
