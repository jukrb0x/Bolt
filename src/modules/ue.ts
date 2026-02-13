import type { BoltConfig } from "../config"
import path from "path"

interface UeModuleOptions {
  dryRun?: boolean
}

export class UeModule {
  private commandSink?: (cmd: string) => void

  constructor(private cfg: BoltConfig, private opts: UeModuleOptions = {}) {}

  onCommand(fn: (cmd: string) => void) { this.commandSink = fn }

  build(params: Record<string, string>): void {
    const targetName = params.target
    const target = this.cfg.targets[targetName]
    if (!target) throw new Error(`Unknown target: ${targetName}`)

    const buildType = this.capitalize(target.build_type)
    const platform = "Win64"
    const uePath = this.cfg.project.ue_path
    const projFile = path.join(this.cfg.project.project_path, `${this.cfg.project.project_name}.uproject`)

    const targetBin = target.type === "editor"
      ? `${this.cfg.project.project_name}Editor`
      : (target.name ?? targetName)

    const cmd = `"${uePath}/Engine/Build/BatchFiles/Build.bat" ${targetBin} ${platform} ${buildType} -Project="${projFile}" -WaitMutex`
    this.commandSink?.(cmd)
    if (!this.opts.dryRun) this.exec(cmd)
  }

  update(): void {
    this.gitPull()
    this.svnUpdate()
  }

  start(): void {
    const uePath = this.cfg.project.ue_path
    const projFile = path.join(this.cfg.project.project_path, `${this.cfg.project.project_name}.uproject`)
    const cmd = `"${uePath}/Engine/Binaries/Win64/UE4Editor.exe" "${projFile}"`
    this.commandSink?.(cmd)
    if (!this.opts.dryRun) this.exec(cmd)
  }

  kill(): void {
    const cmd = "taskkill /f /im UE4Editor.exe"
    this.commandSink?.(cmd)
    if (!this.opts.dryRun) this.exec(cmd)
  }

  fillddc(): void {
    const uePath = this.cfg.project.ue_path
    const projFile = path.join(this.cfg.project.project_path, `${this.cfg.project.project_name}.uproject`)
    const cmd = `"${uePath}/Engine/Binaries/Win64/UE4Editor-Cmd.exe" "${projFile}" -run=Automation RunTests FillDDCForPIETest -unattended -buildmachine -nullrhi`
    this.commandSink?.(cmd)
    if (!this.opts.dryRun) this.exec(cmd)
  }

  iniSet(params: Record<string, string>): void {
    const { file, section, key, value } = params
    const projFile = path.join(this.cfg.project.project_path, file)
    this.commandSink?.(`ini-set ${file} [${section}] ${key}=${value}`)
    if (!this.opts.dryRun) {
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
  }

  private gitPull(): void {
    const cmd = `git -C "${this.cfg.project.ue_path}" pull origin ${this.cfg.project.project_name} --autostash --no-edit`
    this.commandSink?.(cmd)
    if (!this.opts.dryRun) this.exec(cmd)
  }

  private svnUpdate(): void {
    const root = (this.cfg.project as any).svn_root ?? this.cfg.project.project_path
    const cmd = `svn update "${root}" --non-interactive --trust-server-cert`
    this.commandSink?.(cmd)
    if (!this.opts.dryRun) this.exec(cmd)
  }

  private exec(cmd: string): void {
    const proc = Bun.spawnSync(["cmd", "/c", cmd], { stdout: "inherit", stderr: "inherit" })
    if (proc.exitCode !== 0) throw new Error(`Command failed: ${cmd}`)
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
}
