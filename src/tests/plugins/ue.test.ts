import { expect, test } from "bun:test";
import uePlugin from "../../plugins/ue";
import { loadConfig } from "../../config";
import { run } from "../../api";
import { testCfg, PROJECT_NAME, mockRuntime, tortoiseProcOnPath, withUeConfig } from "../env";
import type { BoltPluginContext } from "../../plugin";
import { Logger } from "../../logger";
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "fs";
import os from "os";
import path from "path";

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

test.each(["debuggame", "dbggame", "DebugGame"])(
  "build editor renders %s as DebugGame",
  async (config) => {
    const ctx = makeCtx();
    await uePlugin.handlers["build"]({ target: "editor", config }, ctx);
    const cmd = ctx.logged.find((line) => line.includes("Build.bat")) ?? "";
    expect(cmd).toContain(`-Target="${PROJECT_NAME}Editor Win64 DebugGame"`);
  },
);

test("build rejects unknown config before shell execution", async () => {
  const ctx = makeCtx();
  await expect(
    uePlugin.handlers["build"]({ target: "editor", config: "profile" }, ctx),
  ).rejects.toThrow('Unknown build configuration "profile"');
  expect(ctx.logged.some((line) => line.includes("Build.bat"))).toBe(false);
});

test("build with unknown target falls back to raw program build", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build"]({ target: "CustomProgram" }, ctx);
  const cmd = ctx.logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("CustomProgram");
});

test("build throws when no target specified", async () => {
  const ctx = makeCtx();
  await expect(uePlugin.handlers["build"]({}, ctx)).rejects.toThrow("No target specified");
});

test("build with target=engine runs setup and engine build", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build"]({ target: "engine" }, ctx);
  const cmds = ctx.logged.join("\n");
  expect(cmds).toContain("Build.bat");
  expect(cmds).toContain("UE4Editor");
});

test("update-engine produces git pull command (default vcs=git)", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["update_engine"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("pull origin main"))).toBe(true);
});

test("update-project produces svn update command (default vcs=svn)", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["update_project"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("svn update"))).toBe(true);
});

test("generate-project produces GenerateProjectFiles command", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["generate_project"]({}, ctx);
  expect(ctx.logged.some((l) => l.includes("GenerateProjectFiles.bat"))).toBe(true);
});

test("build-engine logs Setup.bat, GenerateProjectFiles.bat, and Build.bat -Target command", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build_engine"]({ config: "development" }, ctx);
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
  await uePlugin.handlers["build_engine"]({}, ctx);
  const buildLine = ctx.logged.find((l) => l.includes("-Target=")) ?? "";
  expect(buildLine).toContain("Development");
});

test("build-engine respects debug config", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build_engine"]({ config: "debug" }, ctx);
  const buildLine = ctx.logged.find((l) => l.includes("-Target=")) ?? "";
  expect(buildLine).toContain("Debug");
});

test("build-program produces Build.bat with -project= flag", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build_program"]({ target: "UnrealInsights" }, ctx);
  const cmd = ctx.logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("UnrealInsights");
  expect(cmd).toContain("-project=");
  expect(cmd).toContain(`${PROJECT_NAME}.uproject`);
  expect(cmd).toContain("Win64");
  expect(cmd).toContain("Development");
});

test("build-program respects config and platform params", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build_program"](
    { target: "AnvilSmith", config: "debug", platform: "Win64" },
    ctx,
  );
  const cmd = ctx.logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Debug");
  expect(cmd).toContain("Win64");
});

test("build-program throws when target is missing", async () => {
  const ctx = makeCtx();
  await expect(uePlugin.handlers["build_program"]({}, ctx)).rejects.toThrow("No target specified");
});

test("build-program throws when target is empty string", async () => {
  const ctx = makeCtx();
  await expect(uePlugin.handlers["build_program"]({ target: "" }, ctx)).rejects.toThrow(
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
  const fakeCfg = withUeConfig({ uproject: `${fakeProject}/Test.uproject` });
  const ctx2: BoltPluginContext = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: false,
    logger: new Logger({ sink: () => {} }),
    runtime: mockRuntime,
  };
  await uePlugin.handlers["fix_dll"]({}, ctx2);
  expect(existsSync(`${binariesDir}/zero.dll`)).toBe(false);
  expect(existsSync(`${binariesDir}/nonzero.dll`)).toBe(true);
  rmSync(fakeProject, { recursive: true, force: true });
});

