import { expect, test, describe } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { VERSION } from "../version";
import { buildEnvelope, issue } from "../json-envelope";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO_ROOT, "src/main.ts");

const YAML = `version: 1
project:
  name: Demo
tasks:
  hello:
    - run: echo hi
flows:
  all:
    description: everything
    steps: [hello]
`;

function assertIssue(item: unknown): void {
  expect(typeof item).toBe("object");
  expect(item).not.toBeNull();
  const record = item as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  expect(keys.includes("code")).toBe(true);
  expect(keys.includes("message")).toBe(true);
  expect(keys.every((key) => key === "code" || key === "message" || key === "hint")).toBe(true);
  expect(typeof record.code).toBe("string");
  expect(record.code).not.toBe("");
  expect(typeof record.message).toBe("string");
  expect(record.message).not.toBe("");
  if ("hint" in record) {
    expect(typeof record.hint).toBe("string");
    expect(record.hint).not.toBe("");
  }
}

function parseStdout(out: string): Record<string, unknown> {
  expect(out.startsWith("{")).toBe(true);
  const parsed = JSON.parse(out) as Record<string, unknown>;
  expect(out).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

async function bolt(
  argv: string[],
  cwd: string,
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", MAIN, ...argv], {
    cwd,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

describe("buildEnvelope", () => {
  test("uses the shared field order and derives ok from the exit code", () => {
    const env = buildEnvelope({
      schema: "bolt.list/v1",
      exitCode: 0,
      config: { path: "/proj/bolt.yaml", local: null },
      data: { tasks: [] },
      warnings: [issue("CONFIG_WARNING", "fan-out ignored")],
      errors: [],
    });
    expect(Object.keys(env)).toEqual([
      "schema",
      "bolt",
      "ok",
      "config",
      "data",
      "warnings",
      "errors",
    ]);
    expect(env.schema).toBe("bolt.list/v1");
    expect(env.bolt).toBe(VERSION);
    expect(env.ok).toBe(true);
    expect(env.warnings[0]).toEqual({ code: "CONFIG_WARNING", message: "fan-out ignored" });
    expect("hint" in env.warnings[0]).toBe(false);
    for (const code of [0, 1, 2, 3]) {
      expect(
        buildEnvelope({ schema: "bolt.check/v1", exitCode: code, config: null, data: null }).ok,
      ).toBe(code === 0);
    }
  });

  test("keeps config null when there is no bolt.yaml", () => {
    const env = buildEnvelope({
      schema: "bolt.info/v1",
      exitCode: 3,
      config: null,
      data: null,
      errors: [issue("CONFIG_NOT_FOUND", "bolt.yaml not found", "Run bolt init")],
    });
    const text = JSON.stringify(env);
    expect(text).toContain('"config":null');
    expect(env.config).toBeNull();
    expect(JSON.parse(text).config).toBeNull();
    assertIssue(env.errors[0]);
    expect(env.errors[0]).toEqual({
      code: "CONFIG_NOT_FOUND",
      message: "bolt.yaml not found",
      hint: "Run bolt init",
    });
  });
});

describe("stdout guard", () => {
  test("sends console.log and stdout.write to stderr", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-json-guard-"));
    const file = path.join(dir, "probe.ts");
    const mod = path.join(REPO_ROOT, "src/json-envelope.ts");
    writeFileSync(
      file,
      `import { installJsonStdoutGuard, writeJsonStdout } from ${JSON.stringify(mod)};
installJsonStdoutGuard();
console.log("noise-log");
process.stdout.write("noise-write\\n");
writeJsonStdout('{"ok":true}\\n');
`,
    );
    try {
      const proc = Bun.spawn(["bun", file], { stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code).toBe(0);
      expect(out).toBe('{"ok":true}\n');
      expect(err).toContain("noise-log");
      expect(err).toContain("noise-write");
      expect(out).not.toContain("noise");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CLI --json", () => {
  test("list, info, and check report a null config and ok false when bolt.yaml is missing", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-json-missing-"));
    try {
      for (const [cmd, schema] of [
        ["list", "bolt.list/v1"],
        ["info", "bolt.info/v1"],
        ["check", "bolt.check/v1"],
      ] as const) {
        const run = await bolt([cmd, "--json"], dir);
        expect(run.code).toBe(3);
        expect(run.err).not.toContain("reserved by bolt");
        expect(run.err).not.toContain("[ERROR]");
        const body = parseStdout(run.out);
        expect(body.schema).toBe(schema);
        expect(body.bolt).toBe(VERSION);
        expect(body.ok).toBe(false);
        expect(body.ok).toBe(run.code === 0);
        expect(body.config).toBeNull();
        expect(Array.isArray(body.warnings)).toBe(true);
        expect(Array.isArray(body.errors)).toBe(true);
        const errors = body.errors as unknown[];
        expect(errors.length).toBeGreaterThan(0);
        for (const item of errors) assertIssue(item);
        expect((errors[0] as { code: string }).code).toBe("CONFIG_NOT_FOUND");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("list, info, check, and inspect print one envelope and ok matches exit 0", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-json-ok-"));
    writeFileSync(path.join(dir, "bolt.yaml"), YAML);
    writeFileSync(path.join(dir, "bolt.local.yaml"), "vars: {}\n");
    try {
      const list = await bolt(["list", "--json"], dir);
      expect(list.code).toBe(0);
      expect(list.err).toBe("");
      const listBody = parseStdout(list.out);
      expect(listBody.schema).toBe("bolt.list/v1");
      expect(listBody.ok).toBe(true);
      expect(listBody.config).toEqual({
        path: path.join(dir, "bolt.yaml"),
        local: path.join(dir, "bolt.local.yaml"),
      });
      expect(listBody.data).toEqual({
        tasks: ["hello"],
        flows: [{ name: "all", steps: ["hello"], description: "everything" }],
      });
      expect(listBody.warnings).toEqual([]);
      expect(listBody.errors).toEqual([]);

      const info = await bolt(["info", "--json"], dir);
      expect(info.code).toBe(0);
      const infoBody = parseStdout(info.out);
      expect(infoBody.schema).toBe("bolt.info/v1");
      expect(infoBody.ok).toBe(info.code === 0);
      expect(infoBody.data).toEqual({
        version: 1,
        project: { name: "Demo" },
        tasks: ["hello"],
        flows: [{ name: "all", steps: ["hello"] }],
      });

      const check = await bolt(["check", "--json"], dir);
      expect(check.code).toBe(0);
      const checkBody = parseStdout(check.out);
      expect(checkBody.schema).toBe("bolt.check/v1");
      expect(checkBody.ok).toBe(true);
      expect(checkBody.data).toEqual({ valid: true, legacy: [] });

      const inspect = await bolt(["inspect", "hello", "--json"], dir);
      expect(inspect.code).toBe(0);
      const inspectBody = parseStdout(inspect.out);
      expect(inspectBody.schema).toBe("bolt.inspect/v1");
      expect(inspectBody.ok).toBe(true);
      expect(inspectBody.data).toEqual({
        kind: "tasks",
        name: null,
        params: {},
        tasks: [
          {
            name: "hello",
            continueOnFailure: false,
            nodes: [{ kind: "run", command: "echo hi", continueOnError: false }],
          },
        ],
        capabilities: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("check and inspect put failures in errors and set ok from the exit code", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-json-bad-"));
    writeFileSync(path.join(dir, "bolt.yaml"), "project:\n  name: Demo\n");
    try {
      const check = await bolt(["check", "--json"], dir);
      expect(check.code).toBe(3);
      const checkBody = parseStdout(check.out);
      expect(checkBody.ok).toBe(false);
      expect(checkBody.config).toEqual({ path: path.join(dir, "bolt.yaml"), local: null });
      const checkData = checkBody.data as { valid: boolean };
      expect(checkData.valid).toBe(false);
      for (const item of checkBody.errors as unknown[]) assertIssue(item);
      expect((checkBody.errors as Array<{ code: string }>)[0].code).toBe("CONFIG_INVALID");

      writeFileSync(path.join(dir, "bolt.yaml"), YAML);
      const missing = await bolt(["inspect", "--json"], dir);
      expect(missing.code).toBe(2);
      const missingBody = parseStdout(missing.out);
      expect(missingBody.schema).toBe("bolt.inspect/v1");
      expect(missingBody.ok).toBe(false);
      expect(missingBody.data).toBeNull();
      expect((missingBody.errors as Array<{ code: string }>)[0].code).toBe("USAGE");

      const unknown = await bolt(["inspect", "nope", "--json"], dir);
      expect(unknown.code).toBe(2);
      const unknownBody = parseStdout(unknown.out);
      expect(unknownBody.ok).toBe(unknown.code === 0);
      expect((unknownBody.errors as Array<{ code: string }>)[0].code).toBe("USAGE");

      const list = await bolt(["list", "--json"], dir);
      expect(list.code).toBe(0);
      expect(list.out).not.toContain("TASKS");
      expect(list.out).not.toContain("bolt.yaml:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("text output is unchanged when --json is absent", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-json-text-"));
    writeFileSync(path.join(dir, "bolt.yaml"), YAML);
    try {
      const list = await bolt(["list"], dir);
      expect(list.code).toBe(0);
      expect(list.out).toContain("TASKS");
      expect(list.out).toContain("hello");
      expect(list.out).not.toContain("bolt.list/v1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
