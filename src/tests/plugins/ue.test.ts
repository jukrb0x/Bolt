import { expect, test } from "bun:test";
import uePlugin from "../../plugins/ue";
import { testCfg, PROJECT_NAME, mockRuntime } from "../env";
import type { BoltPluginContext } from "../../plugin";
import { Logger } from "../../logger";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import os from "os";

function makeCtx(dryRun = true): BoltPluginContext & { logged: string[] } {
  const logged: string[] = [];
  const logger = new Logger({ sink: (l: string) => logged.push(l) });
  return { cfg: testCfg, configDir: process.cwd(), dryRun, logger, logged, runtime: mockRuntime };
}

test("build editor target produces correct command", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build"]({ target: "editor" }, ctx);
  const cmd = ctx.logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Build.bat");
  expect(cmd).toContain(`${PROJECT_NAME}Editor`);
  expect(cmd).toContain("Development");
  expect(cmd).toContain(`${PROJECT_NAME}.uproject`);
  expect(cmd).toContain(`-Target="${PROJECT_NAME}Editor Win64 Development"`);
  expect(cmd).toContain(`-Target="ShaderCompileWorker Win64 Development -Quiet"`);
});

test("build program target uses target.name", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build"]({ target: "client" }, ctx);
  const cmd = ctx.logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("MyClient");
  expect(cmd).toContain("Shipping");
});

test("build: params.config overrides target config", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build"]({ target: "editor", config: "debug" }, ctx);
  const cmd = ctx.logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain(`-Target="${PROJECT_NAME}Editor Win64 Debug"`);
  // SCW is always Development regardless of build type
  expect(cmd).toContain(`-Target="ShaderCompileWorker Win64 Development -Quiet"`);
});

test("build throws on unknown target", async () => {
  const ctx = makeCtx();
  await expect(uePlugin.handlers["build"]({ target: "nope" }, ctx)).rejects.toThrow(
    "Unknown target",
  );
});

test("update-engine produces git pull command (default vcs=git)", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["update-engine"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("git") && l.includes("pull"))).toBe(true);
});

test("update-project produces svn update command (default vcs=svn)", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["update-project"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("svn update"))).toBe(true);
});

test("generate-project produces GenerateProjectFiles command", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["generate-project"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("GenerateProjectFiles.bat"))).toBe(true);
});

test("build-engine logs Setup.bat, GenerateProjectFiles.bat, and Build.bat -Target command", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build-engine"]({ config: "development" }, ctx);
  expect(ctx.logged.some((l) => l.includes("Setup.bat"))).toBe(true);
  expect(ctx.logged.some((l) => l.includes("GenerateProjectFiles.bat"))).toBe(true);
  const buildLine = ctx.logged.find((l) => l.includes("-Target=")) ?? "";
  expect(buildLine).toContain("UE4Editor");
  expect(buildLine).toContain("Win64");
  expect(buildLine).toContain("Development");
  expect(buildLine).toContain("ShaderCompileWorker");
});

test("build-engine defaults to development when config omitted", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build-engine"]({}, ctx);
  const buildLine = ctx.logged.find((l) => l.includes("-Target=")) ?? "";
  expect(buildLine).toContain("Development");
});

test("build-engine respects debug config", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build-engine"]({ config: "debug" }, ctx);
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

test("build-program respects config and platform params", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build-program"](
    { target: "AnvilSmith", config: "debug", platform: "Win64" },
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
  const fakeCfg = { ...testCfg, project: { ...testCfg.project, project_root: fakeProject } };
  const ctx2: BoltPluginContext = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: false,
    logger: new Logger({ sink: () => {} }),
    runtime: mockRuntime,
  };
  await uePlugin.handlers["fix-dll"]({}, ctx2);
  expect(existsSync(`${binariesDir}/zero.dll`)).toBe(false);
  expect(existsSync(`${binariesDir}/nonzero.dll`)).toBe(true);
  rmSync(fakeProject, { recursive: true, force: true });
});

test("fix-dll does not fail when no DLLs found", async () => {
  const fakeProject = `${os.tmpdir()}/bolt-fixdll-empty`;
  mkdirSync(fakeProject, { recursive: true });
  const fakeCfg = { ...testCfg, project: { ...testCfg.project, project_root: fakeProject } };
  const ctx2: BoltPluginContext = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: false,
    logger: new Logger({ sink: () => {} }),
    runtime: mockRuntime,
  };
  await uePlugin.handlers["fix-dll"]({}, ctx2);
  rmSync(fakeProject, { recursive: true, force: true });
});

