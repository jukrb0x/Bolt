import { expect, test } from "bun:test";
import uePlugin from "../../plugins/ue";
import { testCfg, PROJECT_NAME } from "../env";
import type { BoltPluginContext } from "../../plugin";
import { Logger } from "../../logger";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import os from "os";

function makeCtx(dryRun = true): BoltPluginContext & { logged: string[] } {
  const logged: string[] = [];
  const logger = new Logger({ sink: (l: string) => logged.push(l) });
  return { cfg: testCfg, dryRun, logger, logged };
}

test("build editor target produces correct command", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build"]({ target: "editor" }, ctx);
  const cmd = ctx.logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Build.bat");
  expect(cmd).toContain(`${PROJECT_NAME}Editor`);
  expect(cmd).toContain("Development");
  expect(cmd).toContain(`${PROJECT_NAME}.uproject`);
});

test("build program target uses target.name", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build"]({ target: "client" }, ctx);
  const cmd = ctx.logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("MyClient");
  expect(cmd).toContain("Shipping");
});

test("build throws on unknown target", async () => {
  const ctx = makeCtx();
  await expect(uePlugin.handlers["build"]({ target: "nope" }, ctx)).rejects.toThrow(
    "Unknown target",
  );
});

test("update-git produces git pull command", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["update-git"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("git") && l.includes("pull"))).toBe(true);
});

test("update-svn produces svn update command", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["update-svn"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("svn update"))).toBe(true);
});

test("generate-project produces GenerateProjectFiles command", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["generate-project"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("GenerateProjectFiles.bat"))).toBe(true);
});

test("build-engine logs Setup.bat, GenerateProjectFiles.bat, and Build.bat -Target command", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build-engine"]({ build_type: "development" }, ctx);
  expect(ctx.logged.some((l) => l.includes("Setup.bat"))).toBe(true);
  expect(ctx.logged.some((l) => l.includes("GenerateProjectFiles.bat"))).toBe(true);
  const buildLine = ctx.logged.find((l) => l.includes("-Target=")) ?? "";
  expect(buildLine).toContain("UE4Editor");
  expect(buildLine).toContain("Win64");
  expect(buildLine).toContain("Development");
  expect(buildLine).toContain("ShaderCompileWorker");
});

test("build-engine defaults to development when build_type omitted", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build-engine"]({}, ctx);
  const buildLine = ctx.logged.find((l) => l.includes("-Target=")) ?? "";
  expect(buildLine).toContain("Development");
});

test("build-engine respects debug build_type", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build-engine"]({ build_type: "debug" }, ctx);
  const buildLine = ctx.logged.find((l) => l.includes("-Target=")) ?? "";
  expect(buildLine).toContain("Debug");
});

test("build-program produces Build.bat with -project= flag", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build-program"]({ target: "UnrealInsights" }, ctx);
  const cmd = ctx.logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("UnrealInsights");
  expect(cmd).toContain("-project=");
  expect(cmd).toContain(`${PROJECT_NAME}.uproject`);
  expect(cmd).toContain("Win64");
  expect(cmd).toContain("Development");
});

test("build-program respects build_type and platform params", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build-program"](
    { target: "AnvilSmith", build_type: "debug", platform: "Win64" },
    ctx,
  );
  const cmd = ctx.logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Debug");
  expect(cmd).toContain("Win64");
});

test("build-program throws when target is missing", async () => {
  const ctx = makeCtx();
  await expect(uePlugin.handlers["build-program"]({}, ctx)).rejects.toThrow("No target specified");
});

test("build-program throws when target is empty string", async () => {
  const ctx = makeCtx();
  await expect(uePlugin.handlers["build-program"]({ target: "" }, ctx)).rejects.toThrow(
    "No target specified",
  );
});

test("info runs without throwing and produces output", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["info"]({}, ctx);
  // info is read-only, runs even in dryRun, just verify no throw and some output
  expect(ctx.logged.length).toBeGreaterThan(0);
});

test("fix-dll moves 0-byte DLL files to trash dir", async () => {
  const fakeProject = `${os.tmpdir()}/bolt-fixdll-test`;
  const binariesDir = `${fakeProject}/Binaries`;
  mkdirSync(binariesDir, { recursive: true });
  writeFileSync(`${binariesDir}/zero.dll`, "");
  writeFileSync(`${binariesDir}/nonzero.dll`, "content");
  const fakeCfg = { ...testCfg, project: { ...testCfg.project, project_path: fakeProject } };
  const ctx2: BoltPluginContext = {
    cfg: fakeCfg,
    dryRun: false,
    logger: new Logger({ sink: () => {} }),
  };
  await uePlugin.handlers["fix-dll"]({}, ctx2);
  expect(existsSync(`${binariesDir}/zero.dll`)).toBe(false);
  expect(existsSync(`${binariesDir}/nonzero.dll`)).toBe(true);
  rmSync(fakeProject, { recursive: true, force: true });
});

test("fix-dll does not fail when no DLLs found", async () => {
  const fakeProject = `${os.tmpdir()}/bolt-fixdll-empty`;
  mkdirSync(fakeProject, { recursive: true });
  const fakeCfg = { ...testCfg, project: { ...testCfg.project, project_path: fakeProject } };
  const ctx2: BoltPluginContext = {
    cfg: fakeCfg,
    dryRun: false,
    logger: new Logger({ sink: () => {} }),
  };
  await uePlugin.handlers["fix-dll"]({}, ctx2);
  rmSync(fakeProject, { recursive: true, force: true });
});
