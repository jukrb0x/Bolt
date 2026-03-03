import type { BoltPlugin, BoltPluginContext } from "../plugin";
import { $ } from "bun";
import { existsSync } from "fs";

function findTortoiseProc(): string | null {
  const candidates = [
    "C:\Program Files\TortoiseSVN\bin\TortoiseProc.exe",
    "C:\Program Files (x86)\TortoiseSVN\bin\TortoiseProc.exe",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  const result = Bun.spawnSync(["where", "TortoiseProc.exe"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode === 0) return result.stdout.toString().trim().split("\n")[0].trim();
  return null;
}

export function resolveTortoiseProc(ctx: BoltPluginContext): string | null {
  const pref = ctx.cfg.project.use_tortoise;
  if (pref === false) return null;
  const found = findTortoiseProc();
  if (pref === true && !found) throw new Error("TortoiseProc.exe not found but use_tortoise: true");
  return found;
}

function resolvePath(params: Record<string, string>, ctx: BoltPluginContext): string {
  const p = params.path ?? ctx.cfg.project.project_root;
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
        const result = await $`svn update ${p} --non-interactive --trust-server-cert`.nothrow();
        if (result.exitCode !== 0) throw new Error(`svn update failed (exit ${result.exitCode})`);
      }
    },

    cleanup: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      const tortoiseProc = resolveTortoiseProc(ctx);
      if (tortoiseProc) {
        ctx.logger.cmd(`TortoiseProc /command:cleanup /path:"${p}" /noui /nodlg /externals /fixtimestamps /vacuum /breaklocks /refreshshell`);
        if (!ctx.dryRun) {
          const result = Bun.spawnSync(
            [tortoiseProc, "/command:cleanup", `/path:${p}`, "/noui", "/nodlg", "/externals", "/fixtimestamps", "/vacuum", "/breaklocks", "/refreshshell"],
            { stdout: "inherit", stderr: "inherit" },
          );
          if (result.exitCode !== 0) throw new Error(`TortoiseProc cleanup failed (exit ${result.exitCode})`);
        }
      } else {
        ctx.logger.cmd(`svn cleanup "${p}"`);
        if (!ctx.dryRun) {
          const result = await $`svn cleanup ${p}`.nothrow();
          if (result.exitCode !== 0) throw new Error(`svn cleanup failed (exit ${result.exitCode})`);
        }
      }
    },

    revert: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      const tortoiseProc = resolveTortoiseProc(ctx);
      if (tortoiseProc) {
        // TortoiseSVN exposes revert through /command:cleanup with the /revert flag — there is no standalone /command:revert
        ctx.logger.cmd(`TortoiseProc /command:cleanup /path:"${p}" /noui /nodlg /revert /breaklocks /vacuum /fixtimestamps`);
        if (!ctx.dryRun) {
          const result = Bun.spawnSync(
            [tortoiseProc, "/command:cleanup", `/path:${p}`, "/noui", "/nodlg", "/revert", "/breaklocks", "/vacuum", "/fixtimestamps"],
            { stdout: "inherit", stderr: "inherit" },
          );
          if (result.exitCode !== 0) throw new Error(`TortoiseProc revert failed (exit ${result.exitCode})`);
        }
      } else {
        ctx.logger.cmd(`svn revert -R "${p}"`);
        if (!ctx.dryRun) {
          const result = await $`svn revert -R ${p}`.nothrow();
          if (result.exitCode !== 0) throw new Error(`svn revert failed (exit ${result.exitCode})`);
        }
      }
    },

    info: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      ctx.logger.info(`=== SVN Info: ${p} ===`);
      // Read-only query — intentionally runs in dry-run mode
      const result = Bun.spawnSync(["svn", "info", p], { stdout: "pipe", stderr: "pipe" });
      if (result.exitCode === 0) {
        for (const line of result.stdout.toString().split("\n")) {
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

    commit: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      const tortoiseProc = resolveTortoiseProc(ctx);
      if (tortoiseProc) {
        ctx.logger.cmd(`TortoiseProc /command:commit /path:"${p}"`);
        if (!ctx.dryRun) {
          const result = Bun.spawnSync(
            [tortoiseProc, "/command:commit", `/path:${p}`],
            { stdout: "inherit", stderr: "inherit" },
          );
          if (result.exitCode !== 0) throw new Error(`TortoiseProc commit failed (exit ${result.exitCode})`);
        }
      } else {
        if (!params.message) throw new Error("svn/commit requires with: message: when not using TortoiseSVN");
        ctx.logger.cmd(`svn commit "${p}" -m "${params.message}"`);
        if (!ctx.dryRun) {
          const result = await $`svn commit ${p} -m ${params.message}`.nothrow();
          if (result.exitCode !== 0) throw new Error(`svn commit failed (exit ${result.exitCode})`);
        }
      }
    },

    add: async (params, ctx) => {
      if (!params.path) throw new Error("svn/add requires with: path:");
      ctx.logger.cmd(`svn add "${params.path}"`);
      if (!ctx.dryRun) {
        const result = await $`svn add ${params.path}`.nothrow();
        if (result.exitCode !== 0) throw new Error(`svn add failed (exit ${result.exitCode})`);
      }
    },

    status: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      ctx.logger.cmd(`svn status "${p}"`);
      if (!ctx.dryRun) {
        const result = await $`svn status ${p}`.nothrow();
        if (result.exitCode !== 0) throw new Error(`svn status failed (exit ${result.exitCode})`);
      }
    },
  },
};

export default plugin;
