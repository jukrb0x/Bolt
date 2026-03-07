// src/plugins/svn.ts
import type { BoltPlugin, BoltPluginContext } from "../plugin";
import { existsSync } from "fs";

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
  const pref = ctx.cfg.project.use_tortoise;
  if (pref === false) return null;
  const found = findTortoiseProc(ctx);
  if (pref === true && !found) throw new Error("TortoiseProc.exe not found but use_tortoise: true");
  return found;
}

function resolvePath(params: Record<string, string>, ctx: BoltPluginContext): string {
  const p = params.path ?? (ctx.cfg.project as any).project_root;
  if (!p) throw new Error("svn handler requires with: path: or project.project_root in config");
  return p;
}

const plugin: BoltPlugin = {
  namespace: "svn",
  handlers: {
    update: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      ctx.logger.cmd(`svn update "${p}" --non-interactive --trust-server-cert`);
      if (!ctx.dryRun) {
        const result = await ctx.runtime.spawn(["svn", "update", p, "--non-interactive", "--trust-server-cert"]);
        if (result.exitCode !== 0) throw new Error(`svn update failed (exit ${result.exitCode})`);
      }
    },

    cleanup: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      const tortoiseProc = resolveTortoiseProc(ctx);
      if (tortoiseProc) {
        ctx.logger.cmd(`TortoiseProc /command:cleanup /path:"${p}" /noui /nodlg /externals /fixtimestamps /vacuum /breaklocks /refreshshell`);
        if (!ctx.dryRun) {
          const result = ctx.runtime.spawnSync([
            tortoiseProc, "/command:cleanup", `/path:${p}`, "/noui", "/nodlg", "/externals", "/fixtimestamps", "/vacuum", "/breaklocks", "/refreshshell"
          ]);
          if (result.exitCode !== 0) throw new Error(`TortoiseProc cleanup failed (exit ${result.exitCode})`);
        }
      } else {
        ctx.logger.cmd(`svn cleanup "${p}"`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn(["svn", "cleanup", p]);
          if (result.exitCode !== 0) throw new Error(`svn cleanup failed (exit ${result.exitCode})`);
        }
      }
    },

    revert: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      const tortoiseProc = resolveTortoiseProc(ctx);
      if (tortoiseProc) {
        ctx.logger.cmd(`TortoiseProc /command:cleanup /path:"${p}" /noui /nodlg /revert /breaklocks /vacuum /fixtimestamps`);
        if (!ctx.dryRun) {
          const result = ctx.runtime.spawnSync([
            tortoiseProc, "/command:cleanup", `/path:${p}`, "/noui", "/nodlg", "/revert", "/breaklocks", "/vacuum", "/fixtimestamps"
          ]);
          if (result.exitCode !== 0) throw new Error(`TortoiseProc revert failed (exit ${result.exitCode})`);
        }
      } else {
        ctx.logger.cmd(`svn revert -R "${p}"`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn(["svn", "revert", "-R", p]);
          if (result.exitCode !== 0) throw new Error(`svn revert failed (exit ${result.exitCode})`);
        }
      }
    },

    info: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      ctx.logger.info(`=== SVN Info: ${p} ===`);
      const result = ctx.runtime.spawnSync(["svn", "info", p]);
      if (result.exitCode === 0) {
        for (const line of result.stdout.split("\n")) {
          if (line.startsWith("URL:") || line.startsWith("Revision:") || line.startsWith("Last Changed Rev:")) {
            ctx.logger.info(`SVN: ${line.trim()}`);
          }
        }
      } else {
        ctx.logger.warn("SVN info unavailable");
      }
    },

    commit: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      const tortoiseProc = resolveTortoiseProc(ctx);
      if (tortoiseProc) {
        ctx.logger.cmd(`TortoiseProc /command:commit /path:"${p}"`);
        if (!ctx.dryRun) {
          const result = ctx.runtime.spawnSync([tortoiseProc, "/command:commit", `/path:${p}`]);
          if (result.exitCode !== 0) throw new Error(`TortoiseProc commit failed (exit ${result.exitCode})`);
        }
      } else {
        if (!params.message) throw new Error("svn/commit requires with: message: when not using TortoiseSVN");
        ctx.logger.cmd(`svn commit "${p}" -m "${params.message}"`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn(["svn", "commit", p, "-m", params.message]);
          if (result.exitCode !== 0) throw new Error(`svn commit failed (exit ${result.exitCode})`);
        }
      }
    },

    add: async (params, ctx) => {
      if (!params.path) throw new Error("svn/add requires with: path:");
      ctx.logger.cmd(`svn add "${params.path}"`);
      if (!ctx.dryRun) {
        const result = await ctx.runtime.spawn(["svn", "add", params.path]);
        if (result.exitCode !== 0) throw new Error(`svn add failed (exit ${result.exitCode})`);
      }
    },

    status: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      ctx.logger.cmd(`svn status "${p}"`);
      if (!ctx.dryRun) {
        const result = await ctx.runtime.spawn(["svn", "status", p]);
        if (result.exitCode !== 0) throw new Error(`svn status failed (exit ${result.exitCode})`);
      }
    },
  },
};

export default plugin;
