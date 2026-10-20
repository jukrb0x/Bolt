import { defineCommand } from "citty";
import pc from "picocolors";
import { USAGE_EXIT_CODE } from "../exit-codes";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  issue,
  loadConfigForJson,
  type JsonIssue,
} from "../json-envelope";
import { loadProjectConfigOrExit } from "../project-config";
import { printUsageError } from "../strict-args";
import {
  clearSessions,
  focusStep,
  loadSessions,
  safeSessionId,
  sessionListItem,
  type SessionRecord,
} from "../session";
import path from "path";

function printList(configPath: string, sessions: SessionRecord[]): void {
  console.log(pc.dim(`bolt.yaml: ${configPath}`));
  if (sessions.length === 0) {
    console.log("sessions: (none)");
    return;
  }
  for (const record of sessions) {
    const step = focusStep(record);
    const stuck = step ? `  ${step.ref}` : "";
    console.log(`${record.session_id}  ${record.status}  ${record.names.join(", ")}${stuck}`);
  }
}

function printShow(record: SessionRecord): void {
  console.log(`session_id: ${record.session_id}`);
  console.log(`status: ${record.status}`);
  console.log(`entry: ${record.invocation.entry}`);
  console.log(`names: ${record.names.join(", ") || "(none)"}`);
  console.log(`started_at: ${record.started_at}`);
  if (record.finished_at) console.log(`finished_at: ${record.finished_at}`);
  if (record.log_run_id) console.log(`log_run_id: ${record.log_run_id}`);
  if (record.plan_hash) console.log(`plan_hash: ${record.plan_hash}`);
  for (const step of record.steps) {
    const code = step.error ? `  ${step.error.code}` : "";
    console.log(`  ${step.index}  ${step.status}  ${step.ref}${code}`);
    if (step.error?.message) console.log(`     ${step.error.message}`);
    if (step.error?.hint) console.log(`     Fix: ${step.error.hint}`);
  }
}

const listCmd = defineCommand({
  meta: {
    name: "list",
    description: "List execute sessions for this project. Skips dry-run and preview records",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.session.list/v1 JSON document on stdout",
    },
  },
  async run({ args }) {
    const json = Boolean(args?.json);
    if (json) installJsonStdoutGuard();
    const loaded = json
      ? await loadConfigForJson(JSON_SCHEMA.sessionList)
      : await loadProjectConfigOrExit();
    const { sessions, warnings } = loadSessions(path.dirname(loaded.configPath));
    if (json) {
      emitJsonAndExit({
        schema: JSON_SCHEMA.sessionList,
        exitCode: 0,
        config: configRef(loaded.configPath),
        data: { sessions: sessions.map(sessionListItem) },
        warnings,
      });
    }
    printList(loaded.configPath, sessions);
    for (const warning of warnings) console.error(`[WARN] ${warning.message}`);
  },
});

const showCmd = defineCommand({
  meta: {
    name: "show",
    description: "Show one session, including preview records hidden from list",
  },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id under .bolt/sessions",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.session/v1 JSON document on stdout",
    },
  },
  async run({ args }) {
    const json = Boolean(args?.json);
    const id = typeof args?.sessionId === "string" ? args.sessionId : "";
    if (json) installJsonStdoutGuard();
    const schema = JSON_SCHEMA.session;
    const missing = (configPath: string | null, errors: JsonIssue[]): never => {
      if (json) {
        emitJsonAndExit({
          schema,
          exitCode: USAGE_EXIT_CODE,
          config: configRef(configPath),
          data: null,
          errors,
        });
      }
      printUsageError(errors[0]?.message ?? "Session not found.");
      process.exit(USAGE_EXIT_CODE);
    };
    if (!safeSessionId(id)) {
      const configPath = json
        ? (await loadConfigForJson(schema)).configPath
        : (await loadProjectConfigOrExit()).configPath;
      missing(configPath, [issue("SESSION_NOT_FOUND", `No session "${id}".`)]);
    }
    const loaded = json ? await loadConfigForJson(schema) : await loadProjectConfigOrExit();
    const { sessions } = loadSessions(path.dirname(loaded.configPath), { includePreview: true });
    const record = sessions.find((item) => item.session_id === id);
    if (!record) missing(loaded.configPath, [issue("SESSION_NOT_FOUND", `No session "${id}".`)]);
    if (json) {
      emitJsonAndExit({
        schema,
        exitCode: 0,
        config: configRef(loaded.configPath),
        data: record,
      });
    }
    printShow(record!);
  },
});

const clearCmd = defineCommand({
  meta: {
    name: "clear",
    description: "Delete session records under .bolt/sessions",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.session.clear/v1 JSON document on stdout",
    },
  },
  async run({ args }) {
    const json = Boolean(args?.json);
    if (json) installJsonStdoutGuard();
    const loaded = json
      ? await loadConfigForJson(JSON_SCHEMA.sessionClear)
      : await loadProjectConfigOrExit();
    const removed = clearSessions(path.dirname(loaded.configPath));
    if (json) {
      emitJsonAndExit({
        schema: JSON_SCHEMA.sessionClear,
        exitCode: 0,
        config: configRef(loaded.configPath),
        data: { removed },
      });
    }
    console.log(`removed: ${removed}`);
  },
});

export default defineCommand({
  meta: {
    name: "session",
    description: "List and show run sessions recorded for this project",
  },
  subCommands: {
    list: listCmd,
    show: showCmd,
    clear: clearCmd,
  },
});
