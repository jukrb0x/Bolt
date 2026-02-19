import type { BoltPlugin, BoltPluginContext } from "../plugin";
import { $ } from "bun";
import path from "path";

/** Normalise any path to Windows backslashes so cmd.exe handles it correctly. */
const w = (p: string) => p.replace(/\//g, "\\");

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function exec(cmd: string): void {
  // cmd /c with a quoted executable requires the whole command to be wrapped in an
  // extra pair of outer quotes, otherwise cmd.exe strips the first quote pair and
  // misinterprets the path (classic cmd.exe quirk).
  const proc = Bun.spawnSync(["cmd", "/c", `"${cmd}"`], { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) throw new Error(`Command failed: ${cmd}`);
}

function run(cmd: string, ctx: BoltPluginContext): void {
  ctx.logger.info(cmd);
  if (!ctx.dryRun) exec(cmd);
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
      const buildType = capitalize(target.build_type);
      const uePath = ctx.cfg.project.ue_path;
      const projFile = path.join(
        ctx.cfg.project.project_path,
        `${ctx.cfg.project.project_name}.uproject`,
      );
      const targetBin =
        target.type === "editor"
          ? `${ctx.cfg.project.project_name}Editor`
          : (target.name ?? targetName);
      const cmd = `"${w(uePath)}/Engine/Build/BatchFiles/Build.bat" ${targetBin} Win64 ${buildType} -Project="${projFile}" -WaitMutex`;
      run(cmd, ctx);
    },

    update: async (params, ctx) => {
      await plugin.handlers["update-git"](params, ctx);
      await plugin.handlers["update-svn"](params, ctx);
    },

    "update-git": async (params, ctx) => {
      const branch = ctx.cfg.project.git_branch ?? "main";
      run(`git -C "${ctx.cfg.project.ue_path}" pull origin ${branch} --autostash --no-edit`, ctx);
    },

    "update-svn": async (params, ctx) => {
      const root = ctx.cfg.project.svn_root ?? ctx.cfg.project.project_path;
      run(`svn update "${root}" --non-interactive --trust-server-cert`, ctx);
    },

    "svn-cleanup": async (params, ctx) => {
      const root = ctx.cfg.project.svn_root ?? ctx.cfg.project.project_path;
      run(`svn cleanup "${root}"`, ctx);
    },

    "svn-revert": async (params, ctx) => {
      const target = params.path ?? ctx.cfg.project.project_path;
      run(`svn revert -R "${target}"`, ctx);
    },

    "generate-project": async (params, ctx) => {
      const uePath = ctx.cfg.project.ue_path;
      const projFile = path.join(
        ctx.cfg.project.project_path,
        `${ctx.cfg.project.project_name}.uproject`,
      );
      run(`"${w(uePath)}/Engine/Build/BatchFiles/GenerateProjectFiles.bat" "${projFile}" -Game`, ctx);
    },

    start: async (params, ctx) => {
      const uePath = ctx.cfg.project.ue_path;
      const projFile = path.join(
        ctx.cfg.project.project_path,
        `${ctx.cfg.project.project_name}.uproject`,
      );
      const binDir = w(`${uePath}/Engine/Binaries/Win64`);

      // Map build type to exe suffix, matching UBS behaviour
      const suffixMap: Record<string, string> = {
        debug: "-Win64-Debug",
        shipping: "-Win64-Shipping",
        test: "-Win64-Test",
        development: "",
      };
      const buildType = (params.type ?? params.build_type ?? "development")
        .toString()
        .toLowerCase();
      const suffix = suffixMap[buildType] ?? "";

      // Try suffixed exe first (e.g. UE4Editor-Win64-Debug.exe), then plain,
      // then UnrealEditor variants for UE5.
      const { existsSync } = require("fs");
      const candidates = suffix
        ? [
            `${binDir}\\UE4Editor${suffix}.exe`,
            `${binDir}\\UnrealEditor${suffix}.exe`,
            `${binDir}\\UE4Editor.exe`,
            `${binDir}\\UnrealEditor.exe`,
          ]
        : [`${binDir}\\UE4Editor.exe`, `${binDir}\\UnrealEditor.exe`];

      const exePath = candidates.find(existsSync);
      if (!exePath) throw new Error(`No UE editor executable found in ${binDir}`);

      ctx.logger.info(`start "" "${exePath}" "${projFile}"`);
      if (!ctx.dryRun) {
        Bun.spawnSync(["cmd", "/c", "start", "", exePath, projFile], {
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
        ctx.logger.info(`taskkill /f /im ${p}`);
        if (!ctx.dryRun) await $`taskkill /f /im ${p}`.nothrow().quiet();
      }
    },

    fillddc: async (params, ctx) => {
      const uePath = ctx.cfg.project.ue_path;
      const projFile = path.join(
        ctx.cfg.project.project_path,
        `${ctx.cfg.project.project_name}.uproject`,
      );
      run(
        `"${w(uePath)}/Engine/Binaries/Win64/UE4Editor-Cmd.exe" "${projFile}" -run=Automation RunTests FillDDCForPIETest -unattended -buildmachine -nullrhi`,
        ctx,
      );
    },

    "ini-set": async (params, ctx) => {
      const { file, section, key, value } = params;
      const projFile = path.join(ctx.cfg.project.project_path, file);
      ctx.logger.info(`ini-set ${file} [${section}] ${key}=${value}`);
      if (!ctx.dryRun) {
        const fs = require("fs");
        let content: string = fs.existsSync(projFile) ? fs.readFileSync(projFile, "utf8") : "";
        const pattern = new RegExp(
          `(\\[${section.replace(/\//g, "\\/")}\\][\\s\\S]*?)${key}=.*`,
          "m",
        );
        if (pattern.test(content)) {
          content = content.replace(pattern, `$1${key}=${value}`);
        } else {
          content += `\n[${section}]\n${key}=${value}\n`;
        }
        fs.writeFileSync(projFile, content);
      }
    },

    "build-engine": async (params, ctx) => {
      const uePath = ctx.cfg.project.ue_path;
      const buildType = capitalize(params.build_type ?? "development");
      const setupCmd = `"${w(uePath)}/Setup.bat" --force`;
      const genCmd = `"${w(uePath)}/GenerateProjectFiles.bat"`;
      const buildCmd = `"${w(uePath)}/Engine/Build/BatchFiles/Build.bat" -Target="UE4Editor Win64 ${buildType}" -Target="ShaderCompileWorker Win64 Development -Quiet" -WaitMutex -FromMsBuild`;
      ctx.logger.info(setupCmd);
      if (!ctx.dryRun) {
        const { existsSync } = require("fs");
        if (existsSync(`${w(uePath)}/Setup.bat`)) exec(setupCmd);
      }
      ctx.logger.info(genCmd);
      if (!ctx.dryRun) {
        const { existsSync } = require("fs");
        if (existsSync(`${w(uePath)}/GenerateProjectFiles.bat`)) exec(genCmd);
      }
      run(buildCmd, ctx);
    },

    "build-program": async (params, ctx) => {
      const target = params.target;
      if (!target || target.trim() === "") {
        throw new Error(`No target specified. Use: bolt go build-program --target=<Name>`);
      }
      const buildType = capitalize(params.build_type ?? "development");
      const platform = params.platform ?? "Win64";
      const uePath = ctx.cfg.project.ue_path;
      const projFile = path.join(
        ctx.cfg.project.project_path,
        `${ctx.cfg.project.project_name}.uproject`,
      );
      const buildBat = `${w(uePath)}/Engine/Build/BatchFiles/Build.bat`;
      const cmd = `"${buildBat}" ${target} ${platform} ${buildType} -project="${projFile}" -WaitMutex -FromMsBuild`;
      run(cmd, ctx);
    },

    info: async (params, ctx) => {
      const uePath = ctx.cfg.project.ue_path;
      const svnRoot = ctx.cfg.project.svn_root ?? ctx.cfg.project.project_path;
      ctx.logger.info("=== VCS Info ===");
      const gitLog = Bun.spawnSync(
        ["git", "-C", uePath, "log", "-1", "--pretty=format:%h %s", "--no-walk"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (gitLog.exitCode === 0) {
        ctx.logger.info(`Git (engine): ${gitLog.stdout.toString().trim()}`);
      } else {
        ctx.logger.warn("Git info unavailable");
      }
      const gitBranch = Bun.spawnSync(["git", "-C", uePath, "rev-parse", "--abbrev-ref", "HEAD"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (gitBranch.exitCode === 0) {
        ctx.logger.info(`Git branch:   ${gitBranch.stdout.toString().trim()}`);
      }
      const svnInfo = Bun.spawnSync(["svn", "info", svnRoot], { stdout: "pipe", stderr: "pipe" });
      if (svnInfo.exitCode === 0) {
        for (const line of svnInfo.stdout.toString().split("\n")) {
          if (
            line.startsWith("URL:") ||
            line.startsWith("Revision:") ||
            line.startsWith("Last Changed Rev:")
          ) {
            ctx.logger.info(`SVN: ${line.trim()}`);
          }
        }
      } else {
        ctx.logger.warn("SVN info unavailable");
      }
    },

    "fix-dll": async (params, ctx) => {
      const { renameSync, mkdirSync } = require("fs");
      const uePath = ctx.cfg.project.ue_path;
      const projectPath = ctx.cfg.project.project_path;
      const trashDir = path.join(projectPath, ".bolt", "trash-dlls");
      const dirsToScan = [
        path.join(uePath, "Engine", "Binaries"),
        path.join(projectPath, "Binaries"),
        path.join(projectPath, "Plugins"),
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
