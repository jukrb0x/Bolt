import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { diagnoseCookLog, diagnoseUatLog } from "../../plugins/ue-diagnose-uat";
import ue from "../../plugins/ue";

const REPO = path.resolve(import.meta.dir, "../../..");
const MAIN = path.join(REPO, "src/main.ts");

const FIXTURE = path.join(import.meta.dir, "../fixtures/uat-unknown-cook.log");
const FIXTURE_TEXT = readFileSync(FIXTURE, "utf8");

function causeLine(text: string, needle: string): number {
  const line = text.split(/\r?\n/).findIndex((row) => row.includes(needle));
  expect(line).toBeGreaterThanOrEqual(0);
  return line + 1;
}

test("buried cook error is a short missing-package diagnosis, not the noise or the wrapper", () => {
  const found = diagnoseCookLog(FIXTURE_TEXT);
  const line = causeLine(FIXTURE_TEXT, "Couldn't find file for package");
  expect(found).toEqual({
    code: "UE_COOK_MISSING_PACKAGE",
    line,
    message:
      "Cook failed because /Game/UI/MissingWidget is missing (requested by /Game/Maps/Town).",
    fix: "Restore or retarget /Game/UI/MissingWidget, which /Game/Maps/Town references, then cook again.",
  });
  expect(found!.message.length).toBeLessThan(200);
  expect(found!.message.length * 4).toBeLessThan(FIXTURE_TEXT.length);
  expect(found!.message).not.toContain("SENTINEL_COOK_NOISE");
  expect(found!.message).not.toContain("texture streaming");
  expect(found!.message).not.toContain("Unknown Cook Failure");
});

test("a later missing package wins, and a missing package beats a later crash line", () => {
  const later = diagnoseCookLog(
    [
      "LogCook: Error: Couldn't find file for package /Game/Old/Stale requested by /Game/Maps/A.",
      "LogCook: Error: Couldn't find file for package /Game/UI/MissingWidget requested by /Game/Maps/Town.",
      "Unknown Cook Failure",
    ].join("\n"),
  );
  expect(later?.code).toBe("UE_COOK_MISSING_PACKAGE");
  expect(later?.message).toContain("/Game/UI/MissingWidget");
  expect(later?.line).toBe(2);

  const overCrash = diagnoseCookLog(
    [
      "LogCook: Error: Couldn't find file for package /Game/UI/MissingWidget requested by /Game/Maps/Town.",
      "Fatal error: [File:D:\\work\\Engine\\Source\\CookOnTheFlyServer.cpp] [Line: 10] Cook aborted.",
      "Unknown Cook Failure",
    ].join("\n"),
  );
  expect(overCrash?.code).toBe("UE_COOK_MISSING_PACKAGE");
  expect(overCrash?.line).toBe(1);
});

test("crash, shader, and other cook errors stay specific; a bare Error line is not a diagnosis", () => {
  const crash = diagnoseCookLog(
    [
      "LogCook: Display: start",
      "Fatal error: [File:D:\\work\\Engine\\Source\\Editor\\UnrealEd\\Private\\Cooker\\CookOnTheFlyServer.cpp] [Line: 4521] Cook aborted.",
      "Unknown Cook Failure",
    ].join("\n"),
  );
  expect(crash).toMatchObject({
    code: "UE_COOK_FATAL",
    line: 2,
    message: "Cook crashed in CookOnTheFlyServer.cpp:4521: Cook aborted.",
  });
  expect(crash?.fix.length).toBeGreaterThan(0);

  const assertion = diagnoseCookLog(
    "Assertion failed: Package != nullptr [File:CookOnTheFlyServer.cpp] [Line: 12]\nUnknown Cook Failure\n",
  );
  expect(assertion?.code).toBe("UE_COOK_FATAL");
  expect(assertion?.message).toContain("CookOnTheFlyServer.cpp:12");

  const shader = diagnoseCookLog(
    "LogShaderCompilers: Error: Failed to compile global shader FLumenScreenProbeGather\nUnknown Cook Failure\n",
  );
  expect(shader?.code).toBe("UE_COOK_SHADER");
  expect(shader?.message).toContain("FLumenScreenProbeGather");
  expect(shader?.message).not.toContain("Unknown Cook Failure");

  const other = diagnoseCookLog(
    "LogCook: Error: SavePackage failed for /Game/Maps/Town because the filename is too long\nError_UnknownCookFailure\n",
  );
  expect(other?.code).toBe("UE_COOK_ERROR");
  expect(other?.message).toContain("SavePackage failed");
  expect(other?.line).toBe(1);

  expect(
    diagnoseCookLog("Error: texture streaming pool over budget\nLogCook: Display: ok\n"),
  ).toBeUndefined();
});

test("wrapper with no cook cause is one short root-cause row, including CRLF logs", () => {
  const text = [
    "LogCook: Display: hello",
    "Error: texture streaming pool over budget",
    "LogCook: Warning: slow package",
    "Unknown Cook Failure",
  ].join("\n");
  const found = diagnoseCookLog(text);
  expect(found).toEqual({
    code: "UE_COOK_UNKNOWN_ROOTCAUSE",
    line: 4,
    message: "Cook ended as Unknown Cook Failure with no package, shader, or crash line above it.",
    fix: "Re-run the cook and keep the full log. Unknown Cook Failure is the wrapper, not the cause.",
  });
  expect(found!.message.length).toBeLessThan(text.length);

  const crlf = FIXTURE_TEXT.replace(/\n/g, "\r\n");
  expect(diagnoseCookLog(crlf)?.code).toBe("UE_COOK_MISSING_PACKAGE");
  expect(diagnoseCookLog(crlf)?.line).toBe(
    causeLine(FIXTURE_TEXT, "Couldn't find file for package"),
  );
});

