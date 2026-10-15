import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Cold pwsh on ubuntu-latest can take longer than bun's 5s default. The runner
// then kills the spawn and the test sees exit 1. Later cases in this file finish
// in a few hundred ms once pwsh is warm. 30s is the ceiling for one start.
setDefaultTimeout(30_000);

// Runs scripts/self-update-tag.ps1, the tag check (and --force decision for
// self-update) that verify-windows-self-update.yml and verify-windows-install.yml
// call, under real pwsh.
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
function run(
  tag: string,
  opts: { allowBaseline?: boolean } = {},
): { exitCode: number; stdout: string; stderr: string } {
  const switchArg = opts.allowBaseline ? " -AllowBaseline" : "";
  const result = Bun.spawnSync(
    [
      pwsh!,
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `& '${script}' -Tag $env:TEST_TAG${switchArg}; exit $LASTEXITCODE`,
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

// Mirrors Format-Tag in the script for the test inputs.
function escapeTag(tag: string): string {
  return tag.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
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
    expect(r.stderr).toContain(`Tag '${escapeTag(tag)}' is invalid`);
    expect(r.stderr).toContain("must start with a lowercase 'v'");
    expect(r.stderr).toContain("like v1.2.3 or v1.2.3-rc.1");
  });
}

for (const [tag, shown] of [
  ["v1.2.3\n", "v1.2.3\\n"],
  ["v1.2.3\r\n", "v1.2.3\\r\\n"],
  ["v1.2\n.3", "v1.2\\n.3"],
  ["v1.2.3\t", "v1.2.3\\t"],
  ["v1.2.3\u001b[31m", "v1.2.3\\x1B[31m"],
] as const) {
  ptest(`control characters in ${JSON.stringify(tag)} are escaped on one line`, () => {
    const r = run(tag);
    // Windows pwsh ends stderr with CRLF; normalize before asserting one line / no raw CR.
    const stderr = r.stderr.replace(/\r\n/g, "\n");
    expect(r.exitCode).not.toBe(0);
    expect(stderr).toContain(`Tag '${shown}' is invalid`);
    expect(stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(stderr).not.toContain("\r");
    expect(stderr).not.toContain("\u001b");
  });
}

ptest("v2.1.0 is rejected because self-update would not replace it", () => {
  const r = run("v2.1.0");
  expect(r.exitCode).not.toBe(0);
  expect(r.stderr).toContain("self-update would not replace the binary");
});

ptest("v2.1.0 is accepted with -AllowBaseline (install path)", () => {
  const r = run("v2.1.0", { allowBaseline: true });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toBe("stable");
  expect(r.stderr).not.toContain("self-update would not replace");
});

test("the script uses a case-sensitive match", () => {
  const text = readFileSync(script, "utf8");
  expect(text).toContain("-cnotmatch '^v(0|[1-9]");
  expect(text).toContain("\\z'");
  expect(text).not.toMatch(/\s-notmatch\s/);
});

// The block the workflow runs, taken from the yml so the two cannot drift.
function workflowTagCheck(workflow = "verify-windows-self-update.yml"): string {
  const yml = readFileSync(path.join(import.meta.dir, "../../.github/workflows", workflow), "utf8");
  const lines = yml.split("\n");
  const begin = lines.findIndex((line) => line.trim() === "# BEGIN tag-check");
  const end = lines.findIndex((line) => line.trim() === "# END tag-check");
  if (begin < 0 || end < begin) throw new Error("tag-check markers not found in the workflow");
  return lines.slice(begin + 1, end).join("\n");
}

function runWorkflowCheck(tag: string, workspace: string, workflow?: string) {
  const body = [
    '$ErrorActionPreference = "Stop"',
    "$tag = $env:TEST_TAG",
    workflowTagCheck(workflow),
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

// verify-windows-install.yml runs the same script; it only needs validity.
const install = "verify-windows-install.yml";

ptest("the install workflow block stops on an invalid tag", () => {
  for (const tag of ["V1.2.3", "v1.2.3\n", "v01.2.3"]) {
    const r = runWorkflowCheck(tag, repoRoot, install);
    expect(r.exitCode).not.toBe(0);
    expect(r.out).not.toContain("after-tag-check");
    expect(r.out).toContain(`Tag validation failed for '${escapeTag(tag)}' (exit 1)`);
  }
});

ptest("the install workflow block lets valid tags through", () => {
  for (const tag of ["v1.2.3", "v1.2.3-rc.1", "v2.1.0"]) {
    const r = runWorkflowCheck(tag, repoRoot, install);
    expect(r.exitCode).toBe(0);
    expect(r.out).toContain("after-tag-check");
    expect(r.out).not.toContain("self-update would not replace");
  }
});

ptest("the self-update workflow block rejects v2.1.0", () => {
  const r = runWorkflowCheck("v2.1.0", repoRoot);
  expect(r.exitCode).not.toBe(0);
  expect(r.out).not.toContain("after-tag-check");
  expect(r.out).toContain("self-update would not replace the binary");
});

test("the install workflow block passes -AllowBaseline", () => {
  const yml = readFileSync(path.join(repoRoot, ".github/workflows", install), "utf8");
  const begin = yml.indexOf("# BEGIN tag-check");
  const end = yml.indexOf("# END tag-check");
  const block = yml.slice(begin, end);
  expect(block).toContain("-AllowBaseline");
  const su = readFileSync(
    path.join(repoRoot, ".github/workflows/verify-windows-self-update.yml"),
    "utf8",
  );
  const suBlock = su.slice(su.indexOf("# BEGIN tag-check"), su.indexOf("# END tag-check"));
  expect(suBlock).not.toContain("-AllowBaseline");
});

ptest("the install workflow block explains a ref without the script", () => {
  const r = runWorkflowCheck("v1.2.3", path.join(repoRoot, "src"), install);
  expect(r.exitCode).not.toBe(0);
  expect(r.out).toContain("scripts/self-update-tag.ps1 not found in the checked-out ref");
});

test("the install workflow no longer uses a loose -notmatch tag check", () => {
  const yml = readFileSync(path.join(repoRoot, ".github/workflows", install), "utf8");
  expect(yml).not.toMatch(/\$tag -notmatch/);
  expect(yml).toContain("sparse-checkout: scripts");
});
