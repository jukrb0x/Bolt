import { expect, test } from "bun:test";
import svnPlugin from "../../plugins/svn";
import { testCfg, mockRuntime, PROJECT_ROOT } from "../env";
import type { BoltPluginContext } from "../../plugin";
import { Logger } from "../../logger";

function makeCtx(dryRun = true, overrides: Partial<typeof testCfg.project> = {}): BoltPluginContext & { logged: string[] } {
  const logged: string[] = [];
  const logger = new Logger({ sink: (l: string) => logged.push(l) });
  const cfg = { ...testCfg, project: { ...testCfg.project, project_root: PROJECT_ROOT, ...overrides } };
  return { cfg, configDir: process.cwd(), dryRun, logger, logged, runtime: mockRuntime };
}

test("update produces svn update command", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["update"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("svn update"))).toBe(true);
});

test("update uses with:path when provided", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["update"]({ path: "C:/CustomPath" }, ctx);
  expect(ctx.logged.some((l) => l.includes("C:/CustomPath"))).toBe(true);
});

test("cleanup with use_tortoise=false uses plain svn", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["cleanup"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("svn cleanup"))).toBe(true);
  expect(ctx.logged.every((l) => !l.includes("TortoiseProc"))).toBe(true);
});

test("cleanup with use_tortoise=true throws when TortoiseProc absent", async () => {
  const tp = Bun.spawnSync(["where", "TortoiseProc.exe"], { stdout: "pipe", stderr: "pipe" });
  if (tp.exitCode === 0) return; // TortoiseProc present — skip
  const ctx = makeCtx(true, { use_tortoise: true });
  await expect(svnPlugin.handlers["cleanup"]({}, ctx)).rejects.toThrow("TortoiseProc.exe not found");
});

test("cleanup without use_tortoise uses svn when TortoiseProc absent", async () => {
  const tp = Bun.spawnSync(["where", "TortoiseProc.exe"], { stdout: "pipe", stderr: "pipe" });
  if (tp.exitCode === 0) return; // TortoiseProc present — skip
  const ctx = makeCtx();
  await svnPlugin.handlers["cleanup"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("svn cleanup"))).toBe(true);
});

test("revert with use_tortoise=false uses plain svn", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["revert"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("svn revert"))).toBe(true);
  expect(ctx.logged.every((l) => !l.includes("TortoiseProc"))).toBe(true);
});

test("revert uses with:path when provided", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["revert"]({ path: "C:/CustomPath" }, ctx);
  expect(ctx.logged.some((l) => l.includes("C:/CustomPath"))).toBe(true);
});

test("info runs without throwing and logs svn output", async () => {
  const ctx = makeCtx();
  await svnPlugin.handlers["info"]({}, ctx);
  expect(ctx.logged.length).toBeGreaterThan(0);
});

test("commit with use_tortoise=false produces svn commit command", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["commit"]({ message: "test commit" }, ctx);
  expect(ctx.logged.some((l) => l.includes("svn commit") && l.includes("test commit"))).toBe(true);
});

test("commit throws when message is missing and use_tortoise=false", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await expect(svnPlugin.handlers["commit"]({}, ctx)).rejects.toThrow("message");
});

test("add produces svn add command", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["add"]({ path: "C:/Projects/NewFile.txt" }, ctx);
  expect(ctx.logged.some((l) => l.includes("svn add") && l.includes("C:/Projects/NewFile.txt"))).toBe(true);
});

test("add throws when path is missing", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await expect(svnPlugin.handlers["add"]({}, ctx)).rejects.toThrow("path");
});

test("status produces svn status command", async () => {
  const ctx = makeCtx(true, { use_tortoise: false });
  await svnPlugin.handlers["status"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("svn status"))).toBe(true);
});
