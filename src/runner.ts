import { safePath } from "./plugins/path-guard";
import type { BoltConfig } from "./config";
import { Logger } from "./logger";
import { buildRegistry, type PluginRegistry } from "./plugin-registry";
import { normalizeTextualBooleans, type BoltPlugin, type BoltPluginContext } from "./plugin";
import { createRuntime, type Runtime } from "./runtime";
import type { SpawnOptions } from "./runtime/types";
import uePlugin from "./plugins/ue";
import fsPlugin from "./plugins/fs";
import jsonPlugin from "./plugins/json";
import gitPlugin from "./plugins/git";
import svnPlugin from "./plugins/svn";
import path from "path";
import { LOCAL_RUNNERS } from "./local-runners";
import type { ZodTypeAny } from "zod";
import { BUILTIN_PARAM_SCHEMAS } from "./plugins/builtin-params";
import { closestMatches } from "./suggest";
import { existsSync } from "fs";
import { Notifier, type BuildContext } from "./notify";
import { formatPlanErrors, resolveRunPlan, type PlanNode, type RunPlan } from "./run-plan";
import { RunEvents } from "./step-events";
import { staleAiContextWarning } from "./ai-context";
import {
  BoltStepError,
  validateHandlerResult,
  type HandlerResult,
  type StampedEvent,
} from "./handler-result";

/** Outcome of one plugin step whose plugin declared API v2. */
export interface StepResult extends HandlerResult {
  ref: string;
  step: string;
}

const BUILTINS: Record<string, BoltPlugin> = {
  ue: uePlugin,
  fs: fsPlugin,
  json: jsonPlugin,
  git: gitPlugin,
  svn: svnPlugin,
};

/** The param schema for a handler: its manifest schema, or the built-in table. */
function stepParamSchema(plugin: BoltPlugin, operation: string): ZodTypeAny | undefined {
  const declared = plugin.manifest?.handlers[operation]?.params as ZodTypeAny | undefined;
  if (declared) return declared;
  // Only the real built-in object, not a user plugin that shadows the namespace.
  if (BUILTINS[plugin.namespace] !== plugin) return undefined;
  return BUILTIN_PARAM_SCHEMAS[plugin.namespace]?.[operation];
}

function schemaKeys(schema: ZodTypeAny): string[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  return shape ? Object.keys(shape) : [];
}

/**
 * Validate step params against the handler's schema. Errors name the param, suggest a
 * close match for a misspelled key (`dest` -> `dst`), and say how to fix bolt.yaml.
 */
export function parseStepParams(
  plugin: BoltPlugin,
  ref: string,
  operation: string,
  raw: Record<string, string>,
): Record<string, string> {
  const schema = stepParamSchema(plugin, operation);
  if (!schema) return raw;
  const result = schema.safeParse(normalizeTextualBooleans(schema, raw));
  if (result.success) return result.data as Record<string, string>;
  const expected = schemaKeys(schema);
  const unknown = Object.keys(raw).filter((k) => !expected.includes(k));
  const lines = result.error.issues.map((issue) => {
    const key = issue.path.join(".");
    const missing = issue.code === "invalid_type" && issue.received === "undefined";
    if (!missing) return `  ${key}: ${issue.message}`;
    const typo = unknown.find((u) => closestMatches(u, [key]).length > 0);
    return typo
      ? `  missing param "${key}" (you passed "${typo}"; did you mean "${key}"?)`
      : `  missing param "${key}"`;
  });
  const known = expected.length > 0 ? `\n  ${ref} params: ${expected.join(", ")}` : "";
  throw new Error(
    `Invalid params for "${ref}":\n${lines.join("\n")}${known}\n  Fix the step's with: in bolt.yaml.`,
  );
}

interface RunnerOptions {
  dryRun?: boolean;
  /**
   * @internal Set by the AI permission path when an agent invokes the run. Core
   * enforces AI-only restrictions (see {@link AI_PATH_RESTRICTED}); it is not
   * exposed to plugins. Human runs leave it unset.
   */
  aiInvocation?: boolean;
  onStep?: (cmd: string) => void;
  logger?: Logger;
  configDir?: string;
  notifier?: Notifier;
  runtime?: Runtime;
  /** Every event a handler or hook emits, after core stamps it. */
  onEvent?: (event: StampedEvent) => void;
  /** Every validated result returned by a plugin API v2 handler. */
  onStepResult?: (result: StepResult) => void;
}

/**
 * Path params that an AI invocation may only point inside the project directory,
 * after resolving symlinks (fail closed). Human runs are not restricted here:
 * git/info and svn/info warn; fs/* and json/* keep main's literal check.
 */
const AI_PATH_RESTRICTED = new Map<string, string[]>([
  ["git/info", ["path"]],
  ["svn/info", ["path"]],
  ["fs/copy", ["src", "dst"]],
  ["fs/move", ["src", "dst"]],
  ["fs/delete", ["path"]],
  ["fs/mkdir", ["path"]],
  ["json/set", ["file"]],
  ["json/merge", ["file", "patch"]],
]);

