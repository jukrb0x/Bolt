import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { checkConfig } from "../config";
import { ensureResultHasNoopSemantics, probeResultHasGapSemantics } from "../env-ensure";
import { envSetupShellWarnings } from "../env-manifest";
import { fail, ok, skipped } from "../handler-result";

const REPO = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO, "src/main.ts");
const FIXTURE = path.join(REPO, "tests/fixtures/env-check-plugin");
const SHELL_FIXTURE = path.join(REPO, "tests/fixtures/env-shell-plugin");

const YAML_HEAD = `version: 1
project:
  name: Demo
`;

function bolt(
  argv: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; out: string; err: string }> {
  const home = path.join(cwd, ".empty-home");
  mkdirSync(home, { recursive: true });
  const proc = Bun.spawn(
    ["bun", "--tsconfig-override", path.join(REPO, "tsconfig.json"), MAIN, ...argv],
    {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home, ...env },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([out, err, code]) => ({ code, out, err }));
}

function parseStdout(out: string): Record<string, unknown> {
  expect(out.startsWith("{")).toBe(true);
  const parsed = JSON.parse(out) as Record<string, unknown>;
  expect(out).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

function project(yaml: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-ensure-"));
  writeFileSync(path.join(dir, "bolt.yaml"), yaml);
  return dir;
}

function withFixture(dir: string): void {
  cpSync(FIXTURE, path.join(dir, "fixture"), { recursive: true });
}

function withShell(dir: string): void {
  cpSync(SHELL_FIXTURE, path.join(dir, "shellfix"), { recursive: true });
}

function shellProject(id: string): string {
  return project(`${YAML_HEAD}plugins:
  - namespace: shellfix
    path: ./shellfix
env:
  checks:
    - id: ${id}
      require: true
`);
}

const TWO_CHECKS = `${YAML_HEAD}plugins:
  - namespace: fixture
    path: ./fixture
env:
  checks:
    - id: fixture.tool.a
      require: true
    - id: fixture.tool.b
      require: true
      version: ">=1"
`;

interface EnsureData {
  policy: string;
  dry_run: boolean;
  plan_hash: string;
  plan: Array<{ id: string; action: string; will_change: boolean; reason?: string }>;
  changed: string[];
  noop: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; code: string }>;
  summary: { changed: number; noop: number; failed: number };
}

function marker(dir: string, id: string): string {
  return path.join(dir, ".bolt", "env-checks", id);
}

