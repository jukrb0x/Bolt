/**
 * Structured handler results and events (BOLT-EXT-1 E1).
 * Core owns validation and rendering; plugins only return plain objects.
 */
import type { BoltPluginContext } from "./plugin";
import { CAPABILITY_PATTERN } from "./capabilities";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type HandlerStatus = "ok" | "warn" | "fail" | "skipped";

export interface Diagnostic {
  level: "info" | "warn" | "error";
  /** Upper snake case, e.g. `DDC_SHARED_MISSING`. */
  code?: string;
  message: string;
  /** Core normalises `\` to `/`. */
  file?: string;
  line?: number;
  /** A hint for the user. Never executed. */
  fix?: string;
}

export interface Artifact {
  kind: string;
  path: string;
  sha256?: string;
  size?: number;
  label?: string;
}

/** Display-only suggestion. Core never executes it. */
export interface NextStep {
  ref: string;
  params?: Record<string, string>;
  reason?: string;
}

export interface HandlerResult<D extends JsonValue = JsonValue> {
  status: HandlerStatus;
  /** One line, at most 200 characters. */
  summary?: string;
  data?: D;
  artifacts?: Artifact[];
  diagnostics?: Diagnostic[];
  next?: NextStep[];
  /** Reserved, e.g. "bolt.doctor/v1". Not enforced by core. */
  schema?: string;
}

export interface BoltEvent {
  /** Same pattern as capability tags, e.g. "progress" or "log". */
  type: string;
  message?: string;
  data?: JsonValue;
  progress?: { current: number; total?: number; unit?: string };
}

/** An event after core stamps it. */
export interface StampedEvent extends BoltEvent {
  seq: number;
  ref: string;
  /** Plan step label, e.g. `build > ue/build`. Absent for onInit. */
  step?: string;
}

type Extra<D extends JsonValue> = Partial<Omit<HandlerResult<D>, "status" | "summary">>;

function build<D extends JsonValue>(
  status: HandlerStatus,
  summary: string | undefined,
  extra?: Extra<D>,
): HandlerResult<D> {
  const out: HandlerResult<D> = { ...extra, status };
  if (summary !== undefined) out.summary = summary;
  return out;
}

/** Plugin API v2 only: older bolt releases do not export these constructors. */
export function ok<D extends JsonValue = JsonValue>(
  summary?: string,
  extra?: Extra<D>,
): HandlerResult<D> {
  return build("ok", summary, extra);
}
export function warn<D extends JsonValue = JsonValue>(
  summary: string,
  extra?: Extra<D>,
): HandlerResult<D> {
  return build("warn", summary, extra);
}
export function fail<D extends JsonValue = JsonValue>(
  summary: string,
  extra?: Extra<D>,
): HandlerResult<D> {
  return build("fail", summary, extra);
}
export function skipped<D extends JsonValue = JsonValue>(
  summary?: string,
  extra?: Extra<D>,
): HandlerResult<D> {
  return build("skipped", summary, extra);
}

// ---------------------------------------------------------------------------
// Validation (plugin API v2 return values)
// ---------------------------------------------------------------------------

export const RESULT_LIMITS = {
  bytes: 256 * 1024,
  diagnostics: 200,
  artifacts: 200,
  next: 20,
  summary: 200,
  string: 8 * 1024,
  eventBytes: 16 * 1024,
  eventsPerStep: 10_000,
} as const;

const STATUSES: readonly HandlerStatus[] = ["ok", "warn", "fail", "skipped"];
const LEVELS = ["info", "warn", "error"] as const;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const RESULT_KEYS = ["status", "summary", "data", "artifacts", "diagnostics", "next", "schema"];

/** A step error with a stable code (`RESULT_INVALID`, `HANDLER_FAILED`). */
/** Exit code when an AI invocation is not allowed to run a step (`AI_FORBIDDEN`, permission denied). */
export const AI_FORBIDDEN_EXIT_CODE = 4;

export class BoltStepError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics: Diagnostic[] = [],
  ) {
    super(message);
    this.name = "BoltStepError";
  }
}

const FIX =
  "Fix: return ok()/warn()/fail()/skipped() from boltstack, or a matching object literal.";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

class Checker {
  readonly warnings: string[] = [];
  constructor(private ref: string) {}

  invalid(path: string, problem: string): never {
    throw new BoltStepError(
      "RESULT_INVALID",
      `${this.ref} returned an invalid HandlerResult: ${path} ${problem}. ${FIX}`,
    );
  }

