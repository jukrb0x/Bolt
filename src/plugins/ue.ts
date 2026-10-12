import { PluginBase, handler } from "../plugin";
import type { BoltPluginContext } from "../plugin";
import path from "path";
import { existsSync, readdirSync, statSync, renameSync, mkdirSync } from "fs";
import { z } from "zod";
import { declaredPluginConfig, run, execRaw as exec } from "./helpers";
import gitPlugin from "./git";
import svnPlugin from "./svn";
import * as ueIni from "./ue-ini";
import { BuildConfigSchema, normalizeBuildConfig, toUnrealBuildConfig } from "../build-config";
import type { BuildConfig } from "../build-config";

const RepoSchema = z.object({
  path: z.string().min(1),
  vcs: z.enum(["git", "svn"]).default("git"),
  url: z.string().optional(),
  branch: z.string().optional(),
});

const TargetSchema = z.object({
  kind: z.enum(["editor", "program", "game", "client", "server"]),
  name: z.string().optional(),
  config: BuildConfigSchema.default("development"),
});

/** UE plugin metadata. Validated here, not by the core bolt.yaml schema. */
export const ueConfigSchema = z.object({
  engine: RepoSchema,
  project: RepoSchema,
  uproject: z.string().min(1),
  targets: z.record(TargetSchema).default({}),
});

export interface UeTarget {
  kind: "editor" | "program" | "game" | "client" | "server";
  name?: string;
  config: BuildConfig;
}

export interface UeConfig {
  engine: { path: string; vcs: "git" | "svn"; url?: string; branch?: string };
  project: { path: string; vcs: "git" | "svn"; url?: string; branch?: string };
  uproject: string;
  targets: Record<string, UeTarget>;
}

function resolveAgainst(configDir: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(configDir, value);
}

export function ueMetadataErrors(plugins: unknown): Array<{ path: string; message: string }> {
  if (!Array.isArray(plugins)) return [];
  const entry = plugins.find(
    (item) =>
      !!item && typeof item === "object" && (item as { namespace?: unknown }).namespace === "ue",
  ) as { config?: unknown } | undefined;
  if (!entry) return [];
  const result = ueConfigSchema.safeParse(entry.config);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: ["plugins", "ue", "config", ...issue.path.map(String)].join("."),
    message: issue.message,
  }));
}

export function tasksReferenceUe(tasks: unknown): boolean {
  if (!tasks || typeof tasks !== "object") return false;
  for (const steps of Object.values(tasks as Record<string, unknown>)) {
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const uses = (step as { uses?: unknown }).uses;
      if (typeof uses === "string" && uses.startsWith("ue/")) return true;
    }
  }
  return false;
}

/**
 * Targets from the ue plugin entry. `config` is the canonical build config
 * (`debuggame`, not `DebugGame`). A missing or invalid ue config yields {}.
 */
export function resolveUeTargets(
  plugins: ReadonlyArray<{ namespace: string; config?: unknown }> | undefined,
): Record<string, UeTarget> {
  const raw = plugins?.find((entry) => entry.namespace === "ue")?.config;
  if (raw === undefined) return {};
  const result = ueConfigSchema.safeParse(raw);
  if (!result.success) return {};
  return result.data.targets;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("\n");
}

