import { findConfig }  from "./discover"
import { loadConfig }  from "./config"
import { Runner }      from "./runner"
import { Logger }      from "./logger"
import path from "path"
import { mkdirSync }   from "fs"

const VERSION = "0.1.0"

async function main() {
  const args = process.argv.slice(2)

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`bolt ${VERSION}`)
    process.exit(0)
  }

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp()
    process.exit(0)
  }

  const dryRun = args.includes("--dry-run")
  const actionArgs = args.filter(a => !a.startsWith("--"))
  const action = actionArgs[0]

  if (action === "list") {
    await listActions()
    return
  }

  if (action === "info") {
    await printInfo()
    return
  }

  const configPath = await findConfig(process.cwd())
  if (!configPath) {
    console.error("[ERROR] bolt.yaml not found (searched up from cwd)")
    process.exit(1)
  }

  const cfg = await loadConfig(configPath)

  const logDir = path.join(path.dirname(configPath), ".bolt", "logs")
  mkdirSync(logDir, { recursive: true })
  const logFile = path.join(logDir, `bolt_${timestamp()}.log`)
  const logger = new Logger({ logFile })

  logger.info(`bolt ${VERSION}`)
  logger.info(`Config: ${configPath}`)
  logger.info(`Action: ${action}${dryRun ? " (dry-run)" : ""}`)

  const runner = new Runner(cfg, { dryRun, logger })

  const start = Date.now()
  try {
    await runner.run(action)
    const dur = ((Date.now() - start) / 1000).toFixed(1)
    logger.info(`Done in ${dur}s`)
    logger.info(`Log: ${logFile}`)
    logger.close()
    process.exit(0)
  } catch (e: any) {
    logger.error(e.message)
    logger.info(`Log: ${logFile}`)
    logger.close()
    process.exit(1)
  }
}

async function listActions() {
  const configPath = await findConfig(process.cwd())
  if (!configPath) { console.error("bolt.yaml not found"); process.exit(1) }
  const cfg = await loadConfig(configPath)
  console.log("Actions:")
  for (const name of Object.keys(cfg.actions)) {
    console.log(`  ${name}`)
  }
}

async function printInfo() {
  const configPath = await findConfig(process.cwd())
  if (!configPath) { console.error("bolt.yaml not found"); process.exit(1) }
  const cfg = await loadConfig(configPath)
  console.log(`Project:  ${cfg.project.name}`)
  console.log(`UE path:  ${cfg.project.ue_path}`)
  console.log(`Project:  ${cfg.project.project_path}`)
  console.log(`Targets:  ${Object.keys(cfg.targets).join(", ")}`)
  console.log(`Actions:  ${Object.keys(cfg.actions).join(", ")}`)
}

function printHelp() {
  console.log(`bolt ${VERSION} — Unreal Engine build automation

Usage:
  bolt <action>            Run a named action
  bolt list                List available actions
  bolt info                Print project config summary
  bolt <action> --dry-run  Print steps without executing

Options:
  --dry-run                Simulate execution
  --help, -h               Show this help
  --version, -v            Show version`)
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

main()