test("fix-dll does not fail when no DLLs found", async () => {
  const fakeProject = `${os.tmpdir()}/bolt-fixdll-empty`;
  mkdirSync(fakeProject, { recursive: true });
  const fakeCfg = withUeConfig({ uproject: `${fakeProject}/Test.uproject` });
  const ctx2: BoltPluginContext = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: false,
    logger: new Logger({ sink: () => {} }),
    runtime: mockRuntime,
  };
  await uePlugin.handlers["fix_dll"]({}, ctx2);
  rmSync(fakeProject, { recursive: true, force: true });
});

function withTortoise(use_tortoise: boolean) {
  return {
    ...testCfg,
    plugins: [...testCfg.plugins, { namespace: "svn", path: "test", config: { use_tortoise } }],
  };
}

test("svn-cleanup with use_tortoise=false uses plain svn", async () => {
  const logged2: string[] = [];
  const fakeCfg = withTortoise(false);
  const ctx2 = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: (l: string) => logged2.push(l) }),
    logged: logged2,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["svn_cleanup"]({}, ctx2);
  expect(ctx2.logged.some((l) => l.includes("svn cleanup"))).toBe(true);
  expect(ctx2.logged.every((l) => !l.includes("TortoiseProc"))).toBe(true);
});

test("svn-revert with use_tortoise=false uses plain svn", async () => {
  const logged2: string[] = [];
  const fakeCfg = withTortoise(false);
  const ctx2 = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: (l: string) => logged2.push(l) }),
    logged: logged2,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["svn_revert"]({}, ctx2);
  expect(ctx2.logged.some((l) => l.includes("svn revert"))).toBe(true);
  expect(ctx2.logged.every((l) => !l.includes("TortoiseProc"))).toBe(true);
});

test("svn-cleanup with use_tortoise=true throws when TortoiseProc absent", async () => {
  if (tortoiseProcOnPath()) return; // TortoiseProc present — skip this test
  const fakeCfg = withTortoise(true);
  const ctx2 = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: () => {} }),
    logged: [] as string[],
    runtime: mockRuntime,
  };
  await expect(uePlugin.handlers["svn_cleanup"]({}, ctx2)).rejects.toThrow(
    "TortoiseProc.exe not found",
  );
});

test("svn-cleanup without use_tortoise uses svn when TortoiseProc absent", async () => {
  if (tortoiseProcOnPath()) return; // TortoiseProc present — auto-detect would use it, skip
  const logged2: string[] = [];
  const ctx2 = {
    cfg: testCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: (l: string) => logged2.push(l) }),
    logged: logged2,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["svn_cleanup"]({}, ctx2);
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
  const ctx = makeCtx(false);
  await expect(
    uePlugin.handlers["start"]({ target: "NonExistentProgram_XYZ" }, ctx),
  ).rejects.toThrow("No binary found");
});

test("update-engine with engine.vcs=svn calls svn update", async () => {
  const logged2: string[] = [];
  const fakeCfg = withUeConfig({ engine: { vcs: "svn" } });
  const ctx2 = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: (l: string) => logged2.push(l) }),
    logged: logged2,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["update_engine"]({}, ctx2);
  expect(logged2.some((l) => l.includes("svn update"))).toBe(true);
});

test("build accepts the dev config alias", async () => {
  const ctx = makeCtx();
  await uePlugin.handlers["build"]({ target: "editor", config: "dev" }, ctx);
  const cmd = ctx.logged.find((line) => line.includes("Build.bat")) ?? "";
  expect(cmd).toContain(`-Target="${PROJECT_NAME}Editor Win64 Development"`);
});

