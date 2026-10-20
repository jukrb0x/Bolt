/**
 * Project-local run sessions (BOLT-A3-DASH A3a).
 *
 * Files live at `<project>/.bolt/sessions/<session_id>.json` only.
 * `list` / `show` reclaim a `running` record when its pid is gone, or when it
 * has no pid and the file is older than 2 hours. Records older than 7 days
 * are removed on that read. Dry-run does not write a session; a record with
 * `preview: true` stays out of the default list.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { BoltStepError, type HandlerResult } from "./handler-result";
import { issue, type JsonIssue } from "./json-envelope";
import { onProcessInterrupt } from "./process-guards";

export const SESSION_RETAIN_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_RECLAIM_MS = 2 * 60 * 60 * 1000;

const ARG_LIMIT = 160;
const ARG_COUNT_LIMIT = 32;
const SECRET_FLAG = /(^|[-_])(token|password|passwd|secret|api[-_]?key|access[-_]?key|key)($|[-_])/i;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

export type SessionStatus = "running" | "ok" | "failed" | "interrupted";
export type StepStatus = "pending" | "running" | "ok" | "failed" | "skipped" | "interrupted";
export type SessionEntry = "human" | "agent" | "script";

export interface SessionError {
  code: string;
  message: string;
  hint?: string;
}

export interface SessionStep {
  ref: string;
  index: number;
  status: StepStatus;
  /** Inspect display node. Same object shape `bolt inspect --json` puts on `tasks[].nodes`. */
  node: unknown;
  started_at?: string;
  finished_at?: string;
  error?: SessionError;
  result?: Record<string, unknown>;
}

export interface SessionRecord {
  session_id: string;
  started_at: string;
  finished_at?: string;
  cwd: string;
  config: { path: string };
  invocation: {
    argv_summary: string[];
    entry: SessionEntry;
    pid?: number;
  };
  names: string[];
  plan_hash?: string;
  status: SessionStatus;
  steps: SessionStep[];
  log_run_id?: string;
  preview?: boolean;
}

export interface SessionHooks {
  begin(index: number): void;
  ok(index: number, result?: HandlerResult): void;
  fail(
    index: number,
    error: SessionError,
    result?: HandlerResult,
  ): { ref: string; index: number; error: SessionError };
}

export function sessionsDir(configDir: string): string {
  return path.join(configDir, ".bolt", "sessions");
}

function clip(token: string): string {
  if (token.length <= ARG_LIMIT) return token;
  return `${token.slice(0, ARG_LIMIT)}…`;
}

/** Mask secret flag values and truncate. Never returns the raw argv string. */
export function summarizeArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (out.length >= ARG_COUNT_LIMIT) {
      out.push("…");
      break;
    }
    const token = argv[i] ?? "";
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      if (SECRET_FLAG.test(name)) {
        if (eq === -1) {
          out.push(clip(token));
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith("-")) {
            out.push("***");
            i++;
          }
        } else {
          out.push(clip(`--${name}=***`));
        }
        continue;
      }
    }
    out.push(clip(token));
  }
  return out;
}

export function invocationEntry(
  agent: boolean,
  stdoutIsTTY = Boolean(process.stdout.isTTY),
): SessionEntry {
  if (agent) return "agent";
  if (!stdoutIsTTY) return "script";
  return "human";
}

