import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { startDashServer } from "../dash";
import { SESSION_RECLAIM_MS } from "../session";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO_ROOT, "src/main.ts");

function parseStdout(out: string): Record<string, unknown> {
  expect(out.trim().startsWith("{")).toBe(true);
  return JSON.parse(out) as Record<string, unknown>;
}

async function bolt(
  argv: string[],
  cwd: string,
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", MAIN, ...argv], {
    cwd,
    env: { ...process.env, BOLT_AGENT: "" },
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

function project(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    "version: 1\nproject:\n  name: Demo\ntasks:\n  hi:\n    - run: echo hi\n",
  );
}

function writeSession(dir: string, record: Record<string, unknown>) {
  const root = path.join(dir, ".bolt", "sessions");
  mkdirSync(root, { recursive: true });
  const id = String(record.session_id);
  const file = path.join(root, `${id}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

function baseRecord(id: string, extra: Record<string, unknown> = {}) {
  return {
    session_id: id,
    started_at: "2026-10-20T08:00:00.000Z",
    cwd: "/tmp/demo",
    config: { path: "/tmp/demo/bolt.yaml" },
    invocation: { argv_summary: ["run", "hi"], entry: "human", pid: process.pid },
    names: ["hi"],
    status: "ok",
    steps: [
      {
        ref: "echo hi",
        index: 0,
        status: "ok",
        node: { kind: "run", command: "echo hi" },
      },
    ],
    ...extra,
  };
}

function boundPort(server: { port?: number }): number {
  const port = server.port;
  if (port === undefined) throw new Error("dash did not bind a port");
  return port;
}

function localListeners(port: number): string[] {
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  const found: string[] = [];
  for (const line of readFileSync("/proc/net/tcp", "utf8").split("\n")) {
    const local = line.trim().split(/\s+/)[1]?.toUpperCase();
    if (local?.endsWith(`:${hex}`)) found.push(local);
  }
  return found;
}

test("dash listens on 127.0.0.1 and serves the session list envelope", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-dash-"));
  project(dir);
  writeSession(dir, baseRecord("keep"));
  writeSession(dir, baseRecord("preview", { preview: true, names: ["dry"] }));
  writeSession(
    dir,
    baseRecord("bad", {
      started_at: "2026-10-20T09:00:00.000Z",
      status: "failed",
      names: ["go"],
      invocation: { argv_summary: ["run", "go"], entry: "agent", pid: process.pid },
      steps: [
        {
          ref: "demo/go",
          index: 0,
          status: "failed",
          node: { kind: "uses", ref: "demo/go" },
          error: { code: "HANDLER_FAILED", message: "disk full", hint: "free space" },
        },
      ],
    }),
  );
  const server = startDashServer({
    configDir: dir,
    configPath: path.join(dir, "bolt.yaml"),
    port: 0,
  });
  try {
    expect(server.hostname).toBe("127.0.0.1");
    const port = boundPort(server);
    // /proc/net/tcp is Linux-only. Other platforms keep the hostname check
    // and the 127.0.0.1 fetch below.
    if (process.platform === "linux") {
      const hex = port.toString(16).toUpperCase().padStart(4, "0");
      expect(localListeners(port)).toEqual([`0100007F:${hex}`]);
    }

    const listRes = await fetch(`http://127.0.0.1:${port}/sessions`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      schema: string;
      ok: boolean;
      data: { sessions: Array<{ session_id: string; entry: string; step?: { ref: string } }> };
    };
    expect(list.schema).toBe("bolt.session.list/v1");
    expect(list.ok).toBe(true);
    expect(list.data.sessions.map((row) => row.session_id)).toEqual(["bad", "keep"]);
    expect(list.data.sessions.map((row) => row.session_id)).not.toContain("preview");
    const failed = list.data.sessions[0];
    expect(failed.entry).toBe("agent");
    expect(failed.step?.ref).toBe("demo/go");

    const cli = parseStdout((await bolt(["session", "list", "--json"], dir)).out);
    expect(list).toEqual(cli as typeof list);

    const showRes = await fetch(`http://127.0.0.1:${port}/sessions/bad`);
    const show = await showRes.json();
    const shown = parseStdout((await bolt(["session", "show", "bad", "--json"], dir)).out);
    expect(show).toEqual(shown as typeof show);
    const step = (
      show as {
        data: { steps: Array<{ error?: { code: string; message: string; hint?: string } }> };
      }
    ).data.steps[0];
    expect(step.error).toEqual({
      code: "HANDLER_FAILED",
      message: "disk full",
      hint: "free space",
    });

    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(page).toContain('id="session-list"');
    expect(page).toContain('id="step-graph"');
    expect(page).toContain('id="stuck"');
    expect(page).toContain("error.code");
    expect(page).toContain("error.message");
    expect(page).toContain("error.hint");
    expect(page).not.toContain("0.0.0.0");
  } finally {
    await server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bolt dash prints a 127.0.0.1 url and serves today's execute sessions", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-dash-cli-"));
  project(dir);
  writeSession(dir, baseRecord("keep", { names: ["hi"] }));
  writeSession(dir, baseRecord("preview", { preview: true }));
  const proc = Bun.spawn(["bun", MAIN, "dash"], {
    cwd: dir,
    env: { ...process.env, BOLT_AGENT: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let url = "";
  const deadline = Date.now() + 8_000;
  try {
    while (Date.now() < deadline && !url) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      url = buf.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0] ?? "";
    }
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(buf).not.toContain("0.0.0.0");
    const list = (await (await fetch(`${url}sessions`)).json()) as {
      data: { sessions: Array<{ session_id: string }> };
    };
    expect(list.data.sessions.map((row) => row.session_id)).toEqual(["keep"]);
    const page = await (await fetch(url)).text();
    expect(page).toContain('id="step-graph"');
  } finally {
    proc.kill();
    await proc.exited;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dash read reclaims a dead running pid and rejects writes", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-dash-reclaim-"));
  project(dir);
  const file = writeSession(
    dir,
    baseRecord("dead", {
      status: "running",
      invocation: { argv_summary: ["run", "hi"], entry: "script", pid: 2_147_483_646 },
      steps: [
        {
          ref: "echo hi",
          index: 0,
          status: "running",
          node: { kind: "run", command: "echo hi" },
        },
      ],
    }),
  );
  const stale = writeSession(
    dir,
    baseRecord("stale", {
      status: "running",
      invocation: { argv_summary: ["run", "hi"], entry: "script" },
      steps: [
        { ref: "echo hi", index: 0, status: "running", node: { kind: "run", command: "echo hi" } },
      ],
    }),
  );
  const old = (Date.now() - SESSION_RECLAIM_MS - 60_000) / 1000;
  utimesSync(stale, old, old);
  const server = startDashServer({
    configDir: dir,
    configPath: path.join(dir, "bolt.yaml"),
    port: 0,
  });
  try {
    const port = boundPort(server);
    const list = (await (await fetch(`http://127.0.0.1:${port}/sessions`)).json()) as {
      data: { sessions: Array<{ session_id: string; status: string }> };
    };
    expect(list.data.sessions.find((row) => row.session_id === "dead")?.status).toBe("interrupted");
    expect(list.data.sessions.find((row) => row.session_id === "stale")?.status).toBe(
      "interrupted",
    );
    const reclaimed = readFileSync(file, "utf8");
    expect(JSON.parse(reclaimed).status).toBe("interrupted");

    const posted = await fetch(`http://127.0.0.1:${port}/sessions/dead`, { method: "POST" });
    expect(posted.status).toBe(405);
    expect(readFileSync(file, "utf8")).toBe(reclaimed);
    const missing = (await (await fetch(`http://127.0.0.1:${port}/sessions/nope`)).json()) as {
      ok: boolean;
      errors: Array<{ code: string }>;
    };
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]?.code).toBe("SESSION_NOT_FOUND");
  } finally {
    await server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
