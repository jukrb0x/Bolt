import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { parse } from "yaml";
import { checkConfig, loadConfig } from "../config";
import { boltConfigJsonSchema } from "../config-schema";
import { schemaErrors } from "./schema-match";

const REPO = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO, "src/main.ts");

const SYNC_POLICY_HINT = "Remove sync_policy. Daily multi-repo update stays pipeline + vcs.sync.";

const INVENTORY = `version: 1
project:
  name: Demo
workspace:
  roots:
    - id: engine
      path: ./engine
      role: engine
      vcs: git
    - id: game
      path: ./missing
      role: project
`;

function tempProject(yaml: string, extra?: (dir: string) => void): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-a1-list-"));
  writeFileSync(path.join(dir, "bolt.yaml"), yaml);
  extra?.(dir);
  return dir;
}

function bolt(argv: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  const home = path.join(cwd, ".empty-home");
  mkdirSync(home, { recursive: true });
  const proc = Bun.spawn(
    ["bun", "--tsconfig-override", path.join(REPO, "tsconfig.json"), MAIN, ...argv],
    {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([out, err, code]) => ({ code, out, err }));
}

function parseStdout(out: string): Record<string, unknown> {
  expect(out.startsWith("{")).toBe(true);
  const parsed = JSON.parse(out) as Record<string, unknown>;
  expect(out).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const rec = (current: string) => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      if (name.name === ".empty-home") continue;
      const abs = path.join(current, name.name);
      out.push(path.relative(dir, abs));
      if (name.isDirectory()) rec(abs);
    }
  };
  rec(dir);
  return out.sort();
}

test("list and check show two roots, optional vcs, and a missing path without disk writes", async () => {
  const dir = tempProject(INVENTORY, (root) => mkdirSync(path.join(root, "engine")));
  const before = filesUnder(dir);
  try {
    const listed = await bolt(["list", "--json"], dir);
    expect(listed.code).toBe(0);
    const listBody = parseStdout(listed.out);
    expect(listBody.schema).toBe("bolt.list/v1");
    expect(listBody.schema).not.toBe("bolt.workspace.sync/v1");
    const listData = listBody.data as {
      workspace: { roots: Array<Record<string, unknown>> };
    };
    expect(listData.workspace.roots).toEqual([
      { id: "engine", path: "./engine", role: "engine", vcs: "git", exists: true },
      { id: "game", path: "./missing", role: "project", exists: false },
    ]);
    expect("vcs" in listData.workspace.roots[1]).toBe(false);
    expect(JSON.stringify(listData.workspace)).not.toContain("pin");
    expect(JSON.stringify(listData.workspace)).not.toContain("sync_policy");

    const human = await bolt(["list"], dir);
    expect(human.code).toBe(0);
    expect(human.out).toContain("engine");
    expect(human.out).toContain("game");
    expect(human.out).toContain("./missing");
    expect(human.out).toContain("path does not exist");

    const checked = await bolt(["check", "--json"], dir);
    expect(checked.code).toBe(0);
    const checkBody = parseStdout(checked.out);
    expect(checkBody.schema).toBe("bolt.check/v1");
    const checkData = checkBody.data as {
      valid: boolean;
      workspace: { roots: Array<Record<string, unknown>> };
    };
    expect(checkData.valid).toBe(true);
    expect(checkData.workspace.roots).toEqual(listData.workspace.roots);
    const warnings = checkBody.warnings as Array<{ code: string; message: string }>;
    expect(warnings.map((item) => item.message)).toEqual([
      'workspace.roots.game: path "./missing" does not exist',
    ]);

    const text = `${listed.out}\n${human.out}\n${checked.out}\n${checked.err}`;
    for (const banned of ["ROOT_MISSING", "frozen", "plan", "pull", "update", "clone"]) {
      expect(text).not.toContain(banned);
    }
    expect(existsSync(path.join(dir, "missing"))).toBe(false);
    expect(existsSync(path.join(dir, "engine", ".git"))).toBe(false);
    expect(filesUnder(dir)).toEqual(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync_policy and pin are rejected; vcs may be omitted", async () => {
  expect(schemaErrors(boltConfigJsonSchema(), parse(INVENTORY))).toEqual([]);
  const withPolicy = `${INVENTORY}  sync_policy: one-side-safe\n`;
  expect(
    schemaErrors(boltConfigJsonSchema(), parse(withPolicy)).some((err) =>
      err.includes("additional sync_policy"),
    ),
  ).toBe(true);
  const withPin = INVENTORY.replace("role: engine", "role: engine\n      pin: abc");
  expect(
    schemaErrors(boltConfigJsonSchema(), parse(withPin)).some((err) => err.includes("pin")),
  ).toBe(true);

  const dir = tempProject(withPolicy, (root) => mkdirSync(path.join(root, "engine")));
  try {
    const checked = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(checked.ok).toBe(false);
    const hit = checked.errors.find((error) => error.message.includes("sync_policy"));
    expect(hit?.code).toBe("WORKSPACE_INVALID");
    expect(hit?.hint).toBe(SYNC_POLICY_HINT);
    await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(/sync_policy/);
    await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(/vcs\.sync/);

    const run = await bolt(["check", "--json"], dir);
    expect(run.code).toBe(3);
    const body = parseStdout(run.out);
    const errors = body.errors as Array<{ code: string; message: string; hint?: string }>;
    expect(errors.some((error) => error.code === "WORKSPACE_INVALID")).toBe(true);
    expect(errors.some((error) => error.hint === SYNC_POLICY_HINT)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("bolt.workspace.sync/v1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const loaded = tempProject(INVENTORY);
  try {
    const cfg = await loadConfig(path.join(loaded, "bolt.yaml"));
    expect(cfg.workspace).toEqual({
      roots: [
        { id: "engine", path: "./engine", role: "engine", vcs: "git" },
        { id: "game", path: "./missing", role: "project" },
      ],
    });
  } finally {
    rmSync(loaded, { recursive: true, force: true });
  }
});

test("invalid id, path, role, and a duplicate id are CONFIG errors", async () => {
  const cases = [
    INVENTORY.replace("id: engine", 'id: ""'),
    INVENTORY.replace("path: ./engine", 'path: ""'),
    INVENTORY.replace("role: project", "role: depot"),
    INVENTORY.replace("id: game", "id: engine"),
  ];
  for (const yaml of cases) {
    const dir = tempProject(yaml);
    try {
      const run = await bolt(["check", "--json"], dir);
      expect(run.code).toBe(3);
      const body = parseStdout(run.out);
      const errors = body.errors as Array<{ code: string; message: string }>;
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((error) => error.code === "WORKSPACE_INVALID")).toBe(true);
      await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toMatchObject({
        code: "WORKSPACE_INVALID",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
