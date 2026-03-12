import { PluginBase, handler } from "../plugin";
import type { BoltPluginContext } from "../plugin";
import path from "path";
import { existsSync, readdirSync, statSync, renameSync, mkdirSync } from "fs";
import { run, execRaw as exec } from "./helpers";
import gitPlugin from "./git";
import svnPlugin from "./svn";
import * as ueIni from "./ue-ini";

/** Normalise any path to Windows backslashes so cmd.exe handles it correctly. */
const w = (p: string) => p.replace(/\//g, "\\");

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Extract project name from .uproject file path (filename without extension) */
function getProjectName(uprojectPath: string): string {
  const basename = path.basename(uprojectPath);
  return basename.replace(/\.uproject$/i, "");
}

/** Get the directory containing the .uproject file */
function getProjectDir(uprojectPath: string): string {
  return path.dirname(uprojectPath);
}

function findZeroByteDlls(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.endsWith(".dll") && st.size === 0) results.push(full);
    }
  }
  return results;
}

class UEPlugin extends PluginBase {
  namespace = "ue";

  @handler("Build target: ${target} with config: ${config}")
  async build(params: Record<string, string>, ctx: BoltPluginContext) {
    const targetName = params.target;
    if (!targetName || targetName.trim() === "") {
      throw new Error(`No target specified for ue/build`);
    }

    const uePath = ctx.cfg.project.engine_repo.path;
    const buildType = capitalize(params.config ?? "development");
    const platform = params.platform ?? "Win64";
    const buildBat = `"${w(uePath)}/Engine/Build/BatchFiles/Build.bat"`;

    // "engine" is a reserved target that builds the engine from source
    if (targetName === "engine") {
      await this.setup({ force: "true" }, ctx);
      const genCmd = `"${w(uePath)}/GenerateProjectFiles.bat"`;
      ctx.logger.cmd(genCmd);
      if (!ctx.dryRun) {
        if (existsSync(`${w(uePath)}/GenerateProjectFiles.bat`)) await exec(genCmd, ctx);
      }
      const cmd = `${buildBat} -Target="UE4Editor ${platform} ${buildType}" -Target="ShaderCompileWorker ${platform} Development -Quiet" -WaitMutex -FromMsBuild`;
      await run(cmd, ctx);
      return;
    }

    const projFile = ctx.cfg.project.uproject;
    const target = ctx.cfg.targets[targetName];

    if (target) {
      // Known target from cfg.targets
      const effectiveConfig = capitalize((params.config as string | undefined) ?? target.config);
      const projectName = getProjectName(projFile);
      const targetBin =
        target.kind === "editor"
          ? `${projectName}Editor`
          : (target.name ?? targetName);
      const cmd =
        target.kind === "editor"
          ? `${buildBat} -Target="${targetBin} ${platform} ${effectiveConfig}" -Target="ShaderCompileWorker ${platform} Development -Quiet" -Project="${projFile}" -WaitMutex`
          : `${buildBat} ${targetBin} ${platform} ${effectiveConfig} -Project="${projFile}" -WaitMutex`;
      await run(cmd, ctx);
    } else {
      // Raw program target name (not in cfg.targets)
      const cmd = `${buildBat} ${targetName} ${platform} ${buildType} -project="${projFile}" -WaitMutex -FromMsBuild`;
      await run(cmd, ctx);
    }
  }

  @handler("Update engine repository")
  async update_engine(params: Record<string, string>, ctx: BoltPluginContext) {
    const repo = ctx.cfg.project.engine_repo;
    const vcs = repo.vcs ?? "git";
    if (vcs === "git") {
      await gitPlugin.handlers["pull"]({ path: repo.path, branch: repo.branch }, ctx);
    } else {
      await svnPlugin.handlers["update"]({ path: repo.path }, ctx);
    }
  }

  @handler("Update project repository")
  async update_project(params: Record<string, string>, ctx: BoltPluginContext) {
    const repo = ctx.cfg.project.project_repo;
    const vcs = repo.vcs ?? "svn";
    if (vcs === "git") {
      await gitPlugin.handlers["pull"]({ path: repo.path, branch: repo.branch }, ctx);
    } else {
      await svnPlugin.handlers["update"]({ path: repo.path }, ctx);
    }
  }

  @handler("SVN cleanup")
  async svn_cleanup(params: Record<string, string>, ctx: BoltPluginContext) {
    await svnPlugin.handlers["cleanup"]({ path: ctx.cfg.project.project_repo.path }, ctx);
  }

  @handler("SVN revert ${path}")
  async svn_revert(params: Record<string, string>, ctx: BoltPluginContext) {
    const p = params.path ?? ctx.cfg.project.project_repo.path;
    await svnPlugin.handlers["revert"]({ path: p }, ctx);
  }

  @handler("Run engine Setup.bat")
  async setup(params: Record<string, string>, ctx: BoltPluginContext) {
    const uePath = ctx.cfg.project.engine_repo.path;
    const setupBat = `${w(uePath)}\\Setup.bat`;
    if (!existsSync(setupBat)) {
      ctx.logger.warn(`Setup.bat not found at ${setupBat}, skipping`);
      return;
    }
    const force = (params.force ?? "true") === "true";
    const cmd = `"${setupBat}"${force ? " --force" : ""}`;
    await run(cmd, ctx);
  }