function ueConfig(ctx: BoltPluginContext): UeConfig {
  const raw = declaredPluginConfig(ctx, "ue");
  if (raw === undefined) {
    throw new Error(
      "ue plugin config is missing. Declare it under plugins: [{ namespace: ue, config: { engine, project, uproject, targets } }]",
    );
  }
  const result = ueConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config for plugin "ue":\n${formatIssues(result.error)}`);
  }
  const data = result.data;
  return {
    engine: { ...data.engine, path: resolveAgainst(ctx.configDir, data.engine.path) },
    project: { ...data.project, path: resolveAgainst(ctx.configDir, data.project.path) },
    uproject: resolveAgainst(ctx.configDir, data.uproject),
    targets: resolveUeTargets(ctx.cfg.plugins),
  };
}

/** Normalise any path to Windows backslashes so cmd.exe handles it correctly. */
const w = (p: string) => p.replace(/\//g, "\\");

/**
 * Production commands target Windows batch files (.bat / .exe, backslashes).
 * End-to-end tests set BOLT_E2E_UE_SHELL so those handlers can execute a fake
 * script instead of a PE binary. Unset, the strings stay the Windows forms.
 * - posix: forward slashes and .sh
 * - cmd: backslashes, .bat unchanged, .exe rewritten to .cmd
 */
function e2eUeShell(): "posix" | "cmd" | undefined {
  const value = process.env.BOLT_E2E_UE_SHELL;
  if (value === "posix" || value === "cmd") return value;
  return undefined;
}

/** Engine-relative script. Unset matches the historical `w(root)/rel` form. */
function ueScript(root: string, winRel: string): string {
  const mode = e2eUeShell();
  if (mode === "posix") {
    const rel = winRel.replace(/\.bat$/i, ".sh").replace(/\.exe$/i, ".sh");
    return `${root}/${rel}`;
  }
  const rel = mode === "cmd" ? winRel.replace(/\.exe$/i, ".cmd") : winRel;
  return `${w(root)}/${rel}`;
}

/** Setup.bat is joined with a backslash, unlike the other batch paths. */
function setupScript(root: string): string {
  if (e2eUeShell() === "posix") return `${root}/Setup.sh`;
  return `${w(root)}\\Setup.bat`;
}

function hostSep(): string {
  return e2eUeShell() === "posix" ? "/" : "\\";
}

function hostExt(): string {
  if (e2eUeShell() === "posix") return ".sh";
  if (e2eUeShell() === "cmd") return ".cmd";
  return ".exe";
}

/** Omit an unset branch so git/pull keeps its default (`main`). */
function gitPullArgs(repo: { path: string; branch?: string }): Record<string, string> {
  const args: Record<string, string> = { path: repo.path };
  if (repo.branch !== undefined) args.branch = repo.branch;
  return args;
}

function requireUnrealBuildConfig(input: string): string {
  const result = normalizeBuildConfig(input);
  if (!result.ok) throw new Error(result.message);
  return toUnrealBuildConfig(result.value);
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

class UEPlugin extends PluginBase.withDescriptor({
  namespace: "ue",
  version: "1.0.0",
  description: "Unreal Engine build and editor automation",
  metadata: ueConfigSchema,
}) {
  namespace = "ue";

  @handler("Build target: ${target} with config: ${config}")
  async build(params: Record<string, string>, ctx: BoltPluginContext) {
    const targetName = params.target;
    if (!targetName || targetName.trim() === "") {
      throw new Error(`No target specified for ue/build`);
    }

    const uePath = ueConfig(ctx).engine.path;
    const platform = params.platform ?? "Win64";
    const buildBat = `"${ueScript(uePath, "Engine/Build/BatchFiles/Build.bat")}"`;

    // "engine" is a reserved target that builds the engine from source
    if (targetName === "engine") {
      const buildType = requireUnrealBuildConfig(params.config ?? "development");
      await this.setup({ force: "true" }, ctx);
      const genFile = ueScript(uePath, "GenerateProjectFiles.bat");
      const genCmd = `"${genFile}"`;
      ctx.logger.cmd(genCmd);
      if (!ctx.dryRun) {
        if (existsSync(genFile)) await exec(genCmd, ctx);
      }
      const cmd = `${buildBat} -Target="UE4Editor ${platform} ${buildType}" -Target="ShaderCompileWorker ${platform} Development -Quiet" -WaitMutex -FromMsBuild`;
      await run(cmd, ctx);
      return;
    }

    const projFile = ueConfig(ctx).uproject;
    const target = resolveUeTargets(ctx.cfg.plugins)[targetName];

    if (target) {
      // Known alias from the ue plugin target map.
      const effectiveConfig = requireUnrealBuildConfig(params.config ?? target.config);
      const projectName = getProjectName(projFile);
      const targetBin =
        target.kind === "editor" ? `${projectName}Editor` : (target.name ?? targetName);
      const cmd =
        target.kind === "editor"
          ? `${buildBat} -Target="${targetBin} ${platform} ${effectiveConfig}" -Target="ShaderCompileWorker ${platform} Development -Quiet" -Project="${projFile}" -WaitMutex`
          : `${buildBat} ${targetBin} ${platform} ${effectiveConfig} -Project="${projFile}" -WaitMutex`;
      await run(cmd, ctx);
    } else {
      // Raw program target name (not an alias in the ue plugin).
      const buildType = requireUnrealBuildConfig(params.config ?? "development");
      const cmd = `${buildBat} ${targetName} ${platform} ${buildType} -project="${projFile}" -WaitMutex -FromMsBuild`;
      await run(cmd, ctx);
    }
  }

  @handler("Update engine repository")
  async update_engine(params: Record<string, string>, ctx: BoltPluginContext) {
    const repo = ueConfig(ctx).engine;
    const vcs = repo.vcs ?? "git";
    if (vcs === "git") {
      await gitPlugin.handlers["pull"](gitPullArgs(repo), ctx);
    } else {
      await svnPlugin.handlers["update"]({ path: repo.path }, ctx);
    }
  }

  @handler("Update project repository")
  async update_project(params: Record<string, string>, ctx: BoltPluginContext) {
    const repo = ueConfig(ctx).project;
    const vcs = repo.vcs ?? "svn";
    if (vcs === "git") {
      await gitPlugin.handlers["pull"](gitPullArgs(repo), ctx);
    } else {
      await svnPlugin.handlers["update"]({ path: repo.path }, ctx);
    }
  }

  @handler("SVN cleanup")
  async svn_cleanup(params: Record<string, string>, ctx: BoltPluginContext) {
    await svnPlugin.handlers["cleanup"]({ path: ueConfig(ctx).project.path }, ctx);
  }

  @handler("SVN revert ${path}")
  async svn_revert(params: Record<string, string>, ctx: BoltPluginContext) {
    const p = params.path ?? ueConfig(ctx).project.path;
    await svnPlugin.handlers["revert"]({ path: p }, ctx);
  }

  @handler("Run engine Setup.bat")
  async setup(params: Record<string, string>, ctx: BoltPluginContext) {
    const uePath = ueConfig(ctx).engine.path;
    const setupBat = setupScript(uePath);
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
    const uePath = ueConfig(ctx).engine.path;
    const projFile = ueConfig(ctx).uproject;
    await run(
      `"${ueScript(uePath, "Engine/Build/BatchFiles/GenerateProjectFiles.bat")}" "${projFile}" -Game`,
      ctx,
    );
  }

  @handler("Launch ${target} (${config})")
  async start(params: Record<string, string>, ctx: BoltPluginContext) {
    const uePath = ueConfig(ctx).engine.path;
    const projFile = ueConfig(ctx).uproject;
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
      const binName = `${t}${suffix}${hostExt()}`;
      const candidates = [
        path.join(projectDir, "Binaries", platform, binName),
        path.join(uePath, "Engine", "Binaries", platform, binName),
      ];
      ctx.logger.info(`Searching for ${binName}`);
      exePath = ctx.dryRun ? candidates[0] : candidates.find(existsSync);
      if (!exePath)
        throw new Error(`No binary found for target "${t}" in:\n  ${candidates.join("\n  ")}`);
    } else {
      const binDir =
        e2eUeShell() === "posix"
          ? `${uePath}/Engine/Binaries/Win64`
          : w(`${uePath}/Engine/Binaries/Win64`);
      const sep = hostSep();
      const ext = hostExt();
      const candidates = suffix
        ? [
            `${binDir}${sep}UE4Editor${suffix}${ext}`,
            `${binDir}${sep}UnrealEditor${suffix}${ext}`,
            `${binDir}${sep}UE4Editor${ext}`,
            `${binDir}${sep}UnrealEditor${ext}`,
          ]
        : [`${binDir}${sep}UE4Editor${ext}`, `${binDir}${sep}UnrealEditor${ext}`];
      exePath = ctx.dryRun ? candidates[0] : candidates.find(existsSync);
      if (!exePath) throw new Error(`No UE editor executable found in ${binDir}`);
    }

    ctx.logger.cmd(`start "" "${exePath}" "${projFile}"`);
    if (!ctx.dryRun) {
      // SpawnOptions has no stdio mode. Both runtimes pipe, and this result is unused.
      ctx.runtime.spawnSync(["cmd", "/c", "start", "", exePath, projFile]);
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
    const uePath = ueConfig(ctx).engine.path;
    const projFile = ueConfig(ctx).uproject;
    await run(
      `"${ueScript(uePath, "Engine/Binaries/Win64/UE4Editor-Cmd.exe")}" "${projFile}" -run=Automation RunTests FillDDCForPIETest -unattended -buildmachine -nullrhi`,
      ctx,
    );
  }

  @handler("Set INI ${file} [${section}] ${key}")
  async ini_set(params: Record<string, string>, ctx: BoltPluginContext) {
    const {
      file,
      section,
      key,
      value,
      "value-list": valueList,
      "insert-front": insertFront,
    } = params;
    const projectPath = ueConfig(ctx).project.path;
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
    const projectPath = ueConfig(ctx).project.path;
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
    const projectPath = ueConfig(ctx).project.path;
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
    const projectPath = ueConfig(ctx).project.path;
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
    const projectPath = ueConfig(ctx).project.path;
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
      throw new Error(`No target specified. Use: bolt run <task> --target=<Name>`);
    }
    await this.build(params, ctx);
  }

  @handler("Show VCS info")
  async info(params: Record<string, string>, ctx: BoltPluginContext) {
    ctx.logger.info("=== VCS Info ===");
    const engineVcs = ueConfig(ctx).engine.vcs ?? "git";
    const projectVcs = ueConfig(ctx).project.vcs ?? "svn";
    const enginePath = ueConfig(ctx).engine.path;
    const projectPath = ueConfig(ctx).project.path;

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
    const uePath = ueConfig(ctx).engine.path;
    const projectDir = getProjectDir(ueConfig(ctx).uproject);
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
