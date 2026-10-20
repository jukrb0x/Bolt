/**
 * Localhost-only readonly session observer (BOLT-A3-DASH A3b + A3c).
 * Every session read calls `loadSessions`, which reclaims `running` records.
 * List and detail responses use the same envelopes as `bolt session list|show --json`.
 * A plan read is `bolt.inspect/v1` and only fills steps that have no `node`.
 * It does not run the plan and does not write a session.
 */
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "fs";
import path from "path";
import { assessCapabilities } from "./capability-selection";
import { loadConfig } from "./config";
import { DASH_PAGE } from "./dash-page";
import { CONFIG_EXIT_CODE, USAGE_EXIT_CODE } from "./exit-codes";
import { JSON_SCHEMA, buildEnvelope, configRef, issue, type JsonConfigRef } from "./json-envelope";
import { previewPlan } from "./plan-preview";
import { capabilityUsesInPlan, resolveRunPlan, type PlanRequest } from "./run-plan";
import {
  loadSessions,
  maskSecretText,
  safeSessionId,
  sessionListItem,
  type SessionRecord,
} from "./session";

export const DASH_HOSTNAME = "127.0.0.1";
/** Tail kept for the log drawer. The file itself is not the error-code source. */
export const DASH_LOG_LIMIT = 8192;

export interface CompareRow {
  index: number;
  ref: string;
  status: string;
  plan: unknown;
  error?: { code: string; message: string; hint?: string };
}

/** Plan side is `step.node` when the session stored it. Fallback nodes are by index. */
export function compareRows(
  steps: ReadonlyArray<{
    index: number;
    ref: string;
    status: string;
    node?: unknown;
    error?: { code: string; message: string; hint?: string };
  }>,
  fallbackNodes?: ReadonlyArray<unknown> | null,
): CompareRow[] {
  return steps.map((step, i) => {
    const own = step.node !== undefined && step.node !== null ? step.node : undefined;
    return {
      index: step.index,
      ref: step.ref,
      status: step.status,
      plan: own !== undefined ? own : (fallbackNodes?.[i] ?? null),
      ...(step.error ? { error: step.error } : {}),
    };
  });
}

/** Same charset as a session id, plus a ban on `..` and absolute paths. */
export function safeLogRunId(id: string): boolean {
  if (!safeSessionId(id) || id.includes("..")) return false;
  return !path.posix.isAbsolute(id) && !path.win32.isAbsolute(id);
}

