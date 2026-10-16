/**
 * bolt doctor / bolt why: fan-out, aggregation, and why log resolution.
 * Domain strings (cook logs, ini section names) stay in plugins.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import os from "os";
import path from "path";
import { capabilityKind, resolveCapabilitySelection } from "./capability-selection";
import type { BoltConfig } from "./config";
import { issue, type JsonIssue } from "./json-envelope";
import { validateHandlerResult, type HandlerResult } from "./handler-result";
import type { BoltPluginContext } from "./plugin";
import { PluginRegistry, buildRegistry, type CapabilityMatch } from "./plugin-registry";
import { builtinPlugins } from "./plugins";
import { createRuntime } from "./runtime";
import { Logger } from "./logger";

export type CheckLevel = "pass" | "info" | "warn" | "error";
export type DiagnosticLevel = "info" | "warn" | "error";

export interface ObserveSpan {
  start_line?: number;
  end_line?: number;
}

export interface DoctorCheck {
  id: string;
  level: CheckLevel;
  message: string;
  fix?: string;
  source: string;
  path?: string;
  span?: ObserveSpan;
}

export interface DoctorSummary {
  pass: number;
  info: number;
  warn: number;
  error: number;
}

export interface WhyDiagnostic {
  code?: string;
  level: DiagnosticLevel;
  message: string;
  fix?: string;
  source: string;
  path?: string;
  span?: ObserveSpan;
}

export interface WhyLog {
  path: string;
  kind: "run" | "explicit";
  /** Basename of a `.bolt/logs/bolt_*.log` without `.log`, or the run id the user passed. */
  run_id: string | null;
}

const CHECK_LEVELS = new Set<CheckLevel>(["pass", "info", "warn", "error"]);