/** Errors the runner already printed (step failure), so callers do not print them twice. */
const reportedErrors = new WeakSet<object>();

/** Whether `error` was already printed by the runner as a task failure. */
export function wasReported(error: unknown): boolean {
  return typeof error === "object" && error !== null && reportedErrors.has(error);
}

const contextualized = new WeakSet<object>();

/**
 * Prefix a step failure with where it happened: `<task> > <call...> > <ref>: <message>`.
 * Native errors (ENOENT, TypeError, ...) otherwise carry no task or step. The error object
 * is kept (so BoltStepError codes and wasReported still work); only its message changes,
 * and only once.
 */
export function withStepContext(error: unknown, where: string): unknown {
  if (!(error instanceof Error)) return new Error(`${where}: ${String(error)}`);
  if (contextualized.has(error)) return error;
  contextualized.add(error);
  // Avoid "t > fs/copy: fs/copy ..." when the message already starts with the step.
  const step = where.split(" > ").pop() ?? where;
  error.message = error.message.startsWith(`${step} `)
    ? `${where.slice(0, where.length - step.length)}${error.message}`
    : `${where}: ${error.message}`;
  return error;
}

/** The run script a local action would execute; throws if action.yaml or the script is missing. */
export function resolveLocalAction(actionPath: string): string {
  const actionDir = path.resolve(actionPath);
  if (!existsSync(path.join(actionDir, "action.yaml"))) {
    throw new Error(`No action.yaml in ${actionDir}`);
  }
  for (const runner of LOCAL_RUNNERS) {
    const runFile = path.join(actionDir, runner);
    if (existsSync(runFile)) return runFile;
  }
  throw new Error(
    `No run script found in ${actionDir} (expected one of ${LOCAL_RUNNERS.join(", ")})`,
  );
}

export class Runner {
  private registry?: PluginRegistry;
  private runtime: Runtime;
  private events: RunEvents;

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
    this.events = new RunEvents({ logger: opts.logger, onEvent: opts.onEvent });
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
    for (const warning of this.registry.warnings) this.opts.logger?.warn(warning);
    const stale = staleAiContextWarning(this.opts.configDir ?? process.cwd());
    if (stale) this.opts.logger?.warn(stale);

    // Call onInit for any plugins that implement lifecycle hooks
    for (const ns of this.registry.listNamespaces()) {
      const plugin = this.registry.get(ns) as any;
      if (typeof plugin?.onInit === "function") {
        const scope = this.events.scope(ns);
        try {
          await plugin.onInit(scope.bind(this.pluginContext()));
        } finally {
          scope.settle();
        }
      }
    }

