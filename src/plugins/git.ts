// src/plugins/git.ts
import { defineHandler, definePlugin, type BoltPluginContext, type HandlerResult } from "../plugin";
import { z } from "zod";
import { safePath } from "./path-guard";

/** Params schema for handlers that take only a working copy path. */
export function pathParams(description: string) {
  return z.object({ path: z.string().describe(description) });
}

function resolvePath(params: Record<string, string>): string {
  if (!params.path) throw new Error("git handler requires with: path:");
  return params.path;
}

/**
 * Handlers with `ai: true` only read repositories inside the project, so an
 * agent cannot use them to inspect unrelated directories.
 */
export function projectPath(
  params: Record<string, string>,
  ctx: BoltPluginContext,
  ref: string,
): string {
  if (!params.path) throw new Error(`${ref} requires with: path:`);
  try {
    return safePath(params.path, ctx.configDir);
  } catch {
    throw new Error(
      `${ref}: path "${params.path}" is outside the project directory "${ctx.configDir}". ${ref} is AI-callable (ai: true), so it only reads repositories inside the project. Fix: use a path under the project, or use a run: step for other repositories.`,
    );
  }
}

/** Read-only query. Runs in dry-run mode too. Not path-restricted; ue/info calls it directly. */
export async function gitInfo(p: string, ctx: BoltPluginContext): Promise<HandlerResult> {
  const logResult = ctx.runtime.spawnSync([
    "git",
    "-C",
    p,
    "log",
    "-1",
    "--pretty=format:%h %s",
    "--no-walk",
  ]);
  const data: Record<string, string> = { path: p };
  if (logResult.exitCode === 0) {
    data.commit = logResult.stdout.trim();
    ctx.logger.info(`Git: ${data.commit}`);
  } else {
    ctx.logger.warn("Git info unavailable");
  }
  const branchResult = ctx.runtime.spawnSync(["git", "-C", p, "rev-parse", "--abbrev-ref", "HEAD"]);
  if (branchResult.exitCode === 0) {
    data.branch = branchResult.stdout.trim();
    ctx.logger.info(`Git branch: ${data.branch}`);
  }
  if (data.commit === undefined) {
    return { status: "warn", summary: `Git info unavailable for ${p}`, data };
  }
  return { status: "ok", data };
}

const plugin = definePlugin({
  namespace: "git",
  version: "1.0.0",
  description: "Built-in git handlers.",
  apiVersion: 2,
  handlers: {
    pull: defineHandler(
      { ai: false, capability: "vcs.sync", description: "git pull ${path}" },
      async (params, ctx) => {
        const p = resolvePath(params);
        const branch = params.branch ?? "main";
        ctx.logger.cmd(`git -C "${p}" pull origin ${branch} --autostash --no-edit`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn([
            "git",
            "-C",
            p,
            "pull",
            "origin",
            branch,
            "--autostash",
            "--no-edit",
          ]);
          if (result.exitCode !== 0) throw new Error(`git pull failed (exit ${result.exitCode})`);
        }
      },
    ),

    status: defineHandler(
      {
        ai: "confirm",
        description: "git status ${path}",
        params: pathParams("Working copy path"),
      },
      async (params, ctx) => {
        const p = resolvePath(params);
        ctx.logger.cmd(`git -C "${p}" status`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn(["git", "-C", p, "status"]);
          if (result.exitCode !== 0) throw new Error(`git status failed (exit ${result.exitCode})`);
        }
      },
    ),

    info: defineHandler(
      {
        ai: true,
        capability: "vcs.info",
        description: "git info ${path}",
        params: pathParams("Working copy path inside the project"),
      },
      async (params, ctx) => gitInfo(projectPath(params, ctx, "git/info"), ctx),
    ),

    checkout: defineHandler(
      { ai: false, description: "git checkout ${branch} in ${path}" },
      async (params, ctx) => {
        if (!params.branch) throw new Error("git/checkout requires with: branch:");
        const p = resolvePath(params);
        ctx.logger.cmd(`git -C "${p}" checkout ${params.branch}`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn(["git", "-C", p, "checkout", params.branch]);
          if (result.exitCode !== 0)
            throw new Error(`git checkout failed (exit ${result.exitCode})`);
        }
      },
    ),

    clone: defineHandler(
      { ai: false, description: "git clone ${url} into ${path}" },
      async (params, ctx) => {
        if (!params.url) throw new Error("git/clone requires with: url:");
        if (!params.path) throw new Error("git/clone requires with: path:");
        ctx.logger.cmd(`git clone "${params.url}" "${params.path}"`);
        if (!ctx.dryRun) {
          const result = await ctx.runtime.spawn(["git", "clone", params.url, params.path]);
          if (result.exitCode !== 0) throw new Error(`git clone failed (exit ${result.exitCode})`);
        }
      },
    ),
  },
});

export default plugin;
