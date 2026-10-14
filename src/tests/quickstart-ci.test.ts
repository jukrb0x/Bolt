import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isNewer } from "../commands/update";

// Local release artifacts, same as the Windows install job. The public latest
// URL is not a pull-request check: the commit is not published yet.
test("quickstart CI installs the local binary and is not a required-check workflow", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  expect(ci).toContain("name: quickstart ${{ matrix.os }}");
  expect(ci).toContain("needs: binaries");
  expect(ci).toContain("os: macos-14");
  expect(ci).toContain("os: macos-15-intel");
  expect(ci).not.toContain("os: macos-13");
  expect(ci).toContain("bash scripts/unix-quickstart-e2e.sh");
  expect(ci).toContain("github.event_name == 'pull_request' || github.ref == 'refs/heads/main'");
  // No branch-protection or ruleset change. The job name is not an existing required check.
  expect(ci).not.toContain("required_status_checks");

  const script = readFileSync("scripts/unix-quickstart-e2e.sh", "utf8");
  expect(script).toContain('curl -fsSL "http://127.0.0.1:${port}/install.sh"');
  expect(script).toContain("|");
  expect(script).toContain("BOLT_INSTALL_BASE");
  expect(script).toContain('export PATH="$HOME/.bolt/bin:$PATH"');
  expect(script).toContain("bolt --version");
  expect(script).toContain("bolt init");
  expect(script).toContain("bolt run demo --dry-run");
  expect(script).toContain("bolt run demo");
  expect(script).toContain("hello from");
  expect(script).toContain("com.apple.quarantine");
  expect(script).toContain("bolt self-update");

  const win = readFileSync("scripts/windows-install-e2e.ps1", "utf8");
  expect(win).toContain("bolt init");
  expect(win).toContain("bolt run demo --dry-run");
  expect(win).toContain("bolt run demo");
  expect(win).toContain("cmd.exe");
  expect(win).toContain("Bun's shell");
});

test("quickstart self-update target is newer than the installed version", () => {
  function next(current: string): string {
    const result = Bun.spawnSync(
      [
        "bash",
        "-c",
        'source "$1"; next_version "$2"',
        "bash",
        "scripts/unix-quickstart-e2e.sh",
        current,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  }

  expect(next("2.0.0-dev")).toBe("2.0.0");
  expect(isNewer("2.0.0-dev", next("2.0.0-dev"))).toBe(true);
  expect(next("2.0.0")).toBe("2.0.1");
  expect(isNewer("2.0.0", next("2.0.0"))).toBe(true);
});
