import { maskedTree } from "../interpolate";
import { PluginBase, handler, skipped, warn } from "../plugin";
import { DDC_CHECK_ID, doctorDdcCheck } from "./ue-doctor-ddc";
import { diagnoseUatLog } from "./ue-diagnose-uat";
import type { BoltConfig } from "../config";
import type { BoltPluginContext, ConfigIssue, HandlerResult, ValidateConfigInput } from "../plugin";
import path from "path";
import { existsSync, readdirSync, readFileSync, statSync, renameSync, mkdirSync } from "fs";
import { z } from "zod";
import { declaredPluginConfig, run, execRaw as exec } from "./helpers";
import gitPlugin, { gitInfo } from "./git";
import svnPlugin, { svnInfo } from "./svn";
import * as ueIni from "./ue-ini";
import {
  BuildConfigSchema,
  normalizeBuildConfig,
  toUnrealBuildConfig,
  type BuildConfig,
} from "./ue-build-config";

/** ue/info ignores result data, so print the git/svn info warn summary itself. */
async function infoWithWarning(
  info: (p: string, ctx: BoltPluginContext) => Promise<HandlerResult>,
  p: string,
  ctx: BoltPluginContext,
): Promise<void> {
  const result = await info(p, ctx);
  if (result.status === "warn" && result.summary) ctx.logger.warn(result.summary);
}

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

const EngineVersionSchema = z
  .union([z.literal(4), z.literal(5), z.literal("4"), z.literal("5")])
  .transform((value) => Number(value) as EngineMajor);

const EngineSchema = RepoSchema.extend({
  /** Engine major version. Detected from the engine tree when omitted. */
  version: EngineVersionSchema.optional(),
});

/** UE plugin metadata. Validated here, not by the core bolt.yaml schema. */
export const ueConfigSchema = z.object({
  engine: EngineSchema,
  /** Editor target and executable base name, e.g. UnrealEditor. Overrides engine.version. */
  editor_target: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/, "editor_target must be a target name such as UnrealEditor")
    .optional(),
  project: RepoSchema,
  uproject: z.string().min(1),
  targets: z.record(TargetSchema).default({}),
});

export interface UeTarget {
  kind: "editor" | "program" | "game" | "client" | "server";
  name?: string;
  config: BuildConfig;
}

export type EngineMajor = 4 | 5;

export interface UeConfig {
  engine: {
    path: string;
    vcs: "git" | "svn";
    url?: string;
    branch?: string;
    version?: EngineMajor;
  };
  editor_target?: string;
  project: { path: string; vcs: "git" | "svn"; url?: string; branch?: string };
  uproject: string;
  targets: Record<string, UeTarget>;
}

function resolveAgainst(configDir: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(configDir, value);
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
    editor_target: data.editor_target,
    uproject: resolveAgainst(ctx.configDir, data.uproject),
    targets: resolveUeTargets(ctx.cfg.plugins),
  };
}

export interface EngineFlavor {
  major: EngineMajor;
  /** Editor target and executable base name (UE4Editor or UnrealEditor). */
  editor: string;
  /** How major was decided, for `ue/info`. */
  source: "config" | "editor_target" | "Build.version" | "binaries" | "targets" | "default";
}

/** Major version from Engine/Build/Build.version, or undefined. */
function buildVersionMajor(root: string): EngineMajor | undefined {
  const file = path.join(root, "Engine", "Build", "Build.version");
  if (!existsSync(file)) return undefined;
  try {
    const major = (JSON.parse(readFileSync(file, "utf8")) as { MajorVersion?: unknown })
      .MajorVersion;
    if (typeof major !== "number") return undefined;
    return major >= 5 ? 5 : 4;
  } catch {
    return undefined;
  }
}

function anyExists(root: string, rels: string[]): boolean {
  return rels.some((rel) => existsSync(path.join(root, rel)));
}

const editorName = (major: EngineMajor) => (major >= 5 ? "UnrealEditor" : "UE4Editor");

/**
 * Engine major version and editor name. Order: `editor_target`, then
 * `engine.version`, then Engine/Build/Build.version MajorVersion, then which
 * editor binaries or target files exist. An unknown tree is UE4, the
 * historical behaviour.
 */
