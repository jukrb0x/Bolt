import type { BoltConfig } from "./config";
import { Logger } from "./logger";
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
import { formatPlanErrors, resolveRunPlan, type PlanNode, type RunPlan } from "./run-plan";

interface RunnerOptions {
  dryRun?: boolean;
  onStep?: (cmd: string) => void;
  logger?: Logger;
  configDir?: string;
  notifier?: Notifier;
  runtime?: Runtime;
}

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
      const injectOpts = (o?: SpawnOptions) => (o ? ((o.onOutput ??= onOutput), o) : { onOutput });
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
    } catch {
      /* not a git repo or git not available */
    }

    return { buildId, projectName: this.cfg.project.name, mode: "run", gitBranch, startTime };
  }

  // ── Public entry points ─────────────────────────────────────────────────────

  /** Back-compat single-task entry. */
  async run(name: string, params: Record<string, string> = {}): Promise<void> {
    await this.runTask(name, params);
  }

  async runTasks(names: string[], params: Record<string, string> = {}): Promise<void> {
    const result = resolveRunPlan(this.cfg, { kind: "tasks", names, params });
    if (!result.ok) throw new Error(formatPlanErrors(result.errors));
    await this.executePlan(result.plan);
  }

  async runTask(name: string, params: Record<string, string> = {}): Promise<void> {
    await this.runTasks([name], params);
  }

  async runFlow(name: string, params: Record<string, string> = {}): Promise<void> {
    const result = resolveRunPlan(this.cfg, { kind: "flow", name, params });
    if (!result.ok) throw new Error(formatPlanErrors(result.errors));
    await this.executePlan(result.plan);
  }

  // ── Plan execution ──────────────────────────────────────────────────────────

  private async executePlan(plan: RunPlan): Promise<void> {
    const startTime = Date.now();
    const ctx = this.buildContext(startTime);
    const notifier = this.opts.notifier ?? Notifier.fromConfig(undefined);
    const results: { op: string; ok: boolean; duration: number }[] = [];
    await notifier.fire({ kind: "start", ctx, plan });

    for (const task of plan.tasks) {
      if (this.cfg.timeout_hours) {
        const elapsedHours = (Date.now() - startTime) / 3_600_000;
        if (elapsedHours >= this.cfg.timeout_hours) {
          await notifier.fire({
            kind: "complete",
            ctx,
            duration: Date.now() - startTime,
            results,
          });
          throw new Error(`Build timed out after ${this.cfg.timeout_hours}h`);
        }
      }

      const taskStart = Date.now();
      this.opts.logger?.step(task.name);
      try {
        await this.executeNodes(task.nodes);
        const duration = Date.now() - taskStart;
        results.push({ op: task.name, ok: true, duration });
        this.opts.logger?.success(task.name, duration / 1000);
        await notifier.fire({
          kind: "op_complete",
          ctx,
          opName: task.name,
          opDuration: duration,
        });
      } catch (error: unknown) {
        const duration = Date.now() - taskStart;
        const message = error instanceof Error ? error.message : String(error);
        results.push({ op: task.name, ok: false, duration });
        this.opts.logger?.fail(task.name, duration / 1000);
        this.opts.logger?.error(message);
        await notifier.fire({
          kind: "op_failure",
          ctx,
          opName: task.name,
          opDuration: duration,
          error: message,
        });
        if (!task.continueOnFailure) {
          await notifier.fire({ kind: "complete", ctx, duration: Date.now() - startTime, results });
          throw error;
        }
        this.opts.logger?.warn(`"${task.name}" failed but is in continue_on_fail — continuing`);
      }
    }

    await notifier.fire({ kind: "complete", ctx, duration: Date.now() - startTime, results });
  }

  private async executeNodes(nodes: PlanNode[]): Promise<void> {
    for (const node of nodes) {
      if (node.kind === "call") {
        this.opts.onStep?.(`call:${node.name}`);
        await this.executeNodes(node.nodes);
        continue;
      }

      if (node.kind === "run") {
        this.opts.onStep?.(node.command);
        this.opts.logger?.step_detail(`run: ${node.command}`);
        if (!this.opts.dryRun) await this.shell(node.command, node.continueOnError);
        continue;
      }

      this.opts.onStep?.(node.ref);
      if (node.ref.startsWith("./") || node.ref.startsWith("../")) {
        const paramText = Object.entries(node.params)
          .map(([key, value]) => `${key}=${value}`)
          .join("  ");
        this.opts.logger?.step_detail(`local: ${node.ref}${paramText ? `  ${paramText}` : ""}`);
        await this.runLocalAction(node.ref, node.params);
        continue;
      }

      const slash = node.ref.indexOf("/");
      if (slash === -1) {
        throw new Error(`Invalid uses format (expected "ns/op"): "${node.ref}"`);
      }
      const namespace = node.ref.slice(0, slash);
      const operation = node.ref.slice(slash + 1);
      if (namespace === "task") {
        throw new Error(`legacy task reference "${node.ref}"; replace with "call: ${operation}"`);
      }

      const paramText = Object.entries(node.params)
        .map(([key, value]) => `${key}=${value}`)
        .join("  ");
      this.opts.logger?.step_detail(`${node.ref}${paramText ? `  ${paramText}` : ""}`);

      const registry = await this.ensureRegistry();
      const plugin = registry.get(namespace);
      if (!plugin) throw new Error(`Unknown plugin namespace: "${namespace}"`);
      const handler = plugin.handlers[operation];
      if (!handler) throw new Error(`Unknown op "${operation}" in plugin "${namespace}"`);

      const pluginCtx = this.pluginContext();
      const pluginInstance = plugin as any;
      if (typeof pluginInstance.onBeforeStep === "function") {
        await pluginInstance.onBeforeStep(operation, node.params, pluginCtx);
      }
      try {
        await handler(node.params, pluginCtx);
      } finally {
        if (typeof pluginInstance.onAfterStep === "function") {
          await pluginInstance.onAfterStep(operation, node.params, pluginCtx);
        }
      }
    }
  }

  private async shell(cmd: string, continueOnError = false): Promise<void> {
    const result = await this.runtime.shell(cmd);
    if (result.exitCode !== 0 && !continueOnError) {
      throw new Error(`Command failed (exit ${result.exitCode}): ${cmd}`);
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