  @handler("Generate project files")
  async generate_project(params: Record<string, string>, ctx: BoltPluginContext) {
    const uePath = ctx.cfg.project.engine_repo.path;
    const projFile = ctx.cfg.project.uproject;
    await run(
      `"${w(uePath)}/Engine/Build/BatchFiles/GenerateProjectFiles.bat" "${projFile}" -Game`,
      ctx,
    );
  }

  @handler("Launch ${target} (${config})")
  async start(params: Record<string, string>, ctx: BoltPluginContext) {
    const uePath = ctx.cfg.project.engine_repo.path;
    const projFile = ctx.cfg.project.uproject;
    const projectDir = getProjectDir(projFile);

    const suffixMap: Record<string, string> = {
      debug: "-Win64-Debug",
      shipping: "-Win64-Shipping",
      test: "-Win64-Test",
      development: "",
    };
    const buildType = (params.config ?? "development").toString().toLowerCase();
    const suffix = suffixMap[buildType] ?? "";
    const platform = (params.platform as string | undefined) ?? "Win64";

    let exePath: string | undefined;

    if (params.target) {
      const t = params.target as string;
      const binName = `${t}${suffix}.exe`;
      const candidates = [
        path.join(projectDir, "Binaries", platform, binName),
        path.join(uePath, "Engine", "Binaries", platform, binName),
      ];
      ctx.logger.info(`Searching for ${binName}`);
      exePath = ctx.dryRun ? candidates[0] : candidates.find(existsSync);
      if (!exePath)
        throw new Error(`No binary found for target "${t}" in:\n  ${candidates.join("\n  ")}`);
    } else {
      const binDir = w(`${uePath}/Engine/Binaries/Win64`);
      const candidates = suffix
        ? [
            `${binDir}\\UE4Editor${suffix}.exe`,
            `${binDir}\\UnrealEditor${suffix}.exe`,
            `${binDir}\\UE4Editor.exe`,
            `${binDir}\\UnrealEditor.exe`,
          ]
        : [`${binDir}\\UE4Editor.exe`, `${binDir}\\UnrealEditor.exe`];
      exePath = ctx.dryRun ? candidates[0] : candidates.find(existsSync);
      if (!exePath) throw new Error(`No UE editor executable found in ${binDir}`);
    }

    ctx.logger.cmd(`start "" "${exePath}" "${projFile}"`);
    if (!ctx.dryRun) {
      ctx.runtime.spawnSync(["cmd", "/c", "start", "", exePath, projFile], {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
    }
  }

  @handler("Terminate all UE processes")
  async kill(params: Record<string, string>, ctx: BoltPluginContext) {
    const procs = [
      "UE4Editor.exe",
      "UE4Editor-Win64-Debug.exe",
      "UE4Editor-Cmd.exe",
      "UnrealEditor.exe",
      "UnrealEditor-Cmd.exe",
      "CrashReportClient.exe",
    ];
    for (const p of procs) {
      ctx.logger.cmd(`taskkill /f /im ${p}`);
      if (!ctx.dryRun) await ctx.runtime.spawn(["taskkill", "/f", "/im", p]).catch(() => {});
    }
  }

  @handler("Fill DDC for PIE")
  async fillddc(params: Record<string, string>, ctx: BoltPluginContext) {
    const uePath = ctx.cfg.project.engine_repo.path;
    const projFile = ctx.cfg.project.uproject;
    await run(
      `"${w(uePath)}/Engine/Binaries/Win64/UE4Editor-Cmd.exe" "${projFile}" -run=Automation RunTests FillDDCForPIETest -unattended -buildmachine -nullrhi`,
      ctx,
    );
  }

  @handler("Set INI ${file} [${section}] ${key}")
  async ini_set(params: Record<string, string>, ctx: BoltPluginContext) {
    const { file, section, key, value, "value-list": valueList, "insert-front": insertFront } = params;
    const projectPath = ctx.cfg.project.project_repo.path;
    const projFile = path.join(projectPath, file);

    // Parse value-list (semicolon-separated) if provided
    let finalValue: string | string[] | null = null;
    if (valueList && valueList.trim() !== "") {
      finalValue = valueList.split(";").filter((v: string) => v.trim() !== "");
    } else if (value !== undefined && value !== null) {
      finalValue = value;
    }

    const displayValue = Array.isArray(finalValue)
      ? finalValue.map((v) => `+${key}=${v}`).join(", ")
      : `${key}=${finalValue}`;
    ctx.logger.info(`ini-set ${file} [${section}] ${displayValue}`);

    if (!ctx.dryRun) {
      const options = { sectionInsertFront: insertFront === "true" };
      await ueIni.setSectionKeyValue(projFile, section, key, finalValue, options);
    }
  }

  @handler()
  async ini_get(params: Record<string, string>, ctx: BoltPluginContext) {
    const { file, section, key, type } = params;
    const projectPath = ctx.cfg.project.project_repo.path;
    const projFile = path.join(projectPath, file);

    const options = type ? { valueType: type as "string" | "number" | "boolean" } : undefined;
    const value = await ueIni.readIni(projFile, section, key, options);

    if (value === undefined) {
      ctx.logger.info(`ini-get: key "${key}" not found in section [${section}]`);
    } else if (Array.isArray(value)) {
      value.forEach((v) => ctx.logger.info(String(v)));
    } else {
      ctx.logger.info(String(value));
    }
  }

  @handler()
  async ini_remove(params: Record<string, string>, ctx: BoltPluginContext) {
    const { file, section, key } = params;
    const projectPath = ctx.cfg.project.project_repo.path;
    const projFile = path.join(projectPath, file);

    ctx.logger.info(`ini-remove ${file} [${section}] ${key}`);

    if (!ctx.dryRun) {
      const removed = await ueIni.removeSectionKey(projFile, section, key);
      if (!removed) {
        ctx.logger.warn(`ini-remove: key "${key}" not found in section [${section}]`);
      }
    }
  }

  @handler("Override INI ${file} with ${override-file}")
  async ini_override(params: Record<string, string>, ctx: BoltPluginContext) {
    const { file, "override-file": overrideFile } = params;
    const projectPath = ctx.cfg.project.project_repo.path;
    const targetPath = path.join(projectPath, file);
    const overridePath = path.join(projectPath, overrideFile);

    ctx.logger.info(`ini-override: applying ${overrideFile} to ${file}`);

    if (!ctx.dryRun) {
      await ueIni.overrideIniData(targetPath, overridePath);
    }
  }

  @handler()
  async ini_read_all(params: Record<string, string>, ctx: BoltPluginContext) {
    const { file } = params;
    const projectPath = ctx.cfg.project.project_repo.path;
    const projFile = path.join(projectPath, file);

    const data = await ueIni.readIniAll(projFile);

    for (const [section, keys] of Object.entries(data)) {
      ctx.logger.info(`[${section}]`);
      for (const [key, value] of Object.entries(keys)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            ctx.logger.info(`  +${key}=${v}`);
          }
        } else {
          ctx.logger.info(`  ${key}=${value}`);
        }
      }
    }
  }