test("ensure --help lists dry-run, execute, plan, and confirmed-by-user", async () => {
  const dir = project(YAML_HEAD);
  try {
    const help = await bolt(["env", "ensure", "--help"], dir);
    expect(help.code).toBe(0);
    expect(help.out).toContain("--dry-run");
    expect(help.out).toContain("--execute");
    expect(help.out).toContain("--plan");
    expect(help.out).toContain("--confirmed-by-user");
    expect(help.out).toContain("--json");
    expect(help.out).toContain("--manifest");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dry-run plan_hash round-trips and does not write markers", async () => {
  const dir = project(TWO_CHECKS);
  withFixture(dir);
  try {
    const first = await bolt(["env", "ensure", "--dry-run", "--json"], dir);
    expect(first.code).toBe(0);
    const body = parseStdout(first.out);
    expect(body.schema).toBe("bolt.env.ensure/v1");
    expect(body.ok).toBe(true);
    expect(body.errors).toEqual([]);
    const data = body.data as EnsureData;
    expect(data.policy).toBe("fill-gaps");
    expect(data.dry_run).toBe(true);
    expect(data.plan_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(data.changed).toEqual([]);
    expect(data.noop).toEqual([]);
    expect(data.failed).toEqual([]);
    expect(data.summary).toEqual({ changed: 0, noop: 0, failed: 0 });
    expect(data.plan).toEqual([
      { id: "fixture.tool.a", action: "ensure", will_change: true },
      { id: "fixture.tool.b", action: "ensure", will_change: true },
    ]);
    expect(JSON.stringify(data.plan)).not.toContain("will_touch");
    expect(JSON.stringify(data.plan)).not.toContain("target_rev");
    expect(JSON.stringify(data)).not.toContain("sync_policy");
    expect(existsSync(marker(dir, "fixture.tool.a"))).toBe(false);
    expect(existsSync(marker(dir, "fixture.tool.b"))).toBe(false);

    const again = await bolt(["env", "ensure", "--dry-run", "--json"], dir);
    expect(again.code).toBe(0);
    expect((parseStdout(again.out).data as EnsureData).plan_hash).toBe(data.plan_hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("a mismatched plan exits 4 PLAN_MISMATCH and does not write", async () => {
  const dir = project(TWO_CHECKS);
  withFixture(dir);
  try {
    const run = await bolt(
      ["env", "ensure", "--execute", "--plan=sha256:" + "ab".repeat(32), "--json"],
      dir,
    );
    expect(run.code).toBe(4);
    const body = parseStdout(run.out);
    expect(body.ok).toBe(false);
    expect(body.schema).toBe("bolt.env.ensure/v1");
    expect((body.errors as Array<{ code: string }>)[0]?.code).toBe("PLAN_MISMATCH");
    expect(existsSync(marker(dir, "fixture.tool.a"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("execute without --confirmed-by-user exits 4 CONFIRM_REQUIRED and does not write", async () => {
  const dir = project(TWO_CHECKS);
  withFixture(dir);
  try {
    const preview = await bolt(["env", "ensure", "--dry-run", "--json"], dir);
    const hash = (parseStdout(preview.out).data as EnsureData).plan_hash;
    const run = await bolt(["env", "ensure", "--execute", `--plan=${hash}`, "--json"], dir);
    expect(run.code).toBe(4);
    const body = parseStdout(run.out);
    expect(body.ok).toBe(false);
    expect((body.errors as Array<{ code: string }>)[0]?.code).toBe("CONFIRM_REQUIRED");
    expect(existsSync(marker(dir, "fixture.tool.a"))).toBe(false);
    expect(existsSync(marker(dir, "fixture.tool.b"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("execute fills fixture gaps, then a second ensure changes nothing", async () => {
  const dir = project(TWO_CHECKS);
  withFixture(dir);
  try {
    const preview = await bolt(["env", "ensure", "--dry-run", "--json"], dir);
    const hash = (parseStdout(preview.out).data as EnsureData).plan_hash;
    const run = await bolt(
      ["env", "ensure", "--execute", `--plan=${hash}`, "--confirmed-by-user", "--json"],
      dir,
    );
    expect(run.code).toBe(0);
    const data = parseStdout(run.out).data as EnsureData;
    expect(data.dry_run).toBe(false);
    expect(data.changed).toEqual(["fixture.tool.a", "fixture.tool.b"]);
    expect(data.failed).toEqual([]);
    expect(data.summary.changed).toBe(2);
    expect(existsSync(marker(dir, "fixture.tool.a"))).toBe(true);
    expect(existsSync(marker(dir, "fixture.tool.b"))).toBe(true);

    const probed = await bolt(["env", "probe", "--json"], dir);
    expect(probed.code).toBe(0);
    const gaps = (parseStdout(probed.out).data as { gaps: unknown[] }).gaps;
    expect(gaps).toEqual([]);

    const nextPreview = await bolt(["env", "ensure", "--dry-run", "--json"], dir);
    const next = parseStdout(nextPreview.out).data as EnsureData;
    expect(next.plan.every((row) => row.action === "noop" && row.will_change === false)).toBe(true);
    expect(next.plan_hash).not.toBe(hash);
    const second = await bolt(
      ["env", "ensure", "--execute", `--plan=${next.plan_hash}`, "--confirmed-by-user", "--json"],
      dir,
    );
    expect(second.code).toBe(0);
    const again = parseStdout(second.out).data as EnsureData;
    expect(again.summary.changed).toBe(0);
    expect(again.changed).toEqual([]);
    expect(again.noop.map((row) => row.reason)).toEqual(["already_satisfied", "already_satisfied"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("require false is a noop and is not ensured", async () => {
  const dir = project(`${YAML_HEAD}plugins:
  - namespace: fixture
    path: ./fixture
env:
  checks:
    - id: fixture.tool.a
      require: true
    - id: fixture.tool.b
      require: false
`);
  withFixture(dir);
  try {
    const preview = await bolt(["env", "ensure", "--dry-run", "--json"], dir);
    const data = parseStdout(preview.out).data as EnsureData;
    expect(data.plan).toEqual([
      { id: "fixture.tool.a", action: "ensure", will_change: true },
      { id: "fixture.tool.b", action: "noop", will_change: false, reason: "not_required" },
    ]);
    const run = await bolt(
      ["env", "ensure", "--execute", `--plan=${data.plan_hash}`, "--confirmed-by-user", "--json"],
      dir,
    );
    expect(run.code).toBe(0);
    const applied = parseStdout(run.out).data as EnsureData;
    expect(applied.changed).toEqual(["fixture.tool.a"]);
    expect(applied.noop).toEqual([{ id: "fixture.tool.b", reason: "not_required" }]);
    expect(existsSync(marker(dir, "fixture.tool.b"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("vcs.git.lfs ensure is idempotent when git lfs is installed", async () => {
  const which = Bun.spawnSync(["git", "lfs", "version"], { stdout: "pipe", stderr: "pipe" });
  if (which.exitCode !== 0) return;
  const dir = project(`${YAML_HEAD}env:
  checks:
    - id: vcs.git.lfs
      require: true
`);
  const home = path.join(dir, ".empty-home");
  const gitConfig = path.join(home, "lfs.gitconfig");
  const env = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitConfig,
    HOME: home,
    USERPROFILE: home,
  };
  try {
    const preview = await bolt(["env", "ensure", "--dry-run", "--json"], dir, env);
    expect(preview.code).toBe(0);
    const data = parseStdout(preview.out).data as EnsureData;
    expect(data.plan.map((row) => row.id)).toEqual(["vcs.git.lfs"]);
    expect(existsSync(marker(dir, "vcs.git.lfs"))).toBe(false);
    const run = await bolt(
      ["env", "ensure", "--execute", `--plan=${data.plan_hash}`, "--confirmed-by-user", "--json"],
      dir,
      env,
    );
    expect(run.code).toBe(0);
    const applied = parseStdout(run.out).data as EnsureData;
    expect(applied.failed).toEqual([]);
    const next = await bolt(["env", "ensure", "--dry-run", "--json"], dir, env);
    const nextData = parseStdout(next.out).data as EnsureData;
    const second = await bolt(
      [
        "env",
        "ensure",
        "--execute",
        `--plan=${nextData.plan_hash}`,
        "--confirmed-by-user",
        "--json",
      ],
      dir,
      env,
    );
    expect(second.code).toBe(0);
    expect((parseStdout(second.out).data as EnsureData).summary.changed).toBe(0);
    if (data.plan[0]?.will_change) expect(applied.changed).toEqual(["vcs.git.lfs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("gap and noop predicates keep a structured result and reject a bare one", () => {
  const gap = fail("missing", {
    data: { current: null, expected: "present", fix: "Install via adapter" },
  });
  expect(probeResultHasGapSemantics(gap)).toBe(true);
  expect(probeResultHasGapSemantics(ok("please install"))).toBe(false);
  expect(probeResultHasGapSemantics(skipped("skip"))).toBe(true);
  expect(
    ensureResultHasNoopSemantics(
      ok("installer noop", { data: { changed: false, reason: "already_satisfied" } }),
    ),
  ).toBe(true);
  expect(ensureResultHasNoopSemantics(ok("ensured", { data: { changed: true } }))).toBe(true);
  expect(ensureResultHasNoopSemantics(ok("setup complete"))).toBe(false);
  expect(
    ensureResultHasNoopSemantics(
      ok("setup", { data: { changed: true, studio_setup_shell: true } }),
    ),
  ).toBe(false);
});

test("a studio_setup_shell handler is EMPTY_SHELL and is not called", async () => {
  const dir = shellProject("fixture.shell");
  withShell(dir);
  try {
    const dry = await bolt(["env", "ensure", "--dry-run", "--json"], dir);
    expect(dry.code).toBe(2);
    const dryBody = parseStdout(dry.out);
    expect(dryBody.ok).toBe(false);
    expect(dryBody.schema).toBe("bolt.env.ensure/v1");
    expect((dryBody.errors as Array<{ code: string }>)[0]?.code).toBe("EMPTY_SHELL");
    expect(JSON.stringify(dryBody.errors)).toContain("studio_setup_shell");
    expect(existsSync(marker(dir, "fixture.shell"))).toBe(false);

    const run = await bolt(
      [
        "env",
        "ensure",
        "--execute",
        "--plan=sha256:" + "ab".repeat(32),
        "--confirmed-by-user",
        "--json",
      ],
      dir,
    );
    expect(run.code).toBe(2);
    expect((parseStdout(run.out).errors as Array<{ code: string }>)[0]?.code).toBe("EMPTY_SHELL");
    expect(existsSync(marker(dir, "fixture.shell"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("ensure rejects a probe result that has no gap fields", async () => {
  const dir = shellProject("fixture.echo");
  withShell(dir);
  try {
    const dry = await bolt(["env", "ensure", "--dry-run", "--json"], dir);
    expect(dry.code).toBe(2);
    const body = parseStdout(dry.out);
    expect((body.errors as Array<{ code: string; message: string }>)[0]?.code).toBe("EMPTY_SHELL");
    expect(body.errors).toEqual([
      expect.objectContaining({ message: expect.stringContaining("fixture.echo") }),
    ]);
    expect((body.data as EnsureData).changed).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("ensure rejects an apply result that has no changed flag", async () => {
  const dir = shellProject("fixture.bare");
  withShell(dir);
  try {
    const preview = await bolt(["env", "ensure", "--dry-run", "--json"], dir);
    expect(preview.code).toBe(0);
    const hash = (parseStdout(preview.out).data as EnsureData).plan_hash;
    const run = await bolt(
      ["env", "ensure", "--execute", `--plan=${hash}`, "--confirmed-by-user", "--json"],
      dir,
    );
    expect(run.code).toBe(2);
    const body = parseStdout(run.out);
    expect((body.errors as Array<{ code: string }>)[0]?.code).toBe("EMPTY_SHELL");
    expect((body.data as EnsureData).changed).toEqual([]);
    expect((body.data as EnsureData).summary.changed).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("a handler that returns changed false is not EMPTY_SHELL", async () => {
  const dir = shellProject("fixture.installer");
  withShell(dir);
  try {
    const preview = await bolt(["env", "ensure", "--dry-run", "--json"], dir);
    expect(preview.code).toBe(0);
    const data = parseStdout(preview.out).data as EnsureData;
    expect(data.plan).toEqual([{ id: "fixture.installer", action: "ensure", will_change: true }]);
    const run = await bolt(
      ["env", "ensure", "--execute", `--plan=${data.plan_hash}`, "--confirmed-by-user", "--json"],
      dir,
    );
    expect(run.code).toBe(0);
    const applied = parseStdout(run.out).data as EnsureData;
    expect(applied.changed).toEqual([]);
    expect(applied.noop).toEqual([{ id: "fixture.installer", reason: "already_satisfied" }]);
    expect(applied.failed).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("bolt check warns on a one-shot setup task when env is absent and still exits 0", async () => {
  const dir = project(`${YAML_HEAD}tasks:
  setup:
    - run: ./Setup.bat
  build:
    - run: echo build
    - run: ./Setup.bat
`);
  try {
    const run = await bolt(["check", "--json"], dir);
    expect(run.code).toBe(0);
    const body = parseStdout(run.out);
    expect(body.ok).toBe(true);
    const warnings = body.warnings as Array<{ code: string; message: string }>;
    expect(warnings.map((item) => item.message)).toEqual([
      expect.stringContaining('ENV_SETUP_SHELL: task "setup"'),
    ]);
    expect(JSON.stringify(warnings)).not.toContain("build");

    writeFileSync(
      path.join(dir, "bolt.yaml"),
      `${YAML_HEAD}env:\n  checks: []\ntasks:\n  setup:\n    - run: ./Setup.bat\n`,
    );
    const declared = await bolt(["check", "--json"], dir);
    expect(declared.code).toBe(0);
    expect(JSON.stringify(parseStdout(declared.out).warnings)).not.toContain("ENV_SETUP_SHELL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkConfig warning matches the one-shot setup task", async () => {
  const dir = project(`${YAML_HEAD}tasks:\n  setup:\n    - run: pwsh ./tools/Setup.ps1\n`);
  try {
    const result = await checkConfig(path.join(dir, "bolt.yaml"));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.startsWith("ENV_SETUP_SHELL:"))).toBe(true);
    expect(
      envSetupShellWarnings(
        {
          setup: [{ run: "./Setup.bat" }],
          engine: [{ run: undefined }],
        },
        false,
      ).join("\n"),
    ).not.toContain("engine");
    expect(envSetupShellWarnings({ engine: [{ run: "ue/setup" }] }, false)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensure without a mode is a usage error", async () => {
  const dir = project(YAML_HEAD);
  try {
    const run = await bolt(["env", "ensure", "--json"], dir);
    expect(run.code).toBe(2);
    const body = parseStdout(run.out);
    expect((body.errors as Array<{ code: string }>)[0]?.code).toBe("USAGE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
