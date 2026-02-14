import { defineCommand } from "citty"
import { findConfig } from "../discover"
import { loadConfig } from "../config"

export default defineCommand({
  meta: { description: "List available actions defined in bolt.yaml" },
  async run() {
    const configPath = await findConfig(process.cwd())
    if (!configPath) { console.error("bolt.yaml not found"); process.exit(1) }
    const cfg = await loadConfig(configPath)
    console.log("Actions:")
    for (const name of Object.keys(cfg.actions)) {
      console.log(`  ${name}`)
    }
  },
})
