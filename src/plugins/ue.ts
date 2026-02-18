import type { BoltPlugin, BoltPluginContext } from "../plugin"
import path from "path"

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function exec(cmd: string): void {
  const proc = Bun.spawnSync(["cmd", "/c", cmd], { stdout: "inherit", stderr: "inherit" })
  if (proc.exitCode !== 0) throw new Error(`Command failed: ${cmd}`)
}

function run(cmd: string, ctx: BoltPluginContext): void {
  ctx.logger.info(cmd)
  if (!ctx.dryRun) exec(cmd)
}

const plugin: BoltPlugin = {
  namespace: "ue",
  handlers: {
    "build": async (params, ctx) => {
      const targetName = params.target
      const target = ctx.cfg.targets[targetName]
      if (!target) throw new Error(`Unknown target: "${targetName}"`)
      const buildType = capitalize(target.build_type)
      const uePath = ctx.cfg.project.ue_path
      const projFile = path.join(ctx.cfg.project.project_path, `${ctx.cfg.project.project_name}.uproject`)
      const targetBin = target.type === "editor"
        ? `${ctx.cfg.project.project_name}Editor`
        : (target.name ?? targetName)
      const cmd = `"${uePath}/Engine/Build/BatchFiles/Build.bat" ${targetBin} Win64 ${buildType} -Project="${projFile}" -WaitMutex`
      run(cmd, ctx)
    },

    "update": async (params, ctx) => {
      await plugin.handlers["update-git"](params, ctx)
      await plugin.handlers["update-svn"](params, ctx)
    },

    "update-git": async (params, ctx) => {
      const branch = ctx.cfg.project.git_branch ?? "main"
      run(`git -C "${ctx.cfg.project.ue_path}" pull origin ${branch} --autostash --no-edit`, ctx)
    },

    "update-svn": async (params, ctx) => {
      const root = ctx.cfg.project.svn_root ?? ctx.cfg.project.project_path
      run(`svn update "${root}" --non-interactive --trust-server-cert`, ctx)
    },

    "svn-cleanup": async (params, ctx) => {
      const root = ctx.cfg.project.svn_root ?? ctx.cfg.project.project_path
      run(`svn cleanup "${root}"`, ctx)
    },

    "svn-revert": async (params, ctx) => {
      const target = params.path ?? ctx.cfg.project.project_path
      run(`svn revert -R "${target}"`, ctx)
    },

    "generate-project": async (params, ctx) => {
      const uePath = ctx.cfg.project.ue_path
      const projFile = path.join(ctx.cfg.project.project_path, `${ctx.cfg.project.project_name}.uproject`)
      run(`"${uePath}/Engine/Build/BatchFiles/GenerateProjectFiles.bat" "${projFile}" -Game`, ctx)
    },

    "start": async (params, ctx) => {
      const uePath = ctx.cfg.project.ue_path
      const projFile = path.join(ctx.cfg.project.project_path, `${ctx.cfg.project.project_name}.uproject`)
      run(`"${uePath}/Engine/Binaries/Win64/UE4Editor.exe" "${projFile}"`, ctx)
    },

    "kill": async (params, ctx) => {
      run(`taskkill /f /im UE4Editor.exe`, ctx)
    },

    "fillddc": async (params, ctx) => {
      const uePath = ctx.cfg.project.ue_path
      const projFile = path.join(ctx.cfg.project.project_path, `${ctx.cfg.project.project_name}.uproject`)
      run(`"${uePath}/Engine/Binaries/Win64/UE4Editor-Cmd.exe" "${projFile}" -run=Automation RunTests FillDDCForPIETest -unattended -buildmachine -nullrhi`, ctx)
    },

    "ini-set": async (params, ctx) => {
      const { file, section, key, value } = params
      const projFile = path.join(ctx.cfg.project.project_path, file)
      ctx.logger.info(`ini-set ${file} [${section}] ${key}=${value}`)
      if (!ctx.dryRun) {
        const fs = require("fs")
        let content: string = fs.existsSync(projFile) ? fs.readFileSync(projFile, "utf8") : ""
        const pattern = new RegExp(`(\\[${section.replace(/\//g, "\\/")}\\][\\s\\S]*?)${key}=.*`, "m")
        if (pattern.test(content)) {
          content = content.replace(pattern, `$1${key}=${value}`)
        } else {
          content += `\n[${section}]\n${key}=${value}\n`
        }
        fs.writeFileSync(projFile, content)
      }
    },
  }
}

export default plugin
