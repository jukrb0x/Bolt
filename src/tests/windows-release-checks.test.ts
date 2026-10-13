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
