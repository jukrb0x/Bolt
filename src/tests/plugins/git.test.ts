import { expect, test } from "bun:test";
import path from "path";
import gitPlugin from "../../plugins/git";
import { testCfg, mockRuntime, ENGINE_ROOT } from "../env";
import type { BoltPluginContext } from "../../plugin";
import { Logger } from "../../logger";

function makeCtx(dryRun = true): BoltPluginContext & { logged: string[] } {
  const logged: string[] = [];
  const logger = new Logger({ sink: (l: string) => logged.push(l) });
  return { cfg: testCfg, configDir: process.cwd(), dryRun, logger, logged, runtime: mockRuntime };
}

test("pull throws when path is missing", async () => {
  const ctx = makeCtx();
  await expect(gitPlugin.handlers["pull"]({}, ctx)).rejects.toThrow("path");
});

test("pull produces git pull command with default branch", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["pull"]({ path: ENGINE_ROOT }, ctx);
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
  await gitPlugin.handlers["pull"]({ path: ENGINE_ROOT, branch: "develop" }, ctx);
  expect(ctx.logged.some((l) => l.includes("develop"))).toBe(true);
});

test("status produces git status command", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["status"]({ path: ENGINE_ROOT }, ctx);
  expect(ctx.logged.some((l) => l.includes("git") && l.includes("status"))).toBe(true);
});

test("info runs without throwing and logs output", async () => {
  const root = path.resolve(ENGINE_ROOT);
  const ctx = { ...makeCtx(), configDir: root };
  const result = await gitPlugin.handlers["info"]({ path: root }, ctx);
  expect(ctx.logged.length).toBeGreaterThan(0);
  expect(result).toMatchObject({ status: "ok", data: { path: root } });
});

test("info: human run with ../Engine outside the project only warns", async () => {
  const ctx = makeCtx();
  const result = await gitPlugin.handlers["info"]({ path: "../Engine" }, ctx);
  const resolved = path.resolve(ctx.configDir, "../Engine");
  expect(result).toMatchObject({ data: { path: resolved } });
  const warning = ctx.logged.find((l) => l.includes("outside the project directory"));
  expect(warning).toContain("[WARN]");
  expect(warning).toContain("AI invocations of git/info will reject this path");
  expect(warning).toContain("Fix:");
});

test("info: the same path via an AI invocation is rejected with AI_FORBIDDEN", async () => {
  const ctx = { ...makeCtx(), aiInvocation: true };
  const call = gitPlugin.handlers["info"]({ path: "../Engine" }, ctx);
  await expect(call).rejects.toMatchObject({ code: "AI_FORBIDDEN" });
  await expect(gitPlugin.handlers["info"]({ path: "../Engine" }, ctx)).rejects.toThrow(
    /outside the project directory.*Fix:/,
  );
});

test("info resolves a relative path against the project directory", async () => {
  const ctx = makeCtx();
  const result = await gitPlugin.handlers["info"]({ path: "sub" }, ctx);
  expect(result).toMatchObject({ data: { path: path.join(ctx.configDir, "sub") } });
});

test("checkout produces git checkout command", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["checkout"]({ path: ENGINE_ROOT, branch: "main" }, ctx);
  expect(
    ctx.logged.some((l) => l.includes("git") && l.includes("checkout") && l.includes("main")),
  ).toBe(true);
});

test("checkout throws when branch is missing", async () => {
  const ctx = makeCtx();
  await expect(gitPlugin.handlers["checkout"]({}, ctx)).rejects.toThrow("branch");
});

test("clone produces git clone command", async () => {
  const ctx = makeCtx();
  await gitPlugin.handlers["clone"](
    { url: "https://github.com/example/repo", path: "C:/Repos/repo" },
    ctx,
  );
  expect(
    ctx.logged.some(
      (l) => l.includes("git clone") && l.includes("https://github.com/example/repo"),
    ),
  ).toBe(true);
});

test("clone throws when url is missing", async () => {
  const ctx = makeCtx();
  await expect(gitPlugin.handlers["clone"]({ path: "C:/Repos/repo" }, ctx)).rejects.toThrow("url");
});

test("clone throws when path is missing", async () => {
  const ctx = makeCtx();
  await expect(
    gitPlugin.handlers["clone"]({ url: "https://github.com/example/repo" }, ctx),
  ).rejects.toThrow("path");
});

test("pull does not read project.git_branch when path is missing", async () => {
  const logged: string[] = [];
  const logger = new Logger({ sink: (l: string) => logged.push(l) });
  const cfg = {
    ...testCfg,
    project: { ...testCfg.project, git_branch: "release/2.0" } as typeof testCfg.project,
  };
  const ctx = { cfg, configDir: process.cwd(), dryRun: true, logger, logged, runtime: mockRuntime };
  await expect(gitPlugin.handlers["pull"]({}, ctx)).rejects.toThrow("path");
});
