import { expect, test } from "bun:test";
import path from "path";
import svnPlugin from "../../plugins/svn";
import { testCfg, mockRuntime, PROJECT_ROOT, tortoiseProcOnPath } from "../env";
import type { BoltPluginContext } from "../../plugin";
import { Logger } from "../../logger";

function makeCtx(
  dryRun = true,
  overrides: { use_tortoise?: boolean } = {},
): BoltPluginContext & { logged: string[] } {
  const logged: string[] = [];
  const logger = new Logger({ sink: (l: string) => logged.push(l) });
  const plugins =
    overrides.use_tortoise === undefined
      ? testCfg.plugins
      : [
          ...testCfg.plugins,
          {
            namespace: "svn",
            path: "test",
            config: { use_tortoise: overrides.use_tortoise },
          },
        ];
  return {
    cfg: { ...testCfg, plugins },
    configDir: process.cwd(),
    dryRun,
    logger,
    logged,
    runtime: mockRuntime,
  };
}

const atProject = { path: PROJECT_ROOT };

test("update throws when path is missing", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await expect(svnPlugin.handlers["update"]({}, ctx)).rejects.toThrow("path");
});

test("update produces svn update command", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["update"](atProject, ctx);
  expect(ctx.logged.some((l) => l.includes("svn update"))).toBe(true);
});

test("update uses with:path when provided", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["update"]({ path: "C:/CustomPath" }, ctx);
  expect(ctx.logged.some((l) => l.includes("C:/CustomPath"))).toBe(true);
});

test("cleanup with use_tortoise=false uses plain svn", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["cleanup"](atProject, ctx);
  expect(ctx.logged.some((l) => l.includes("svn cleanup"))).toBe(true);
  expect(ctx.logged.every((l) => !l.includes("TortoiseProc"))).toBe(true);
});

// TortoiseProc lookup overruns Bun's 5s default on a busy Windows runner.
test(
  "cleanup with use_tortoise=true throws when TortoiseProc absent",
  async () => {
    if (tortoiseProcOnPath()) return; // TortoiseProc present — skip
    const ctx = makeCtx(true, { use_tortoise: true });
    await expect(svnPlugin.handlers["cleanup"](atProject, ctx)).rejects.toThrow(
      "TortoiseProc.exe not found",
    );
  },
  process.platform === "win32" ? 60_000 : undefined,
);

test(
  "cleanup without use_tortoise uses svn when TortoiseProc absent",
  async () => {
    if (tortoiseProcOnPath()) return; // TortoiseProc present — skip
    const ctx = makeCtx();
    await svnPlugin.handlers["cleanup"](atProject, ctx);
    expect(ctx.logged.some((l) => l.includes("svn cleanup"))).toBe(true);
  },
  process.platform === "win32" ? 60_000 : undefined,
);

test("revert with use_tortoise=false uses plain svn", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["revert"](atProject, ctx);
  expect(ctx.logged.some((l) => l.includes("svn revert"))).toBe(true);
  expect(ctx.logged.every((l) => !l.includes("TortoiseProc"))).toBe(true);
});

test("revert uses with:path when provided", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["revert"]({ path: "C:/CustomPath" }, ctx);
  expect(ctx.logged.some((l) => l.includes("C:/CustomPath"))).toBe(true);
});

test("info: human run with ../Engine outside the project only warns", async () => {
  const ctx = makeCtx();
  await svnPlugin.handlers["info"]({ path: "../Engine" }, ctx);
  expect(
    ctx.logged.some((l) => l.includes("AI invocations of svn/info will reject this path")),
  ).toBe(true);
});

test("info runs without throwing and logs svn output", async () => {
  const root = path.resolve(PROJECT_ROOT);
  const ctx = { ...makeCtx(), configDir: root };
  await svnPlugin.handlers["info"]({ path: root }, ctx);
  expect(ctx.logged.length).toBeGreaterThan(0);
});

test("commit with use_tortoise=false produces svn commit command", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["commit"]({ ...atProject, message: "test commit" }, ctx);
  expect(ctx.logged.some((l) => l.includes("svn commit") && l.includes("test commit"))).toBe(true);
});

test("commit throws when message is missing and use_tortoise=false", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await expect(svnPlugin.handlers["commit"](atProject, ctx)).rejects.toThrow("message");
});

test("add produces svn add command", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["add"]({ path: "C:/Projects/NewFile.txt" }, ctx);
  expect(
    ctx.logged.some((l) => l.includes("svn add") && l.includes("C:/Projects/NewFile.txt")),
  ).toBe(true);
});

test("add throws when path is missing", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await expect(svnPlugin.handlers["add"]({}, ctx)).rejects.toThrow("path");
});

test("status produces svn status command", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["status"](atProject, ctx);
  expect(ctx.logged.some((l) => l.includes("svn status"))).toBe(true);
});