export function detectEngine(
  root: string,
  opts: { version?: EngineMajor; editorTarget?: string } = {},
): EngineFlavor {
  const pick = (major: EngineMajor, source: EngineFlavor["source"]): EngineFlavor => ({
    major,
    editor: opts.editorTarget ?? editorName(major),
    source: opts.editorTarget ? "editor_target" : source,
  });
  if (opts.version !== undefined) return pick(opts.version, "config");
  if (opts.editorTarget !== undefined) {
    return pick(/^UE4/i.test(opts.editorTarget) ? 4 : 5, "editor_target");
  }
  const fromFile = buildVersionMajor(root);
  if (fromFile !== undefined) return pick(fromFile, "Build.version");
  const bins = (name: string) => [
    `Engine/Binaries/Win64/${name}.exe`,
    `Engine/Binaries/Linux/${name}`,
    `Engine/Binaries/Mac/${name}.app`,
  ];
  const ue5Bin = anyExists(root, bins("UnrealEditor"));
  const ue4Bin = anyExists(root, bins("UE4Editor"));
  if (ue5Bin !== ue4Bin) return pick(ue5Bin ? 5 : 4, "binaries");
  const ue5Target = existsSync(path.join(root, "Engine/Source/UnrealEditor.Target.cs"));
  const ue4Target = existsSync(path.join(root, "Engine/Source/UE4Editor.Target.cs"));
  if (ue5Target !== ue4Target) return pick(ue5Target ? 5 : 4, "targets");
  return pick(4, "default");
}

function engineFlavor(cfg: UeConfig): EngineFlavor {
  return detectEngine(cfg.engine.path, {
    version: cfg.engine.version,
    editorTarget: cfg.editor_target,
  });
}