test("diagnose_uat reads the log path and returns one EXT-1 diagnostic", () => {
  expect(ue.manifest?.handlers.diagnose_uat?.capabilities).toEqual(["diagnose"]);
  expect(ue.manifest?.handlers.diagnose_uat?.ai).toBe(true);

  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-uat-"));
  const log = path.join(dir, "cook.log");
  writeFileSync(log, FIXTURE_TEXT);
  try {
    const result = diagnoseUatLog(log);
    expect(result.status).toBe("ok");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics?.[0]).toMatchObject({
      level: "error",
      code: "UE_COOK_MISSING_PACKAGE",
      line: causeLine(FIXTURE_TEXT, "Couldn't find file for package"),
    });
    expect(path.resolve(String(result.diagnostics?.[0]?.file))).toBe(path.resolve(log));
    expect(result.summary && result.summary.length).toBeLessThanOrEqual(200);

    expect(diagnoseUatLog("")).toMatchObject({ status: "skipped" });
    const missing = diagnoseUatLog(path.join(dir, "nope.log"));
    expect(missing.status).toBe("warn");
    expect(missing.diagnostics?.[0]?.code).toBe("UE_COOK_LOG_UNREADABLE");

    const noise = path.join(dir, "noise.log");
    writeFileSync(noise, "Error: texture streaming pool over budget\n");
    expect(diagnoseUatLog(noise).diagnostics).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Unknown Cook Failure lives in the ue diagnose plugin", () => {
  const plugin = readFileSync(
    path.join(import.meta.dir, "../../plugins/ue-diagnose-uat.ts"),
    "utf8",
  );
  expect(plugin).toContain("Unknown Cook Failure");
});

function bolt(argv: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  const home = path.join(cwd, ".empty-home");
  mkdirSync(home, { recursive: true });
  const proc = Bun.spawn(
    ["bun", "--tsconfig-override", path.join(REPO, "tsconfig.json"), MAIN, ...argv],
    {
      cwd,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: process.env.PATH },
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

function project(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-uat-why-"));
  writeFileSync(dir + "/bolt.yaml", "version: 1\nproject:\n  name: Demo\n");
  return dir;
}

test("bolt why --log on the cook fixture returns a short primary", async () => {
  const dir = project();
  try {
    const run = await bolt(["why", "--log", FIXTURE, "--json"], dir);
    expect(run.code).toBe(0);
    expect(run.out.startsWith("{")).toBe(true);
    const body = JSON.parse(run.out) as {
      schema: string;
      ok: boolean;
      warnings: Array<{ code: string }>;
      data: {
        diagnostics: Array<Record<string, unknown>>;
        primary: {
          code: string;
          source: string;
          level: string;
          message: string;
          fix: string;
          path: string;
          span: { start_line: number };
        };
      };
    };
    expect(body.schema).toBe("bolt.why/v1");
    expect(body.ok).toBe(true);
    expect(run.out).not.toContain("SENTINEL_COOK_NOISE");
    expect(run.out).not.toContain("texture streaming");
    const primary = body.data.primary;
    expect(primary.code).toBe("UE_COOK_MISSING_PACKAGE");
    expect(primary.source).toBe("ue/diagnose_uat");
    expect(primary.level).toBe("error");
    expect(primary.message.length).toBeLessThan(FIXTURE_TEXT.length);
    expect(primary.fix.length).toBeGreaterThan(0);
    expect(path.resolve(primary.path)).toBe(path.resolve(FIXTURE));
    expect(primary.span.start_line).toBe(causeLine(FIXTURE_TEXT, "Couldn't find file for package"));
    expect(body.data.diagnostics[0]).toEqual(primary);
    expect(body.warnings.some((item) => item.code === "WHY_NO_PROVIDERS")).toBe(false);

    const human = await bolt(["why", "--log", FIXTURE], dir);
    expect(human.code).toBe(0);
    expect(human.out).toContain("UE_COOK_MISSING_PACKAGE");
    expect(human.out).toContain("/Game/UI/MissingWidget");
    expect(human.out).not.toContain("SENTINEL_COOK_NOISE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);

test("why without --log diagnoses the newest failed run", async () => {
  const dir = project();
  const logs = path.join(dir, ".bolt", "logs");
  mkdirSync(logs, { recursive: true });
  writeFileSync(path.join(logs, "bolt_2026-10-17T00-00-00.log"), "<< cook: SUCCESS (1.0s)\n");
  const failed = path.join(logs, "bolt_2026-10-16T03-49-00.log");
  writeFileSync(failed, `<< cook: FAILED (2.0s)\n${FIXTURE_TEXT}`);
  try {
    const run = await bolt(["why", "--json"], dir);
    expect(run.code).toBe(0);
    const data = JSON.parse(run.out).data as {
      run_id: string;
      log: { path: string; kind: string };
      primary: { code: string; source: string; span: { start_line: number } };
    };
    expect(data.log.kind).toBe("run");
    expect(data.run_id).toBe("bolt_2026-10-16T03-49-00");
    expect(path.resolve(data.log.path)).toBe(path.resolve(failed));
    expect(data.primary.code).toBe("UE_COOK_MISSING_PACKAGE");
    expect(data.primary.source).toBe("ue/diagnose_uat");
    expect(data.primary.span.start_line).toBe(
      causeLine(FIXTURE_TEXT, "Couldn't find file for package") + 1,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
