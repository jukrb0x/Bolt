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

function run(tag: string): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(
    [pwsh!, "-NoProfile", "-NonInteractive", "-File", script, "-Tag", tag],
    { stdout: "pipe", stderr: "pipe" },
  );
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

const ptest = pwsh ? test : test.skip;

for (const tag of ["v1.2.3", "v2.1.6", "v10.20.30"]) {
  ptest(`${tag} is stable, so self-update runs without --force`, () => {
    const r = run(tag);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("stable");
  });
}

// SemVer allows uppercase prerelease identifiers, so v1.2.3-RC.1 is accepted.
for (const tag of ["v1.2.3-rc.1", "v1.2.3-beta.2", "v1.2.3-rc", "v1.2.3-RC.1"]) {
  ptest(`${tag} is a prerelease, so self-update runs with --force`, () => {
    const r = run(tag);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("prerelease");
  });
}

for (const tag of [
  "V1.2.3",
  "V1.2.3-rc.1",
  "v1.2.3+rcbuild",
  "v1.2.3rc1",
  "",
  "v1.2.3-",
  "1.2.3",
]) {
  ptest(`${JSON.stringify(tag)} is rejected with a fix`, () => {
    const r = run(tag);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe("");
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
  expect(text).toContain("-cnotmatch '^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.]+)?$'");
  expect(text).not.toMatch(/\s-notmatch\s/);
});
