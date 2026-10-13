import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// These workflows install the published release. A pull_request run is a false
// failure: it does not test the PR, and an anonymous api.github.com call shares
// the runner IP's rate limit.
const workflows = [
  ".github/workflows/verify-windows-install.yml",
  ".github/workflows/verify-windows-self-update.yml",
];

for (const path of workflows) {
  test(`${path} runs against the live release only after Release`, () => {
    const text = readFileSync(path, "utf8");
    expect(text).not.toMatch(/^\s*pull_request:\s*$/m);
    expect(text).toContain("workflow_dispatch:");
    expect(text).toMatch(/workflows:\s*\["Release"\]/);
    expect(text).toMatch(/types:\s*\[completed\]/);
    expect(text).toContain(
      "github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'",
    );
    expect(text).toContain("Bearer ${{ github.token }}");
  });
}

// /releases/latest is the newest non-prerelease. The triggering Release run's
// head_branch is the tag that was pushed.
test("live Windows checks query the triggering tag", () => {
  for (const path of workflows) {
    const text = readFileSync(path, "utf8");
    expect(text).toContain("github.event.workflow_run.head_branch || inputs.tag");
    expect(text).toContain("/releases/tags/");
    expect(text).toContain("^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.]+)?$");
    expect(text).not.toMatch(/api\.github\.com\/repos\/jukrb0x\/Bolt\/releases\/latest/);
  }

  const install = readFileSync(workflows[0], "utf8");
  expect(install).toContain(
    '$env:BOLT_INSTALL_BASE = "https://github.com/jukrb0x/Bolt/releases/download/$tag"',
  );
  expect(install).not.toContain("releases/latest");

  // v2.1.0 self-update sends no token. BOLT_RELEASES_API is the override it honors.
  const update = readFileSync(workflows[1], "utf8");
  expect(update).toContain(
    '$env:BOLT_RELEASES_API = "http://127.0.0.1:8765/repos/jukrb0x/Bolt/releases"',
  );
  expect(update).toContain("HttpListener");
  expect(update).toContain("releases/latest");
  expect(update).toContain("bolt self-update --force");
});

// The pwsh leg of windows install already runs scripts/windows-install-e2e.ps1.
// main does not require the old live-release check name, so it is not repeated.
test("pull requests run the local Windows install proof once", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  expect(ci).not.toContain("windows-latest self-update from v2.1.0");
  expect(ci).not.toContain("windows-self-update:");
  expect(ci.split("windows-install-e2e.ps1").length - 1).toBe(1);
  expect(ci).toContain("host: [powershell, pwsh]");
  expect(ci).toContain("github.event_name == 'pull_request'");

  for (const path of workflows) {
    expect(readFileSync(path, "utf8")).not.toContain("windows-latest self-update from v2.1.0");
  }
});
