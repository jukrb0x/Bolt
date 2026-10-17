// src/plugins/git.ts
import { defineHandler, definePlugin, type BoltPluginContext, type HandlerResult } from "../plugin";
import { z } from "zod";
import path from "path";
import type { SpawnResult } from "../runtime/types";
import { projectFilePath } from "./path-guard";
import { vcsFail, vcsFailureCode } from "./vcs-revision";

/** Params schema for handlers that take only a working copy path. */
export function pathParams(description: string) {
  return z.object({ path: z.string().describe(description) });
}

function resolvePath(params: Record<string, string>): string {
  if (!params.path) throw new Error("git handler requires with: path:");
  return params.path;
}

/**
 * Path for read-only handlers with `ai: true` (`git/info`, `svn/info`). A relative
 * path resolves against the bolt.yaml directory.
 * - Human runs: a path literally outside the project (`../Engine`) is allowed with a
 *   warning. An in-project path that resolves outside through a symlink gives no
 *   warning (as on main); its real path goes to the run log file only.
 * - AI invocations: any path outside the project, literal or through a symlink, is
 *   rejected by core (the runner) before the handler runs.
 */
export function projectPath(
  params: Record<string, string>,
  ctx: BoltPluginContext,
  ref: string,
): string {
  if (!params.path) throw new Error(`${ref} requires with: path:`);
  try {
    // Literal check only (as on main); a symlink escape goes to the run log file only.
    return projectFilePath(params.path, ctx, ref);
  } catch {
    const resolved = path.resolve(ctx.configDir, params.path);
    ctx.logger.warn(
      `${ref}: path "${params.path}" (${resolved}) is outside the project directory "${ctx.configDir}". This run continues, but AI invocations of ${ref} will reject this path. Fix: use a path under the project directory, or read other repositories with a run: step.`,
    );
    return resolved;
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

const GIT_ENV = { GIT_TERMINAL_PROMPT: "0" };

function gitCall(ctx: BoltPluginContext, args: string[]): SpawnResult {
  try {
    return ctx.runtime.spawnSync(args, { env: GIT_ENV });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 127, stdout: "", stderr: message };
  }
}

function gitText(ctx: BoltPluginContext, cwd: string, args: string[]): string | undefined {
  const result = gitCall(ctx, ["git", "-C", cwd, ...args]);
  if (result.exitCode !== 0) return undefined;
  const text = result.stdout.trim();
  return text.length > 0 ? text : undefined;
}

function gitUpstream(
  ctx: BoltPluginContext,
  cwd: string,
): { remote: string; branch: string; sha: string } | undefined {
  const name = gitText(ctx, cwd, ["rev-parse", "--abbrev-ref", "@{u}"]);
  const sha = gitText(ctx, cwd, ["rev-parse", "@{u}"]);
  if (!name || !sha || !name.includes("/")) return undefined;
  const slash = name.indexOf("/");
  return { remote: name.slice(0, slash), branch: name.slice(slash + 1), sha };
}

function revisionRow(targetRev: string, willTouch: boolean): HandlerResult {
  return { status: "ok", data: { action: "sync", target_rev: targetRev, will_touch: willTouch } };
}

function gitDetail(result: SpawnResult, fallback: string): string {
  const text = `${result.stderr}\n${result.stdout}`.trim();
  return text || fallback;
}

/** Read-only. `target_rev` is a local commit. A later pull may move past it. */
function gitPlan(
  params: Record<string, string>,
  ctx: BoltPluginContext,
  cwd: string,
): HandlerResult {
  if (gitText(ctx, cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return vcsFail("VCS_REVISION", `Git revision unavailable for ${cwd}: not a git work tree.`);
  }
  const head = gitText(ctx, cwd, ["rev-parse", "HEAD"]);
  if (!head) return vcsFail("VCS_REVISION", `Git revision unavailable for ${cwd}: no commits.`);
  if (params.pin) {
    const resolved = gitText(ctx, cwd, ["rev-parse", "--verify", `${params.pin}^{commit}`]);
    if (!resolved)
      return vcsFail("VCS_REVISION", `Pin "${params.pin}" does not resolve in ${cwd}.`);
    return revisionRow(resolved, resolved !== head);
  }
  const upstream = gitUpstream(ctx, cwd);
  if (!upstream) return revisionRow(head, false);
  // ponytail: target_rev is the local @{u} commit, so git pull can land on a newer
  // remote commit. Upgrade: resolve the remote tip here and merge that exact sha.
  return revisionRow(upstream.sha, true);
}

function gitPrecheck(
  params: Record<string, string>,
  ctx: BoltPluginContext,
  cwd: string,
): HandlerResult {
  if (gitText(ctx, cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return vcsFail("VCS_REVISION", `Git precheck failed for ${cwd}: not a git work tree.`);
  }
  if (params.pin) {
    const resolved = gitText(ctx, cwd, ["rev-parse", "--verify", `${params.pin}^{commit}`]);
    if (!resolved)
      return vcsFail("VCS_REVISION", `Pin "${params.pin}" does not resolve in ${cwd}.`);
    return { status: "ok" };
  }
  const upstream = gitUpstream(ctx, cwd);
  if (!upstream) return { status: "ok" };
  ctx.logger.cmd(
    `git -C ${JSON.stringify(cwd)} ls-remote ${upstream.remote} refs/heads/${upstream.branch}`,
  );
  const result = gitCall(ctx, [
    "git",
    "-C",
    cwd,
    "ls-remote",
    upstream.remote,
    `refs/heads/${upstream.branch}`,
  ]);
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    const detail = gitDetail(result, `git ls-remote failed (exit ${result.exitCode})`);
    return vcsFail(vcsFailureCode(detail, "VCS_SYNC"), `Git precheck failed for ${cwd}: ${detail}`);
  }
  return { status: "ok" };
}

async function gitSync(
  params: Record<string, string>,
  ctx: BoltPluginContext,
  cwd: string,
): Promise<HandlerResult> {
  if (params.pin) {
    ctx.logger.cmd(`git -C ${JSON.stringify(cwd)} checkout ${params.pin}`);
    if (ctx.dryRun) return { status: "ok" };
    const result = await gitRun(ctx, [
      "git",
      "-c",
      "advice.detachedHead=false",
      "-C",
      cwd,
      "checkout",
      params.pin,
    ]);
    if (result.exitCode !== 0) {
      const detail = gitDetail(result, `git checkout failed (exit ${result.exitCode})`);
      return vcsFail(
        vcsFailureCode(detail, "VCS_SYNC"),
        `git checkout failed for ${cwd}: ${detail}`,
      );
    }
    return { status: "ok" };
  }
  const upstream = gitUpstream(ctx, cwd);
  if (!upstream) return { status: "ok" };
  ctx.logger.cmd(
    `git -C ${JSON.stringify(cwd)} pull --ff-only --autostash --no-edit ${upstream.remote} ${upstream.branch}`,
  );
  if (ctx.dryRun) return { status: "ok" };
  const result = await gitRun(ctx, [
    "git",
    "-C",
    cwd,
    "pull",
    "--ff-only",
    "--autostash",
    "--no-edit",
    upstream.remote,
    upstream.branch,
  ]);
  if (result.exitCode !== 0) {
    const detail = gitDetail(result, `git pull failed (exit ${result.exitCode})`);
    return vcsFail(vcsFailureCode(detail, "VCS_SYNC"), `git pull failed for ${cwd}: ${detail}`);
  }
  return { status: "ok" };
}

async function gitRun(ctx: BoltPluginContext, args: string[]): Promise<SpawnResult> {
  try {
    return await ctx.runtime.spawn(args, { env: GIT_ENV });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 127, stdout: "", stderr: message };
  }
}

/**
 * `vcs.revision` for workspace sync. `phase=plan` (default) and `phase=precheck`
 * do not update the work tree. `phase=sync` checks out `pin` or pulls the upstream.
 */
async function gitRevision(
  params: Record<string, string>,
  ctx: BoltPluginContext,
): Promise<HandlerResult> {
  const cwd = params.path;
  if (!cwd) return vcsFail("VCS_REVISION", "git/revision requires path.");
  if (params.phase === "sync") return gitSync(params, ctx, cwd);
  if (params.phase === "precheck") return gitPrecheck(params, ctx, cwd);
  return gitPlan(params, ctx, cwd);
}

const plugin = definePlugin({
  namespace: "git",
  version: "1.0.0",
  description: "Built-in git handlers.",
  apiVersion: 2,
  handlers: {
    pull: defineHandler(
      { ai: "confirm", capability: "vcs.sync", description: "git pull ${path}" },
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

    revision: defineHandler(
      {
        ai: "confirm",
        capability: "vcs.revision",
        description: "Resolve the git revision workspace sync uses for ${path}",
      },
      gitRevision,
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
