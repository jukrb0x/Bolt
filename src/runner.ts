import type { BoltConfig, Step } from "./config"
import { Logger } from "./logger"
import { interpolate } from "./interpolate"

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
      if (!this.opts.dryRun) await this.dispatch(step)
      return
    }
  }

  private async shell(cmd: string, continueOnError = false): Promise<void> {
    const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "inherit", stderr: "inherit" })
    const code = await proc.exited
    if (code !== 0 && !continueOnError) throw new Error(`Command failed (exit ${code}): ${cmd}`)
  }

  private async dispatch(step: Step): Promise<void> {
    // Built-in module dispatch — implemented in Task 9
    const [ns, op] = (step.uses ?? "").split("/")
    throw new Error(`Module not yet implemented: ${ns}/${op}`)
  }
}
