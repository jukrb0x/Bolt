/**
 * Phase 2b: confirm-tier builtins, CONFIRM_REQUIRED, and ai.run: never.
 */
import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "fs";
import path from "path";
import { bolt, dispose, makeProject } from "./harness";

const env = { BOLT_AGENT: "" };

function parse(stdout: string): {
  schema: string;
  ok: boolean;
  data: {
    preview?: boolean;
    ai?: boolean | string;
    plan_hash?: string;
    outcome?: string;
    plugins?: Array<{
      namespace: string;
      handlers: Array<{ name: string; ai?: boolean | string }>;
    }>;
  };
  errors: Array<{ code: string; hint?: string }>;
} {
  return JSON.parse(stdout);
}

test("fs/mkdir requires confirmation, then runs when the user flag is set", async () => {
  const project = makeProject({
    tasks: `tasks:
  mk:
    - uses: fs/mkdir
      with: { path: made }
`,
  });
  const made = path.join(project.dir, "made");
  try {
    const preview = await bolt(project.dir, ["run", "--dry-run", "mk", "--json"], env);
    expect(preview.exitCode, preview.output).toBe(0);
    const body = parse(preview.stdout);
    expect(body.schema).toBe("bolt.run/v1");
    expect(body.data.preview).toBe(true);
    expect(body.data.ai).toBe("confirm");
    expect(existsSync(made)).toBe(false);

    const refused = await bolt(
      project.dir,
      ["run", "mk", "--execute", `--plan=${body.data.plan_hash}`, "--json"],
      env,
    );
    expect(refused.exitCode, refused.output).toBe(4);
    const denied = parse(refused.stdout);
    expect(denied.ok).toBe(false);
    expect(denied.errors[0]?.code).toBe("CONFIRM_REQUIRED");
    expect(denied.errors[0]?.hint).toContain("--confirmed-by-user");
    expect(existsSync(made)).toBe(false);

    const yes = await bolt(
      project.dir,
      ["run", "mk", "--execute", `--plan=${body.data.plan_hash}`, "--confirmed-by-user", "--json"],
      env,
    );
    expect(yes.exitCode, yes.output).toBe(0);
    expect(parse(yes.stdout).data.outcome).toBe("ok");
    expect(existsSync(made)).toBe(true);
  } finally {
    dispose(project.dir);
  }
});

test("ai.run never refuses a confirm plan even with --confirmed-by-user", async () => {
  const project = makeProject({
    tasks: `tasks:
  mk:
    - uses: fs/mkdir
      with: { path: made }
`,
  });
  writeFileSync(path.join(project.dir, "bolt.local.yaml"), "ai:\n  run: never\n");
  const made = path.join(project.dir, "made");
  try {
    const preview = await bolt(project.dir, ["run", "--dry-run", "mk", "--json"], env);
    expect(preview.exitCode, preview.output).toBe(0);
    const hash = parse(preview.stdout).data.plan_hash;
    const refused = await bolt(
      project.dir,
      ["run", "mk", "--execute", `--plan=${hash}`, "--confirmed-by-user", "--json"],
      env,
    );
    expect(refused.exitCode, refused.output).toBe(4);
    expect(parse(refused.stdout).errors[0]?.code).toBe("AGENT_EXECUTION_DISABLED");
    expect(existsSync(made)).toBe(false);
  } finally {
    dispose(project.dir);
  }
});

test("destructive ue/kill stays ai false", async () => {
  const project = makeProject({
    tasks: `tasks:
  die:
    - uses: ue/kill
`,
  });
  try {
    const preview = await bolt(project.dir, ["run", "--dry-run", "die", "--agent", "--json"], env);
    expect(preview.exitCode, preview.output).toBe(0);
    const body = parse(preview.stdout);
    expect(body.data.ai).toBe(false);
    const refused = await bolt(
      project.dir,
      ["run", "die", "--execute", `--plan=${body.data.plan_hash}`, "--confirmed-by-user", "--json"],
      env,
    );
    expect(refused.exitCode, refused.output).toBe(4);
    expect(parse(refused.stdout).errors[0]?.code).toBe("AI_FORBIDDEN");
  } finally {
    dispose(project.dir);
  }
});

test("version --json advertises confirm without dropping agent or execute", async () => {
  const project = makeProject();
  try {
    const run = await bolt(project.dir, ["version", "--json"], env);
    expect(run.exitCode, run.output).toBe(0);
    const info = JSON.parse(run.stdout) as { capabilities: string[] };
    expect(info.capabilities).toContain("agent");
    expect(info.capabilities).toContain("execute");
    expect(info.capabilities.at(-1)).toBe("confirm");
  } finally {
    dispose(project.dir);
  }
});

test("bolt ai --json is bolt.catalog/v1 and does not write the context file", async () => {
  const project = makeProject();
  try {
    const run = await bolt(project.dir, ["ai", "--json"], env);
    expect(run.exitCode, run.output).toBe(0);
    expect(existsSync(path.join(project.dir, ".bolt", "ai-context.md"))).toBe(false);
    const body = parse(run.stdout);
    expect(body.schema).toBe("bolt.catalog/v1");
    expect(body.ok).toBe(true);
    const ue = body.data.plugins?.find((plugin) => plugin.namespace === "ue");
    const names = new Map(ue?.handlers.map((handler) => [handler.name, handler.ai]));
    expect(names.get("build")).toBe("confirm");
    expect(names.get("info")).toBe(true);
    expect(names.has("kill")).toBe(false);
    const fs = body.data.plugins?.find((plugin) => plugin.namespace === "fs");
    const fsNames = new Map(fs?.handlers.map((handler) => [handler.name, handler.ai]));
    expect(fsNames.get("mkdir")).toBe("confirm");
    expect(fsNames.has("delete")).toBe(false);
  } finally {
    dispose(project.dir);
  }
});
