/**
 * `vcs.git.lfs`: probe the Git LFS binary and user filters.
 * Ensure runs `git lfs install --skip-repo` only when the binary is new enough
 * and the filters are missing. It does not install the Git LFS package.
 */
import type { HandlerResult, JsonValue } from "../handler-result";
import { fail, ok } from "../handler-result";
import type { BoltPluginContext } from "../plugin";
import type { Runtime } from "../runtime/types";

export interface LfsView {
  status: "pass" | "fail";
  current: string | null;
  expected: string;
  fix: string | null;
  reason: "ok" | "missing" | "too_old" | "filters" | "unparsed";
  version: string | null;
}

const VERSION_RE = /git-lfs\/(\d+\.\d+\.\d+)/;

export function parseGitLfsVersion(text: string): string | undefined {
  return VERSION_RE.exec(text)?.[1];
}

function constraintParts(
  constraint: string | undefined,
): { exact: boolean; parts: [number, number, number] } | undefined {
  if (!constraint) return undefined;
  const match = constraint.trim().match(/^(>=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return undefined;
  return {
    exact: match[1] !== ">=",
    parts: [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)],
  };
}

/** `>=` and exact `major[.minor[.patch]]`. Any other spelling is not compared. */
export function versionSatisfies(current: string, constraint: string | undefined): boolean {
  const want = constraintParts(constraint);
  if (!want) return true;
  const got = constraintParts(current);
  if (!got) return false;
  const cmp =
    got.parts[0] - want.parts[0] || got.parts[1] - want.parts[1] || got.parts[2] - want.parts[2];
  return want.exact ? cmp === 0 : cmp >= 0;
}

function globalValue(runtime: Runtime, key: string): string | undefined {
  const result = runtime.spawnSync(["git", "config", "--global", "--get", key]);
  if (result.exitCode !== 0) return undefined;
  const text = result.stdout.trim();
  return text.length > 0 ? text : undefined;
}

function filtersInstalled(runtime: Runtime): boolean {
  return (
    globalValue(runtime, "filter.lfs.process") !== undefined ||
    globalValue(runtime, "filter.lfs.clean") !== undefined
  );
}

export function inspectGitLfs(runtime: Runtime, version: string | undefined): LfsView {
  const expected = version ?? "present";
  let listed: { exitCode: number; stdout: string };
  try {
    listed = runtime.spawnSync(["git", "lfs", "version"]);
  } catch {
    listed = { exitCode: 1, stdout: "" };
  }
  if (listed.exitCode !== 0) {
    return {
      status: "fail",
      current: null,
      expected,
      fix: "Install Git LFS, then run: git lfs install",
      reason: "missing",
      version: null,
    };
  }
  const parsed = parseGitLfsVersion(listed.stdout);
  if (!parsed) {
    return {
      status: "fail",
      current: null,
      expected,
      fix: "Git LFS did not report a version. Reinstall Git LFS, then run: git lfs install",
      reason: "unparsed",
      version: null,
    };
  }
  if (!versionSatisfies(parsed, version)) {
    return {
      status: "fail",
      current: parsed,
      expected,
      fix: `Upgrade Git LFS to satisfy ${expected}`,
      reason: "too_old",
      version: parsed,
    };
  }
  if (!filtersInstalled(runtime)) {
    return {
      status: "fail",
      current: parsed,
      expected,
      fix: "Run: git lfs install",
      reason: "filters",
      version: parsed,
    };
  }
  return {
    status: "pass",
    current: parsed,
    expected,
    fix: null,
    reason: "ok",
    version: parsed,
  };
}

function viewData(view: LfsView, changed?: boolean): { [key: string]: JsonValue } {
  const data: { [key: string]: JsonValue } = {
    current: view.current,
    expected: view.expected,
    fix: view.fix,
  };
  if (changed !== undefined) data.changed = changed;
  return data;
}

function failureCode(reason: LfsView["reason"]): string {
  if (reason === "missing") return "LFS_MISSING";
  if (reason === "too_old") return "LFS_TOO_OLD";
  if (reason === "filters") return "LFS_FILTERS";
  return "LFS_UNPARSEABLE";
}

function viewResult(view: LfsView, changed?: boolean): HandlerResult {
  const data = viewData(view, changed);
  if (view.status === "pass") {
    return ok(view.version ? `Git LFS ${view.version}` : "Git LFS", { data });
  }
  const message = view.fix ?? "Git LFS is not ready";
  return fail(message, {
    data,
    diagnostics: [
      {
        level: "error",
        code: failureCode(view.reason),
        message,
        ...(view.fix ? { fix: view.fix } : {}),
      },
    ],
  });
}

/** Install user filters when that is the only gap. Does not install the package. */
export async function applyGitLfs(
  runtime: Runtime,
  version: string | undefined,
): Promise<HandlerResult> {
  const view = inspectGitLfs(runtime, version);
  if (view.reason === "ok") return viewResult(view, false);
  if (view.reason !== "filters") return viewResult(view, false);
  let installed: { exitCode: number };
  try {
    installed = await runtime.spawn(["git", "lfs", "install", "--skip-repo"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message, {
      data: viewData(view, false),
      diagnostics: [
        {
          level: "error",
          code: "LFS_INSTALL_FAILED",
          message,
          fix: "Run: git lfs install",
        },
      ],
    });
  }
  if (installed.exitCode !== 0) {
    return fail("git lfs install failed", {
      data: viewData(view, false),
      diagnostics: [
        {
          level: "error",
          code: "LFS_INSTALL_FAILED",
          message: "git lfs install failed",
          fix: "Run: git lfs install",
        },
      ],
    });
  }
  const after = inspectGitLfs(runtime, version);
  if (after.reason !== "ok") {
    return fail(after.fix ?? "git lfs install did not configure filters", {
      data: viewData(after, false),
      diagnostics: [
        {
          level: "error",
          code: "LFS_INSTALL_FAILED",
          message: after.fix ?? "git lfs install did not configure filters",
          fix: "Run: git lfs install",
        },
      ],
    });
  }
  return viewResult({ ...after, fix: null }, true);
}

export async function gitLfsCheck(ctx: BoltPluginContext): Promise<HandlerResult> {
  const version = ctx.envCheck?.version;
  if (ctx.envCheck?.action === "ensure" && !ctx.dryRun) return applyGitLfs(ctx.runtime, version);
  return viewResult(inspectGitLfs(ctx.runtime, version));
}
