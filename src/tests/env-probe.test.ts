import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { defineHandler, definePlugin, fail, ok } from "../plugin";
import { PluginRegistry } from "../plugin-registry";
import { EnvSchema, manifestPathProblem, resolveEnvManifest } from "../env-manifest";
import { checkFromHandler, indexEnvChecks, probeData, type EnvProbeCheck } from "../env-probe";
import { VERSION } from "../version";

const REPO = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO, "src/main.ts");
const FIXTURE = path.join(REPO, "tests/fixtures/env-check-plugin");

const YAML_HEAD = `version: 1
project:
  name: Demo
`;

function bolt(argv: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  const home = path.join(cwd, ".empty-home");
  mkdirSync(home, { recursive: true });
  const proc = Bun.spawn(
    ["bun", "--tsconfig-override", path.join(REPO, "tsconfig.json"), MAIN, ...argv],
    {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home },
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
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-env-"));
  writeFileSync(path.join(dir, "bolt.yaml"), yaml);
  return dir;
}

function withFixture(dir: string): void {
  cpSync(FIXTURE, path.join(dir, "fixture"), { recursive: true });
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

test("manifest paths reject drive letters and parent escape", () => {
  expect(manifestPathProblem("C:/tools/env.yaml")).toContain("relative");
  expect(manifestPathProblem("D:\\tools\\env.yaml")).toContain("relative");
  expect(manifestPathProblem("/tmp/env.yaml")).toContain("relative");
  expect(manifestPathProblem("../env.yaml")).toContain("escapes");
  expect(manifestPathProblem("env.manifest.yaml")).toBeUndefined();
  expect(manifestPathProblem(".bolt/env.manifest.yaml")).toBeUndefined();
});

test("env schema accepts two checks and rejects an empty id, a drive letter, and both sources", () => {
  expect(
    EnvSchema.safeParse({
      checks: [{ id: "fixture.tool.a" }, { id: "fixture.tool.b", require: false, version: ">=1" }],
    }).success,
  ).toBe(true);
  expect(EnvSchema.safeParse({ checks: [] }).success).toBe(true);
  expect(EnvSchema.safeParse({ checks: [{ id: "" }] }).success).toBe(false);
  expect(
    EnvSchema.safeParse({ checks: [{ id: "fixture.tool.a", version: "C:/sdk" }] }).success,
  ).toBe(false);
  expect(
    EnvSchema.safeParse({ checks: [{ id: "fixture.tool.a" }], manifest: "env.yaml" }).success,
  ).toBe(false);
  expect(EnvSchema.safeParse({ manifest: "../env.yaml" }).success).toBe(false);
});

test("an external manifest resolves relative to the project root", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-env-file-"));
  try {
    writeFileSync(
      path.join(dir, "env.manifest.yaml"),
      "checks:\n  - id: fixture.tool.a\n    require: true\n",
    );
    const resolved = resolveEnvManifest({
      env: { manifest: "env.manifest.yaml" },
      configDir: dir,
    });
    expect(resolved).toEqual({
      source: "env.manifest.yaml",
      empty: false,
      checks: [{ id: "fixture.tool.a", require: true }],
    });
    expect(resolveEnvManifest({ env: undefined, configDir: dir }).empty).toBe(true);
    expect(resolveEnvManifest({ env: { checks: [] }, configDir: dir }).empty).toBe(true);
    expect(() =>
      resolveEnvManifest({ env: undefined, configDir: dir, manifestPath: "C:/env.yaml" }),
    ).toThrow(/relative/);
    expect(() =>
      resolveEnvManifest({ env: undefined, configDir: dir, manifestPath: "../env.yaml" }),
    ).toThrow(/escapes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("require false turns a handler fail into a warn gap, and pass stays out of gaps", () => {
  const missing = checkFromHandler(
    { id: "fixture.tool.a", require: false },
    "fixture",
    fail("missing", {
      data: {
        current: null,
        expected: "present",
        fix: "Install via fixture plugin ensure adapter",
      },
    }),
  );
  expect(missing.status).toBe("warn");
  expect(missing.source).toBe("plugin:fixture");
  const data = probeData("bolt.yaml#env", 1, [missing]);
  expect(data.gaps).toEqual([
    {
      id: "fixture.tool.a",
      status: "warn",
      current: null,
      expected: "present",
      fix: "Install via fixture plugin ensure adapter",
    },
  ]);
  const present = checkFromHandler(
    { id: "fixture.tool.b", require: true },
    "fixture",
    ok("present", { data: { current: "present", expected: "present", fix: null } }),
  );
  expect(probeData("bolt.yaml#env", 1, [present]).gaps).toEqual([]);
});

test("env.check handlers are indexed by checkId and a missing checkId is rejected", () => {
  const plugin = definePlugin({
    namespace: "fixture",
    version: "0.0.0",
    description: "fixture",
    apiVersion: 2,
    handlers: {
      tool_a: defineHandler(
        { capability: "env.check", checkId: "fixture.tool.a", ai: true },
        async () => ok(),
      ),
      tool_b: defineHandler(
        { capability: "env.check", checkId: "fixture.tool.b", ai: true },
        async () => ok(),
      ),
    },
  });
  const registry = new PluginRegistry();
  registry.register(plugin);
  const index = indexEnvChecks(registry);
  expect(index.get("fixture.tool.a")?.ref).toBe("fixture/tool_a");
  expect(index.get("fixture.tool.b")?.ref).toBe("fixture/tool_b");
  expect([...index.keys()].sort()).toEqual(["fixture.tool.a", "fixture.tool.b"]);

  expect(() =>
    definePlugin({
      namespace: "fixture",
      version: "0.0.0",
      description: "fixture",
      apiVersion: 2,
      handlers: {
        bare: defineHandler({ capability: "env.check", ai: true }, async () => ok()),
      },
    }),
  ).toThrow(/checkId/);
});

test("probe --json reports checks, gaps, and manifest, then a marker clears one gap", async () => {
  const dir = project(TWO_CHECKS);
  withFixture(dir);
  try {
    const first = await bolt(["env", "probe", "--json"], dir);
    expect(first.code).toBe(0);
    const body = parseStdout(first.out);
    expect(Object.keys(body)).toEqual([
      "schema",
      "bolt",
      "ok",
      "config",
      "data",
      "warnings",
      "errors",
    ]);
    expect(body.schema).toBe("bolt.env.probe/v1");
    expect(body.bolt).toBe(VERSION);
    expect(body.ok).toBe(true);
    expect(body.errors).toEqual([]);
    const data = body.data as {
      manifest: { source: string; checks_declared: number };
      checks: EnvProbeCheck[];
      gaps: Array<{
        id: string;
        status: string;
        current: string | null;
        expected: string;
        fix: string | null;
      }>;
      summary: { pass: number; fail: number; warn: number; skip: number };
    };
    expect(data.manifest).toEqual({ source: "bolt.yaml#env", checks_declared: 2 });
    expect(data.checks.map((check) => check.id)).toEqual(["fixture.tool.a", "fixture.tool.b"]);
    expect(
      data.checks.every((check) => check.status === "fail" && check.source === "plugin:fixture"),
    ).toBe(true);
    expect(data.gaps.map((gap) => gap.id)).toEqual(["fixture.tool.a", "fixture.tool.b"]);
    const gap = data.gaps[1];
    expect(gap).toEqual({
      id: "fixture.tool.b",
      status: "fail",
      current: null,
      expected: ">=1",
      fix: "Install via fixture plugin ensure adapter",
    });
    expect(data.summary).toEqual({ pass: 0, fail: 2, warn: 0, skip: 0 });

    mkdirSync(path.join(dir, ".bolt", "env-checks"), { recursive: true });
    writeFileSync(path.join(dir, ".bolt", "env-checks", "fixture.tool.a"), "");
    const second = await bolt(["env", "probe", "--json"], dir);
    expect(second.code).toBe(0);
    const again = parseStdout(second.out).data as {
      checks: EnvProbeCheck[];
      gaps: Array<{ id: string }>;
    };
    expect(again.checks.find((check) => check.id === "fixture.tool.a")?.status).toBe("pass");
    expect(again.gaps.map((gap) => gap.id)).toEqual(["fixture.tool.b"]);

    const human = await bolt(["env", "probe"], dir);
    expect(human.code).toBe(0);
    expect(human.out).toContain("fixture.tool.b");
    expect(human.out).toContain("Fix: Install via fixture plugin ensure adapter");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("a declared id with no provider is CHECK_UNKNOWN and is not a pass", async () => {
  const dir = project(`${YAML_HEAD}plugins:
  - namespace: fixture
    path: ./fixture
env:
  checks:
    - id: fixture.tool.a
    - id: missing.tool
`);
  withFixture(dir);
  try {
    const run = await bolt(["env", "probe", "--json"], dir);
    expect(run.code).toBe(3);
    const body = parseStdout(run.out);
    expect(body.ok).toBe(false);
    const errors = body.errors as Array<{ code: string; message: string }>;
    expect(errors.map((item) => item.code)).toEqual(["CHECK_UNKNOWN"]);
    expect(errors[0]?.message).toContain("missing.tool");
    const data = body.data as { checks: EnvProbeCheck[]; gaps: unknown[] };
    expect(data.checks).toEqual([]);
    expect(data.gaps).toEqual([]);
    expect(JSON.stringify(data)).not.toContain('"status": "pass"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("no env and empty checks warn ENV_NO_MANIFEST and exit 0", async () => {
  const dir = project(YAML_HEAD);
  try {
    const absent = await bolt(["env", "probe", "--json"], dir);
    expect(absent.code).toBe(0);
    const absentBody = parseStdout(absent.out);
    expect(absentBody.ok).toBe(true);
    expect(absentBody.errors).toEqual([]);
    expect(absentBody.warnings).toEqual([expect.objectContaining({ code: "ENV_NO_MANIFEST" })]);
    expect(absentBody.data).toEqual({
      manifest: { source: "bolt.yaml#env", checks_declared: 0 },
      checks: [],
      gaps: [],
      summary: { pass: 0, fail: 0, warn: 0, skip: 0 },
    });

    writeFileSync(path.join(dir, "bolt.yaml"), `${YAML_HEAD}env:\n  checks: []\n`);
    const empty = await bolt(["env", "probe", "--json"], dir);
    expect(empty.code).toBe(0);
    const emptyBody = parseStdout(empty.out);
    expect(emptyBody.ok).toBe(true);
    expect((emptyBody.warnings as Array<{ code: string }>)[0]?.code).toBe("ENV_NO_MANIFEST");
    expect((emptyBody.data as { checks: unknown[]; gaps: unknown[] }).checks).toEqual([]);
    expect((emptyBody.data as { gaps: unknown[] }).gaps).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("drive letters and path escape are MANIFEST_INVALID", async () => {
  const dir = project(`${YAML_HEAD}env:\n  manifest: "C:/tools/env.yaml"\n`);
  try {
    const drive = await bolt(["env", "probe", "--json"], dir);
    expect(drive.code).toBe(3);
    const driveBody = parseStdout(drive.out);
    expect(driveBody.ok).toBe(false);
    expect((driveBody.errors as Array<{ code: string }>)[0]?.code).toBe("MANIFEST_INVALID");

    writeFileSync(path.join(dir, "bolt.yaml"), YAML_HEAD);
    const flag = await bolt(["env", "probe", "--json", "--manifest", "C:/tools/env.yaml"], dir);
    expect(flag.code).toBe(3);
    expect((parseStdout(flag.out).errors as Array<{ code: string }>)[0]?.code).toBe(
      "MANIFEST_INVALID",
    );

    const escape = await bolt(["env", "probe", "--json", "--manifest", "../env.yaml"], dir);
    expect(escape.code).toBe(3);
    const escapeBody = parseStdout(escape.out);
    expect((escapeBody.errors as Array<{ code: string; message: string }>)[0]?.code).toBe(
      "MANIFEST_INVALID",
    );
    expect(escapeBody.errors).toEqual([
      expect.objectContaining({ message: expect.stringContaining("escapes") }),
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a second project reuses the same check ids", async () => {
  const dir = project(`${TWO_CHECKS.replace("name: Demo", "name: Other")}`);
  withFixture(dir);
  try {
    const run = await bolt(["env", "probe", "--json"], dir);
    expect(run.code).toBe(0);
    const data = parseStdout(run.out).data as { gaps: Array<{ id: string }> };
    expect(data.gaps.map((gap) => gap.id)).toEqual(["fixture.tool.a", "fixture.tool.b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
