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

// Branch protection may require this exact job name. It has to keep running on
// pull requests, and it has to run the local proof rather than the live release.
test("pull requests keep the self-update check name on the local install proof", () => {
  const marker = "name: windows-latest self-update from v2.1.0";
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const at = ci.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const job = ci.slice(at, ci.indexOf("\n  binaries:", at));
  expect(job).toContain("github.event_name == 'pull_request'");
  expect(job).toContain(".\\scripts\\windows-install-e2e.ps1");
  expect(job).not.toContain("api.github.com");
  expect(job).not.toContain("releases/latest");

  for (const path of workflows) {
    expect(readFileSync(path, "utf8")).not.toContain(marker);
  }
});
