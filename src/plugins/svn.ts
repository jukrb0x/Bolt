// src/plugins/svn.ts
import { defineHandler, definePlugin, type BoltPluginContext, type HandlerResult } from "../plugin";
import { pathParams, projectPath } from "./git";
import { existsSync } from "fs";
import { z } from "zod";
import { declaredPluginConfig } from "./helpers";

/** svn plugin metadata. Not part of the core bolt.yaml schema. */
export const svnConfigSchema = z
  .object({
    use_tortoise: z.boolean().optional(),
  })
  .strict();

export function svnMetadataErrors(plugins: unknown): Array<{ path: string; message: string }> {
  if (!Array.isArray(plugins)) return [];
  const entry = plugins.find(
    (item) =>
      !!item && typeof item === "object" && (item as { namespace?: unknown }).namespace === "svn",
  ) as { config?: unknown } | undefined;
  if (!entry) return [];
  const result = svnConfigSchema.safeParse(entry.config ?? {});
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: ["plugins", "svn", "config", ...issue.path].filter((part) => part !== "").join("."),
    message: issue.message,
  }));
}

function tortoisePreference(ctx: BoltPluginContext): boolean | undefined {
  const raw = declaredPluginConfig(ctx, "svn");
  if (raw === undefined) return undefined;
  const parsed = svnConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid config for plugin "svn": ${detail}`);
  }
  return parsed.data.use_tortoise;
}

function findTortoiseProc(ctx: BoltPluginContext): string | null {
  const candidates = [
    "C:\\Program Files\\TortoiseSVN\\bin\\TortoiseProc.exe",
    "C:\\Program Files (x86)\\TortoiseSVN\\bin\\TortoiseProc.exe",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  const result = ctx.runtime.spawnSync(["where", "TortoiseProc.exe"]);
  if (result.exitCode === 0) return result.stdout.trim().split("\n")[0].trim();
  return null;
}

export function resolveTortoiseProc(ctx: BoltPluginContext): string | null {
  const pref = tortoisePreference(ctx);
  if (pref === false) return null;
  const found = findTortoiseProc(ctx);
  if (pref === true && !found) throw new Error("TortoiseProc.exe not found but use_tortoise: true");
  return found;
}

function resolvePath(params: Record<string, string>): string {
  if (!params.path) throw new Error("svn handler requires with: path:");
  return params.path;
}

/** Read-only query. Not path-restricted; ue/info calls it directly. */
export async function svnInfo(p: string, ctx: BoltPluginContext): Promise<HandlerResult> {
  ctx.logger.info(`=== SVN Info: ${p} ===`);
  const result = ctx.runtime.spawnSync(["svn", "info", p]);
  if (result.exitCode !== 0) {
    return { status: "warn", summary: `SVN info unavailable for ${p}` };
  }
  const data: Record<string, string> = { path: p };
  const keys: Record<string, string> = {
    "URL:": "url",
    "Revision:": "revision",
    "Last Changed Rev:": "last_changed_rev",
  };
  for (const line of result.stdout.split("\n")) {
    for (const [prefix, key] of Object.entries(keys)) {
      if (line.startsWith(prefix)) {
        ctx.logger.info(`SVN: ${line.trim()}`);
        data[key] = line.slice(prefix.length).trim();
      }
    }
  }
  return { status: "ok", data };
}

const plugin = definePlugin({
  namespace: "svn",
  version: "1.0.0",
  description: "Built-in svn handlers.",
  apiVersion: 2,
  handlers: {
    update: defineHandler(
      { ai: "confirm", capability: "vcs.sync", description: "svn update ${path}" },
      async (params, ctx) => {
        const p = resolvePath(params);
        ctx.logger.cmd(`svn update "${p}" --non-interactive --trust-server-cert`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn([
            "svn",
            "update",
            p,
            "--non-interactive",
            "--trust-server-cert",
          ]);
          if (result.exitCode !== 0) throw new Error(`svn update failed (exit ${result.exitCode})`);
        }
      },
    ),

    cleanup: defineHandler(
      { ai: false, description: "svn cleanup ${path}" },
      async (params, ctx) => {
        const p = resolvePath(params);
        const tortoiseProc = resolveTortoiseProc(ctx);
        if (tortoiseProc) {
          ctx.logger.cmd(
            `TortoiseProc /command:cleanup /path:"${p}" /noui /nodlg /externals /fixtimestamps /vacuum /breaklocks /refreshshell`,
          );
          if (!ctx.dryRun) {
            const result = ctx.runtime.spawnSync([
              tortoiseProc,
              "/command:cleanup",
              `/path:${p}`,
              "/noui",
              "/nodlg",
              "/externals",
              "/fixtimestamps",
              "/vacuum",
              "/breaklocks",
              "/refreshshell",
            ]);
            if (result.exitCode !== 0)
              throw new Error(`TortoiseProc cleanup failed (exit ${result.exitCode})`);
          }
        } else {
          ctx.logger.cmd(`svn cleanup "${p}"`);
          if (!ctx.dryRun) {
            const result = await ctx.runtime.spawn(["svn", "cleanup", p]);
            if (result.exitCode !== 0)
              throw new Error(`svn cleanup failed (exit ${result.exitCode})`);
          }
        }
      },
    ),

    revert: defineHandler({ ai: false, description: "svn revert ${path}" }, async (params, ctx) => {
      const p = resolvePath(params);
      const tortoiseProc = resolveTortoiseProc(ctx);
      if (tortoiseProc) {
        ctx.logger.cmd(
          `TortoiseProc /command:cleanup /path:"${p}" /noui /nodlg /revert /breaklocks /vacuum /fixtimestamps`,
        );
        if (!ctx.dryRun) {
          const result = ctx.runtime.spawnSync([
            tortoiseProc,
            "/command:cleanup",
            `/path:${p}`,
            "/noui",
            "/nodlg",
            "/revert",
            "/breaklocks",
            "/vacuum",
            "/fixtimestamps",
          ]);
          if (result.exitCode !== 0)
            throw new Error(`TortoiseProc revert failed (exit ${result.exitCode})`);
        }
      } else {
        ctx.logger.cmd(`svn revert -R "${p}"`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn(["svn", "revert", "-R", p]);
          if (result.exitCode !== 0) throw new Error(`svn revert failed (exit ${result.exitCode})`);
        }
      }
    }),

    info: defineHandler(
      {
        ai: true,
        capability: "vcs.info",
        description: "svn info ${path}",
        params: pathParams("Working copy path inside the project"),
      },
      async (params, ctx) => svnInfo(projectPath(params, ctx, "svn/info"), ctx),
    ),

    commit: defineHandler({ ai: false, description: "svn commit ${path}" }, async (params, ctx) => {
      const p = resolvePath(params);
      const tortoiseProc = resolveTortoiseProc(ctx);
      if (tortoiseProc) {
        ctx.logger.cmd(`TortoiseProc /command:commit /path:"${p}"`);
        if (!ctx.dryRun) {
          const result = ctx.runtime.spawnSync([tortoiseProc, "/command:commit", `/path:${p}`]);
          if (result.exitCode !== 0)
            throw new Error(`TortoiseProc commit failed (exit ${result.exitCode})`);
        }
      } else {
        if (!params.message)
          throw new Error("svn/commit requires with: message: when not using TortoiseSVN");
        ctx.logger.cmd(`svn commit "${p}" -m "${params.message}"`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn(["svn", "commit", p, "-m", params.message]);
          if (result.exitCode !== 0) throw new Error(`svn commit failed (exit ${result.exitCode})`);
        }
      }
    }),

    add: defineHandler({ ai: false, description: "svn add ${path}" }, async (params, ctx) => {
      if (!params.path) throw new Error("svn/add requires with: path:");
      ctx.logger.cmd(`svn add "${params.path}"`);
      if (!ctx.dryRun) {
        const result = await ctx.runtime.spawn(["svn", "add", params.path]);
        if (result.exitCode !== 0) throw new Error(`svn add failed (exit ${result.exitCode})`);
      }
    }),

    status: defineHandler(
      {
        ai: "confirm",
        description: "svn status ${path}",
        params: pathParams("Working copy path"),
      },
      async (params, ctx) => {
        const p = resolvePath(params);
        ctx.logger.cmd(`svn status "${p}"`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn(["svn", "status", p]);
          if (result.exitCode !== 0) throw new Error(`svn status failed (exit ${result.exitCode})`);
        }
      },
    ),
  },
});

export default plugin;