  /** Unknown keys warn and are dropped, so newer result fields degrade softly on older cores. */
  pick(obj: Record<string, unknown>, path: string, known: readonly string[]) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (known.includes(key)) {
        if (value !== undefined) out[key] = value;
        continue;
      }
      const at = path ? `${path}.${key}` : key;
      this.warnings.push(
        `RESULT_UNKNOWN_KEY: ${this.ref} returned unknown field "${at}"; it was dropped. Known fields: ${known.join(", ")}. If this field is newer than this bolt, run \`bolt self-update\`.`,
      );
    }
    return out;
  }

  str(value: unknown, path: string, max: number = RESULT_LIMITS.string): string {
    if (typeof value !== "string") this.invalid(path, `must be a string, got ${describe(value)}`);
    if (value.length > max) {
      this.warnings.push(
        `RESULT_TRUNCATED: ${path} truncated at ${max} characters; write large output as an artifact`,
      );
      return value.slice(0, max);
    }
    return value;
  }

  num(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isFinite(value))
      this.invalid(path, `must be a finite number, got ${describe(value)}`);
    return value;
  }

  list(value: unknown, path: string, max: number): unknown[] {
    if (!Array.isArray(value)) this.invalid(path, `must be an array, got ${describe(value)}`);
    if (value.length > max) {
      this.warnings.push(
        `RESULT_TRUNCATED: ${path} has ${value.length} entries; kept the first ${max}`,
      );
      return value.slice(0, max);
    }
    return value;
  }

  obj(value: unknown, path: string): Record<string, unknown> {
    if (!isPlainObject(value)) this.invalid(path, `must be a plain object, got ${describe(value)}`);
    return value;
  }

  json(value: unknown, path: string, seen: Set<object> = new Set()): JsonValue {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        this.invalid(path, "is not JSON-serialisable (non-finite number)");
      return value;
    }
    if (typeof value === "string") return this.str(value, path);
    if (Array.isArray(value)) {
      if (seen.has(value)) this.invalid(path, "is not JSON-serialisable (circular reference)");
      seen.add(value);
      const out = value.map((item, i) => this.json(item, `${path}[${i}]`, seen));
      seen.delete(value);
      return out;
    }
    if (isPlainObject(value)) {
      if (seen.has(value)) this.invalid(path, "is not JSON-serialisable (circular reference)");
      seen.add(value);
      const out: Record<string, JsonValue> = {};
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue;
        out[key] = this.json(item, `${path}.${key}`, seen);
      }
      seen.delete(value);
      return out;
    }
    return this.invalid(path, `is not JSON-serialisable (${describe(value)})`);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") {
    const name = Object.getPrototypeOf(value)?.constructor?.name;
    return name && name !== "Object" ? `a ${name} instance` : "an object";
  }
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value;
}

export interface ValidatedResult {
  result: HandlerResult;
  warnings: string[];
}

/**
 * Validate a plugin API v2 return value. `undefined` means `ok`.
 * Throws BoltStepError("RESULT_INVALID") for a bad status, a wrongly typed known
 * field, or non-JSON data. Unknown keys and oversize values only warn.
 */
