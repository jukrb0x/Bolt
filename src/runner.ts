import type { BoltConfig, Step, GoPipeline } from "./config"
import { Logger } from "./logger"
import { interpolate } from "./interpolate"
import { sortByPipeline, type ResolvedOp } from "./go"
import { buildRegistry, type PluginRegistry } from "./plugin-registry"
import type { BoltPluginContext } from "./plugin"
import uePlugin   from "./plugins/ue"
import fsPlugin   from "./plugins/fs"
import jsonPlugin from "./plugins/json"
import path from "path"

interface RunnerOptions {
  dryRun?:    boolean
  onStep?:    (cmd: string) => void
  logger?:    Logger
  configDir?: string
}

export class Runner {
  private registry?: PluginRegistry

  constructor(private cfg: BoltConfig, private opts: RunnerOptions = {}) {}

  private async ensureRegistry(): Promise<PluginRegistry> {
    if (this.registry) return this.registry
    this.registry = await buildRegistry(
      this.cfg,
      this.opts.configDir ?? process.cwd(),
      [uePlugin, fsPlugin, jsonPlugin]
    )
    return this.registry
  }

  async run(actionName: string, visited = new Set<string>()): Promise<void> {
    if (!this.cfg.actions[actionName]) throw new Error(`Unknown action: ${actionName}`)
    if (visited.has(actionName)) throw new Error(`Dependency cycle detected at: ${actionName}`)
    visited.add(actionName)
    const action = this.cfg.actions[actionName]
    for (const dep of action.depends ?? []) await this.run(dep, visited)
    for (const step of action.steps) await this.execStep(step)
  }

  async runOps(ops: ResolvedOp[], pipeline: GoPipeline): Promise<void> {
    const sorted = pipeline.order.length > 0 ? sortByPipeline(ops, pipeline.order) : ops
    const startTime = Date.now()

    for (const op of sorted) {
      if (this.cfg.timeout_hours) {
        const elapsedHours = (Date.now() - startTime) / 3_600_000
        if (elapsedHours >= this.cfg.timeout_hours) {
          throw new Error(`Build timed out after ${this.cfg.timeout_hours}h`)
        }
      }

      const t0 = Date.now()
      this.opts.logger?.step(op.name)
      try {
        for (const step of op.steps) await this.execStep(step, op.params ?? {})
        this.opts.logger?.success(op.name, (Date.now() - t0) / 1000)
      } catch (e: any) {
        this.opts.logger?.fail(op.name, (Date.now() - t0) / 1000)
        if (pipeline.fail_stops.includes(op.name)) throw e
        this.opts.logger?.warn(`"${op.name}" failed but is not in fail_stops — continuing`)
      }
    }
  }

  private async execStep(step: Step, opParams: Record<string, string> = {}): Promise<void> {
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
      if (!this.opts.dryRun) await this.dispatch(step, ctx, opParams)
      return
    }
  }

  private async shell(cmd: string, continueOnError = false): Promise<void> {
    const proc = Bun.spawn(["cmd", "/c", cmd], { stdout: "inherit", stderr: "inherit" })
    const code = await proc.exited
    if (code !== 0 && !continueOnError) throw new Error(`Command failed (exit ${code}): ${cmd}`)
  }

  private async dispatch(
    step: Step,
    ctx: Record<string, Record<string, string>>,
    opParams: Record<string, string>
  ): Promise<void> {
    const uses = step.uses ?? ""

    if (uses.startsWith("./") || uses.startsWith("../")) {
      const interpolatedParams = Object.fromEntries(
        Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, ctx)])
      )
      await this.runLocalAction(uses, interpolatedParams)
      return
    }

    const slashIdx = uses.indexOf("/")
    if (slashIdx === -1) throw new Error(`Invalid uses format (expected "ns/op"): "${uses}"`)
    const ns = uses.slice(0, slashIdx)
    const op = uses.slice(slashIdx + 1)

    if (ns === "ops") {
      const [opName, variant = "default"] = op.split(":")
      const opDef = this.cfg.ops[opName]
      if (!opDef) throw new Error(`Unknown op: "${opName}"`)
      const steps = opDef[variant]
      if (!steps) throw new Error(`Unknown variant "${variant}" for op "${opName}"`)
      for (const s of steps) await this.execStep(s, opParams)
      return
    }

    const yamlParams = Object.fromEntries(
      Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, ctx)])
    )
    const mergedParams = { ...yamlParams, ...opParams }

    const registry = await this.ensureRegistry()
    const plugin = registry.get(ns)
    if (!plugin) throw new Error(`Unknown plugin namespace: "${ns}"`)
    const handler = plugin.handlers[op]
    if (!handler) throw new Error(`Unknown op "${op}" in plugin "${ns}"`)

    const pluginCtx: BoltPluginContext = {
      cfg:    this.cfg,
      dryRun: this.opts.dryRun ?? false,
      logger: this.opts.logger ?? new Logger(),
    }
    await handler(mergedParams, pluginCtx)
  }

  private async runLocalAction(actionPath: string, params: Record<string, string>): Promise<void> {
    const pathMod = require("path")
    const fs      = require("fs")
    const actionDir  = path.resolve(actionPath)
    const actionYaml = pathMod.join(actionDir, "action.yaml")
    if (!fs.existsSync(actionYaml)) throw new Error(`No action.yaml in ${actionDir}`)
    const env: Record<string, string> = { ...process.env as any }
    for (const [k, v] of Object.entries(params)) {
      env[`BOLT_INPUT_${k.toUpperCase()}`] = v
    }
    for (const runner of ["run.ts", "run.js", "run.py", "run.sh", "run.bat"]) {
      const runFile = pathMod.join(actionDir, runner)
      if (!fs.existsSync(runFile)) continue
      const proc = Bun.spawn([runFile], { env, stdout: "inherit", stderr: "inherit" })
      const code = await proc.exited
      if (code !== 0) throw new Error(`Local action failed (exit ${code}): ${actionPath}`)
      return
    }
    throw new Error(`No run script found in ${actionDir}`)
  }
}