/** Copy a runner/handler issue. Does not read logs. */
export function issueFromStepError(error: unknown): SessionError {
  if (error instanceof BoltStepError) {
    const hint = error.diagnostics.find((item) => item.fix)?.fix;
    return hint
      ? { code: error.code, message: error.message, hint }
      : { code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "RUN_FAILED", message };
}

/** Handler fields already returned to the caller. No stderr, no unknown keys. */
export function publicHandlerResult(
  result: HandlerResult | undefined,
): Record<string, unknown> | undefined {
  if (!result) return undefined;
  const out: Record<string, unknown> = { status: result.status };
  if (result.summary !== undefined) out.summary = result.summary;
  if (result.data !== undefined) out.data = result.data;
  if (result.artifacts !== undefined) out.artifacts = result.artifacts;
  if (result.diagnostics !== undefined) out.diagnostics = result.diagnostics;
  if (result.next !== undefined) out.next = result.next;
  if (result.schema !== undefined) out.schema = result.schema;
  return out;
}

/** Depth-first leaves, same order as `Runner` execution. Call nodes are wrappers. */
export function stepsFromPlanTasks(
  tasks: Array<{ name: string; nodes: unknown[] }>,
): SessionStep[] {
  const steps: SessionStep[] = [];
  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const rec = node as { kind?: string; nodes?: unknown[]; ref?: string; command?: string };
      if (rec.kind === "call" && Array.isArray(rec.nodes)) {
        walk(rec.nodes);
        continue;
      }
      const ref = rec.kind === "run" ? String(rec.command ?? "run") : String(rec.ref ?? "");
      steps.push({ ref, index: steps.length, status: "pending", node });
    }
  };
  for (const task of tasks) walk(task.nodes ?? []);
  return steps;
}

function newSessionId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rand = Math.random().toString(16).slice(2, 8);
  return `bolt_${stamp}_${rand}`;
}

export function safeSessionId(id: string): boolean {
  return SAFE_ID.test(id);
}

// ponytail: kill(pid, 0) treats a reused pid as alive. Upgrade: compare process start time.
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}


/**
 * Persist session JSON via tmp + rename. Must not unlink the sole `.json` first:
 * on Unix rename replaces atomically; on Windows fall back to overwrite-copy
 * without deleting the good file ahead of time.
 */
function writeSessionAtomic(file: string, body: string): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, body);
  try {
    renameSync(tmp, file);
  } catch {
    // Windows cannot rename over an existing file. Copy over (keeps dest present), then drop tmp.
    copyFileSync(tmp, file);
    rmSync(tmp, { force: true });
  }
}

export class RunSession implements SessionHooks {
  readonly file: string;
  record: SessionRecord;
  private unhook?: () => void;

  constructor(file: string, record: SessionRecord) {
    this.file = file;
    this.record = record;
  }

  attach(unhook: () => void): void {
    this.unhook = unhook;
  }

  private detach(): void {
    this.unhook?.();
    this.unhook = undefined;
  }

  begin(index: number): void {
    const step = this.record.steps[index];
    if (!step || this.record.status !== "running") return;
    step.status = "running";
    step.started_at = new Date().toISOString();
    this.write();
  }

  ok(index: number, result?: HandlerResult): void {
    const step = this.record.steps[index];
    if (!step || this.record.status !== "running") return;
    step.status = "ok";
    step.finished_at = new Date().toISOString();
    const pub = publicHandlerResult(result);
    if (pub) step.result = pub;
    this.write();
  }

  fail(
    index: number,
    error: SessionError,
    result?: HandlerResult,
  ): { ref: string; index: number; error: SessionError } {
    const step = this.record.steps[index];
    const ref = step?.ref ?? "";
    if (step && this.record.status === "running") {
      step.status = "failed";
      step.finished_at = new Date().toISOString();
      step.error = error;
      const pub = publicHandlerResult(result);
      if (pub) step.result = pub;
      this.write();
    }
    return { ref, index, error };
  }

  finish(status: "ok" | "failed"): void {
    if (this.record.status !== "running") {
      this.detach();
      return;
    }
    this.record.status = status;
    this.record.finished_at = new Date().toISOString();
    this.write();
    this.detach();
  }

  interrupt(): void {
    if (this.record.status !== "running") {
      this.detach();
      return;
    }
    const now = new Date().toISOString();
    this.record.status = "interrupted";
    this.record.finished_at = now;
    for (const step of this.record.steps) {
      if (step.status === "running") {
        step.status = "interrupted";
        step.finished_at = now;
      }
    }
    this.write();
    this.detach();
  }

  write(): void {
    writeSessionAtomic(this.file, `${JSON.stringify(this.record, null, 2)}\n`);
  }
}

