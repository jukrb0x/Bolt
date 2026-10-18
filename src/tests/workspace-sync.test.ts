import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { parse } from "yaml";
import { checkConfig, loadConfig } from "../config";
import { boltConfigJsonSchema } from "../config-schema";
import { defineHandler, definePlugin } from "../plugin";
import { PluginRegistry } from "../plugin-registry";
import { createTestContext } from "../handler-result";
import { VERSION } from "../version";
import { schemaErrors } from "./schema-match";
import { formatWorkspacePlan, planWorkspaceSync, type WorkspaceConfig } from "../workspace";

const REPO = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO, "src/main.ts");

const YAML = `version: 1
project:
  name: Demo
workspace:
  roots:
    - id: engine
      path: ./engine
      role: engine
      vcs: git
    - id: game
      path: ./game
      role: project
      vcs: svn
`;

const WITH_POLICY = `${YAML}  sync_policy: one-side-safe\n`;

function tempProject(yaml: string, extra?: (dir: string) => void): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-a1a-"));
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

function planner(namespace: string, targetRev: string, calls: string[]) {
  return definePlugin({
    namespace,
    version: "0.0.0",
    description: "fixture planner",
    apiVersion: 2,
    handlers: {
      revision: defineHandler(
        { ai: true, capability: "vcs.revision", description: "plan a root" },
        async (params) => {
          calls.push(`${namespace}:${params.id}`);
          return {
            status: "ok" as const,
            data: {
              action: "sync",
              target_rev: params.pin || targetRev,
              will_touch: true,
            },
          };
        },
      ),
    },
  });
}

