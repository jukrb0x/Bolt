import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Runs scripts/self-update-tag.ps1, the tag check and --force decision that
// verify-windows-self-update.yml calls, under real pwsh.
const script = path.join(import.meta.dir, "../../scripts/self-update-tag.ps1");
const pwsh = Bun.which("pwsh");

if (!pwsh && process.env.CI) {
  test("pwsh is installed in CI", () => {
    throw new Error(
      "pwsh was not found on PATH. CI must run scripts/self-update-tag.ps1 under pwsh; install PowerShell 7 on this runner.",
    );
  });
} else if (!pwsh) {
  console.warn(
    "Skipping self-update-tag.ps1 tests: pwsh was not found on PATH. Install PowerShell 7 to run them locally; CI fails instead of skipping.",
  );
}

// The tag goes through an environment variable, as RELEASE_TAG does in the workflow.
// pwsh -File drops a trailing newline from an argument, which would hide "v1.2.3\n".
function run(tag: string): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(
    [
      pwsh!,
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `& '${script}' -Tag $env:TEST_TAG; exit $LASTEXITCODE`,
    ],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, TEST_TAG: tag } },
  );
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

const ptest = pwsh ? test : test.skip;

for (const tag of ["v1.2.3", "v2.1.6", "v10.20.30", "v0.0.0"]) {
  ptest(`${tag} is stable, so self-update runs without --force`, () => {
    const r = run(tag);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("stable");
  });
}

// SemVer allows uppercase prerelease identifiers, so v1.2.3-RC.1 is accepted.
for (const tag of ["v1.2.3-rc.1", "v1.2.3-beta.2", "v1.2.3-rc", "v1.2.3-RC.1", "v1.2.3-x-y.0"]) {
  ptest(`${tag} is a prerelease, so self-update runs with --force`, () => {
    const r = run(tag);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("prerelease");
  });
}

const rejected = [
  "V1.2.3",
  "V1.2.3-rc.1",
  "v1.2.3+rcbuild",
  "v1.2.3rc1",
  "",
  "v1.2.3-",
  "1.2.3",
  "v01.2.3",
  "v1.02.3",
  "v1.2.03",
  "v1.2.3\n",
  "v1.2.3-..",
  "v1.2.3-rc..1",
  "v1.2.3-rc.",
  "v1.2.3-.rc",
];
for (const tag of rejected) {
  ptest(`${JSON.stringify(tag)} is rejected with a fix`, () => {
    const r = run(tag);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe("");
    // One plain line on stderr, not pwsh's wrapped error view.
    expect(r.stderr).not.toContain("| ");
    expect(r.stderr).toContain(`Tag '${tag}' is invalid`);
    expect(r.stderr).toContain("must start with a lowercase 'v'");
    expect(r.stderr).toContain("like v1.2.3 or v1.2.3-rc.1");
  });
}

ptest("v2.1.0 is rejected because self-update would not replace it", () => {
  const r = run("v2.1.0");
  expect(r.exitCode).not.toBe(0);
  expect(r.stderr).toContain("self-update would not replace the binary");
});

test("the script uses a case-sensitive match", () => {
  const text = readFileSync(script, "utf8");
  expect(text).toContain("-cnotmatch '^v(0|[1-9]");
  expect(text).toContain("\\z'");
  expect(text).not.toMatch(/\s-notmatch\s/);
});

// The block the workflow runs, taken from the yml so the two cannot drift.
function workflowTagCheck(): string {
  const yml = readFileSync(
    path.join(import.meta.dir, "../../.github/workflows/verify-windows-self-update.yml"),
    "utf8",
  );
  const lines = yml.split("\n");
  const begin = lines.findIndex((line) => line.trim() === "# BEGIN tag-check");
  const end = lines.findIndex((line) => line.trim() === "# END tag-check");
  if (begin < 0 || end < begin) throw new Error("tag-check markers not found in the workflow");
  return lines.slice(begin + 1, end).join("\n");
}

function runWorkflowCheck(tag: string, workspace: string) {
  const body = [
    '$ErrorActionPreference = "Stop"',
    "$tag = $env:TEST_TAG",
    workflowTagCheck(),
    'Write-Host "after-tag-check mode=$mode"',
  ].join("\n");
  const result = Bun.spawnSync([pwsh!, "-NoProfile", "-NonInteractive", "-Command", body], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      TEST_TAG: tag,
      GITHUB_WORKSPACE: workspace,
      GITHUB_REF: "refs/tags/v2.0.0",
    },
  });
  return {
    exitCode: result.exitCode ?? 1,
    out: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
}

const repoRoot = path.join(import.meta.dir, "../..");

ptest("the workflow block stops on an invalid tag before the next step", () => {
  const r = runWorkflowCheck("V1.2.3", repoRoot);
  expect(r.exitCode).not.toBe(0);
  expect(r.out).not.toContain("after-tag-check");
  expect(r.out).toContain("Tag validation failed for 'V1.2.3' (exit 1)");
});

ptest("the workflow block passes the mode on for valid tags", () => {
  expect(runWorkflowCheck("v1.2.3-rc.1", repoRoot).out).toContain(
    "after-tag-check mode=prerelease",
  );
  expect(runWorkflowCheck("v1.2.3", repoRoot).out).toContain("after-tag-check mode=stable");
});

ptest("the workflow block explains a ref without the script", () => {
  const r = runWorkflowCheck("v1.2.3", path.join(repoRoot, "src"));
  expect(r.exitCode).not.toBe(0);
  expect(r.out).not.toContain("after-tag-check");
  expect(r.out).toContain(
    "scripts/self-update-tag.ps1 not found in the checked-out ref refs/tags/v2.0.0",
  );
});
