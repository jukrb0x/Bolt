import { type BoltConfig, type Step } from "./config";
import { Logger } from "./logger";
import { interpolate } from "./interpolate";
import { buildRegistry, type PluginRegistry } from "./plugin-registry";
import type { BoltPluginContext } from "./plugin";
import { createRuntime, type Runtime } from "./runtime";
import type { SpawnOptions } from "./runtime/types";
import uePlugin from "./plugins/ue";
import fsPlugin from "./plugins/fs";
import jsonPlugin from "./plugins/json";
import gitPlugin from "./plugins/git";
import svnPlugin from "./plugins/svn";
import path from "path";
import { existsSync } from "fs";
import { Notifier, type BuildContext } from "./notify";

type UsesStep = Extract<Step, { uses: string }>;

function isUsesStep(step: Step): step is UsesStep {
  return "uses" in step && step.uses !== undefined;
}

interface RunnerOptions {
  dryRun?: boolean;
  onStep?: (cmd: string) => void;
  logger?: Logger;
  configDir?: string;
  notifier?: Notifier;
  runtime?: Runtime;
}

type InterpolateCtx = Record<string, Record<string, string>>;

export class Runner {
  private registry?: PluginRegistry;
  private runtime: Runtime;

  constructor(
    private cfg: BoltConfig,
    private opts: RunnerOptions = {},
  ) {
    const base = opts.runtime ?? createRuntime();
    // Wrap the runtime so all spawn/shell calls tee output to the log file
    const logger = opts.logger;
    if (logger) {
      const onOutput = (text: string) => logger.writeRaw(text);
      const injectOpts = (o?: SpawnOptions) =>
        o ? ((o.onOutput ??= onOutput), o) : { onOutput };
      this.runtime = {
        spawn: (cmd, o) => base.spawn(cmd, injectOpts(o)),
        spawnSync: (cmd, o) => base.spawnSync(cmd, injectOpts(o)),
        shell: (cmd, o) => base.shell(cmd, injectOpts(o)),
        parseYaml: (text) => base.parseYaml(text),
      };
    } else {
      this.runtime = base;
    }
  }

  private async ensureRegistry(): Promise<PluginRegistry> {
    if (this.registry) return this.registry;
    this.registry = await buildRegistry(this.cfg, this.opts.configDir ?? process.cwd(), [
      uePlugin,
      fsPlugin,
      jsonPlugin,
      gitPlugin,
      svnPlugin,
    ]);

    // Call onInit for any plugins that implement lifecycle hooks
    for (const ns of this.registry.listNamespaces()) {
      const plugin = this.registry.get(ns) as any;
      if (typeof plugin?.onInit === "function") {
        await plugin.onInit(this.pluginContext());
      }
    }

    return this.registry;
  }

  private pluginContext(): BoltPluginContext {
    return {
      cfg: this.cfg,
      configDir: this.opts.configDir ?? process.cwd(),
      dryRun: this.opts.dryRun ?? false,
      logger: this.opts.logger ?? new Logger(),
      runtime: this.runtime,
    };
  }

  /** Build the notification BuildContext (buildId + auto-detected git branch). */
  private buildContext(startTime: number): BuildContext {
    const now = new Date(startTime);
    const buildId = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "_",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");

    let gitBranch: string | undefined;
    try {
      const proc = this.runtime.spawnSync(["git", "branch", "--show-current"]);
      if (proc.exitCode === 0) gitBranch = proc.stdout.trim() || undefined;
    } catch { /* not a git repo or git not available */ }

    return { buildId, projectName: this.cfg.project.name, mode: "run", gitBranch, startTime };
  }

  // ── Public entry points ─────────────────────────────────────────────────────

  /** Back-compat single-task entry. Prefer runTask/runFlow directly. */
  async run(
    name: string,
    params: Record<string, string> = {},
    visited = new Set<string>(),
  ): Promise<void> {
    await this.runTask(name, params, visited);
  }

