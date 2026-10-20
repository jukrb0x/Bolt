import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import {
  SESSION_RECLAIM_MS,
  SESSION_RETAIN_MS,
  RunSession,
  clearSessions,
  invocationEntry,
  issueFromStepError,
  loadSessions,
  pidAlive,
  stepsFromPlanTasks,
  summarizeArgv,
  type SessionRecord,
} from "../session";
import { BoltStepError } from "../handler-result";
import { INTERRUPTED_EXIT_CODE } from "../exit-codes";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO_ROOT, "src/main.ts");

function parseStdout(out: string): Record<string, unknown> {
  expect(out.trim().startsWith("{")).toBe(true);
  return JSON.parse(out) as Record<string, unknown>;
}

async function bolt(
  argv: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", MAIN, ...argv], {
    cwd,
    env: { ...process.env, BOLT_AGENT: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

function project(dir: string, tasks: string, local = "") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    `version: 1\nproject:\n  name: Demo\n${tasks.endsWith("\n") ? tasks : `${tasks}\n`}`,
  );
  if (local)
    writeFileSync(path.join(dir, "bolt.local.yaml"), local.endsWith("\n") ? local : `${local}\n`);
}

function writePlugin(dir: string, body: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.ts"), body);
}

function sessionsDir(dir: string) {
  return path.join(dir, ".bolt", "sessions");
}

