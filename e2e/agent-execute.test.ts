/**
 * Phase 2a true-mode loop on a built-in read: preview, then execute the same plan_hash.
 */
import { expect, test } from "bun:test";
import { bolt, dispose, makeProject } from "./harness";

test("agent previews and executes ue/ini_get", async () => {
  const project = makeProject({
    tasks: `tasks:
  read:
    - uses: ue/ini_get
      with: { file: Config/DefaultEngine.ini, section: Core.System, key: Foo }
`,
  });
  try {
    const preview = await bolt(project.dir, ["run", "--dry-run", "read", "--agent", "--json"]);
    expect(preview.exitCode, preview.output).toBe(0);
    const body = JSON.parse(preview.stdout) as {
      schema: string;
      ok: boolean;
      data: { preview: boolean; ai: boolean; plan_hash: string; plan: { ai: boolean } };
    };
    expect(body.schema).toBe("bolt.run/v1");
    expect(body.ok).toBe(true);
    expect(body.data.preview).toBe(true);
    expect(body.data.ai).toBe(true);
    expect(body.data.plan.ai).toBe(true);

    const run = await bolt(project.dir, [
      "run",
      "read",
      "--execute",
      `--plan=${body.data.plan_hash}`,
      "--json",
    ]);
    expect(run.exitCode, run.output).toBe(0);
    const done = JSON.parse(run.stdout) as {
      ok: boolean;
      data: { preview: boolean; outcome: string; plan_hash: string };
    };
    expect(done.ok).toBe(true);
    expect(done.data.preview).toBe(false);
    expect(done.data.outcome).toBe("ok");
    expect(done.data.plan_hash).toBe(body.data.plan_hash);
    expect(run.stderr).toContain("1");
  } finally {
    dispose(project.dir);
  }
});
