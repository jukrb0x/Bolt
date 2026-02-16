import { defineCommand } from "citty"
import { findConfig } from "../discover"
import { loadConfig } from "../config"
import pc from "picocolors"

export default defineCommand({
  meta: { description: "List available ops and actions defined in bolt.yaml" },
  async run() {
    const configPath = await findConfig(process.cwd())
    if (!configPath) { console.error("bolt.yaml not found"); process.exit(1) }
    const cfg = await loadConfig(configPath)

    const ops     = Object.entries(cfg.ops)
    const actions = Object.keys(cfg.actions)

    console.log(pc.dim(`bolt.yaml: ${configPath}`))

    console.log("")
    console.log(`${pc.underline(pc.bold("OPS"))} ${pc.dim("(bolt go)")}`)
    console.log("")
    if (ops.length === 0) {
      console.log(pc.dim("  (none)"))
    } else {
      for (const [name, op] of ops) {
        const variants = Object.keys(op).filter(v => v !== "default")
        console.log(`  ${pc.cyan(name)}`)
        if (variants.length > 0) {
          for (const v of variants) {
            console.log(`    ${pc.dim(`${name}:${v}`)}`)
          }
        }
      }
    }

    console.log("")
    console.log(`${pc.underline(pc.bold("ACTIONS"))} ${pc.dim("(bolt run)")}`)
    console.log("")
    if (actions.length === 0) {
      console.log(pc.dim("  (none)"))
    } else {
      for (const name of actions) {
        console.log(`  ${pc.cyan(name)}`)
      }
    }

    console.log("")
  },
})