    return this.registry;
  }

  private pluginContext(): Omit<BoltPluginContext, "emit"> {
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
    // Dry-run spawns nothing: skip the git branch lookup (notifications are off anyway).
    if (!this.opts.dryRun) {
      try {
        const proc = this.runtime.spawnSync(["git", "branch", "--show-current"]);
        if (proc.exitCode === 0) gitBranch = proc.stdout.trim() || undefined;
      } catch {
        /* not a git repo or git not available */
      }
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
        await this.executeNodes(task.nodes, [task.name]);
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
        if (typeof error === "object" && error !== null) reportedErrors.add(error);
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

  private async executeNodes(nodes: PlanNode[], trail: string[] = []): Promise<void> {
    for (const node of nodes) {
      if (node.kind === "call") {
        this.opts.onStep?.(`call:${node.name}`);
        await this.executeNodes(node.nodes, [...trail, node.name]);
        continue;
      }
      try {
        await this.executeStep(node, trail);
      } catch (error) {
        const label = node.kind === "run" ? `run: ${node.command}` : node.ref;
        throw withStepContext(error, [...trail, label].join(" > "));
      }
    }
  }

  private async executeStep(
    node: Exclude<PlanNode, { kind: "call" }>,
    trail: string[],
  ): Promise<void> {
    if (node.kind === "run") {
      this.opts.onStep?.(node.command);
      this.opts.logger?.step_detail(`run: ${node.command}`);
      if (!this.opts.dryRun) await this.shell(node.command, node.continueOnError);
      return;
    }

    this.opts.onStep?.(node.ref);
    if (node.ref.startsWith("./") || node.ref.startsWith("../")) {
      const paramText = Object.entries(node.params)
        .map(([key, value]) => `${key}=${value}`)
        .join("  ");
      this.opts.logger?.step_detail(`local: ${node.ref}${paramText ? `  ${paramText}` : ""}`);
      if (this.opts.dryRun) {
        const runFile = resolveLocalAction(node.ref);
        this.opts.logger?.step_detail(
          `[dry-run] would run local action ${node.ref} (${path.basename(runFile)})`,
        );
      } else {
        await this.runLocalAction(node.ref, node.params);
      }
      return;
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

    const params = parseStepParams(plugin, node.ref, operation, node.params);
    if (this.opts.aiInvocation && AI_PATH_RESTRICTED.has(node.ref)) {
      for (const key of AI_PATH_RESTRICTED.get(node.ref) ?? []) {
        this.assertAiPathInProject(node.ref, key, params[key]);
      }
    }
    const step = [...trail, node.ref].join(" > ");
    // One context object per step, shared by the hooks and the handler as before.
    const scope = this.events.scope(node.ref, step);
    const pluginCtx = scope.bind(this.pluginContext());
    const pluginInstance = plugin as any;
    let returned: unknown;
    try {
      if (typeof pluginInstance.onBeforeStep === "function") {
        await pluginInstance.onBeforeStep(operation, node.params, pluginCtx);
      }
      try {
        returned = await handler(params, pluginCtx);
      } finally {
        if (typeof pluginInstance.onAfterStep === "function") {
          await pluginInstance.onAfterStep(operation, node.params, pluginCtx);
        }
      }
    } finally {
      scope.settle();
    }
    this.handleReturn(plugin, node.ref, step, returned);
  }

  /**
   * Plugin API v1 (and unversioned object plugins): the return value is ignored,
   * exactly as before. v2: validate it, render it, and fail the step on "fail".
   * Runs after onAfterStep, so a returned "fail" behaves like a throw.
   */
  private handleReturn(plugin: BoltPlugin, ref: string, step: string, returned: unknown): void {
    const logger = this.opts.logger;
    if (plugin.apiVersion !== 2) {
      if (returned !== undefined) {
        logger?.writeRaw(
          `[DEBUG] ${ref} (plugin API v1) returned a value; ignored. Declare apiVersion: 2 to report results.\n`,
        );
      }
      return;
    }
    const { result, warnings } = validateHandlerResult(returned, ref);
    for (const warning of warnings) logger?.warn(warning);
    this.opts.onStepResult?.({ ...result, ref, step });

    if (result.summary) {
      // The [WARN] prefix already says "warn"; other statuses keep the status word.
      if (result.status === "warn") logger?.warn(`${ref}: ${result.summary}`);
      else if (result.status !== "fail")
        logger?.step_detail(`${ref}: ${result.status} — ${result.summary}`);
    }
    for (const d of result.diagnostics ?? []) {
      const where = d.file ? ` (${d.file}${d.line !== undefined ? `:${d.line}` : ""})` : "";
      const text = `${ref}: ${d.code ? `${d.code}: ` : ""}${d.message}${where}${d.fix ? ` Fix: ${d.fix}` : ""}`;
      if (d.level === "error") logger?.error(text);
      else if (d.level === "warn") logger?.warn(text);
      else logger?.info(text);
    }
    for (const n of result.next ?? []) {
      logger?.step_detail(`next: ${n.ref}${n.reason ? ` — ${n.reason}` : ""}`);
    }

    if (result.status === "fail") {
      const reason =
        result.summary ?? result.diagnostics?.find((d) => d.level === "error")?.message;
      throw new BoltStepError(
        "HANDLER_FAILED",
        reason
          ? `${ref} returned status "fail": ${reason}`
          : `${ref} returned status "fail" without summary`,
        result.diagnostics ?? [],
      );
    }
  }

  /** Core-side AI rejection for {@link AI_PATH_RESTRICTED} handlers. */
  private assertAiPathInProject(ref: string, key: string, value: string | undefined): void {
    if (!value) return; // the handler reports the missing param
    const root = this.opts.configDir ?? process.cwd();
    try {
      safePath(value, root);
    } catch (error) {
      // Fail closed: any resolution failure (symlink loop, permission, ...) rejects.
      const reason = error instanceof Error ? error.message : String(error);
      const what = reason.includes("cannot be resolved")
        ? `cannot be verified to be inside the project directory "${root}" (${reason})`
        : `is outside the project directory "${root}" (${reason})`;
      throw new BoltStepError(
        "AI_FORBIDDEN",
        `${ref}: ${key} "${value}" ${what}; AI invocations may only use paths inside the project. Fix: use a path under the project directory, or use a run: step for paths outside it.`,
      );
    }
  }

  private async shell(cmd: string, continueOnError = false): Promise<void> {
    const result = await this.runtime.shell(cmd);
    if (result.exitCode !== 0 && !continueOnError) {
      throw new Error(`Command failed (exit ${result.exitCode}): ${cmd}`);
    }
  }

  private async runLocalAction(actionPath: string, params: Record<string, string>): Promise<void> {
    const runFile = resolveLocalAction(actionPath);
    const env: Record<string, string> = { ...(process.env as any) };
    for (const [k, v] of Object.entries(params)) {
      env[`BOLT_INPUT_${k.toUpperCase()}`] = v;
    }
    const result = await this.runtime.spawn([runFile], { env });
    if (result.exitCode !== 0) {
      throw new Error(`Local action failed (exit ${result.exitCode}): ${actionPath}`);
    }
  }
}
