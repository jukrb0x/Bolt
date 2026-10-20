import { safePath } from "./plugins/path-guard";
import type { BoltConfig } from "./config";
import { Logger } from "./logger";
import { buildRegistry, type PluginRegistry } from "./plugin-registry";
import {
  assessCapabilities,
  CapabilitySelectionError,
  isCapabilityRef,
} from "./capability-selection";
import { normalizeTextualBooleans, type BoltPlugin, type BoltPluginContext } from "./plugin";
import { createRuntime, type Runtime } from "./runtime";
import type { SpawnOptions } from "./runtime/types";
import { builtinPlugins } from "./plugins";
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
import { refreshLoadedPlugins } from "./plugin-cache";
import {
  BoltStepError,
  validateHandlerResult,
  type HandlerResult,
  type StampedEvent,
} from "./handler-result";
import { issueFromStepError, type SessionError, type SessionHooks } from "./session";

/** Outcome of one plugin step whose plugin declared API v2. */
export interface StepResult extends HandlerResult {
  ref: string;
  step: string;
}

const BUILTINS = new Set<BoltPlugin>(builtinPlugins);

/** The param schema for a handler: its manifest schema, or the built-in table. */
function stepParamSchema(plugin: BoltPlugin, operation: string): ZodTypeAny | undefined {
  const declared = plugin.manifest?.handlers[operation]?.params as ZodTypeAny | undefined;
  if (declared) return declared;
  // Only the real built-in object, not a user plugin that shadows the namespace.
  if (!BUILTINS.has(plugin)) return undefined;
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
  /** Optional project session. Writes must not change the run outcome. */
  session?: SessionHooks;
  /**
   * Human `bolt run` and `--simulate` write content-addressed manifests for plugins
   * this run loaded. Read-only commands leave it unset.
   */
  refreshPluginCache?: boolean;
}