  /**
   * Run a single task by name (top-level). Fires start/op_complete/op_failure/
   * complete notifications, treating the task name as the op name. Nested calls
   * (visited already populated) skip notifications and just execute steps.
   */
  async runTask(
    name: string,
    params: Record<string, string> = {},
    visited = new Set<string>(),
  ): Promise<void> {
    if (visited.size > 0) {
      await this.execTask(name, params, visited);
      return;
    }

    const notifier = this.opts.notifier ?? Notifier.fromConfig(undefined);
    const startTime = Date.now();
    const ctx = this.buildContext(startTime);
    await notifier.fire({ kind: "start", ctx, ops: [name] });

    const t0 = Date.now();
    try {
      await this.execTask(name, params, visited);
      const opDuration = Date.now() - t0;
      await notifier.fire({ kind: "op_complete", ctx, opName: name, opDuration });
      await notifier.fire({
        kind: "complete",
        ctx,
        duration: Date.now() - startTime,
        results: [{ op: name, ok: true, duration: opDuration }],
      });
    } catch (e: any) {
      const opDuration = Date.now() - t0;
      await notifier.fire({ kind: "op_failure", ctx, opName: name, opDuration, error: e?.message });
      await notifier.fire({
        kind: "complete",
        ctx,
        duration: Date.now() - startTime,
        results: [{ op: name, ok: false, duration: opDuration }],
      });
      throw e;
    }
  }

  /**
   * Run a flow: its tasks in listed order. Fail-fast — the first failing task
   * aborts the flow, UNLESS it is listed in `continue_on_fail` (then log a
   * warning and continue). Fires flow-level start/op_complete/op_failure/complete
   * notifications.
   */
  async runFlow(name: string): Promise<void> {
    const flow = this.cfg.flows[name];
    if (!flow) throw new Error(`Unknown flow: ${name}`);

    const startTime = Date.now();
    const ctx = this.buildContext(startTime);
    const notifier = this.opts.notifier ?? Notifier.fromConfig(undefined);
    const results: { op: string; ok: boolean; duration: number }[] = [];
    await notifier.fire({ kind: "start", ctx, ops: flow.steps });

    for (const taskName of flow.steps) {
      if (this.cfg.timeout_hours) {
        const elapsedHours = (Date.now() - startTime) / 3_600_000;
        if (elapsedHours >= this.cfg.timeout_hours) {
          throw new Error(`Build timed out after ${this.cfg.timeout_hours}h`);
        }
      }

      const t0 = Date.now();
      this.opts.logger?.step(taskName);
      try {
        await this.execTask(taskName, {}, new Set<string>());
        const opDuration = Date.now() - t0;
        this.opts.logger?.success(taskName, opDuration / 1000);
        results.push({ op: taskName, ok: true, duration: opDuration });
        await notifier.fire({ kind: "op_complete", ctx, opName: taskName, opDuration });
      } catch (e: any) {
        const opDuration = Date.now() - t0;
        this.opts.logger?.fail(taskName, opDuration / 1000);
        if (e?.message) this.opts.logger?.error(e.message);
        results.push({ op: taskName, ok: false, duration: opDuration });
        await notifier.fire({ kind: "op_failure", ctx, opName: taskName, opDuration, error: e?.message });
        if (!flow.continue_on_fail.includes(taskName)) {
          await notifier.fire({ kind: "complete", ctx, duration: Date.now() - startTime, results });
          throw e;
        }
        this.opts.logger?.warn(`"${taskName}" failed but is in continue_on_fail — continuing`);
      }
    }

    await notifier.fire({ kind: "complete", ctx, duration: Date.now() - startTime, results });
  }

  // ── Core execution ──────────────────────────────────────────────────────────

  /** Run a task's steps with cycle detection. No notifications (nested-safe). */
  private async execTask(
    name: string,
    params: Record<string, string>,
    visited: Set<string>,
  ): Promise<void> {
    const steps = this.cfg.tasks[name];
    if (!steps) throw new Error(`Unknown task: ${name}`);
    if (visited.has(name)) {
      throw new Error(`Task call cycle: ${[...visited, name].join(" -> ")}`);
    }
    visited.add(name);
    try {
      for (const step of steps) await this.execStep(step, params, visited);
    } finally {
      visited.delete(name);
    }
  }

