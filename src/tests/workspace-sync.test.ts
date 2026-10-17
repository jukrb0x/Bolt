import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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
import {
  executeWorkspaceSync,
  formatWorkspacePlan,
  planWorkspaceSync,
  WorkspaceSyncError,
  type WorkspaceConfig,
} from "../workspace";

const REPO = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO, "src/main.ts");

const hasSvnadmin = Boolean(Bun.which("svnadmin"));

function readText(file: string): string {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

const YAML = `version: 1
project:
  name: Demo
workspace:
  roots:
    - id: engine
      path: ./engine
      role: engine
      vcs: git
      pin: null
    - id: game
      path: ./game
      role: project
      vcs: svn
  sync_policy: one-side-safe
`;

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
          calls.push(`${namespace}:${params.id}:${params.phase ?? "plan"}`);
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

function fixturePlugin(namespace: string, targetRev: string): string {
  return `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: ${JSON.stringify(namespace)},
  version: "0.0.0",
  description: "fixture planner",
  apiVersion: 2,
  handlers: {
    revision: defineHandler(
      { ai: true, capability: "vcs.revision", description: "plan a root" },
      async (params) => ({
        status: "ok",
        data: { action: "sync", target_rev: params.pin || ${JSON.stringify(targetRev)}, will_touch: true },
      }),
    ),
  },
});
`;
}

test("loadConfig keeps workspace roots in declaration order", async () => {
  const dir = tempProject(YAML);
  try {
    const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
    expect(cfg.workspace).toEqual({
      sync_policy: "one-side-safe",
      roots: [
        { id: "engine", path: "./engine", role: "engine", vcs: "git", pin: null },
        { id: "game", path: "./game", role: "project", vcs: "svn", pin: null },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("schema accepts workspace and rejects an unknown policy", async () => {
  expect(schemaErrors(boltConfigJsonSchema(), parse(YAML))).toEqual([]);
  expect(
    schemaErrors(boltConfigJsonSchema(), parse(YAML.replace("one-side-safe", "together"))),
  ).toEqual([]);
  expect(
    schemaErrors(boltConfigJsonSchema(), parse(YAML.replace("one-side-safe", "pin-rev"))),
  ).toEqual([]);
  const dir = tempProject(YAML.replace("one-side-safe", "one-side"));
  try {
    const checked = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(checked.ok).toBe(false);
    expect(checked.errors.some((error) => error.code === "POLICY_UNKNOWN")).toBe(true);
    expect(
      schemaErrors(boltConfigJsonSchema(), parse(YAML.replace("one-side-safe", "one-side"))).length,
    ).toBeGreaterThan(0);
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
  const workspace = (await loadConfig(path.join(dir, "bolt.yaml"))).workspace as WorkspaceConfig;
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
    expect(calls).toEqual(["git:engine:plan", "svn:game:plan"]);

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
    expect(calls).toEqual(["git:engine:plan"]);
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

test("dry-run json plans a git root and an svn root from fixture plugins", async () => {
  const game = path.join(os.tmpdir(), `bolt-a1a-game-${process.pid}`);
  mkdirSync(game, { recursive: true });
  const dir = tempProject(
    YAML.replace("path: ./game", `path: ${game.replaceAll("\\", "/")}`),
    (root) => {
      mkdirSync(path.join(root, "engine"));
      const gitDir = path.join(root, "plugins", "git");
      const svnDir = path.join(root, "plugins", "svn");
      mkdirSync(gitDir, { recursive: true });
      mkdirSync(svnDir, { recursive: true });
      writeFileSync(path.join(gitDir, "index.ts"), fixturePlugin("git", "abc"));
      writeFileSync(path.join(svnDir, "index.ts"), fixturePlugin("svn", "1234"));
      writeFileSync(
        path.join(root, "bolt.yaml"),
        `${YAML.replace("path: ./game", `path: ${game.replaceAll("\\", "/")}`)}
plugins:
  - namespace: svn
    path: ./plugins/svn
  - namespace: git
    path: ./plugins/git
`,
      );
    },
  );
  try {
    const run = await bolt(["workspace", "sync", "--dry-run", "--json"], dir);
    expect(run.code).toBe(0);
    const body = parseStdout(run.out);
    expect(body.schema).toBe("bolt.workspace.sync/v1");
    expect(body.bolt).toBe(VERSION);
    expect(body.ok).toBe(true);
    expect(body.errors).toEqual([]);
    const data = body.data as { policy: string; plan: Array<Record<string, unknown>> };
    expect(data).toEqual({
      policy: "one-side-safe",
      plan: [
        { root: "engine", action: "sync", target_rev: "abc", will_touch: true },
        { root: "game", action: "sync", target_rev: "1234", will_touch: true },
      ],
    });
    const human = await bolt(["workspace", "sync", "--dry-run"], dir);
    expect(human.code).toBe(0);
    expect(human.out.split("\n")[1].split(/\s+/)).toEqual([
      "root",
      "action",
      "target_rev",
      "will_touch",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(game, { recursive: true, force: true });
  }
});

test("unknown policy, missing root, and a sync without dry-run exit as specified", async () => {
  const unknown = tempProject(YAML.replace("one-side-safe", "together-ish"));
  try {
    const run = await bolt(["workspace", "sync", "--dry-run", "--json"], unknown);
    expect(run.code).toBe(3);
    const body = parseStdout(run.out);
    expect(body.ok).toBe(false);
    const errors = body.errors as Array<{ code: string; message: string }>;
    expect(errors[0].code).toBe("POLICY_UNKNOWN");
    expect(errors[0].message).toContain("together-ish");
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
    expect(errors[0].code).toBe("ROOT_MISSING");
    expect(errors[0].message).toContain("engine");
    expect(errors[0].message).toContain("./engine");
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
    expect(live.code).toBe(1);
    const body = parseStdout(live.out);
    expect(body.ok).toBe(false);
    expect(body.data).toBeNull();
    expect((body.errors as Array<{ code: string }>)[0].code).toBe("VCS_REVISION");
    const human = await bolt(["workspace", "sync"], ready);
    expect(human.code).toBe(1);
    expect(human.err).toContain("VCS_REVISION");
    expect(human.out).not.toContain("target_rev");
    const builtin = await bolt(["workspace", "sync", "--dry-run", "--json"], ready);
    expect(builtin.code).toBe(1);
    const builtinBody = parseStdout(builtin.out);
    expect(builtinBody.ok).toBe(false);
    expect((builtinBody.errors as Array<{ code: string }>)[0].code).toBe("VCS_REVISION");
  } finally {
    rmSync(ready, { recursive: true, force: true });
  }
});

function scripted(
  namespace: string,
  targetRev: string,
  calls: string[],
  opts?: { fail?: { phase: string; id: string; code: string }; willTouch?: boolean },
) {
  return definePlugin({
    namespace,
    version: "0.0.0",
    description: "fixture planner",
    apiVersion: 2,
    handlers: {
      revision: defineHandler(
        { ai: true, capability: "vcs.revision", description: "plan a root" },
        async (params) => {
          calls.push(`${params.phase}:${params.id}`);
          if (opts?.fail && params.phase === opts.fail.phase && params.id === opts.fail.id) {
            return {
              status: "fail" as const,
              summary: "denied",
              diagnostics: [{ level: "error" as const, code: opts.fail.code, message: "denied" }],
            };
          }
          return {
            status: "ok" as const,
            data: {
              action: "sync",
              target_rev: params.pin || targetRev,
              will_touch: opts?.willTouch ?? true,
            },
          };
        },
      ),
    },
  });
}

const THREE = YAML.replace(
  "  sync_policy: one-side-safe\n",
  `    - id: later
      path: ./later
      role: related
      vcs: git
  sync_policy: one-side-safe
`,
);

test("one-side-safe keeps the plan and freezes the failed root and the rest", async () => {
  const dir = tempProject(THREE, (root) => {
    mkdirSync(path.join(root, "engine"));
    mkdirSync(path.join(root, "game"));
    mkdirSync(path.join(root, "later"));
  });
  const calls: string[] = [];
  const registry = new PluginRegistry();
  registry.register(
    scripted("svn", "1234", calls, { fail: { phase: "sync", id: "game", code: "VCS_AUTH" } }),
  );
  registry.register(scripted("git", "abc", calls));
  try {
    const workspace = (await loadConfig(path.join(dir, "bolt.yaml"))).workspace as WorkspaceConfig;
    const error = await executeWorkspaceSync(
      workspace,
      dir,
      registry,
      createTestContext({ configDir: dir }),
    ).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(WorkspaceSyncError);
    const failed = error as WorkspaceSyncError;
    expect(failed.code).toBe("VCS_AUTH");
    expect(failed.data.plan.map((row) => row.root)).toEqual(["engine", "game", "later"]);
    expect(failed.data.plan.every((row) => row.will_touch)).toBe(true);
    expect(failed.data.touched).toEqual(["engine"]);
    expect(failed.data.frozen).toEqual(["game", "later"]);
    expect(failed.data.failed).toEqual([{ root: "game", code: "VCS_AUTH" }]);
    expect(calls.filter((call) => call.startsWith("sync:"))).toEqual(["sync:engine", "sync:game"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("together precheck failure updates nothing and clears will_touch", async () => {
  const dir = tempProject(THREE.replace("one-side-safe", "together"), (root) => {
    mkdirSync(path.join(root, "engine"));
    mkdirSync(path.join(root, "game"));
    mkdirSync(path.join(root, "later"));
  });
  const calls: string[] = [];
  const registry = new PluginRegistry();
  registry.register(
    scripted("svn", "1234", calls, { fail: { phase: "precheck", id: "game", code: "VCS_AUTH" } }),
  );
  registry.register(scripted("git", "abc", calls));
  try {
    const workspace = (await loadConfig(path.join(dir, "bolt.yaml"))).workspace as WorkspaceConfig;
    const error = await executeWorkspaceSync(
      workspace,
      dir,
      registry,
      createTestContext({ configDir: dir }),
    ).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(WorkspaceSyncError);
    const failed = error as WorkspaceSyncError;
    expect(failed.data.policy).toBe("together");
    expect(failed.data.plan.every((row) => row.will_touch === false)).toBe(true);
    expect(failed.data.touched).toEqual([]);
    expect(failed.data.frozen).toEqual(["engine", "game", "later"]);
    expect(failed.data.failed).toEqual([{ root: "game", code: "VCS_AUTH" }]);
    expect(calls.some((call) => call.startsWith("sync:"))).toBe(false);
    expect(calls.filter((call) => call.startsWith("precheck:"))).toEqual([
      "precheck:engine",
      "precheck:game",
      "precheck:later",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pin-rev syncs only a pinned root, and a false will_touch is frozen on success", async () => {
  const dir = tempProject(YAML, (root) => {
    mkdirSync(path.join(root, "engine"));
    mkdirSync(path.join(root, "game"));
  });
  const calls: string[] = [];
  const registry = new PluginRegistry();
  registry.register(scripted("svn", "1234", calls));
  registry.register(scripted("git", "abc", calls));
  try {
    const workspace = (await loadConfig(path.join(dir, "bolt.yaml"))).workspace as WorkspaceConfig;
    const pinned: WorkspaceConfig = {
      sync_policy: "pin-rev",
      roots: [{ ...workspace.roots[0], pin: "abc" }, workspace.roots[1]],
    };
    const pinResult = await executeWorkspaceSync(
      pinned,
      dir,
      registry,
      createTestContext({ configDir: dir }),
    );
    expect(pinResult.plan.map((row) => row.root)).toEqual(["engine"]);
    expect(pinResult.plan[0].target_rev).toBe("abc");
    expect(pinResult.touched).toEqual(["engine"]);
    expect(pinResult.frozen).toEqual([]);
    expect(pinResult.failed).toEqual([]);
    expect(calls).toEqual(["plan:engine", "sync:engine"]);

    calls.length = 0;
    const idle = new PluginRegistry();
    idle.register(scripted("git", "abc", calls, { willTouch: false }));
    idle.register(scripted("svn", "1234", calls, { willTouch: false }));
    const skipped = await executeWorkspaceSync(
      workspace,
      dir,
      idle,
      createTestContext({ configDir: dir }),
    );
    expect(skipped.touched).toEqual([]);
    expect(skipped.frozen).toEqual(["engine", "game"]);
    expect(skipped.failed).toEqual([]);
    expect(calls.some((call) => call.startsWith("sync:"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(
    [
      "git",
      "-c",
      "init.defaultBranch=main",
      "-c",
      "user.email=bolt@example.com",
      "-c",
      "user.name=Bolt",
      "-c",
      "advice.detachedHead=false",
      ...args,
    ],
    {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Bolt",
        GIT_AUTHOR_EMAIL: "bolt@example.com",
        GIT_COMMITTER_NAME: "Bolt",
        GIT_COMMITTER_EMAIL: "bolt@example.com",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`${args.join(" ")}: ${new TextDecoder().decode(result.stderr)}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function gitBehind(
  parent: string,
  name: string,
): { dir: string; origin: string; oldRev: string; newRev: string } {
  const origin = path.join(parent, `${name}-origin.git`);
  const seed = path.join(parent, `${name}-seed`);
  const dir = path.join(parent, name);
  git(parent, ["init", "--bare", origin]);
  git(parent, ["init", seed]);
  writeFileSync(path.join(seed, "README"), "v1\n");
  git(seed, ["add", "README"]);
  git(seed, ["commit", "-m", "v1"]);
  git(seed, ["branch", "-M", "main"]);
  git(seed, ["remote", "add", "origin", origin]);
  git(seed, ["push", "-u", "origin", "main"]);
  git(parent, ["clone", origin, dir]);
  const oldRev = git(dir, ["rev-parse", "HEAD"]);
  writeFileSync(path.join(seed, "README"), "v2\n");
  git(seed, ["commit", "-am", "v2"]);
  git(seed, ["push"]);
  return { dir, origin, oldRev, newRev: git(seed, ["rev-parse", "HEAD"]) };
}

function gitBrokenRemote(parent: string, name: string): string {
  const dir = path.join(parent, name);
  git(parent, ["init", dir]);
  writeFileSync(path.join(dir, "README"), "stay\n");
  git(dir, ["add", "README"]);
  git(dir, ["commit", "-m", "stay"]);
  git(dir, ["branch", "-M", "main"]);
  git(dir, ["remote", "add", "origin", path.join(parent, "missing.git")]);
  git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(dir, ["config", "branch.main.remote", "origin"]);
  git(dir, ["config", "branch.main.merge", "refs/heads/main"]);
  return dir;
}

function svnRun(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["svn", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${args.join(" ")}\n${new TextDecoder().decode(result.stderr)}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function svnBehind(parent: string, name: string): string {
  const repo = path.join(parent, `${name}-repo`);
  const seed = path.join(parent, `${name}-seed`);
  const dir = path.join(parent, name);
  const admin = Bun.spawnSync(["svnadmin", "create", repo], { stdout: "pipe", stderr: "pipe" });
  if (admin.exitCode !== 0) throw new Error(new TextDecoder().decode(admin.stderr));
  const url = `file://${repo}`;
  svnRun(["checkout", url, dir], parent);
  svnRun(["checkout", url, seed], parent);
  writeFileSync(path.join(seed, "note.txt"), "svn-v2\n");
  svnRun(["add", "note.txt"], seed);
  svnRun(["commit", "-m", "add note", "--non-interactive"], seed);
  return dir;
}

test.skipIf(!hasSvnadmin)(
  "dry-run leaves git and svn work trees alone, and sync updates both",
  async () => {
    const dir = tempProject(YAML);
    const engine = gitBehind(dir, "engine");
    svnBehind(dir, "game");
    try {
      const dry = await bolt(["workspace", "sync", "--dry-run", "--json"], dir);
      expect(dry.code).toBe(0);
      const dryBody = parseStdout(dry.out);
      const dryData = dryBody.data as {
        policy: string;
        plan: Array<{ root: string; action: string; target_rev: string; will_touch: boolean }>;
      };
      expect(dryData.policy).toBe("one-side-safe");
      expect(dryData.plan).toEqual([
        { root: "engine", action: "sync", target_rev: engine.oldRev, will_touch: true },
        { root: "game", action: "sync", target_rev: "1", will_touch: true },
      ]);
      expect(readText(path.join(dir, "engine", "README"))).toBe("v1\n");
      expect(svnRun(["info", "--show-item", "revision"], path.join(dir, "game"))).toBe("0");

      const live = await bolt(["workspace", "sync", "--json"], dir);
      expect(live.code).toBe(0);
      const body = parseStdout(live.out);
      expect(body.ok).toBe(true);
      expect(body.errors).toEqual([]);
      const data = body.data as {
        plan: unknown;
        touched: string[];
        frozen: string[];
        failed: unknown[];
      };
      expect(data.plan).toEqual(dryData.plan);
      expect(data.touched).toEqual(["engine", "game"]);
      expect(data.frozen).toEqual([]);
      expect(data.failed).toEqual([]);
      expect(readText(path.join(dir, "engine", "README"))).toBe("v2\n");
      expect(git(path.join(dir, "engine"), ["rev-parse", "HEAD"])).toBe(engine.newRev);
      expect(readText(path.join(dir, "game", "note.txt"))).toBe("svn-v2\n");

      const human = await bolt(["workspace", "sync"], dir);
      expect(human.code).toBe(0);
      expect(human.out).toContain("touched:");
      expect(human.out).toContain("frozen:");
      expect(human.out).toContain("failed:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("one-side-safe real sync freezes after a git failure and keeps plan[]", async () => {
  const yaml = `version: 1
project:
  name: Demo
workspace:
  roots:
    - id: engine
      path: ./engine
      role: engine
      vcs: git
    - id: broken
      path: ./broken
      role: project
      vcs: git
    - id: later
      path: ./later
      role: related
      vcs: git
  sync_policy: one-side-safe
`;
  const dir = tempProject(yaml);
  gitBehind(dir, "engine");
  gitBrokenRemote(dir, "broken");
  gitBehind(dir, "later");
  try {
    const live = await bolt(["workspace", "sync", "--json"], dir);
    expect(live.code).toBe(1);
    const body = parseStdout(live.out);
    expect(body.ok).toBe(false);
    const data = body.data as {
      plan: Array<{ root: string; will_touch: boolean }>;
      touched: string[];
      frozen: string[];
      failed: Array<{ root: string; code: string }>;
    };
    expect(data.plan.map((row) => row.root)).toEqual(["engine", "broken", "later"]);
    expect(data.plan.every((row) => row.will_touch)).toBe(true);
    expect(data.touched).toEqual(["engine"]);
    expect(data.frozen).toEqual(["broken", "later"]);
    expect(data.failed).toEqual([{ root: "broken", code: "VCS_SYNC" }]);
    expect((body.errors as Array<{ code: string }>)[0].code).toBe("VCS_SYNC");
    expect(readText(path.join(dir, "engine", "README"))).toBe("v2\n");
    expect(readText(path.join(dir, "later", "README"))).toBe("v1\n");
    expect(readText(path.join(dir, "broken", "README"))).toBe("stay\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("together precheck failure does not update an earlier git root", async () => {
  const yaml = `version: 1
project:
  name: Demo
workspace:
  roots:
    - id: engine
      path: ./engine
      role: engine
      vcs: git
    - id: broken
      path: ./broken
      role: project
      vcs: git
  sync_policy: together
`;
  const dir = tempProject(yaml);
  gitBehind(dir, "engine");
  gitBrokenRemote(dir, "broken");
  try {
    const live = await bolt(["workspace", "sync", "--json"], dir);
    expect(live.code).toBe(1);
    const body = parseStdout(live.out);
    const data = body.data as {
      plan: Array<{ will_touch: boolean }>;
      touched: string[];
      frozen: string[];
      failed: Array<{ root: string; code: string }>;
    };
    expect(data.plan.every((row) => row.will_touch === false)).toBe(true);
    expect(data.touched).toEqual([]);
    expect(data.frozen).toEqual(["engine", "broken"]);
    expect(data.failed).toEqual([{ root: "broken", code: "VCS_SYNC" }]);
    expect(readText(path.join(dir, "engine", "README"))).toBe("v1\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSvnadmin)(
  "pin-rev checks out the pin and leaves an unpinned svn root alone",
  async () => {
    const dir = tempProject("version: 1\nproject:\n  name: Demo\n");
    const engine = gitBehind(dir, "engine");
    const tip = path.join(dir, "tip");
    git(dir, ["clone", engine.origin, tip]);
    svnBehind(dir, "game");
    const yaml = `version: 1
project:
  name: Demo
workspace:
  roots:
    - id: engine
      path: ./tip
      role: engine
      vcs: git
      pin: ${engine.oldRev}
    - id: game
      path: ./game
      role: project
      vcs: svn
      pin: null
  sync_policy: pin-rev
`;
    writeFileSync(path.join(dir, "bolt.yaml"), yaml);
    try {
      expect(readText(path.join(tip, "README"))).toBe("v2\n");
      const live = await bolt(["workspace", "sync", "--json"], dir);
      expect(live.code).toBe(0);
      const data = (parseStdout(live.out).data ?? {}) as {
        plan: Array<{ root: string; action: string; target_rev: string; will_touch: boolean }>;
        touched: string[];
        frozen: string[];
        failed: unknown[];
      };
      expect(data.plan).toEqual([
        { root: "engine", action: "sync", target_rev: engine.oldRev, will_touch: true },
      ]);
      expect(data.touched).toEqual(["engine"]);
      expect(data.frozen).toEqual([]);
      expect(data.failed).toEqual([]);
      expect(readText(path.join(tip, "README"))).toBe("v1\n");
      expect(svnRun(["info", "--show-item", "revision"], path.join(dir, "game"))).toBe("0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("a git root with no upstream is an intentional frozen success", async () => {
  const dir = tempProject(
    YAML.replace("    - id: game\n      path: ./game\n      role: project\n      vcs: svn\n", ""),
  );
  git(dir, ["init", path.join(dir, "engine")]);
  writeFileSync(path.join(dir, "engine", "README"), "local\n");
  git(path.join(dir, "engine"), ["add", "README"]);
  git(path.join(dir, "engine"), ["commit", "-m", "local"]);
  try {
    const live = await bolt(["workspace", "sync", "--json"], dir);
    expect(live.code).toBe(0);
    const data = (parseStdout(live.out).data ?? {}) as {
      plan: Array<{ root: string; action: string; target_rev: string; will_touch: boolean }>;
      touched: string[];
      frozen: string[];
      failed: unknown[];
    };
    expect(data.plan).toEqual([
      {
        root: "engine",
        action: "sync",
        target_rev: git(path.join(dir, "engine"), ["rev-parse", "HEAD"]),
        will_touch: false,
      },
    ]);
    expect(data.touched).toEqual([]);
    expect(data.frozen).toEqual(["engine"]);
    expect(data.failed).toEqual([]);
    expect(readText(path.join(dir, "engine", "README"))).toBe("local\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
