import type { BoltConfig, Step, GoPipeline } from "./config";
import { Logger } from "./logger";
import { interpolate } from "./interpolate";
import { sortByPipeline, type ResolvedOp } from "./go";
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
import { Notifier, type BuildContext } from "./notify";

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
      const injectOpts = (o?: SpawnOptions) =>
        o ? (o.onOutput ??= onOutput, o) : { onOutput };
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
    return this.registry;
  }

  async run(
    actionName: string,
    params: Record<string, string> = {},
    visited = new Set<string>(),
  ): Promise<void> {
    await this.runAction(actionName, params, visited);
  }

  private async runAction(
    actionName: string,
    params: Record<string, string>,
    visited: Set<string>,
  ): Promise<void> {
    if (!this.cfg.actions[actionName]) throw new Error(`Unknown action: ${actionName}`);
    if (visited.has(actionName)) throw new Error(`Dependency cycle detected at: ${actionName}`);
    visited.add(actionName);

    const isTopLevel = visited.size === 1;
    const notifier = this.opts.notifier ?? Notifier.fromConfig(undefined);
    const startTime = Date.now();

    let ctx: BuildContext | undefined;
    if (isTopLevel) {
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
      } catch { /* not a git repo */ }

      ctx = { buildId, projectName: this.cfg.project.name, mode: "run" as const, gitBranch, startTime };
      await notifier.fire({ kind: "start", ctx, ops: [actionName] });
    }

    const action = this.cfg.actions[actionName];
    const t0 = Date.now();
    try {
      for (const dep of action.depends ?? []) await this.runAction(dep, params, visited);
      for (const step of action.steps) await this.execStep(step, params);
      if (isTopLevel && ctx) {
        const opDuration = Date.now() - t0;
        await notifier.fire({ kind: "op_complete", ctx, opName: actionName, opDuration });
        await notifier.fire({
          kind: "complete",
          ctx,
          duration: Date.now() - startTime,
          results: [{ op: actionName, ok: true, duration: opDuration }],
        });
      }
    } catch (e: any) {
      if (isTopLevel && ctx) {
        const opDuration = Date.now() - t0;
        await notifier.fire({ kind: "op_failure", ctx, opName: actionName, opDuration, error: e?.message });
        await notifier.fire({
          kind: "complete",
          ctx,
          duration: Date.now() - startTime,
          results: [{ op: actionName, ok: false, duration: opDuration }],
        });
      }
      throw e;
    }
  }

  async runOps(ops: ResolvedOp[], pipeline: GoPipeline): Promise<void> {
    const sorted = pipeline.order.length > 0 ? sortByPipeline(ops, pipeline.order) : ops;
    const startTime = Date.now();

    // ── Build context for notifications ───────────────────────────────────────
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

    const ctx: import("./notify").BuildContext = {
      buildId,
      projectName: this.cfg.project.name,
      mode: "go",
      gitBranch,
      startTime,
    };

    const notifier = this.opts.notifier ?? Notifier.fromConfig(undefined);
    const opNames = sorted.map((o) => o.name);
    const results: { op: string; ok: boolean; duration: number }[] = [];
    await notifier.fire({ kind: "start", ctx, ops: opNames });

    for (const op of sorted) {
      if (this.cfg.timeout_hours) {
        const elapsedHours = (Date.now() - startTime) / 3_600_000;
        if (elapsedHours >= this.cfg.timeout_hours) {
          throw new Error(`Build timed out after ${this.cfg.timeout_hours}h`);
        }
      }

      const t0 = Date.now();
      this.opts.logger?.step(op.name);
      try {
        for (const step of op.steps) await this.execStep(step, op.params ?? {});
        const opDuration = Date.now() - t0;
        this.opts.logger?.success(op.name, opDuration / 1000);
        results.push({ op: op.name, ok: true, duration: opDuration });
        await notifier.fire({ kind: "op_complete", ctx, opName: op.name, opDuration });
      } catch (e: any) {
        const opDuration = Date.now() - t0;
        this.opts.logger?.fail(op.name, opDuration / 1000);
        if (e?.message) this.opts.logger?.error(e.message);
        results.push({ op: op.name, ok: false, duration: opDuration });
        await notifier.fire({ kind: "op_failure", ctx, opName: op.name, opDuration, error: e?.message });
        if (pipeline.fail_stops.includes(op.name)) {
          await notifier.fire({ kind: "complete", ctx, duration: Date.now() - startTime, results });
          throw e;
        }
        this.opts.logger?.warn(`"${op.name}" failed but is not in fail_stops — continuing`);
      }
    }

    await notifier.fire({ kind: "complete", ctx, duration: Date.now() - startTime, results });
  }

  private async execStep(step: Step, opParams: Record<string, string> = {}): Promise<void> {
    const ctx = {
      project: this.cfg.project as Record<string, string>,
      vars: this.cfg.vars,
      env: process.env as Record<string, string>,
    };

    if (step.run) {
      const cmd = interpolate(step.run, ctx);
      this.opts.onStep?.(cmd);
      this.opts.logger?.step_detail(`run: ${cmd}`);
      if (!this.opts.dryRun) await this.shell(cmd, step["continue-on-error"]);
      return;
    }

    if (step.uses) {
      this.opts.onStep?.(step.uses);
      await this.dispatch(step, ctx, opParams);
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
    step: Step,
    ctx: Record<string, Record<string, string>>,
    opParams: Record<string, string>,
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

    if (ns === "ops") {
      const [opName, variant = "default"] = op.split(":");
      const opDef = this.cfg.ops[opName];
      if (!opDef) throw new Error(`Unknown op: "${opName}"`);
      const steps = opDef[variant];
      if (!steps) throw new Error(`Unknown variant "${variant}" for op "${opName}"`);
      const yamlParams = Object.fromEntries(
        Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, ctx)]),
      );
      const mergedParams = { ...yamlParams, ...opParams };
      for (const s of steps) await this.execStep(s, mergedParams);
      return;
    }

    const yamlParams = Object.fromEntries(
      Object.entries(step.with ?? {}).map(([k, v]) => [k, interpolate(v, ctx)]),
    );
    const mergedParams = { ...yamlParams, ...opParams };

    const paramStr = Object.entries(mergedParams)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
    this.opts.logger?.step_detail(`${uses}${paramStr ? "  " + paramStr : ""}`);

    const registry = await this.ensureRegistry();
    const plugin = registry.get(ns);
    if (!plugin) throw new Error(`Unknown plugin namespace: "${ns}"`);
    const handler = plugin.handlers[op];
    if (!handler) throw new Error(`Unknown op "${op}" in plugin "${ns}"`);

    const pluginCtx: BoltPluginContext = {
      cfg: this.cfg,
      configDir: this.opts.configDir ?? process.cwd(),
      dryRun: this.opts.dryRun ?? false,
      logger: this.opts.logger ?? new Logger(),
      runtime: this.runtime,
    };
    await handler(mergedParams, pluginCtx);
  }

  private async runLocalAction(actionPath: string, params: Record<string, string>): Promise<void> {
    const pathMod = require("path");
    const fs = require("fs");
    const actionDir = path.resolve(actionPath);
    const actionYaml = pathMod.join(actionDir, "action.yaml");
    if (!fs.existsSync(actionYaml)) throw new Error(`No action.yaml in ${actionDir}`);
    const env: Record<string, string> = { ...(process.env as any) };
    for (const [k, v] of Object.entries(params)) {
      env[`BOLT_INPUT_${k.toUpperCase()}`] = v;
    }
    for (const runner of ["run.ts", "run.js", "run.py", "run.sh", "run.bat"]) {
      const runFile = pathMod.join(actionDir, runner);
      if (!fs.existsSync(runFile)) continue;
      const result = await this.runtime.spawn([runFile], { env });
      if (result.exitCode !== 0) {
        throw new Error(`Local action failed (exit ${result.exitCode}): ${actionPath}`);
      }
      return;
    }
    throw new Error(`No run script found in ${actionDir}`);
  }
}