test("build reads pathless ue config from bolt.yaml", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-ue-"));
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    [
      "version: 1",
      "project: { name: FromFile }",
      "plugins:",
      "  - namespace: ue",
      "    config:",
      `      engine: { path: ${JSON.stringify(path.join(dir, "engine"))}, vcs: git }`,
      `      project: { path: ${JSON.stringify(path.join(dir, "project"))}, vcs: svn }`,
      `      uproject: ${JSON.stringify(path.join(dir, "project", "FromFile.uproject"))}`,
      "      targets:",
      "        editor: { kind: editor, config: development }",
    ].join("\n"),
  );
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.plugins).toEqual([
    {
      namespace: "ue",
      config: {
        engine: { path: path.join(dir, "engine"), vcs: "git" },
        project: { path: path.join(dir, "project"), vcs: "svn" },
        uproject: path.join(dir, "project", "FromFile.uproject"),
        targets: { editor: { kind: "editor", config: "development" } },
      },
    },
  ]);
  const logged: string[] = [];
  const ctx: BoltPluginContext & { logged: string[] } = {
    cfg,
    configDir: dir,
    dryRun: true,
    logger: new Logger({ sink: (line) => logged.push(line) }),
    logged,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["build"]({ target: "editor" }, ctx);
  const cmd = logged.find((line) => line.includes("Build.bat")) ?? "";
  expect(cmd).toContain("FromFileEditor");
  expect(cmd).toContain(path.join(dir, "engine").replace(/\//g, "\\"));
});

test("update-project with project.vcs=git calls git pull", async () => {
  const logged2: string[] = [];
  const fakeCfg = withUeConfig({ project: { vcs: "git" } });
  const ctx2 = {
    cfg: fakeCfg,
    configDir: process.cwd(),
    dryRun: true,
    logger: new Logger({ sink: (l: string) => logged2.push(l) }),
    logged: logged2,
    runtime: mockRuntime,
  };
  await uePlugin.handlers["update_project"]({}, ctx2);
  expect(logged2.some((l) => l.includes("pull origin main"))).toBe(true);
});

function ueBuildYaml(engine: string, project: string, uproject: string): string {
  return [
    "version: 1",
    "project: { name: FromFile }",
    "tasks:",
    "  build: [{ uses: ue/build, with: { target: editor } }]",
    "plugins:",
    "  - namespace: ue",
    "    config:",
    `      engine: { path: ${JSON.stringify(engine)}, vcs: git }`,
    `      project: { path: ${JSON.stringify(project)}, vcs: svn }`,
    `      uproject: ${JSON.stringify(uproject)}`,
    "      targets:",
    "        editor: { kind: editor, config: development }",
  ].join("\n");
}

test("run() uses pathless ue config when configPath is outside cwd", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-ue-run-"));
  const other = mkdtempSync(path.join(os.tmpdir(), "bolt-ue-cwd-"));
  const engine = "./engine";
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    ueBuildYaml(engine, "./project", "./project/FromFile.uproject"),
  );
  writeFileSync(
    path.join(other, "bolt.yaml"),
    ueBuildYaml("/decoy/engine", "/decoy/project", "/decoy/project/Decoy.uproject"),
  );
  const logged: string[] = [];
  await run("build", {
    configPath: path.join(dir, "bolt.yaml"),
    cwd: other,
    dryRun: true,
    runtime: mockRuntime,
    logger: new Logger({ sink: (line) => logged.push(line) }),
  });
  const cmd = logged.find((line) => line.includes("Build.bat")) ?? "";
  expect(cmd).toContain(path.join(dir, "engine").replace(/\//g, "\\"));
  expect(cmd).not.toContain("decoy");
});

test("run() uses pathless ue config from opts.config", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-ue-mem-"));
  const other = mkdtempSync(path.join(os.tmpdir(), "bolt-ue-mem-cwd-"));
  const engine = path.join(dir, "engine");
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    ueBuildYaml(engine, path.join(dir, "project"), path.join(dir, "project", "FromFile.uproject")),
  );
  writeFileSync(
    path.join(other, "bolt.yaml"),
    ueBuildYaml("/decoy/engine", "/decoy/project", "/decoy/project/Decoy.uproject"),
  );
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.plugins[0]?.path).toBeUndefined();
  const logged: string[] = [];
  await run("build", {
    config: cfg,
    cwd: other,
    dryRun: true,
    runtime: mockRuntime,
    logger: new Logger({ sink: (line) => logged.push(line) }),
  });
  const cmd = logged.find((line) => line.includes("Build.bat")) ?? "";
  expect(cmd).toContain(engine.replace(/\//g, "\\"));
  expect(cmd).not.toContain("decoy");
});