/**
 * Path params that an AI invocation may only point inside the Bolt project
 * directory (`configDir`), after resolving symlinks (fail closed). Human runs
 * are not restricted here: git/info and svn/info warn; fs/* and json/* keep
 * main's literal check.
 *
 * Plugin `aiPathRoots` rows are merged into this table before an AI handler
 * runs. They do not replace these rows.
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

interface AiPathRule {
  params: string[];
  root: string;
  label: string;
}

interface AiPathRootEntry {
  refs: string[];
  params: string[];
  root: string;
  label: string;
}

function isAiPathRootEntry(value: unknown): value is AiPathRootEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as AiPathRootEntry;
  return (
    Array.isArray(entry.refs) &&
    entry.refs.every((ref) => typeof ref === "string") &&
    Array.isArray(entry.params) &&
    entry.params.every((param) => typeof param === "string") &&
    typeof entry.root === "string" &&
    typeof entry.label === "string"
  );
}

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
  /** AI path rules for this run: core rows plus plugin `aiPathRoots`, built once. */
  private aiConfinement?: Map<string, AiPathRule[]>;
  /** Set when a task fails and the plan stops. */
  failedTask?: string;
  /** Last failed leaf, after step context is applied. `ref` is the session step ref. */
  failedStep?: { ref: string; index: number; error: SessionError };
  private runtime: Runtime;
  private events: RunEvents;
  private stepIndex = 0;
  private stepResult?: HandlerResult;

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
      ...builtinPlugins,
    ]);
    for (const warning of this.registry.warnings) this.opts.logger?.warn(warning);
    if (this.opts.refreshPluginCache) {
      const notes = await refreshLoadedPlugins(this.registry, this.cfg.plugins);
      for (const note of notes) this.opts.logger?.warn(note);
    }
    const stale = staleAiContextWarning(this.opts.configDir ?? process.cwd());
    if (stale) this.opts.logger?.warn(stale);
    await this.initPlugins();
    return this.registry;
  }

  /** onInit for plugins already in the registry. Does not load or compile anything. */
  private async initPlugins(): Promise<void> {
    if (!this.registry) return;
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
  }

  /**
   * Run a plan that was already resolved and hashed. Does not call ensureRegistry,
   * so it never compiles, installs, or imports from a source directory.
   */
  async executeResolved(plan: RunPlan, registry: PluginRegistry): Promise<void> {
    this.registry = registry;
    await this.initPlugins();
    await this.executePlan(plan);
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
      const taskStepStart = this.stepIndex;
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
          this.failedTask = task.name;
          await notifier.fire({ kind: "complete", ctx, duration: Date.now() - startTime, results });
          throw error;
        }
        this.opts.logger?.warn(`"${task.name}" failed but is in continue_on_fail — continuing`);
        this.skipUnexecutedTaskLeaves(task.nodes, taskStepStart);
      }
    }

    await notifier.fire({ kind: "complete", ctx, duration: Date.now() - startTime, results });
  }

  /** After a failed task with continue_on_fail, align stepIndex with the full plan. */
  private skipUnexecutedTaskLeaves(nodes: PlanNode[], taskStepStart: number): void {
    let leafIndex = taskStepStart;
    const walk = (walkNodes: PlanNode[]) => {
      for (const node of walkNodes) {
        if (node.kind === "call") {
          walk(node.nodes);
          continue;
        }
        if (leafIndex >= this.stepIndex) {
          try {
            this.opts.session?.skip(leafIndex);
          } catch {
            /* a session write must not fail the run */
          }
        }
        leafIndex++;
      }
    };
    walk(nodes);
    this.stepIndex = leafIndex;
  }

  private async executeNodes(nodes: PlanNode[], trail: string[] = []): Promise<void> {
    for (const node of nodes) {
      if (node.kind === "call") {
        this.opts.onStep?.(`call:${node.name}`);
        await this.executeNodes(node.nodes, [...trail, node.name]);
        continue;
      }
      const index = this.stepIndex++;
      this.stepResult = undefined;
      try {
        this.opts.session?.begin(index);
      } catch {
        /* a session write must not fail the run */
      }
      try {
        const result = await this.executeStep(node, trail);
        try {
          this.opts.session?.ok(index, result);
        } catch {
          /* a session write must not fail the run */
        }
      } catch (error) {
        const label = node.kind === "run" ? `run: ${node.command}` : node.ref;
        const wrapped = withStepContext(error, [...trail, label].join(" > "));
        const stepError = issueFromStepError(wrapped);
        this.failedStep = {
          ref: node.kind === "uses" ? node.ref : "",
          index,
          error: stepError,
        };
        try {
          const recorded = this.opts.session?.fail(index, stepError, this.stepResult);
          if (recorded) this.failedStep = recorded;
        } catch {
          /* a session write must not fail the run */
        }
        throw wrapped;
      }
    }
  }

  private async executeStep(
    node: Exclude<PlanNode, { kind: "call" }>,
    trail: string[],
  ): Promise<HandlerResult | undefined> {
    if (node.kind === "run") {
      this.opts.onStep?.(node.command);
      this.opts.logger?.step_detail(`run: ${node.command}`);
      if (!this.opts.dryRun) await this.shell(node.command, node.continueOnError);
      return;
    }

    if (node.ref.startsWith("./") || node.ref.startsWith("../")) {
      this.opts.onStep?.(node.ref);
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

    const ref = isCapabilityRef(node.ref) ? this.bindCapability(node.ref) : node.ref;
    this.opts.onStep?.(ref);
    const slash = ref.indexOf("/");
    if (slash === -1) {
      throw new Error(`Invalid uses format (expected "ns/op"): "${ref}"`);
    }
    const namespace = ref.slice(0, slash);
    const operation = ref.slice(slash + 1);
    if (namespace === "task") {
      throw new Error(`legacy task reference "${ref}"; replace with "call: ${operation}"`);
    }

    const paramText = Object.entries(node.params)
      .map(([key, value]) => `${key}=${value}`)
      .join("  ");
    const label = node.ref === ref ? ref : `${node.ref} -> ${ref}`;
    this.opts.logger?.step_detail(`${label}${paramText ? `  ${paramText}` : ""}`);

    const registry = await this.ensureRegistry();
    const plugin = registry.get(namespace);
    if (!plugin) throw new Error(`Unknown plugin namespace: "${namespace}"`);
    const handler = plugin.handlers[operation];
    if (!handler) throw new Error(`Unknown op "${operation}" in plugin "${namespace}"`);

    const params = parseStepParams(plugin, ref, operation, node.params);
    if (this.opts.aiInvocation) {
      for (const rule of this.confinement().get(ref) ?? []) {
        for (const key of rule.params) {
          this.assertAiPathInRoot(ref, key, params[key], rule.root, rule.label);
        }
      }
    }
    const step = [...trail, ref].join(" > ");
    // One context object per step, shared by the hooks and the handler as before.
    const scope = this.events.scope(ref, step);
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
    return this.handleReturn(plugin, ref, step, returned);
  }

  /** Bind `uses: <capability>` to the selected handler before plugins are loaded. */
  private bindCapability(ref: string): string {
    const report = assessCapabilities(this.cfg, this.opts.configDir ?? process.cwd(), {
      requested: [ref],
    });
    const hit = report.resolved.find((item) => item.capability === ref);
    if (!hit) {
      const issue = report.errors.find((item) => item.capability === ref) ?? report.errors[0];
      throw new CapabilitySelectionError(
        issue
          ? `${issue.path}: ${issue.message}`
          : `CAPABILITY_MISSING: no handler provides "${ref}".`,
      );
    }
    return hit.ref;
  }

  /**
   * Plugin API v1 (and unversioned object plugins): the return value is ignored,
   * exactly as before. v2: validate it, render it, and fail the step on "fail".
   * Runs after onAfterStep, so a returned "fail" behaves like a throw.
   */
  private handleReturn(
    plugin: BoltPlugin,
    ref: string,
    step: string,
    returned: unknown,
  ): HandlerResult | undefined {
    const logger = this.opts.logger;
    if (plugin.apiVersion !== 2) {
      if (returned !== undefined) {
        logger?.writeRaw(
          `[DEBUG] ${ref} (plugin API v1) returned a value; ignored. Declare apiVersion: 2 to report results.\n`,
        );
      }
      return undefined;
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
      this.stepResult = result;
      throw new BoltStepError(
        "HANDLER_FAILED",
        reason
          ? `${ref} returned status "fail": ${reason}`
          : `${ref} returned status "fail" without summary`,
        result.diagnostics ?? [],
      );
    }
    return result;
  }

  /**
   * Core {@link AI_PATH_RESTRICTED} rows plus every plugin `aiPathRoots` result.
   * Cached for the run, before the handler. An empty `root` fails closed.
   */
  private confinement(): Map<string, AiPathRule[]> {
    if (this.aiConfinement) return this.aiConfinement;
    const table = new Map<string, AiPathRule[]>();
    const configDir = this.opts.configDir ?? process.cwd();
    for (const [ref, params] of AI_PATH_RESTRICTED) {
      table.set(ref, [{ params, root: configDir, label: "project directory" }]);
    }
    const input = { cfg: this.cfg, configDir };
    for (const ns of this.registry?.listNamespaces() ?? []) {
      const plugin = this.registry?.get(ns);
      if (!plugin || typeof plugin.aiPathRoots !== "function") continue;
      const returned = plugin.aiPathRoots(input);
      if (!Array.isArray(returned)) continue;
      for (const entry of returned) {
        if (!isAiPathRootEntry(entry)) continue;
        for (const ref of entry.refs) {
          const rules = table.get(ref) ?? [];
          rules.push({ params: entry.params, root: entry.root, label: entry.label });
          table.set(ref, rules);
        }
      }
    }
    this.aiConfinement = table;
    return table;
  }

  /** Symlink-resolved confinement. `label` is the directory the message names. */
  private assertAiPathInRoot(
    ref: string,
    key: string,
    value: string | undefined,
    root: string,
    label: string,
  ): void {
    if (!value) return; // the handler reports the missing param
    if (!root) {
      throw new BoltStepError(
        "AI_FORBIDDEN",
        `${ref}: ${key} "${value}" cannot be verified to be inside the ${label}. Fix: declare a path root for this handler, or use a run: step.`,
      );
    }
    try {
      safePath(value, root);
    } catch (error) {
      // Fail closed: any resolution failure (symlink loop, permission, ...) rejects.
      const reason = error instanceof Error ? error.message : String(error);
      const what = reason.includes("cannot be resolved")
        ? `cannot be verified to be inside the ${label} "${root}" (${reason})`
        : `is outside the ${label} "${root}" (${reason})`;
      const inside = label === "project directory" ? "the project" : `the ${label}`;
      const under = label === "project directory" ? "the project directory" : `the ${label}`;
      throw new BoltStepError(
        "AI_FORBIDDEN",
        `${ref}: ${key} "${value}" ${what}; AI invocations may only use paths inside ${inside}. Fix: use a path under ${under}, or use a run: step for paths outside it.`,
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