test("svn-cleanup with use_tortoise=false uses plain svn", async () => {
  const logged2: string[] = [];
  const fakeCfg = { ...testCfg, project: { ...testCfg.project, use_tortoise: false } };
  const ctx2 = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: (l: string) => logged2.push(l) }),
    logged: logged2,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["svn-cleanup"]({}, ctx2);
  expect(ctx2.logged.some((l) => l.includes("svn cleanup"))).toBe(true);
  expect(ctx2.logged.every((l) => !l.includes("TortoiseProc"))).toBe(true);
});

test("svn-revert with use_tortoise=false uses plain svn", async () => {
  const logged2: string[] = [];
  const fakeCfg = { ...testCfg, project: { ...testCfg.project, use_tortoise: false } };
  const ctx2 = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: (l: string) => logged2.push(l) }),
    logged: logged2,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["svn-revert"]({}, ctx2);
  expect(ctx2.logged.some((l) => l.includes("svn revert"))).toBe(true);
  expect(ctx2.logged.every((l) => !l.includes("TortoiseProc"))).toBe(true);
});

test("svn-cleanup with use_tortoise=true throws when TortoiseProc absent", async () => {
  const tp = Bun.spawnSync(["where", "TortoiseProc.exe"], { stdout: "pipe", stderr: "pipe" });
  if (tp.exitCode === 0) return; // TortoiseProc present — skip this test
  const fakeCfg = { ...testCfg, project: { ...testCfg.project, use_tortoise: true } };
  const ctx2 = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: () => {} }),
    logged: [] as string[],
    runtime: mockRuntime,
  };
  await expect(uePlugin.handlers["svn-cleanup"]({}, ctx2)).rejects.toThrow(
    "TortoiseProc.exe not found",
  );
});

test("svn-cleanup without use_tortoise uses svn when TortoiseProc absent", async () => {
  const tp = Bun.spawnSync(["where", "TortoiseProc.exe"], { stdout: "pipe", stderr: "pipe" });
  if (tp.exitCode === 0) return; // TortoiseProc present — auto-detect would use it, skip
  const logged2: string[] = [];
  const ctx2 = {
    cfg: testCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: (l: string) => logged2.push(l) }),
    logged: logged2,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["svn-cleanup"]({}, ctx2);
  expect(ctx2.logged.some((l) => l.includes("svn cleanup"))).toBe(true);
});

test("start without target logs editor exe", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["start"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("UE4Editor") || l.includes("UnrealEditor"))).toBe(true);
});

test("start with target logs target name", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["start"]({ target: "UnrealInsights" }, ctx).catch(() => {
    // binary may not exist in test env — that's fine
  });
  expect(ctx.logged.join("\n")).toContain("UnrealInsights");
});

test("start with target throws when binary not found", async () => {
  const ctx = makeCtx();
  await expect(
    uePlugin.handlers["start"]({ target: "NonExistentProgram_XYZ" }, ctx),
  ).rejects.toThrow("No binary found");
});

test("update-engine with engine_repo.vcs=svn calls svn update", async () => {
  const logged2: string[] = [];
  const fakeCfg = {
    ...testCfg,
    project: { ...testCfg.project, engine_repo: { ...testCfg.project.engine_repo, vcs: "svn" as const } },
  };
  const ctx2 = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: (l: string) => logged2.push(l) }),
    logged: logged2,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["update-engine"]({}, ctx2);
  expect(logged2.some((l) => l.includes("svn update"))).toBe(true);
});

test("update-project with project_repo.vcs=git calls git pull", async () => {
  const logged2: string[] = [];
  const fakeCfg = {
    ...testCfg,
    project: { ...testCfg.project, project_repo: { ...testCfg.project.project_repo, vcs: "git" as const } },
  };
  const ctx2 = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: (l: string) => logged2.push(l) }),
    logged: logged2,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["update-project"]({}, ctx2);
  expect(logged2.some((l) => l.includes("git") && l.includes("pull"))).toBe(true);
});
