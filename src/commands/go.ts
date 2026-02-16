import { defineCommand } from "citty"
import { findConfig }    from "../discover"
import { loadConfig }    from "../config"
import { Runner }        from "../runner"
import { Logger }        from "../logger"
import { parseGoArgs, resolveOps } from "../go"
import path from "path"
import { mkdirSync } from "fs"
import pkg from "../../package.json"

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

export default defineCommand({
  meta: { description: "Run ad-hoc ops in pipeline order (e.g. --update=svn --build --start)" },
  args: {
    "dry-run": { type: "boolean", default: false, description: "Print steps without executing" },
  },
  async run({ args }) {
    const dryRun = args["dry-run"]

    // Slice raw op tokens from process.argv — op names are dynamic, can't be citty args
    const goIdx = process.argv.indexOf("go")
    const rawTokens = process.argv.slice(goIdx + 1).filter(t => t.startsWith("--") && t !== "--dry-run")

    if (rawTokens.length === 0) {
      console.error("[ERROR] No ops specified. Example: bolt go --update=svn --build --start")
      process.exit(1)
    }

    const configPath = await findConfig(process.cwd())
    if (!configPath) { console.error("[ERROR] bolt.yaml not found"); process.exit(1) }

    const cfg    = await loadConfig(configPath)
    const parsed = parseGoArgs(rawTokens)

    let resolved
    try { resolved = resolveOps(parsed, cfg) }
    catch (e: any) { console.error(`[ERROR] ${e.message}`); process.exit(1) }

    const logDir  = path.join(path.dirname(configPath), ".bolt", "logs")
    mkdirSync(logDir, { recursive: true })
    const logFile = path.join(logDir, `bolt_${timestamp()}.log`)
    const logger  = new Logger({ logFile })

    logger.info(`bolt ${pkg.version}`)
    logger.info(`Config: ${configPath}`)
    logger.info(`Ops: ${resolved.map(o => o.name).join(" → ")}${dryRun ? " (dry-run)" : ""}`)

    const runner = new Runner(cfg, { dryRun, logger })
    const start  = Date.now()
    try {
      await runner.runOps(resolved, cfg.pipeline)
      logger.info(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`)
      logger.info(`Log: ${logFile}`)
      logger.close()
      process.exit(0)
    } catch (e: any) {
      logger.error(e.message)
      logger.info(`Log: ${logFile}`)
      logger.close()
      process.exit(1)
    }
  },
})
