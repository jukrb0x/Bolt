import { expect, test } from "bun:test";
import gitPlugin from "../../plugins/git";
import { testCfg, mockRuntime, ENGINE_ROOT } from "../env";
import type { BoltPluginContext } from "../../plugin";
import { Logger } from "../../logger";

function makeCtx(dryRun = true): BoltPluginContext & { logged: string[] } {
  const logged: string[] = [];
  const logger = new Logger({ sink: (l: string) => logged.push(l) });
  const cfg = { ...testCfg, project: { ...testCfg.project, engine_root: ENGINE_ROOT } };
  return { cfg, configDir: process.cwd(), dryRun, logger, logged, runtime: mockRuntime };
}

test("pull produces git pull command with default path and branch", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["pull"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("git") && l.includes("pull"))).toBe(true);
  expect(ctx.logged.some((l) => l.includes("origin"))).toBe(true);
});

test("pull uses with:path when provided", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["pull"]({ path: "C:/SomeRepo" }, ctx);
  expect(ctx.logged.some((l) => l.includes("C:/SomeRepo"))).toBe(true);
});

test("pull uses with:branch when provided", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["pull"]({ branch: "develop" }, ctx);
  expect(ctx.logged.some((l) => l.includes("develop"))).toBe(true);
});

test("status produces git status command", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["status"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("git") && l.includes("status"))).toBe(true);
});

test("info runs without throwing and logs output", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["info"]({}, ctx);
  expect(ctx.logged.length).toBeGreaterThan(0);
});

test("checkout produces git checkout command", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["checkout"]({ branch: "main" }, ctx);
  expect(ctx.logged.some((l) => l.includes("git") && l.includes("checkout") && l.includes("main"))).toBe(true);
});

test("checkout throws when branch is missing", async () => {
  const ctx = makeCtx();
  await expect(gitPlugin.handlers["checkout"]({}, ctx)).rejects.toThrow("branch");
});

test("clone produces git clone command", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["clone"]({ url: "https://github.com/example/repo", path: "C:/Repos/repo" }, ctx);
  expect(ctx.logged.some((l) => l.includes("git clone") && l.includes("https://github.com/example/repo"))).toBe(true);
});

test("clone throws when url is missing", async () => {
  const ctx = makeCtx();
  await expect(gitPlugin.handlers["clone"]({ path: "C:/Repos/repo" }, ctx)).rejects.toThrow("url");
});

test("clone throws when path is missing", async () => {
  const ctx = makeCtx();
  await expect(gitPlugin.handlers["clone"]({ url: "https://github.com/example/repo" }, ctx)).rejects.toThrow("path");
});

test("pull uses git_branch from config when branch param absent", async () => {
  const logged: string[] = [];
  const logger = new Logger({ sink: (l: string) => logged.push(l) });
  const cfg = { ...testCfg, project: { ...testCfg.project, git_branch: "release/2.0", engine_root: ENGINE_ROOT } };
  const ctx = { cfg, configDir: process.cwd(), dryRun: true, logger, logged, runtime: mockRuntime };
  await gitPlugin.handlers["pull"]({}, ctx);
  expect(logged.some((l) => l.includes("release/2.0"))).toBe(true);
});