test("loadConfig keeps workspace roots in declaration order", async () => {
  const dir = tempProject(YAML);
  try {
    const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
    expect(cfg.workspace).toEqual({
      roots: [
        { id: "engine", path: "./engine", role: "engine", vcs: "git" },
        { id: "game", path: "./game", role: "project", vcs: "svn" },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("schema accepts a roots inventory and rejects sync_policy", async () => {
  expect(schemaErrors(boltConfigJsonSchema(), parse(YAML))).toEqual([]);
  expect(
    schemaErrors(boltConfigJsonSchema(), parse(WITH_POLICY)).some((err) =>
      err.includes("sync_policy"),
    ),
  ).toBe(true);
  const dir = tempProject(WITH_POLICY);
  try {
    const checked = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(checked.ok).toBe(false);
    expect(checked.errors.some((error) => error.code === "POLICY_UNKNOWN")).toBe(false);
    expect(checked.errors.some((error) => error.hint?.includes("vcs.sync"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("duplicate root id and unknown role are WORKSPACE_INVALID", async () => {
  const dup = YAML.replace("    - id: game", "    - id: engine");
  const dir = tempProject(dup);
  try {
    await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toMatchObject({
      code: "WORKSPACE_INVALID",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const badRole = tempProject(YAML.replace("role: project", "role: depot"));
  try {
    await expect(loadConfig(path.join(badRole, "bolt.yaml"))).rejects.toMatchObject({
      code: "WORKSPACE_INVALID",
    });
  } finally {
    rmSync(badRole, { recursive: true, force: true });
  }
});

test("bolt.local.yaml cannot override a workspace path", async () => {
  const dir = tempProject(YAML, (root) => {
    writeFileSync(path.join(root, "bolt.local.yaml"), "workspace:\n  roots: []\n");
  });
  try {
    await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(/bolt\.local\.yaml/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("plan rows follow config order and pin-rev skips a root with no pin", async () => {
  const dir = tempProject(YAML);
  mkdirSync(path.join(dir, "engine"));
  mkdirSync(path.join(dir, "game"));
  const calls: string[] = [];
  const registry = new PluginRegistry();
  registry.register(planner("svn", "1234", calls));
  registry.register(planner("git", "abc", calls));
  const workspace: WorkspaceConfig = {
    sync_policy: "one-side-safe",
    roots: [
      { id: "engine", path: "./engine", role: "engine", vcs: "git", pin: null },
      { id: "game", path: "./game", role: "project", vcs: "svn", pin: null },
    ],
  };
  try {
    const planned = await planWorkspaceSync(
      workspace,
      dir,
      registry,
      createTestContext({ configDir: dir, dryRun: true }),
    );
    expect(planned).toEqual({
      policy: "one-side-safe",
      plan: [
        { root: "engine", action: "sync", target_rev: "abc", will_touch: true },
        { root: "game", action: "sync", target_rev: "1234", will_touch: true },
      ],
    });
    expect(calls).toEqual(["git:engine", "svn:game"]);

    calls.length = 0;
    const pinned: WorkspaceConfig = {
      sync_policy: "pin-rev",
      roots: [{ ...workspace.roots[0], pin: "abc" }, workspace.roots[1]],
    };
    const pinPlan = await planWorkspaceSync(
      pinned,
      dir,
      registry,
      createTestContext({ configDir: dir, dryRun: true }),
    );
    expect(pinPlan.plan.map((row) => row.root)).toEqual(["engine"]);
    expect(calls).toEqual(["git:engine"]);

    const missing = planWorkspaceSync(
      {
        ...workspace,
        roots: [{ ...workspace.roots[0], path: "./nope" }, workspace.roots[1]],
      },
      dir,
      registry,
      createTestContext({ configDir: dir, dryRun: true }),
    );
    await expect(missing).rejects.toMatchObject({ code: "ROOT_MISSING" });

    const bare = planWorkspaceSync(
      workspace,
      dir,
      new PluginRegistry(),
      createTestContext({ configDir: dir, dryRun: true }),
    );
    await expect(bare).rejects.toMatchObject({ code: "VCS_REVISION" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("format uses the json field names as columns", () => {
  const text = formatWorkspacePlan({
    policy: "one-side-safe",
    plan: [{ root: "engine", action: "sync", target_rev: "abc", will_touch: true }],
  });
  const [policy, header] = text.split("\n");
  expect(policy).toBe("policy: one-side-safe");
  expect(header.split(/\s+/)).toEqual(["root", "action", "target_rev", "will_touch"]);
});

test("workspace sync rejects sync_policy before it prints a plan", async () => {
  const dir = tempProject(WITH_POLICY, (root) => {
    mkdirSync(path.join(root, "engine"));
    mkdirSync(path.join(root, "game"));
  });
  try {
    const run = await bolt(["workspace", "sync", "--dry-run", "--json"], dir);
    expect(run.code).toBe(3);
    const body = parseStdout(run.out);
    expect(body.schema).toBe("bolt.workspace.sync/v1");
    expect(body.bolt).toBe(VERSION);
    expect(body.ok).toBe(false);
    expect(body.data).toBeNull();
    const errors = body.errors as Array<{ code: string; message: string; hint?: string }>;
    expect(errors[0].code).toBe("WORKSPACE_INVALID");
    expect(`${errors[0].message}\n${errors[0].hint ?? ""}`).toContain("vcs.sync");
    expect(run.out).not.toContain("target_rev");
    expect(run.out).not.toContain("ROOT_MISSING");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown policy, missing root, and a sync without dry-run exit as specified", async () => {
  const unknown = tempProject(WITH_POLICY.replace("one-side-safe", "together-ish"));
  try {
    const run = await bolt(["workspace", "sync", "--dry-run", "--json"], unknown);
    expect(run.code).toBe(3);
    const body = parseStdout(run.out);
    expect(body.ok).toBe(false);
    const errors = body.errors as Array<{ code: string; message: string }>;
    expect(errors[0].code).toBe("WORKSPACE_INVALID");
    expect(errors[0].message).toContain("sync_policy");
    expect(errors[0].message).not.toContain("POLICY_UNKNOWN");
  } finally {
    rmSync(unknown, { recursive: true, force: true });
  }

  const missing = tempProject(YAML, (root) => mkdirSync(path.join(root, "game")));
  try {
    const run = await bolt(["workspace", "sync", "--dry-run", "--json"], missing);
    expect(run.code).toBe(3);
    const body = parseStdout(run.out);
    expect(body.ok).toBe(false);
    const errors = body.errors as Array<{ code: string; message: string }>;
    expect(errors[0].code).toBe("WORKSPACE_INVALID");
    expect(errors[0].message).not.toContain("ROOT_MISSING");
    expect(run.out).not.toContain("ROOT_MISSING");
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }

  const bare = tempProject("version: 1\nproject:\n  name: Demo\n");
  try {
    const run = await bolt(["workspace", "sync", "--dry-run", "--json"], bare);
    expect(run.code).toBe(3);
    const body = parseStdout(run.out);
    expect((body.errors as Array<{ code: string }>)[0].code).toBe("WORKSPACE_INVALID");
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }

  const ready = tempProject(YAML, (root) => {
    mkdirSync(path.join(root, "engine"));
    mkdirSync(path.join(root, "game"));
  });
  try {
    const live = await bolt(["workspace", "sync", "--json"], ready);
    expect(live.code).toBe(2);
    const body = parseStdout(live.out);
    expect(body.ok).toBe(false);
    expect((body.errors as Array<{ code: string }>)[0].code).toBe("USAGE");
    const human = await bolt(["workspace", "sync"], ready);
    expect(human.code).toBe(2);
    expect(human.err).toContain("--dry-run");
    expect(human.out).not.toContain("target_rev");
    const builtin = await bolt(["workspace", "sync", "--dry-run", "--json"], ready);
    expect(builtin.code).toBe(3);
    const builtinBody = parseStdout(builtin.out);
    expect(builtinBody.ok).toBe(false);
    expect((builtinBody.errors as Array<{ code: string }>)[0].code).toBe("WORKSPACE_INVALID");
    expect(builtin.out).not.toContain("VCS_REVISION");
  } finally {
    rmSync(ready, { recursive: true, force: true });
  }
});
