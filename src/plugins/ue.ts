import type { BoltPlugin, BoltPluginContext } from "../plugin";
import path from "path";
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
  const { existsSync, readdirSync, statSync } = require("fs");
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

const plugin: BoltPlugin = {
  namespace: "ue",
  handlers: {
    build: async (params, ctx) => {
      const targetName = params.target;
      const target = ctx.cfg.targets[targetName];
      if (!target) throw new Error(`Unknown target: "${targetName}"`);
      const buildType = capitalize((params.config as string | undefined) ?? target.config);
      const uePath = ctx.cfg.project.engine_repo.path;
      const projFile = ctx.cfg.project.uproject;
      const projectName = getProjectName(projFile);
      const targetBin =
        target.kind === "editor"
          ? `${projectName}Editor`
          : (target.name ?? targetName);
      const buildBat = `"${w(uePath)}/Engine/Build/BatchFiles/Build.bat"`;
      const cmd =
        target.kind === "editor"
          ? `${buildBat} -Target="${targetBin} Win64 ${buildType}" -Target="ShaderCompileWorker Win64 Development -Quiet" -Project="${projFile}" -WaitMutex`
          : `${buildBat} ${targetBin} Win64 ${buildType} -Project="${projFile}" -WaitMutex`;
      await run(cmd, ctx);
    },

    "update-engine": async (params, ctx) => {
      const repo = ctx.cfg.project.engine_repo;
      const vcs = repo.vcs ?? "git";
      if (vcs === "git") {
        await gitPlugin.handlers["pull"]({ path: repo.path, branch: repo.branch }, ctx);
      } else {
        await svnPlugin.handlers["update"]({ path: repo.path }, ctx);
      }
    },

    "update-project": async (params, ctx) => {
      const repo = ctx.cfg.project.project_repo;
      const vcs = repo.vcs ?? "svn";
      if (vcs === "git") {
        await gitPlugin.handlers["pull"]({ path: repo.path, branch: repo.branch }, ctx);
      } else {
        await svnPlugin.handlers["update"]({ path: repo.path }, ctx);
      }
    },

    "svn-cleanup": async (params, ctx) => {
      await svnPlugin.handlers["cleanup"]({ path: ctx.cfg.project.project_repo.path }, ctx);
    },

    "svn-revert": async (params, ctx) => {
      const p = params.path ?? ctx.cfg.project.project_repo.path;
      await svnPlugin.handlers["revert"]({ path: p }, ctx);
    },

    "generate-project": async (params, ctx) => {
      const uePath = ctx.cfg.project.engine_repo.path;
      const projFile = ctx.cfg.project.uproject;
      await run(
        `"${w(uePath)}/Engine/Build/BatchFiles/GenerateProjectFiles.bat" "${projFile}" -Game`,
        ctx,
      );
    },

    start: async (params, ctx) => {
      const { existsSync } = require("fs");
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
        exePath = candidates.find(existsSync);
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
        exePath = candidates.find(existsSync);
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
    },

    kill: async (params, ctx) => {
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
    },

    fillddc: async (params, ctx) => {
      const uePath = ctx.cfg.project.engine_repo.path;
      const projFile = ctx.cfg.project.uproject;
      await run(
        `"${w(uePath)}/Engine/Binaries/Win64/UE4Editor-Cmd.exe" "${projFile}" -run=Automation RunTests FillDDCForPIETest -unattended -buildmachine -nullrhi`,
        ctx,
      );
    },

    "ini-set": async (params, ctx) => {
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
    },

    "ini-get": async (params, ctx) => {
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
    },

    "ini-remove": async (params, ctx) => {
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
    },

    "ini-override": async (params, ctx) => {
      const { file, "override-file": overrideFile } = params;
      const projectPath = ctx.cfg.project.project_repo.path;
      const targetPath = path.join(projectPath, file);
      const overridePath = path.join(projectPath, overrideFile);

      ctx.logger.info(`ini-override: applying ${overrideFile} to ${file}`);

      if (!ctx.dryRun) {
        await ueIni.overrideIniData(targetPath, overridePath);
      }
    },

    "ini-read-all": async (params, ctx) => {
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
    },

    "build-engine": async (params, ctx) => {
      const uePath = ctx.cfg.project.engine_repo.path;
      const buildType = capitalize(params.config ?? "development");
      const setupCmd = `"${w(uePath)}/Setup.bat" --force`;
      const genCmd = `"${w(uePath)}/GenerateProjectFiles.bat"`;
      const buildCmd = `"${w(uePath)}/Engine/Build/BatchFiles/Build.bat" -Target="UE4Editor Win64 ${buildType}" -Target="ShaderCompileWorker Win64 Development -Quiet" -WaitMutex -FromMsBuild`;
      ctx.logger.cmd(setupCmd);
      if (!ctx.dryRun) {
        const { existsSync } = require("fs");
        if (existsSync(`${w(uePath)}/Setup.bat`)) exec(setupCmd);
      }
      ctx.logger.cmd(genCmd);
      if (!ctx.dryRun) {
        const { existsSync } = require("fs");
        if (existsSync(`${w(uePath)}/GenerateProjectFiles.bat`)) exec(genCmd);
      }
      await run(buildCmd, ctx);
    },

    "build-program": async (params, ctx) => {
      const target = params.target;
      if (!target || target.trim() === "") {
        throw new Error(`No target specified. Use: bolt go build-program --target=<Name>`);
      }
      const buildType = capitalize(params.config ?? "development");
      const platform = params.platform ?? "Win64";
      const uePath = ctx.cfg.project.engine_repo.path;
      const projFile = ctx.cfg.project.uproject;
      const buildBat = `${w(uePath)}/Engine/Build/BatchFiles/Build.bat`;
      const cmd = `"${buildBat}" ${target} ${platform} ${buildType} -project="${projFile}" -WaitMutex -FromMsBuild`;
      await run(cmd, ctx);
    },

    info: async (params, ctx) => {
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
    },

    "fix-dll": async (params, ctx) => {
      const { renameSync, mkdirSync } = require("fs");
      const uePath = ctx.cfg.project.engine_repo.path;
      const projectPath = ctx.cfg.project.project_repo.path;
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
    },
  },
};

export default plugin;
