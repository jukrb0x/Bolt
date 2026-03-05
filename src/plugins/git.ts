// src/plugins/git.ts
import type { BoltPlugin, BoltPluginContext } from "../plugin";

function resolvePath(params: Record<string, string>, ctx: BoltPluginContext): string {
  const p = params.path ?? (ctx.cfg.project as any).engine_root;
  if (!p) throw new Error("git handler requires with: path: or project.engine_root in config");
  return p;
}

const plugin: BoltPlugin = {
  namespace: "git",
  handlers: {
    pull: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      const branch = params.branch ?? (ctx.cfg.project as any).git_branch ?? "main";
      ctx.logger.cmd(`git -C "${p}" pull origin ${branch} --autostash --no-edit`);
      if (!ctx.dryRun) {
        const result = await ctx.runtime.shell(`git -C "${p}" pull origin ${branch} --autostash --no-edit`);
        if (result.exitCode !== 0) throw new Error(`git pull failed (exit ${result.exitCode})`);
      }
    },

    status: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      ctx.logger.cmd(`git -C "${p}" status`);
      if (!ctx.dryRun) {
        const result = await ctx.runtime.shell(`git -C "${p}" status`);
        if (result.exitCode !== 0) throw new Error(`git status failed (exit ${result.exitCode})`);
      }
    },

    info: async (params, ctx) => {
      const p = resolvePath(params, ctx);
      // Read-only query — intentionally runs in dry-run mode
      const logResult = ctx.runtime.spawnSync(
        ["git", "-C", p, "log", "-1", "--pretty=format:%h %s", "--no-walk"],
      );
      if (logResult.exitCode === 0) {
        ctx.logger.info(`Git: ${logResult.stdout.trim()}`);
      } else {
        ctx.logger.warn("Git info unavailable");
      }
      const branchResult = ctx.runtime.spawnSync(
        ["git", "-C", p, "rev-parse", "--abbrev-ref", "HEAD"],
      );
      if (branchResult.exitCode === 0) {
        ctx.logger.info(`Git branch: ${branchResult.stdout.trim()}`);
      }
    },

    checkout: async (params, ctx) => {
      if (!params.branch) throw new Error("git/checkout requires with: branch:");
      const p = resolvePath(params, ctx);
      ctx.logger.cmd(`git -C "${p}" checkout ${params.branch}`);
      if (!ctx.dryRun) {
        const result = await ctx.runtime.shell(`git -C "${p}" checkout ${params.branch}`);
        if (result.exitCode !== 0) throw new Error(`git checkout failed (exit ${result.exitCode})`);
      }
    },

    clone: async (params, ctx) => {
      if (!params.url) throw new Error("git/clone requires with: url:");
      if (!params.path) throw new Error("git/clone requires with: path:");
      ctx.logger.cmd(`git clone "${params.url}" "${params.path}"`);
      if (!ctx.dryRun) {
        const result = await ctx.runtime.shell(`git clone "${params.url}" "${params.path}"`);
        if (result.exitCode !== 0) throw new Error(`git clone failed (exit ${result.exitCode})`);
      }
    },
  },
};

export default plugin;