  private async execStep(
    step: Step,
    params: Record<string, string> = {},
    visited = new Set<string>(),
  ): Promise<void> {
    const ctx: InterpolateCtx = {
      project: this.cfg.project as unknown as Record<string, string>,
      vars: this.cfg.vars,
      env: process.env as Record<string, string>,
      params,
    };

    if ("run" in step && step.run !== undefined) {
      const cmd = interpolate(step.run, ctx);
      this.opts.onStep?.(cmd);
      this.opts.logger?.step_detail(`run: ${cmd}`);
      if (!this.opts.dryRun) await this.shell(cmd, step["continue-on-error"]);
      return;
    }

    if ("call" in step && step.call !== undefined) {
      const callParams = Object.fromEntries(
        Object.entries(step.with ?? {}).map(([key, value]) => [key, interpolate(value, ctx)]),
      );
      const mergedParams = { ...callParams, ...params };
      this.opts.onStep?.(`call:${step.call}`);
      await this.execTask(step.call, mergedParams, visited);
      return;
    }

    if (isUsesStep(step)) {
      this.opts.onStep?.(step.uses);
      await this.dispatch(step, ctx, params);
      return;
    }
  }

  private async shell(cmd: string, continueOnError = false): Promise<void> {
    const result = await this.runtime.shell(cmd);
    if (result.exitCode !== 0 && !continueOnError) {
      throw new Error(`Command failed (exit ${result.exitCode}): ${cmd}`);
    }
  }

  private async dispatch(
    step: UsesStep,
    ctx: InterpolateCtx,
    params: Record<string, string>,
  ): Promise<void> {
    const uses = step.uses ?? "";

    if (uses.startsWith("./") || uses.startsWith("../")) {
      const interpolatedParams = Object.fromEntries(
        Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, ctx)]),
      );
      const localParamStr = Object.entries(interpolatedParams)
        .map(([k, v]) => `${k}=${v}`)
        .join("  ");
      this.opts.logger?.step_detail(`local: ${uses}${localParamStr ? "  " + localParamStr : ""}`);
      await this.runLocalAction(uses, interpolatedParams);
      return;
    }

    const slashIdx = uses.indexOf("/");
    if (slashIdx === -1) throw new Error(`Invalid uses format (expected "ns/op"): "${uses}"`);
    const ns = uses.slice(0, slashIdx);
    const op = uses.slice(slashIdx + 1);

    // Interpolated step.with, then run params applied as a shallow override (params win).
    const yamlParams = Object.fromEntries(
      Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, ctx)]),
    );
    const mergedParams = { ...yamlParams, ...params };

    const paramStr = Object.entries(mergedParams)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
    this.opts.logger?.step_detail(`${uses}${paramStr ? "  " + paramStr : ""}`);

    const registry = await this.ensureRegistry();
    const plugin = registry.get(ns);
    if (!plugin) throw new Error(`Unknown plugin namespace: "${ns}"`);
    const handler = plugin.handlers[op];
    if (!handler) throw new Error(`Unknown op "${op}" in plugin "${ns}"`);

    const pluginCtx = this.pluginContext();
    const pluginInstance = plugin as any; // May have lifecycle hooks
    if (typeof pluginInstance.onBeforeStep === "function") {
      await pluginInstance.onBeforeStep(op, mergedParams, pluginCtx);
    }
    try {
      await handler(mergedParams, pluginCtx);
    } finally {
      if (typeof pluginInstance.onAfterStep === "function") {
        await pluginInstance.onAfterStep(op, mergedParams, pluginCtx);
      }
    }
  }

  private async runLocalAction(actionPath: string, params: Record<string, string>): Promise<void> {
    const actionDir = path.resolve(actionPath);
    const actionYaml = path.join(actionDir, "action.yaml");
    if (!existsSync(actionYaml)) throw new Error(`No action.yaml in ${actionDir}`);
    const env: Record<string, string> = { ...(process.env as any) };
    for (const [k, v] of Object.entries(params)) {
      env[`BOLT_INPUT_${k.toUpperCase()}`] = v;
    }
    for (const runner of ["run.ts", "run.js", "run.py", "run.sh", "run.bat"]) {
      const runFile = path.join(actionDir, runner);
      if (!existsSync(runFile)) continue;
      const result = await this.runtime.spawn([runFile], { env });
      if (result.exitCode !== 0) {
        throw new Error(`Local action failed (exit ${result.exitCode}): ${actionPath}`);
      }
      return;
    }
    throw new Error(`No run script found in ${actionDir}`);
  }
}
