import type { BoltConfig, Step } from "./config"
import { Logger } from "./logger"
import { interpolate } from "./interpolate"
import { UeModule }   from "./modules/ue"
import { FsModule }   from "./modules/fs"
import { JsonModule } from "./modules/json"

interface RunnerOptions {
  dryRun?:  boolean
  onStep?:  (cmd: string) => void
  logger?:  Logger
}

export class Runner {
  constructor(private cfg: BoltConfig, private opts: RunnerOptions = {}) {}

  async run(actionName: string, visited = new Set<string>()): Promise<void> {
    if (!this.cfg.actions[actionName]) throw new Error(`Unknown action: ${actionName}`)
    if (visited.has(actionName)) throw new Error(`Dependency cycle detected at: ${actionName}`)
    visited.add(actionName)

    const action = this.cfg.actions[actionName]
    for (const dep of action.depends ?? []) {
      await this.run(dep, visited)
    }

    for (const step of action.steps) {
      await this.execStep(step)
    }
  }

  private async execStep(step: Step): Promise<void> {
    const ctx = {
      project: this.cfg.project as Record<string, string>,
      env: process.env as Record<string, string>,
    }

    if (step.run) {
      const cmd = interpolate(step.run, ctx)
      this.opts.onStep?.(cmd)
      if (!this.opts.dryRun) await this.shell(cmd, step["continue-on-error"])
      return
    }

    if (step.uses) {
      this.opts.onStep?.(step.uses)
      if (!this.opts.dryRun) await this.dispatch(step, ctx)
      return
    }
  }

  private async shell(cmd: string, continueOnError = false): Promise<void> {
    const proc = Bun.spawn(["cmd", "/c", cmd], { stdout: "inherit", stderr: "inherit" })
    const code = await proc.exited
    if (code !== 0 && !continueOnError) throw new Error(`Command failed (exit ${code}): ${cmd}`)
  }

  private async dispatch(step: Step, ctx: Record<string, Record<string, string>>): Promise<void> {
    const uses = step.uses ?? ""
    const params = Object.fromEntries(
      Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, ctx)])
    )
    const [ns, op] = uses.split("/")

    if (ns === "ue") {
      const ue = new UeModule(this.cfg, { dryRun: this.opts.dryRun })
      if (this.opts.logger) ue.onCommand((c) => this.opts.logger!.info(c))
      const method = op.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof UeModule
      if (typeof ue[method] === "function") { await (ue[method] as Function)(params); return }
    }

    if (ns === "fs") {
      const fs = new FsModule()
      const method = op as keyof FsModule
      if (typeof fs[method] === "function") { await (fs[method] as Function)(params); return }
    }

    if (ns === "json") {
      const json = new JsonModule()
      const method = op as keyof JsonModule
      if (typeof json[method] === "function") { await (json[method] as Function)(params); return }
    }

    if (uses.startsWith("./") || uses.startsWith("../")) {
      await this.runLocalAction(uses, params)
      return
    }

    throw new Error(`Unknown module: ${uses}`)
  }

  private async runLocalAction(actionPath: string, params: Record<string, string>): Promise<void> {
    const path = require("path")
    const fs   = require("fs")

    const actionDir  = path.resolve(actionPath)
    const actionYaml = path.join(actionDir, "action.yaml")
    if (!fs.existsSync(actionYaml)) throw new Error(`No action.yaml in ${actionDir}`)

    const env: Record<string, string> = { ...process.env as any }
    for (const [k, v] of Object.entries(params)) {
      env[`BOLT_INPUT_${k.toUpperCase()}`] = v
    }

    for (const runner of ["run.ts", "run.js", "run.py", "run.sh", "run.bat"]) {
      const runFile = path.join(actionDir, runner)
      if (!fs.existsSync(runFile)) continue
      const proc = Bun.spawn([runFile], { env, stdout: "inherit", stderr: "inherit" })
      const code = await proc.exited
      if (code !== 0) throw new Error(`Local action failed (exit ${code}): ${actionPath}`)
      return
    }

    throw new Error(`No run script found in ${actionDir}`)
  }
}