  @handler("Build engine from source")
  async build_engine(params: Record<string, string>, ctx: BoltPluginContext) {
    await this.build({ ...params, target: "engine" }, ctx);
  }

  @handler("Build program ${target}")
  async build_program(params: Record<string, string>, ctx: BoltPluginContext) {
    if (!params.target || params.target.trim() === "") {
      throw new Error(`No target specified. Use: bolt go build-program --target=<Name>`);
    }
    await this.build(params, ctx);
  }

  @handler("Show VCS info")
  async info(params: Record<string, string>, ctx: BoltPluginContext) {
    ctx.logger.info("=== VCS Info ===");
    const engineVcs = ctx.cfg.project.engine_repo.vcs ?? "git";
    const projectVcs = ctx.cfg.project.project_repo.vcs ?? "svn";
    const enginePath = ctx.cfg.project.engine_repo.path;
    const projectPath = ctx.cfg.project.project_repo.path;

    if (engineVcs === "git") {
      await gitPlugin.handlers["info"]({ path: enginePath }, ctx);
    } else {
      await svnPlugin.handlers["info"]({ path: enginePath }, ctx);
    }
    if (projectVcs === "svn") {
      await svnPlugin.handlers["info"]({ path: projectPath }, ctx);
    } else {
      await gitPlugin.handlers["info"]({ path: projectPath }, ctx);
    }
  }

  @handler("Fix 0-byte DLL files")
  async fix_dll(params: Record<string, string>, ctx: BoltPluginContext) {
    const uePath = ctx.cfg.project.engine_repo.path;
    const projectDir = getProjectDir(ctx.cfg.project.uproject);
    const trashDir = path.join(projectDir, ".bolt", "trash-dlls");
    const dirsToScan = [
      path.join(uePath, "Engine", "Binaries"),
      path.join(projectDir, "Binaries"),
      path.join(projectDir, "Plugins"),
    ];
    const zeroDlls: string[] = [];
    for (const dir of dirsToScan) zeroDlls.push(...findZeroByteDlls(dir));
    if (zeroDlls.length === 0) {
      ctx.logger.info("fix-dll: no 0-byte DLL files found");
      return;
    }
    ctx.logger.info(`fix-dll: found ${zeroDlls.length} 0-byte DLL(s), moving to ${trashDir}`);
    mkdirSync(trashDir, { recursive: true });
    let moved = 0;
    for (const dll of zeroDlls) {
      const dest = path.join(trashDir, path.basename(dll));
      try {
        renameSync(dll, dest);
        ctx.logger.info(`  moved: ${path.basename(dll)}`);
        moved++;
      } catch (e: any) {
        ctx.logger.warn(`  failed to move ${dll}: ${e.message}`);
      }
    }
    ctx.logger.info(`fix-dll: moved ${moved}/${zeroDlls.length}`);
  }
}

export default new UEPlugin();
