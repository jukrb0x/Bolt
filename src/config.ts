import { z } from "zod"
import yaml from "js-yaml"
import { readFileSync } from "fs"

const StepSchema = z.object({
  uses: z.string().optional(),
  run:  z.string().optional(),
  with: z.record(z.string()).optional(),
  "continue-on-error": z.boolean().optional(),
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
})

const BoltConfigSchema = z.object({
  project: ProjectSchema,
  targets: z.record(TargetSchema).default({}),
  actions: z.record(ActionSchema).default({}),
})

export type BoltConfig = z.infer<typeof BoltConfigSchema>
export type Step       = z.infer<typeof StepSchema>
export type Target     = z.infer<typeof TargetSchema>

export async function loadConfig(filepath: string): Promise<BoltConfig> {
  const raw = readFileSync(filepath, "utf8")
  const parsed = yaml.load(raw)
  return BoltConfigSchema.parse(parsed)
}