export function openRunSession(opts: {
  configDir: string;
  configPath: string;
  cwd: string;
  names: string[];
  planHash?: string;
  tasks: Array<{ name: string; nodes: unknown[] }>;
  argv: string[];
  entry: SessionEntry;
  logRunId?: string;
  pid?: number;
}): RunSession {
  const sessionId = newSessionId();
  const record: SessionRecord = {
    session_id: sessionId,
    started_at: new Date().toISOString(),
    cwd: opts.cwd,
    config: { path: opts.configPath },
    invocation: {
      argv_summary: summarizeArgv(opts.argv),
      entry: opts.entry,
      ...(opts.pid !== undefined ? { pid: opts.pid } : {}),
    },
    names: opts.names,
    ...(opts.planHash ? { plan_hash: opts.planHash } : {}),
    status: "running",
    steps: stepsFromPlanTasks(opts.tasks),
    ...(opts.logRunId ? { log_run_id: opts.logRunId } : {}),
  };
  const session = new RunSession(
    path.join(sessionsDir(opts.configDir), `${sessionId}.json`),
    record,
  );
  session.write();
  session.attach(onProcessInterrupt(() => session.interrupt()));
  return session;
}

function isRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as SessionRecord;
  return (
    typeof record.session_id === "string" &&
    safeSessionId(record.session_id) &&
    typeof record.started_at === "string" &&
    typeof record.status === "string" &&
    Array.isArray(record.steps) &&
    record.invocation !== undefined &&
    typeof record.invocation === "object"
  );
}

function startedMs(record: SessionRecord, mtimeMs: number): number {
  const parsed = Date.parse(record.started_at);
  return Number.isFinite(parsed) ? parsed : mtimeMs;
}

export interface LoadedSessions {
  sessions: SessionRecord[];
  warnings: JsonIssue[];
}

export function loadSessions(
  configDir: string,
  opts: {
    now?: number;
    retainMs?: number;
    reclaimMs?: number;
    pidAlive?: (pid: number) => boolean;
    includePreview?: boolean;
  } = {},
): LoadedSessions {
  const dir = sessionsDir(configDir);
  if (!existsSync(dir)) return { sessions: [], warnings: [] };
  const now = opts.now ?? Date.now();
  const retainMs = opts.retainMs ?? SESSION_RETAIN_MS;
  const reclaimMs = opts.reclaimMs ?? SESSION_RECLAIM_MS;
  const alive = opts.pidAlive ?? pidAlive;
  const warnings: JsonIssue[] = [];
  const sessions: SessionRecord[] = [];

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    let parsed: unknown;
    let mtimeMs = now;
    try {
      mtimeMs = statSync(file).mtimeMs;
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      warnings.push(issue("SESSION_UNREADABLE", `Could not read ${name}.`));
      continue;
    }
    if (!isRecord(parsed)) {
      warnings.push(issue("SESSION_UNREADABLE", `${name} is not a session record.`));
      continue;
    }
    // ponytail: a still-live pid older than 7 days is kept. Upgrade: store process start time.
    const keepLive =
      parsed.status === "running" &&
      typeof parsed.invocation.pid === "number" &&
      alive(parsed.invocation.pid);
    if (!keepLive && now - startedMs(parsed, mtimeMs) > retainMs) {
      rmSync(file, { force: true });
      continue;
    }
    if (parsed.status === "running") {
      const pid = parsed.invocation.pid;
      const deadPid = typeof pid === "number" && !alive(pid);
      const expired = typeof pid !== "number" && now - mtimeMs > reclaimMs;
      if (deadPid || expired) {
        parsed.status = "interrupted";
        parsed.finished_at = new Date(now).toISOString();
        for (const step of parsed.steps) {
          if (step.status === "running") {
            step.status = "interrupted";
            step.finished_at = parsed.finished_at;
          }
        }
        writeSessionAtomic(file, `${JSON.stringify(parsed, null, 2)}\n`);
      }
    }
    if (parsed.preview === true && !opts.includePreview) continue;
    sessions.push(parsed);
  }

  sessions.sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0));
  return { sessions, warnings };
}

export function clearSessions(configDir: string): number {
  const dir = sessionsDir(configDir);
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") && !name.endsWith(".tmp")) continue;
    rmSync(path.join(dir, name), { force: true });
    if (name.endsWith(".json")) removed++;
  }
  return removed;
}