/** Normalise a Windows engine root to backslashes so cmd.exe handles it. */
const w = (p: string) => p.replace(/\//g, "\\");

/** Drive-letter and UNC roots are Windows paths. A posix engine path is not. */
function winRoot(root: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(root) || root.startsWith("\\\\");
}

/**
 * Engine-relative tool. The filename is always `rel` (`.bat` or `.exe`).
 * A Windows root keeps the historical `w(root)/rel` form. A posix root keeps
 * forward slashes so that same filename is the file on disk.
 */
function engineFile(root: string, rel: string): string {
  if (winRoot(root)) return `${w(root)}/${rel}`;
  return `${root}/${rel}`;
}

/** Setup.bat is joined with a backslash on Windows, unlike the other batch paths. */
function setupScript(root: string): string {
  if (winRoot(root)) return `${w(root)}\\Setup.bat`;
  return `${root}/Setup.bat`;
}

/**
 * `cmd` and `taskkill` resolve to System32 before PATH, so a PATH entry cannot
 * shim them. BOLT_E2E_BIN, when set, is the directory of those two shims.
 * Engine-relative names do not read it. Unset, the result is `cmd` or `taskkill`.
 */
function hostTool(name: string): string {
  const bin = process.env.BOLT_E2E_BIN;
  if (!bin) return name;
  const file = process.platform === "win32" ? `${name}.cmd` : name;
  return path.join(bin, file);
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

export class UEPlugin extends PluginBase.withDescriptor({
  namespace: "ue",
  version: "1.0.0",
  description: "Unreal Engine build and editor automation",
  metadata: ueConfigSchema,
}) {
  namespace = "ue";
  override apiVersion = 2;

  /** Tasks that call ue/ need a plugins entry. Metadata shape is the Zod schema, not this hook. */
  validateConfig(input: ValidateConfigInput): ConfigIssue[] {
    if (input.present || !tasksReferenceUe(input.tasks)) return [];
    return [
      {
        path: `plugins.${input.namespace}`,
        message: "ue metadata is required when a task uses a ue/ handler",
        code: "CONFIG_PLUGIN_REQUIRED",
        hint: "Add plugins: [{ namespace: ue, config: { engine, project, uproject } }]",
      },
    ];
  }

  aiContext(input: { cfg: BoltConfig; configDir: string }): {
    markdown?: string[];
    info?: Record<string, unknown>;
  } {
    const raw = input.cfg.plugins?.find((entry) => entry.namespace === "ue")?.config;
    if (raw === undefined) return {};
    const parsed = ueConfigSchema.safeParse(raw);
    if (!parsed.success) return {};
    const targets = parsed.data.targets;
    const markdown: string[] = [];
    if (Object.keys(targets).length > 0) {
      markdown.push("## Targets", "");
      for (const [name, target] of Object.entries(targets)) {
        const detail = target.name
          ? `${target.kind} · ${target.name} · ${target.config}`
          : `${target.kind} · ${target.config}`;
        markdown.push(`- **${name}**: ${detail}`);
      }
      markdown.push("");
    }
    markdown.push(
      "- `--config=debuggame` (aliases: `dbggame`, `DebugGame`) — Unreal DebugGame",
      "",
    );
    if (Object.keys(targets).length === 0) return { markdown };
    return {
      markdown,
      info: { targets: maskedTree(targets, input.cfg, "plugins.ue.targets") },
    };
  }

  /** AI `ue/ini_get` and `ue/ini_read_all`: `file` stays inside `project.path`. */
  aiPathRoots(input: { cfg: BoltConfig; configDir: string }): Array<{
    refs: string[];
    params: string[];
    root: string;
    label: string;
  }> {
    const raw = input.cfg.plugins?.find((entry) => entry.namespace === "ue")?.config;
    const parsed = ueConfigSchema.safeParse(raw);
    const projectPath = parsed.success ? parsed.data.project.path : "";
    return [
      {
        refs: ["ue/ini_get", "ue/ini_read_all"],
        params: ["file"],
        root: projectPath ? resolveAgainst(input.configDir, projectPath) : "",
        label: "UE project directory",
      },
    ];
  }

  @handler({
    ai: true,
    capability: "doctor",
    description: "Check the project DDC ini section against the engine flavor",
  })
  async doctor_ddc(_params: Record<string, string>, ctx: BoltPluginContext) {
    const raw = declaredPluginConfig(ctx, "ue");
    if (raw === undefined) return skipped("ue config is not set");
    let cfg: UeConfig;
    try {
      cfg = ueConfig(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return warn(message, {
        data: { checks: [{ id: DDC_CHECK_ID, level: "warn", message }] },
      });
    }
    return doctorDdcCheck({ enginePath: cfg.engine.path, projectPath: cfg.project.path });
  }

  @handler({
    ai: true,
    capability: "diagnose",
    description: "Explain a UAT or Cook log that ended as Unknown Cook Failure",
  })
  async diagnose_uat(params: Record<string, string>, _ctx: BoltPluginContext) {
    return diagnoseUatLog(params.log ?? "");
  }

  @handler({
    ai: "confirm",
    description: "Build target: ${target} with config: ${config}",
  })
  async build(params: Record<string, string>, ctx: BoltPluginContext) {
    const targetName = params.target;
    if (!targetName || targetName.trim() === "") {
      throw new Error(`No target specified for ue/build`);
    }

    const cfg = ueConfig(ctx);
    const uePath = cfg.engine.path;
    const platform = params.platform ?? "Win64";
    const buildBat = `"${engineFile(uePath, "Engine/Build/BatchFiles/Build.bat")}"`;

    // "engine" is a reserved target that builds the engine from source
    if (targetName === "engine") {
      const buildType = requireUnrealBuildConfig(params.config ?? "development");
      await this.setup({ force: "true" }, ctx);
      const genFile = engineFile(uePath, "GenerateProjectFiles.bat");
      const genCmd = `"${genFile}"`;
      ctx.logger.cmd(genCmd);
      if (!ctx.dryRun) {
        if (existsSync(genFile)) await exec(genCmd, ctx);
      }
      const { editor } = engineFlavor(cfg);
      const cmd = `${buildBat} -Target="${editor} ${platform} ${buildType}" -Target="ShaderCompileWorker ${platform} Development -Quiet" -WaitMutex -FromMsBuild`;
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

  @handler({ ai: "confirm", description: "Update engine repository" })
  async update_engine(params: Record<string, string>, ctx: BoltPluginContext) {
    const repo = ueConfig(ctx).engine;
    const vcs = repo.vcs ?? "git";
    if (vcs === "git") {
      await gitPlugin.handlers["pull"](gitPullArgs(repo), ctx);
    } else {
      await svnPlugin.handlers["update"]({ path: repo.path }, ctx);
    }
  }

  @handler({ ai: "confirm", description: "Update project repository" })
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

  @handler({ ai: "confirm", description: "Run engine Setup.bat" })
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

  @handler({ ai: "confirm", description: "Generate project files" })
  async generate_project(params: Record<string, string>, ctx: BoltPluginContext) {
    const uePath = ueConfig(ctx).engine.path;
    const projFile = ueConfig(ctx).uproject;
    await run(
      `"${engineFile(uePath, "Engine/Build/BatchFiles/GenerateProjectFiles.bat")}" "${projFile}" -Game`,
      ctx,
    );
  }

  @handler({ ai: "confirm", description: "Launch ${target} (${config})" })
  async start(params: Record<string, string>, ctx: BoltPluginContext) {
    const cfg = ueConfig(ctx);
    const uePath = cfg.engine.path;
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
      const binDir = path.join(uePath, "Engine", "Binaries", "Win64");
      const { editor, major } = engineFlavor(cfg);
      const candidates = suffix
        ? [path.join(binDir, `${editor}${suffix}.exe`), path.join(binDir, `${editor}.exe`)]
        : [path.join(binDir, `${editor}.exe`)];
      exePath = ctx.dryRun ? candidates[0] : candidates.find(existsSync);
      if (!exePath) {
        throw new Error(
          `No UE${major} editor executable found in ${binDir} (looked for ${candidates
            .map((c) => path.basename(c))
            .join(
              ", ",
            )}). Set engine.version or editor_target in the ue config if the engine version was detected wrongly.`,
        );
      }
    }

    ctx.logger.cmd(`start "" "${exePath}" "${projFile}"`);
    if (!ctx.dryRun) {
      // `start` is a cmd builtin. On a headless runner it never returns, and
      // System32\cmd.exe is found before any PATH shim. hostTool("cmd") is
      // still "cmd" unless BOLT_E2E_BIN points at the e2e shim, which runs the
      // program and returns. The engine path above is not rewritten.
      ctx.runtime.spawnSync([hostTool("cmd"), "/c", "start", "", exePath, projFile]);
    }
  }

  @handler("Terminate all UE processes")
  async kill(params: Record<string, string>, ctx: BoltPluginContext) {
    const procs = [
      "UE4Editor.exe",
      "UE4Editor-Win64-Debug.exe",
      "UE4Editor-Cmd.exe",
      "UnrealEditor.exe",
      "UnrealEditor-Win64-Debug.exe",
      "UnrealEditor-Cmd.exe",
      "CrashReportClient.exe",
    ];
    for (const p of procs) {
      ctx.logger.cmd(`taskkill /f /im ${p}`);
      if (!ctx.dryRun)
        await ctx.runtime.spawn([hostTool("taskkill"), "/f", "/im", p]).catch(() => {});
    }
  }

  @handler("Fill DDC for PIE")
  async fillddc(params: Record<string, string>, ctx: BoltPluginContext) {
    const cfg = ueConfig(ctx);
    const uePath = cfg.engine.path;
    const projFile = cfg.uproject;
    const { editor } = engineFlavor(cfg);
    await run(
      `"${engineFile(uePath, `Engine/Binaries/Win64/${editor}-Cmd.exe`)}" "${projFile}" -run=Automation RunTests FillDDCForPIETest -unattended -buildmachine -nullrhi`,
      ctx,
    );
  }

  @handler({ ai: "confirm", description: "Set INI ${file} [${section}] ${key}" })
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

  @handler({ ai: true })
  async ini_get(params: Record<string, string>, ctx: BoltPluginContext) {
    const { file, section, key, type } = params;
    const projectPath = ueConfig(ctx).project.path;
    const projFile = path.resolve(projectPath, file);

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

  @handler({ ai: "confirm", description: "Override INI ${file} with ${override-file}" })
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

  @handler({ ai: true })
  async ini_read_all(params: Record<string, string>, ctx: BoltPluginContext) {
    const { file } = params;
    const projectPath = ueConfig(ctx).project.path;
    const projFile = path.resolve(projectPath, file);

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

  @handler({ ai: "confirm", description: "Build engine from source" })
  async build_engine(params: Record<string, string>, ctx: BoltPluginContext) {
    await this.build({ ...params, target: "engine" }, ctx);
  }

  @handler({ ai: "confirm", description: "Build program ${target}" })
  async build_program(params: Record<string, string>, ctx: BoltPluginContext) {
    if (!params.target || params.target.trim() === "") {
      throw new Error(`No target specified. Use: bolt run <task> --target=<Name>`);
    }
    await this.build(params, ctx);
  }

  @handler({ ai: true, description: "Show VCS info" })
  async info(params: Record<string, string>, ctx: BoltPluginContext) {
    const flavor = engineFlavor(ueConfig(ctx));
    ctx.logger.info(`Engine: UE${flavor.major}, editor ${flavor.editor} (from ${flavor.source})`);
    ctx.logger.info("=== VCS Info ===");
    const engineVcs = ueConfig(ctx).engine.vcs ?? "git";
    const projectVcs = ueConfig(ctx).project.vcs ?? "svn";
    const enginePath = ueConfig(ctx).engine.path;
    const projectPath = ueConfig(ctx).project.path;

    if (engineVcs === "git") {
      await infoWithWarning(gitInfo, enginePath, ctx);
    } else {
      await infoWithWarning(svnInfo, enginePath, ctx);
    }
    if (projectVcs === "svn") {
      await infoWithWarning(svnInfo, projectPath, ctx);
    } else {
      await infoWithWarning(gitInfo, projectPath, ctx);
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
