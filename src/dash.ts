/**
 * Localhost-only readonly session observer (BOLT-A3-DASH A3b).
 * Every read calls `loadSessions`, which reclaims `running` records.
 * Responses use the same envelopes as `bolt session list|show --json`.
 */
import { USAGE_EXIT_CODE } from "./exit-codes";
import { JSON_SCHEMA, buildEnvelope, configRef, issue, type JsonConfigRef } from "./json-envelope";
import { DASH_PAGE } from "./dash-page";
import { loadSessions, safeSessionId, sessionListItem } from "./session";

export const DASH_HOSTNAME = "127.0.0.1";

export function startDashServer(opts: { configDir: string; configPath: string; port?: number }) {
  const configDir = opts.configDir;
  const config = configRef(opts.configPath);

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

  const showEnvelope = (id: string) => {
    if (!safeSessionId(id)) return { status: 404, body: missingEnvelope(config, id) };
    const { sessions } = loadSessions(configDir, { includePreview: true });
    const record = sessions.find((item) => item.session_id === id);
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
    fetch(req) {
      if (req.method !== "GET") {
        return new Response("Read only.\n", {
          status: 405,
          headers: { allow: "GET", "content-type": "text/plain; charset=utf-8" },
        });
      }
      const url = new URL(req.url);
      if (url.pathname === "/") return html(DASH_PAGE);
      if (url.pathname === "/sessions") return json(listEnvelope());
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
