import { expect, test } from "bun:test";
import gitPlugin from "../../plugins/git";
import { applyGitLfs, inspectGitLfs, versionSatisfies } from "../../plugins/git-lfs";
import { settleEnsure } from "../../env-ensure";
import type { Runtime } from "../../runtime/types";
import { Logger } from "../../logger";
import { testCfg } from "../env";

function scripted(replies: Record<string, { code?: number; out?: string }>): {
  runtime: Runtime;
  calls: string[];
} {
  const calls: string[] = [];
  const answer = (cmd: string[]) => {
    const key = cmd.join(" ");
    calls.push(key);
    const hit = replies[key] ?? { code: 1, out: "" };
    return { exitCode: hit.code ?? 0, stdout: hit.out ?? "", stderr: "" };
  };
  const runtime: Runtime = {
    spawn: async (cmd) => answer(cmd),
    spawnSync: (cmd) => answer(cmd),
    shell: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    parseYaml: () => ({}),
  };
  return { runtime, calls };
}

const VERSION = "git-lfs/3.4.1 (GitHub; linux amd64; go 1.21.7)\n";
const VERSION_CMD = "git lfs version";
const PROCESS = "git config --global --get filter.lfs.process";
const CLEAN = "git config --global --get filter.lfs.clean";
const INSTALL = "git lfs install --skip-repo";

test("version constraints compare >= and exact dotted versions", () => {
  expect(versionSatisfies("3.4.1", undefined)).toBe(true);
  expect(versionSatisfies("3.4.1", ">=3")).toBe(true);
  expect(versionSatisfies("3.4.1", ">=3.5")).toBe(false);
  expect(versionSatisfies("3.4.1", "3.4.1")).toBe(true);
  expect(versionSatisfies("3.4.1", "3.4.0")).toBe(false);
  expect(versionSatisfies("3.0.0", ">=3")).toBe(true);
});

test("probe passes when the binary and filters are present", () => {
  const { runtime, calls } = scripted({
    [VERSION_CMD]: { code: 0, out: VERSION },
    [PROCESS]: { code: 0, out: "git-lfs filter-process\n" },
  });
  const view = inspectGitLfs(runtime, ">=3");
  expect(view.reason).toBe("ok");
  expect(view.current).toBe("3.4.1");
  expect(view.status).toBe("pass");
  expect(calls).not.toContain(INSTALL);
});

test("ensure does not install when the binary is missing or too old", async () => {
  const missing = scripted({ [VERSION_CMD]: { code: 1, out: "" } });
  const missingResult = await applyGitLfs(missing.runtime, undefined);
  expect(missingResult.status).toBe("fail");
  expect(missingResult.diagnostics?.[0]?.code).toBe("LFS_MISSING");
  expect(missing.calls).not.toContain(INSTALL);
  expect(settleEnsure(missingResult).kind).toBe("failed");

  const old = scripted({ [VERSION_CMD]: { code: 0, out: "git-lfs/2.9.0 (x)\n" } });
  const oldResult = await applyGitLfs(old.runtime, ">=3");
  expect(oldResult.diagnostics?.[0]?.code).toBe("LFS_TOO_OLD");
  expect(old.calls).not.toContain(INSTALL);
});

test("ensure installs filters once when the binary is new enough", async () => {
  let filters = false;
  const calls: string[] = [];
  const runtime: Runtime = {
    spawn: async (cmd) => {
      calls.push(cmd.join(" "));
      filters = true;
      return { exitCode: 0, stdout: "Git LFS initialized.\n", stderr: "" };
    },
    spawnSync: (cmd) => {
      const key = cmd.join(" ");
      calls.push(key);
      if (key === VERSION_CMD) return { exitCode: 0, stdout: VERSION, stderr: "" };
      if (key === PROCESS || key === CLEAN) {
        return filters
          ? { exitCode: 0, stdout: "git-lfs filter-process\n", stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "" };
    },
    shell: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    parseYaml: () => ({}),
  };
  const gap = inspectGitLfs(runtime, undefined);
  expect(gap.reason).toBe("filters");
  const first = await applyGitLfs(runtime, undefined);
  expect(first.status).toBe("ok");
  expect(first.data).toMatchObject({ changed: true, current: "3.4.1" });
  expect(calls).toContain(INSTALL);
  const second = await applyGitLfs(runtime, undefined);
  expect(second.data).toMatchObject({ changed: false });
  expect(calls.filter((call) => call === INSTALL)).toHaveLength(1);
});

test("git/lfs probes unless env ensure sets action", async () => {
  const { runtime, calls } = scripted({
    [VERSION_CMD]: { code: 0, out: VERSION },
    [PROCESS]: { code: 1 },
    [CLEAN]: { code: 1 },
  });
  const ctx = {
    cfg: testCfg,
    configDir: process.cwd(),
    dryRun: false,
    logger: new Logger({ sink: () => {} }),
    runtime,
    envCheck: { id: "vcs.git.lfs", require: true },
  };
  const probed = await gitPlugin.handlers.lfs({}, ctx);
  expect(probed).toMatchObject({ status: "fail" });
  expect(calls).not.toContain(INSTALL);
  expect(gitPlugin.manifest?.handlers.lfs?.checkId).toBe("vcs.git.lfs");
});