export function validateHandlerResult(value: unknown, ref: string): ValidatedResult {
  const c = new Checker(ref);
  if (value === undefined) return { result: { status: "ok" }, warnings: [] };
  if (!isPlainObject(value)) {
    c.invalid("the return value", `must be undefined or a plain object, got ${describe(value)}`);
  }
  const raw = c.pick(value as Record<string, unknown>, "", RESULT_KEYS);
  if (!STATUSES.includes(raw.status as HandlerStatus)) {
    c.invalid(
      "status",
      `${raw.status === undefined ? "is missing" : JSON.stringify(raw.status)} — expected "ok" | "warn" | "fail" | "skipped"`,
    );
  }
  const result: HandlerResult = { status: raw.status as HandlerStatus };

  if (raw.summary !== undefined) {
    const summary = c.str(raw.summary, "summary", RESULT_LIMITS.summary);
    result.summary = summary.split(/\r?\n/, 1)[0];
    if (result.summary !== summary && summary.length <= RESULT_LIMITS.summary) {
      c.warnings.push(`RESULT_TRUNCATED: summary must be one line; kept the first line`);
    }
  }
  if (raw.data !== undefined) result.data = c.json(raw.data, "data");
  if (raw.schema !== undefined) result.schema = c.str(raw.schema, "schema");

  if (raw.artifacts !== undefined) {
    result.artifacts = c
      .list(raw.artifacts, "artifacts", RESULT_LIMITS.artifacts)
      .map((item, i) => {
        const at = `artifacts[${i}]`;
        const a = c.pick(c.obj(item, at), at, ["kind", "path", "sha256", "size", "label"]);
        const out: Artifact = {
          kind: c.str(a.kind, `${at}.kind`),
          path: c.str(a.path, `${at}.path`).replace(/\\/g, "/"),
        };
        if (a.sha256 !== undefined) out.sha256 = c.str(a.sha256, `${at}.sha256`);
        if (a.size !== undefined) out.size = c.num(a.size, `${at}.size`);
        if (a.label !== undefined) out.label = c.str(a.label, `${at}.label`);
        return out;
      });
  }

  if (raw.diagnostics !== undefined) {
    result.diagnostics = c
      .list(raw.diagnostics, "diagnostics", RESULT_LIMITS.diagnostics)
      .map((item, i) => {
        const at = `diagnostics[${i}]`;
        const d = c.pick(c.obj(item, at), at, ["level", "code", "message", "file", "line", "fix"]);
        if (!LEVELS.includes(d.level as Diagnostic["level"])) {
          c.invalid(`${at}.level`, `${describe(d.level)} — expected "info" | "warn" | "error"`);
        }
        const out: Diagnostic = {
          level: d.level as Diagnostic["level"],
          message: c.str(d.message, `${at}.message`),
        };
        if (d.code !== undefined) {
          const code = c.str(d.code, `${at}.code`);
          if (!CODE_PATTERN.test(code)) {
            c.invalid(`${at}.code`, `${JSON.stringify(code)} must be UPPER_SNAKE_CASE`);
          }
          out.code = code;
        }
        if (d.file !== undefined) out.file = c.str(d.file, `${at}.file`).replace(/\\/g, "/");
        if (d.line !== undefined) out.line = c.num(d.line, `${at}.line`);
        if (d.fix !== undefined) out.fix = c.str(d.fix, `${at}.fix`);
        return out;
      });
  }

  if (raw.next !== undefined) {
    result.next = c.list(raw.next, "next", RESULT_LIMITS.next).map((item, i) => {
      const at = `next[${i}]`;
      const n = c.pick(c.obj(item, at), at, ["ref", "params", "reason"]);
      const out: NextStep = { ref: c.str(n.ref, `${at}.ref`) };
      if (n.params !== undefined) {
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(c.obj(n.params, `${at}.params`))) {
          params[k] = c.str(v, `${at}.params.${k}`);
        }
        out.params = params;
      }
      if (n.reason !== undefined) out.reason = c.str(n.reason, `${at}.reason`);
      return out;
    });
  }

  if (result.data !== undefined && JSON.stringify(result).length > RESULT_LIMITS.bytes) {
    delete result.data;
    c.warnings.push(
      `RESULT_TRUNCATED: data dropped because the result exceeds ${RESULT_LIMITS.bytes / 1024} KiB; write large output as an artifact`,
    );
  }
  return { result, warnings: c.warnings };
}

/** Validate one event. Returns an error message, or undefined when valid. */
export function eventProblem(event: unknown): string | undefined {
  const example = `Example: ctx.emit?.({ type: "progress", message: "cooking", progress: { current: 1, total: 3 } })`;
  if (!isPlainObject(event)) return `event must be a plain object. ${example}`;
  if (typeof event.type !== "string" || !CAPABILITY_PATTERN.test(event.type)) {
    return `event type ${JSON.stringify(event.type)} must be lowercase dot-separated words. ${example}`;
  }
  if (event.message !== undefined && typeof event.message !== "string") {
    return `event message must be a string. ${example}`;
  }
  if (event.progress !== undefined) {
    const p = event.progress as Record<string, unknown>;
    if (
      !isPlainObject(p) ||
      typeof p.current !== "number" ||
      (p.total !== undefined && typeof p.total !== "number") ||
      (p.unit !== undefined && typeof p.unit !== "string")
    ) {
      return `event progress must be { current: number, total?: number, unit?: string }. ${example}`;
    }
  }
  try {
    const size = JSON.stringify(event).length;
    if (size > RESULT_LIMITS.eventBytes) {
      return `event is ${size} bytes (max ${RESULT_LIMITS.eventBytes}). Write large output as an artifact.`;
    }
  } catch {
    return `event is not JSON-serialisable. ${example}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

/**
 * A plugin context for unit tests. Records every `ctx.emit` call in `.events`,
 * uses a silent logger and an in-memory runtime stub that fails every spawn.
 */
export function createTestContext(
  overrides: Partial<BoltPluginContext> = {},
): BoltPluginContext & { emit: (event: BoltEvent) => void; events: BoltEvent[] } {
  const events: BoltEvent[] = [];
  const noop = () => {};
  const spawnResult = { exitCode: 1, stdout: "", stderr: "createTestContext: no runtime stub" };
  const runtime = {
    spawn: async () => spawnResult,
    spawnSync: () => spawnResult,
    shell: async () => spawnResult,
    parseYaml: (_text: string) => {
      throw new Error("createTestContext: parseYaml is not stubbed; pass runtime in overrides");
    },
  } as unknown as BoltPluginContext["runtime"];
  return {
    cfg: {
      project: { name: "test" },
      vars: {},
      plugins: [],
    } as unknown as BoltPluginContext["cfg"],
    configDir: process.cwd(),
    dryRun: false,
    logger: { info: noop, warn: noop, error: noop, debug: noop, cmd: noop },
    runtime,
    ...overrides,
    emit: (event: BoltEvent) => {
      events.push(event);
    },
    events,
  };
}
