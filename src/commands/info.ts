import { defineCommand } from "citty"
import { findConfig } from "../discover"
import { loadConfig } from "../config"

export default defineCommand({
  meta: { description: "Print project config summary from bolt.yaml" },
  async run() {
    const configPath = await findConfig(process.cwd())
    if (!configPath) { console.error("bolt.yaml not found"); process.exit(1) }
    const cfg = await loadConfig(configPath)
    console.log(`Project:  ${cfg.project.name}`)
    console.log(`UE path:  ${cfg.project.ue_path}`)
    console.log(`Project:  ${cfg.project.project_path}`)
    console.log(`Targets:  ${Object.keys(cfg.targets).join(", ")}`)
    console.log(`Actions:  ${Object.keys(cfg.actions).join(", ")}`)
  },
})