function writeSession(dir: string, record: Record<string, unknown>) {
  const id = String(record.session_id);
  const root = sessionsDir(dir);
  mkdirSync(root, { recursive: true });
  const file = path.join(root, `${id}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function baseRecord(id: string, extra: Record<string, unknown> = {}) {
  return {
    session_id: id,
    started_at: new Date().toISOString(),
    cwd: "/tmp/demo",
    config: { path: "/tmp/demo/bolt.yaml" },
    invocation: { argv_summary: ["run", "hi"], entry: "human", pid: process.pid },
    names: ["hi"],
    status: "ok",
    steps: [],
    ...extra,
  };
}

test("summarizeArgv masks secret flags and truncates", () => {
  const secret = "super-secret-value";
  const long = "x".repeat(400);
  const summary = summarizeArgv([
    "run",
    "build",
    `--token=${secret}`,
    "--password",
    "hunter2",
    "--api-key=abcd",
    "--keyboard=fine",
    long,
  ]);
  expect(summary.join(" ")).not.toContain(secret);
  expect(summary.join(" ")).not.toContain("hunter2");
  expect(summary.join(" ")).not.toContain("abcd");
  expect(summary).toContain("--token=***");
  expect(summary).toContain("--password");
  expect(summary).toContain("***");
  expect(summary).toContain("--api-key=***");
  expect(summary).toContain("--keyboard=fine");
  expect(
    summary.some((arg) => arg.startsWith("xxx") && arg.endsWith("…") && arg.length < long.length),
  ).toBe(true);
});

test("summarizeArgv masks *-file secret flags without false-positive on keyboard", () => {
  const summary = summarizeArgv([
    "run",
    "build",
    "--token-file=/creds/token",
    "--password-file",
    "/secret/pass",
    "--secret-file=/var/secret",
    "--api-key-file=/keys/api",
    "--keyboard=fine",
  ]);
  const joined = summary.join(" ");
  expect(joined).not.toContain("/creds/token");
  expect(joined).not.toContain("/secret/pass");
  expect(joined).not.toContain("/var/secret");
  expect(joined).not.toContain("/keys/api");
  expect(summary).toContain("--token-file=***");
  expect(summary).toContain("--password-file");
  expect(summary).toContain("***");
  expect(summary).toContain("--secret-file=***");
  expect(summary).toContain("--api-key-file=***");
  expect(summary).toContain("--keyboard=fine");
});

test("summarizeArgv masks key=value secrets after bare --", () => {
  const summary = summarizeArgv([
    "run",
    "deploy",
    "--",
    "password=hunter2",
    "token=abcd",
    "api-key=secret",
    "keyboard=fine",
    "host=example.com",
  ]);
  const joined = summary.join(" ");
  expect(joined).not.toContain("hunter2");
  expect(joined).not.toContain("abcd");
  expect(joined).not.toContain("secret");
  expect(summary).toContain("password=***");
  expect(summary).toContain("token=***");
  expect(summary).toContain("api-key=***");
  expect(summary).toContain("keyboard=fine");
  expect(summary).toContain("host=example.com");
});

test("invocationEntry distinguishes agent, script, and human", () => {
  expect(invocationEntry(true, false)).toBe("agent");
  expect(invocationEntry(false, false)).toBe("script");
  expect(invocationEntry(false, true)).toBe("human");
});

test("stepsFromPlanTasks flattens call nodes in execution order", () => {
  const steps = stepsFromPlanTasks([
    {
      name: "outer",
      nodes: [
        { kind: "run", command: "echo before" },
        { kind: "call", name: "inner", nodes: [{ kind: "uses", ref: "demo/go", params: {} }] },
        { kind: "run", command: "echo after" },
      ],
    },
  ]);
  expect(steps.map((step) => step.ref)).toEqual(["echo before", "demo/go", "echo after"]);
  expect(steps.map((step) => step.index)).toEqual([0, 1, 2]);
  expect(steps.every((step) => step.status === "pending")).toBe(true);
});

test("issueFromStepError copies BoltStepError code, message, and hint", () => {
  const error = new BoltStepError("HANDLER_FAILED", 'demo/go returned status "fail": disk full', [
    { level: "error", code: "DISK_FULL", message: "disk full", fix: "free space" },
  ]);
  expect(issueFromStepError(error)).toEqual({
    code: "HANDLER_FAILED",
    message: error.message,
    hint: "free space",
  });
  expect(issueFromStepError(new Error("Command failed (exit 1): exit 1")).code).toBe("RUN_FAILED");
});

test("loadSessions reclaims a dead pid and an old file with no pid", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-sess-reclaim-"));
  try {
    const dead = writeSession(
      dir,
      baseRecord("dead", {
        status: "running",
        invocation: { argv_summary: ["run", "hi"], entry: "script", pid: 2_147_483_646 },
      }),
    );
    const stale = writeSession(
      dir,
      baseRecord("stale", {
        status: "running",
        invocation: { argv_summary: ["run", "hi"], entry: "script" },
      }),
    );
    const old = (Date.now() - SESSION_RECLAIM_MS - 60_000) / 1000;
    utimesSync(stale, old, old);
    const live = writeSession(dir, baseRecord("live", { status: "running" }));

    const loaded = loadSessions(dir);
    const byId = Object.fromEntries(loaded.sessions.map((item) => [item.session_id, item]));
    expect(byId.dead.status).toBe("interrupted");
    expect(typeof byId.dead.finished_at).toBe("string");
    expect(byId.stale.status).toBe("interrupted");
    expect(byId.live.status).toBe("running");
    expect(JSON.parse(readFileSync(dead, "utf8")).status).toBe("interrupted");
    expect(JSON.parse(readFileSync(stale, "utf8")).status).toBe("interrupted");
    expect(JSON.parse(readFileSync(live, "utf8")).status).toBe("running");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RunSession.write replaces via rename without unlinking the sole .json first", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-sess-atomic-"));
  try {
    const file = path.join(dir, ".bolt", "sessions", "atomic.json");
    const record: SessionRecord = {
      session_id: "atomic",
      started_at: new Date().toISOString(),
      cwd: dir,
      config: { path: path.join(dir, "bolt.yaml") },
      invocation: { argv_summary: ["run", "hi"], entry: "human" },
      names: ["hi"],
      status: "running",
      steps: [],
    };
    const session = new RunSession(file, record);
    session.write();
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).status).toBe("running");
    // Second write must replace in place. rename over existing keeps the path present;
    // we must never rmSync the only good .json before the new file lands.
    session.record.status = "ok";
    session.record.finished_at = new Date().toISOString();
    session.write();
    expect(existsSync(file)).toBe(true);
    const saved = JSON.parse(readFileSync(file, "utf8")) as SessionRecord;
    expect(saved.status).toBe("ok");
    expect(typeof saved.finished_at).toBe("string");
    const leftovers = readdirSync(path.dirname(file)).filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadSessions drops sessions older than 7 days and hides preview from the default list", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-sess-keep-"));
  try {
    writeSession(
      dir,
      baseRecord("old", {
        started_at: new Date(Date.now() - SESSION_RETAIN_MS - 86_400_000).toISOString(),
      }),
    );
    writeSession(dir, baseRecord("preview", { preview: true, status: "ok" }));
    writeSession(dir, baseRecord("keep"));
    const loaded = loadSessions(dir);
    expect(loaded.sessions.map((item) => item.session_id)).toEqual(["keep"]);
    expect(existsSync(path.join(sessionsDir(dir), "old.json"))).toBe(false);
    const shown = loadSessions(dir, { includePreview: true });
    expect(shown.sessions.map((item) => item.session_id).sort()).toEqual(["keep", "preview"]);
    expect(clearSessions(dir)).toBe(2);
    expect(readdirSync(sessionsDir(dir)).filter((name) => name.endsWith(".json"))).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("execute writes a session and a failed step error matches run --json", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-sess-exec-"));
  const home = path.join(dir, "home");
  const env = { HOME: home, USERPROFILE: home };
  const secret = "super-secret-value";
  writePlugin(
    path.join(dir, ".bolt", "plugins", "demo"),
    `import { defineHandler, definePlugin, fail } from "boltstack";
export default definePlugin({
  namespace: "demo",
  version: "1",
  description: "demo",
  apiVersion: 2,
  handlers: {
    go: defineHandler({ ai: true, description: "go" }, async () => {
      return fail("disk full", {
        data: { note: "public" },
        diagnostics: [{ level: "error", code: "DISK_FULL", message: "disk full", fix: "free space" }],
      });
    }),
  },
});
`,
  );
  project(
    dir,
    "tasks:\n  hi:\n    - run: echo hi\n  go:\n    - uses: demo/go\n",
    "ai:\n  trust_plugins: [demo]\n",
  );
  try {
    const dry = await bolt(["run", "--dry-run", "hi"], dir, env);
    expect(dry.code).toBe(0);
    expect(existsSync(sessionsDir(dir))).toBe(false);

    const human = await bolt(["run", "hi", `--token=${secret}`], dir, env);
    expect(human.code).toBe(0);
    const files = readdirSync(sessionsDir(dir));
    expect(files).toHaveLength(1);
    const saved = JSON.parse(readFileSync(path.join(sessionsDir(dir), files[0]), "utf8")) as {
      status: string;
      names: string[];
      plan_hash?: string;
      invocation: { entry: string; argv_summary: string[]; pid?: number };
      steps: Array<{ ref: string; index: number; status: string; node: unknown }>;
      log_run_id?: string;
    };
    expect(saved.status).toBe("ok");
    expect(saved.names).toEqual(["hi"]);
    expect(saved.invocation.entry).toBe("script");
    expect(typeof saved.invocation.pid).toBe("number");
    expect(saved.invocation.argv_summary.join(" ")).not.toContain(secret);
    expect(saved.invocation.argv_summary).toContain("--token=***");
    expect(readFileSync(path.join(sessionsDir(dir), files[0]), "utf8")).not.toContain(secret);
    expect(saved.steps.map((step) => step.status)).toEqual(["ok"]);
    expect(typeof saved.log_run_id).toBe("string");
    expect(existsSync(path.join(dir, ".bolt", "logs", `${saved.log_run_id}.log`))).toBe(true);
    const inspected = parseStdout(
      (await bolt(["inspect", "hi", `--token=${secret}`, "--json"], dir, env)).out,
    );
    const nodes = (inspected.data as { tasks: Array<{ nodes: unknown[] }> }).tasks[0].nodes;
    expect(saved.steps[0].node).toEqual(nodes[0]);
    expect(saved.plan_hash).toBe((inspected.data as { plan_hash: string }).plan_hash);

    const listed = parseStdout((await bolt(["session", "list", "--json"], dir, env)).out);
    expect(listed.schema).toBe("bolt.session.list/v1");
    expect(listed.ok).toBe(true);
    expect(Array.isArray(listed.warnings)).toBe(true);
    expect(Array.isArray(listed.errors)).toBe(true);
    const rows = (listed.data as { sessions: Array<{ session_id: string; names: string[] }> })
      .sessions;
    expect(rows).toHaveLength(1);
    expect(rows[0].names).toEqual(["hi"]);

    expect((await bolt(["plugin", "build", "demo"], dir, env)).code).toBe(0);
    const preview = parseStdout(
      (await bolt(["run", "--dry-run", "go", "--agent", "--json"], dir, env)).out,
    );
    const hash = (preview.data as { plan_hash: string }).plan_hash;
    const run = await bolt(["run", "go", "--execute", `--plan=${hash}`, "--json"], dir, env);
    expect(run.code).toBe(1);
    const body = parseStdout(run.out);
    expect(body.schema).toBe("bolt.run/v1");
    const errors = body.errors as Array<{
      code: string;
      message: string;
      hint?: string;
      ref?: string;
      index?: number;
    }>;
    expect(errors[0].code).toBe("RUN_FAILED");
    const shown = parseStdout((await bolt(["session", "list", "--json"], dir, env)).out);
    const ids = (shown.data as { sessions: Array<{ session_id: string; status: string }> })
      .sessions;
    expect(ids).toHaveLength(2);
    const failedId = ids.find((item) => item.status === "failed")?.session_id;
    expect(typeof failedId).toBe("string");
    const detail = parseStdout(
      (await bolt(["session", "show", failedId!, "--json"], dir, env)).out,
    );
    expect(detail.schema).toBe("bolt.session/v1");
    const data = detail.data as {
      status: string;
      invocation: { entry: string };
      steps: Array<{
        ref: string;
        index: number;
        status: string;
        error?: { code: string; message: string; hint?: string };
        result?: Record<string, unknown>;
      }>;
    };
    expect(data.status).toBe("failed");
    expect(data.invocation.entry).toBe("agent");
    const step = data.steps[0];
    expect(step.status).toBe("failed");
    const match = errors.find((item) => item.ref === step.ref && item.index === step.index);
    expect(match).toBeDefined();
    expect(step.error).toEqual({
      code: match!.code,
      message: match!.message,
      ...(match!.hint ? { hint: match!.hint } : {}),
    });
    expect(step.error?.code).toBe("HANDLER_FAILED");
    expect(step.error?.hint).toBe("free space");
    expect(step.result).toMatchObject({ status: "fail", data: { note: "public" } });
    expect(step.result).not.toHaveProperty("stderr");
    expect(JSON.stringify(data)).not.toContain("stderr");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

test("RunSession.interrupt persists interrupted status and finished_at", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-sess-interrupt-"));
  try {
    const file = path.join(dir, ".bolt", "sessions", "hook.json");
    const started = new Date().toISOString();
    const session = new RunSession(file, {
      session_id: "hook",
      started_at: started,
      cwd: dir,
      config: { path: path.join(dir, "bolt.yaml") },
      invocation: { argv_summary: ["run", "wait"], entry: "script", pid: process.pid },
      names: ["wait"],
      status: "running",
      steps: [
        {
          ref: "sleep",
          index: 0,
          status: "running",
          node: { kind: "run", command: "sleep" },
          started_at: started,
        },
        { ref: "next", index: 1, status: "pending", node: { kind: "run", command: "next" } },
      ],
    });
    session.write();
    // Same write flushInterruptHooks performs. No child process and no signal.
    session.interrupt();
    const saved = JSON.parse(readFileSync(file, "utf8")) as SessionRecord;
    expect(saved.status).toBe("interrupted");
    expect(typeof saved.finished_at).toBe("string");
    expect(saved.steps[0]?.status).toBe("interrupted");
    expect(typeof saved.steps[0]?.finished_at).toBe("string");
    expect(saved.steps[1]?.status).toBe("pending");
    expect(saved.steps[1]?.finished_at).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SIGINT marks the running session interrupted", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-sess-int-"));
  const env = { HOME: path.join(dir, "home"), USERPROFILE: path.join(dir, "home"), BOLT_AGENT: "" };
  project(dir, 'tasks:\n  wait:\n    - run: bun -e "setTimeout(() => {}, 20000)"\n');
  const proc = Bun.spawn(["bun", MAIN, "run", "wait"], {
    cwd: dir,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const root = sessionsDir(dir);
    const started = Date.now();
    let file = "";
    while (Date.now() - started < 10_000) {
      if (existsSync(root)) {
        const names = readdirSync(root).filter((name) => name.endsWith(".json"));
        if (names.length > 0) {
          file = path.join(root, names[0]);
          const body = JSON.parse(readFileSync(file, "utf8")) as { status: string };
          if (body.status === "running") break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(file).not.toBe("");
    try {
      proc.kill("SIGINT");
    } catch {
      process.kill(proc.pid, "SIGINT");
    }

    if (process.platform === "win32") {
      // Cross-process SIGINT does not enter Bun signal or exit hooks on win32.
      // Stop the child, then require dead-pid reclaim — do not poll for an in-process write.
      const exited = await Promise.race([
        proc.exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
      ]);
      if (!exited) {
        try {
          process.kill(proc.pid, "SIGKILL");
        } catch {
          /* already exited */
        }
        await proc.exited;
      }
      let saved = JSON.parse(readFileSync(file, "utf8")) as SessionRecord;
      if (saved.status === "running") {
        const pid = saved.invocation.pid;
        expect(typeof pid).toBe("number");
        expect(pidAlive(pid as number)).toBe(false);
        const reclaimed = loadSessions(dir).sessions.find(
          (item) => item.session_id === saved.session_id,
        );
        expect(reclaimed?.status).toBe("interrupted");
        expect(typeof reclaimed?.finished_at).toBe("string");
        saved = JSON.parse(readFileSync(file, "utf8")) as SessionRecord;
      }
      expect(saved.status).toBe("interrupted");
      expect(typeof saved.finished_at).toBe("string");
      return;
    }

    const code = await proc.exited;
    expect(code).toBe(INTERRUPTED_EXIT_CODE);
    const deadline = Date.now() + 5_000;
    let saved = JSON.parse(readFileSync(file, "utf8")) as {
      status: string;
      finished_at?: string;
    };
    while (saved.status === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      saved = JSON.parse(readFileSync(file, "utf8")) as {
        status: string;
        finished_at?: string;
      };
    }
    expect(saved.status).toBe("interrupted");
    expect(typeof saved.finished_at).toBe("string");
  } finally {
    try {
      process.kill(proc.pid, "SIGKILL");
    } catch {
      /* already exited */
    }
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