/** Line the run logger writes when a step fails (`Logger.fail`). */
const FAILED_STEP = /^<< .+?: FAILED \(/m;

export function userHome(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

export async function loadFanoutRegistry(
  cfg: BoltConfig,
  configDir: string,
): Promise<PluginRegistry> {
  return buildRegistry(cfg, configDir, [...builtinPlugins], { home: userHome() });
}

/**
 * Fan-out order: built-in list order, then `plugins[]` order, then any other
 * built handler by ref. Within a plugin, manifest handler order.
 */
export function fanOutRefs(
  registry: PluginRegistry,
  cfg: { plugins?: Array<{ namespace: string; path?: string }> },
  tag: string,
): CapabilityMatch[] {
  const matches = registry.findByCapability(tag);
  const byRef = new Map(matches.map((match) => [match.ref, match]));
  const ordered: CapabilityMatch[] = [];
  const used = new Set<string>();
  const take = (namespace: string) => {
    const handlers = registry.get(namespace)?.manifest?.handlers ?? {};
    for (const name of Object.keys(handlers)) {
      const ref = `${namespace}/${name}`;
      const hit = byRef.get(ref);
      if (!hit || used.has(ref)) continue;
      used.add(ref);
      ordered.push(hit);
    }
  };
  const builtinNamespaces = new Set<string>();
  for (const plugin of builtinPlugins) {
    builtinNamespaces.add(plugin.namespace);
    take(plugin.namespace);
  }
  const seen = new Set<string>();
  for (const entry of cfg.plugins ?? []) {
    if (seen.has(entry.namespace)) continue;
    seen.add(entry.namespace);
    if (builtinNamespaces.has(entry.namespace) && !entry.path) continue;
    take(entry.namespace);
  }
  const rest = matches
    .filter((match) => !used.has(match.ref))
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  return [...ordered, ...rest];
}

/** Exact id, or a dot-segment prefix (`ue.ddc` matches `ue.ddc.installed_vs_source`). */
export function matchesOnly(id: string, only: string): boolean {
  return id === only || id.startsWith(`${only}.`);
}

export function summarizeChecks(checks: readonly DoctorCheck[]): DoctorSummary {
  const summary: DoctorSummary = { pass: 0, info: 0, warn: 0, error: 0 };
  for (const check of checks) summary[check.level] += 1;
  return summary;
}

export function pickPrimary<T extends { level: string }>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  const error = items.find((item) => item.level === "error");
  return error ?? items[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function warningIssue(text: string): JsonIssue {
  const idx = text.indexOf(": ");
  const code = idx > 0 ? text.slice(0, idx) : "";
  if (code && /^[A-Z][A-Z0-9_]*$/.test(code)) return issue(code, text.slice(idx + 2));
  return issue("RESULT_WARNING", text);
}

function copySpan(value: unknown): ObserveSpan | undefined {
  if (!isRecord(value)) return undefined;
  const span: ObserveSpan = {};
  if (typeof value.start_line === "number" && Number.isFinite(value.start_line)) {
    span.start_line = value.start_line;
  }
  if (typeof value.end_line === "number" && Number.isFinite(value.end_line)) {
    span.end_line = value.end_line;
  }
  return span.start_line === undefined && span.end_line === undefined ? undefined : span;
}

function mapAuthoredCheck(
  ref: string,
  item: unknown,
  index: number,
  warnings: JsonIssue[],
): DoctorCheck | undefined {
  if (!isRecord(item)) {
    warnings.push(
      issue("DOCTOR_CHECK_INVALID", `${ref} checks[${index}] is not an object; skipped.`),
    );
    return undefined;
  }
  let id = "";
  if (typeof item.id === "string" && item.id.length > 0) id = item.id;
  else {
    warnings.push(issue("DOCTOR_CHECK_INVALID", `${ref} checks[${index}] is missing id.`));
    id = "unknown";
  }
  let level: CheckLevel;
  if (typeof item.level === "string" && CHECK_LEVELS.has(item.level as CheckLevel)) {
    level = item.level as CheckLevel;
  } else {
    level = "error";
    warnings.push(
      issue("DOCTOR_CHECK_LEVEL", `${ref} checks[${index}] has no usable level; counted as error.`),
    );
  }
  const message = typeof item.message === "string" ? item.message : "";
  if (typeof item.message !== "string") {
    warnings.push(issue("DOCTOR_CHECK_INVALID", `${ref} checks[${index}] is missing message.`));
  }
  const check: DoctorCheck = { id, level, message, source: ref };
  if (typeof item.fix === "string" && item.fix.length > 0) check.fix = item.fix;
  if (typeof item.path === "string" && item.path.length > 0) check.path = item.path;
  const span = copySpan(item.span);
  if (span) check.span = span;
  return check;
}

/** Prefer `data.checks`. Otherwise map EXT-1 diagnostics (no `pass` row). */
export function checksFromHandler(
  ref: string,
  result: HandlerResult,
): { checks: DoctorCheck[]; warnings: JsonIssue[] } {
  const warnings: JsonIssue[] = [];
  const data = result.data;
  if (isRecord(data) && Array.isArray(data.checks)) {
    const checks: DoctorCheck[] = [];
    data.checks.forEach((item, index) => {
      const mapped = mapAuthoredCheck(ref, item, index, warnings);
      if (mapped) checks.push(mapped);
    });
    return { checks, warnings };
  }
  const checks: DoctorCheck[] = [];
  for (const diagnostic of result.diagnostics ?? []) {
    if (
      diagnostic.level !== "error" &&
      diagnostic.level !== "warn" &&
      diagnostic.level !== "info"
    ) {
      continue;
    }
    const check: DoctorCheck = {
      id: diagnostic.code ?? "diagnostic",
      level: diagnostic.level,
      message: diagnostic.message,
      source: ref,
    };
    if (!diagnostic.code) {
      warnings.push(
        issue("DOCTOR_CHECK_INVALID", `${ref} diagnostic is missing code; id is "diagnostic".`),
      );
    }
    if (diagnostic.fix) check.fix = diagnostic.fix;
    if (diagnostic.file) check.path = diagnostic.file;
    if (typeof diagnostic.line === "number") check.span = { start_line: diagnostic.line };
    checks.push(check);
  }
  return { checks, warnings };
}

export function diagnosticsFromHandler(ref: string, result: HandlerResult): WhyDiagnostic[] {
  const out: WhyDiagnostic[] = [];
  for (const diagnostic of result.diagnostics ?? []) {
    const item: WhyDiagnostic = {
      level: diagnostic.level,
      message: diagnostic.message,
      source: ref,
    };
    if (diagnostic.code) item.code = diagnostic.code;
    if (diagnostic.fix) item.fix = diagnostic.fix;
    if (diagnostic.file) item.path = diagnostic.file;
    if (typeof diagnostic.line === "number") item.span = { start_line: diagnostic.line };
    out.push(item);
  }
  return out;
}

export function fanOutCapabilityWarning(
  map: Record<string, string> | undefined,
  tag: string,
): JsonIssue | undefined {
  const keys = Object.keys(map ?? {}).filter((key) => capabilityKind(key) === "fan-out");
  if (!keys.includes(tag)) return undefined;
  const report = resolveCapabilitySelection({
    map: map ?? {},
    index: { registry: new PluginRegistry(), built: [], unbuilt: [] },
  });
  const message = report.warnings[0];
  if (!message) return undefined;
  return issue("CAPABILITY_WARNING", message);
}

export interface FanoutCall {
  ref: string;
  result: HandlerResult;
  warnings: JsonIssue[];
}

export async function invokeFanOut(
  registry: PluginRegistry,
  matches: readonly CapabilityMatch[],
  ctx: BoltPluginContext,
  params: Record<string, string>,
): Promise<{ calls: FanoutCall[]; failure?: string }> {
  const calls: FanoutCall[] = [];
  for (const match of matches) {
    const plugin = registry.get(match.namespace);
    const handler = plugin?.handlers[match.handler];
    if (!plugin || !handler) {
      return { calls, failure: `Unknown handler "${match.ref}".` };
    }
    let returned: unknown;
    try {
      returned = await handler(params, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { calls, failure: message };
    }
    if (plugin.apiVersion !== 2) {
      calls.push({ ref: match.ref, result: { status: "ok" }, warnings: [] });
      continue;
    }
    try {
      const validated = validateHandlerResult(returned, match.ref);
      const warnings = validated.warnings.map(warningIssue);
      for (const warning of validated.warnings) ctx.logger.warn(warning);
      calls.push({ ref: match.ref, result: validated.result, warnings });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { calls, failure: message };
    }
  }
  return { calls };
}

export function observeContext(cfg: BoltConfig, configDir: string): BoltPluginContext {
  return {
    cfg,
    configDir,
    dryRun: false,
    logger: new Logger({ sink: (line) => process.stderr.write(`${line}\n`) }),
    runtime: createRuntime(),
    emit: () => {},
  };
}

export function doctorExit(input: { fix: boolean; summary: DoctorSummary; failure?: string }): {
  exitCode: number;
  errors: JsonIssue[];
} {
  if (input.failure) {
    return {
      exitCode: 1,
      errors: [issue("RUN_FAILED", input.failure)],
    };
  }
  if (input.fix && input.summary.error > 0) {
    return {
      exitCode: 1,
      errors: [
        issue(
          "DOCTOR_FAILED",
          `doctor found ${input.summary.error} error check(s).`,
          "bolt doctor --json",
        ),
      ],
    };
  }
  return { exitCode: 0, errors: [] };
}

export function whyExit(input: {
  fail: boolean;
  diagnostics: readonly WhyDiagnostic[];
  failure?: string;
}): { exitCode: number; errors: JsonIssue[] } {
  if (input.failure) {
    return { exitCode: 1, errors: [issue("RUN_FAILED", input.failure)] };
  }
  const error = input.diagnostics.find((item) => item.level === "error");
  if (input.fail && error) {
    return {
      exitCode: 1,
      errors: [issue("WHY_FAILED", error.message, error.fix ?? "bolt why --json")],
    };
  }
  return { exitCode: 0, errors: [] };
}

export function noDoctorProviders(): JsonIssue {
  return issue("DOCTOR_NO_PROVIDERS", "No built handler provides doctor.", "bolt plugin build ue");
}

export function noDiagnoseProviders(): JsonIssue {
  return issue("WHY_NO_PROVIDERS", "No built handler provides diagnose.", "bolt plugin build ue");
}

export function whyNoSource(message: string): JsonIssue {
  return issue("WHY_NO_SOURCE", message, "bolt why --log=<path>");
}

function logsDir(configDir: string): string {
  return path.join(configDir, ".bolt", "logs");
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Run id embedded in a log path, when the file is `bolt_*.log` under `.bolt/logs`. */
export function runIdFromLogPath(configDir: string, file: string): string | null {
  const dir = logsDir(configDir);
  if (!isInside(dir, file)) return null;
  const name = path.basename(file);
  if (!name.startsWith("bolt_") || !name.endsWith(".log")) return null;
  return name.slice(0, -".log".length);
}

function safeRunId(runId: string): boolean {
  return runId.length > 0 && !runId.includes("/") && !runId.includes("\\") && !runId.includes("..");
}

function findRunLog(configDir: string, runId: string): string | undefined {
  if (!safeRunId(runId)) return undefined;
  const dir = logsDir(configDir);
  const candidates = [
    path.join(dir, runId),
    path.join(dir, `${runId}.log`),
    path.join(dir, `bolt_${runId}.log`),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Newest failed `bolt_*.log` under `.bolt/logs`.
 * ponytail: reads every matching log until one contains a failed step line.
 * A run index would avoid the scan once logs are indexed.
 */
export function mostRecentFailedRun(
  configDir: string,
): { path: string; run_id: string } | undefined {
  const dir = logsDir(configDir);
  if (!existsSync(dir)) return undefined;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return undefined;
  }
  const logs = names
    .filter((name) => name.startsWith("bolt_") && name.endsWith(".log"))
    .sort()
    .reverse();
  for (const name of logs) {
    const full = path.join(dir, name);
    try {
      if (!statSync(full).isFile()) continue;
      if (!FAILED_STEP.test(readFileSync(full, "utf8"))) continue;
    } catch {
      continue;
    }
    return { path: full, run_id: name.slice(0, -".log".length) };
  }
  return undefined;
}

/**
 * Log source priority: `--log` (cwd-relative), then the run id, then the newest
 * failed `.bolt/logs/bolt_*.log`. A missing file at any step is no source.
 */
export function resolveWhyLog(opts: {
  configDir: string;
  cwd?: string;
  logFlag?: string;
  runId?: string;
}): { ok: true; log: WhyLog } | { ok: false; message: string } {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.logFlag !== undefined) {
    const raw = opts.logFlag.trim();
    if (!raw) return { ok: false, message: "--log needs a file path." };
    const abs = path.resolve(cwd, raw);
    try {
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        return { ok: false, message: `Log file not found: ${abs}` };
      }
    } catch {
      return { ok: false, message: `Log file not found: ${abs}` };
    }
    return {
      ok: true,
      log: { path: abs, kind: "explicit", run_id: runIdFromLogPath(opts.configDir, abs) },
    };
  }
  if (opts.runId !== undefined && opts.runId !== "") {
    const found = findRunLog(opts.configDir, opts.runId);
    if (!found) {
      return { ok: false, message: `No log for run id "${opts.runId}" under .bolt/logs.` };
    }
    return { ok: true, log: { path: found, kind: "run", run_id: opts.runId } };
  }
  const recent = mostRecentFailedRun(opts.configDir);
  if (!recent) {
    return {
      ok: false,
      message: "No log source. Pass --log, a run id, or produce a failed run under .bolt/logs.",
    };
  }
  return { ok: true, log: { path: recent.path, kind: "run", run_id: recent.run_id } };
}

export function diagnoseParams(log: WhyLog): Record<string, string> {
  const params: Record<string, string> = { log: log.path, kind: log.kind };
  if (log.run_id) params.run_id = log.run_id;
  return params;
}

export function filterChecks(
  checks: DoctorCheck[],
  only: string | undefined,
): { checks: DoctorCheck[]; unknown: boolean } {
  if (only === undefined) return { checks, unknown: false };
  const matched = checks.filter((check) => matchesOnly(check.id, only));
  return { checks: matched, unknown: matched.length === 0 };
}