export function startDashServer(opts: { configDir: string; configPath: string; port?: number }) {
  const configDir = opts.configDir;
  const configPath = opts.configPath;
  const config = configRef(configPath);

  const listEnvelope = () => {
    const { sessions, warnings } = loadSessions(configDir);
    return buildEnvelope({
      schema: JSON_SCHEMA.sessionList,
      exitCode: 0,
      config,
      data: { sessions: sessions.map(sessionListItem) },
      warnings,
    });
  };

  const findRecord = (id: string): SessionRecord | undefined => {
    if (!safeSessionId(id)) return undefined;
    const { sessions } = loadSessions(configDir, { includePreview: true });
    return sessions.find((item) => item.session_id === id);
  };

  const showEnvelope = (id: string) => {
    const record = findRecord(id);
    if (!record) return { status: 404, body: missingEnvelope(config, id) };
    return {
      status: 200,
      body: buildEnvelope({
        schema: JSON_SCHEMA.session,
        exitCode: 0,
        config,
        data: record,
      }),
    };
  };

  return Bun.serve({
    hostname: DASH_HOSTNAME,
    port: opts.port ?? 0,
    async fetch(req) {
      if (req.method !== "GET") {
        return new Response("Read only.\n", {
          status: 405,
          headers: { allow: "GET", "content-type": "text/plain; charset=utf-8" },
        });
      }
      const url = new URL(req.url);
      if (url.pathname === "/") return html(DASH_PAGE);
      if (url.pathname === "/sessions") return json(listEnvelope());
      const planMatch = /^\/sessions\/([^/]+)\/plan$/.exec(url.pathname);
      if (planMatch) {
        const shown = await planEnvelope(
          configDir,
          configPath,
          config,
          findRecord,
          decodeURIComponent(planMatch[1]),
        );
        return json(shown.body, shown.status);
      }
      const logMatch = /^\/sessions\/([^/]+)\/log$/.exec(url.pathname);
      if (logMatch) return logResponse(configDir, findRecord, decodeURIComponent(logMatch[1]));
      const match = /^\/sessions\/([^/]+)$/.exec(url.pathname);
      if (match) {
        const shown = showEnvelope(decodeURIComponent(match[1]));
        return json(shown.body, shown.status);
      }
      return new Response("Not found.\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    },
  });
}

async function planEnvelope(
  configDir: string,
  configPath: string,
  config: JsonConfigRef | null,
  findRecord: (id: string) => SessionRecord | undefined,
  id: string,
) {
  const record = findRecord(id);
  if (!record) return { status: 404, body: missingEnvelope(config, id) };
  const names = Array.isArray(record.names)
    ? record.names.filter((name) => typeof name === "string")
    : [];
  if (names.length === 0) {
    return {
      status: 200,
      body: buildEnvelope({
        schema: JSON_SCHEMA.inspect,
        exitCode: USAGE_EXIT_CODE,
        config,
        data: null,
        errors: [issue("PLAN_INVALID", "Session has no task names to inspect.")],
      }),
    };
  }
  // ponytail: session files do not store run params, so this inspect uses names only.
  const cfg = await loadConfig(configPath);
  const request: PlanRequest =
    names.length === 1 && cfg.flows[names[0]]
      ? { kind: "flow", name: names[0], params: {} }
      : { kind: "tasks", names, params: {} };
  const result = resolveRunPlan(cfg, request);
  if (!result.ok) {
    return {
      status: 200,
      body: buildEnvelope({
        schema: JSON_SCHEMA.inspect,
        exitCode: CONFIG_EXIT_CODE,
        config,
        data: null,
        errors: result.errors.map((error) =>
          issue(
            "PLAN_INVALID",
            error.path ? `${error.path}: ${error.message}` : error.message,
            "Fix bolt.yaml, then run bolt inspect again.",
          ),
        ),
      }),
    };
  }
  const report = assessCapabilities(cfg, configDir, {
    requested: capabilityUsesInPlan(result.plan),
    catalog: true,
  });
  const preview = previewPlan({
    cfg,
    configPath,
    configDir,
    plan: result.plan,
    names,
    params: {},
  });
  const failed = report.errors.length > 0;
  return {
    status: 200,
    body: buildEnvelope({
      schema: JSON_SCHEMA.inspect,
      exitCode: failed ? CONFIG_EXIT_CODE : 0,
      config,
      data: {
        kind: result.plan.kind,
        name: result.plan.name ?? null,
        names: preview.names,
        params: {},
        context_hash: preview.context_hash,
        plan_hash: preview.plan_hash,
        ai: preview.ai,
        ai_reasons: preview.ai_reasons,
        tasks: preview.tasks,
        capabilities: report.resolved,
      },
      warnings: [
        ...report.warnings.map((message) => issue("CAPABILITY_WARNING", message)),
        ...preview.warnings,
      ],
      errors: report.errors.map((error) =>
        issue(
          error.code ?? "CAPABILITY_ERROR",
          error.path ? `${error.path}: ${error.message}` : error.message,
          "Fix bolt.yaml or bolt.local.yaml, then run bolt inspect again.",
        ),
      ),
    }),
  };
}

function logResponse(
  configDir: string,
  findRecord: (id: string) => SessionRecord | undefined,
  id: string,
): Response {
  const record = findRecord(id);
  if (!record) return text("No session.\n", 404);
  const logRunId = record.log_run_id;
  if (!logRunId) return text("No log_run_id. Log cannot be linked.\n", 404);
  if (!safeLogRunId(logRunId)) return text("log_run_id is not a safe id.\n", 400);
  const root = path.resolve(configDir, ".bolt", "logs");
  const file = path.resolve(root, `${logRunId}.log`);
  const rel = path.relative(root, file);
  if (rel.startsWith("..") || path.isAbsolute(rel) || path.basename(file) !== `${logRunId}.log`) {
    return text("log_run_id is not a safe id.\n", 400);
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    return text("No log file for this log_run_id.\n", 404);
  }
  const realRoot = realpathSync(root);
  const realFile = realpathSync(file);
  const realRel = path.relative(realRoot, realFile);
  if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
    return text("Log path escapes .bolt/logs.\n", 400);
  }
  const fragment = readLogFragment(file);
  return text(fragment.text, 200, { "x-bolt-log-truncated": fragment.truncated ? "1" : "0" });
}

function readLogFragment(file: string): { text: string; truncated: boolean } {
  const size = statSync(file).size;
  if (size <= DASH_LOG_LIMIT) {
    return { text: maskSecretText(readFileSync(file, "utf8")), truncated: false };
  }
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(DASH_LOG_LIMIT);
    readSync(fd, buf, 0, DASH_LOG_LIMIT, size - DASH_LOG_LIMIT);
    let text = buf.toString("utf8");
    const nl = text.indexOf("\n");
    text = nl === -1 ? "" : text.slice(nl + 1);
    return { text: maskSecretText(text), truncated: true };
  } finally {
    closeSync(fd);
  }
}

function missingEnvelope(config: JsonConfigRef | null, id: string) {
  return buildEnvelope({
    schema: JSON_SCHEMA.session,
    exitCode: USAGE_EXIT_CODE,
    config,
    data: null,
    errors: [issue("SESSION_NOT_FOUND", `No session "${id}".`)],
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function text(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}
