import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { VERSION } from "../version";
import { PluginRegistry } from "../plugin-registry";
import { builtinPlugins } from "../plugins";
import { defineHandler, definePlugin, ok } from "../plugin";
import { ddcSectionCheck } from "../plugins/ue-doctor-ddc";
import {
  checksFromHandler,
  fanOutRefs,
  matchesOnly,
  pickPrimary,
  resolveWhyLog,
  summarizeChecks,
} from "../doctor-why";

const REPO = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO, "src/main.ts");

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
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-m3-"));
  writeFileSync(path.join(dir, "bolt.yaml"), yaml);
  return dir;
}

function plugin(dir: string, namespace: string, source: string): void {
  const root = path.join(dir, namespace);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "index.ts"), source);
}

function doctorPlugin(namespace: string, handlerSource: string): string {
  return `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: ${JSON.stringify(namespace)},
  version: "1.0.0",
  description: ${JSON.stringify(namespace)},
  apiVersion: 2,
  handlers: {
    check: defineHandler({ capability: "doctor", ai: true, description: "check" }, ${handlerSource}),
  },
});
`;
}

function diagnosePlugin(namespace: string, handlerSource: string): string {
  return `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: ${JSON.stringify(namespace)},
  version: "1.0.0",
  description: ${JSON.stringify(namespace)},
  apiVersion: 2,
  handlers: {
    read: defineHandler({ capability: "diagnose", ai: true, description: "read" }, ${handlerSource}),
  },
});
`;
}

const YAML_HEAD = `version: 1
project:
  name: Demo
`;

test("matchesOnly is an exact id or a dot-segment prefix", () => {
  expect(matchesOnly("ue.ddc.installed_vs_source", "ue.ddc")).toBe(true);
  expect(matchesOnly("ue.ddc.installed_vs_source", "ue.ddc.installed_vs_source")).toBe(true);
  expect(matchesOnly("ue.ddcfoo", "ue.ddc")).toBe(false);
  expect(matchesOnly("ue.ddc", "ue.ddc.installed_vs_source")).toBe(false);
});

test("checks prefer data.checks and map diagnostics without a pass row", () => {
  const preferred = checksFromHandler("acme/check", {
    status: "ok",
    data: {
      checks: [{ id: "acme.one", level: "pass", message: "ok" }],
    },
    diagnostics: [{ level: "error", code: "IGNORED", message: "nope" }],
  });
  expect(preferred.checks).toEqual([
    { id: "acme.one", level: "pass", message: "ok", source: "acme/check" },
  ]);

  const missing = checksFromHandler("acme/check", {
    status: "fail",
    data: { checks: [{ id: "acme.bad", message: "missing level" }] },
  });
  expect(missing.checks[0]?.level).toBe("error");
  expect(missing.warnings.map((item) => item.code)).toEqual(["DOCTOR_CHECK_LEVEL"]);

  const mapped = checksFromHandler("acme/check", {
    status: "fail",
    diagnostics: [
      {
        level: "error",
        code: "DDC_SHARED_MISSING",
        message: "shared",
        fix: "set it",
        file: "a.ini",
        line: 4,
      },
      { level: "info", code: "NOTE", message: "note" },
    ],
  });
  expect(mapped.checks.map((check) => check.level)).toEqual(["error", "info"]);
  expect(mapped.checks[0]).toMatchObject({
    id: "DDC_SHARED_MISSING",
    fix: "set it",
    source: "acme/check",
    path: "a.ini",
    span: { start_line: 4 },
  });
  expect(summarizeChecks(mapped.checks)).toEqual({ pass: 0, info: 1, warn: 0, error: 1 });
});

test("primary is the first error, else the first diagnostic", () => {
  expect(pickPrimary([])).toBeNull();
  const info = { level: "info", code: "A" };
  const error = { level: "error", code: "B" };
  expect(pickPrimary([info, error])).toBe(error);
  expect(pickPrimary([info, { level: "warn", code: "C" }])).toBe(info);
});

test("fan-out order is builtins, then plugins[], then other refs", () => {
  const make = (namespace: string) =>
    definePlugin({
      namespace,
      version: "1.0.0",
      description: namespace,
      apiVersion: 2,
      handlers: {
        zeta: defineHandler({ capability: "doctor" }, async () => ok()),
        alpha: defineHandler({ capability: "doctor" }, async () => ok()),
      },
    });
  const registry = new PluginRegistry();
  for (const plugin of builtinPlugins) registry.register(plugin);
  registry.register(make("beta"), "path");
  registry.register(make("userland"), "user");
  registry.setConfigOrder(["beta"]);
  const refs = fanOutRefs(
    registry,
    { plugins: [{ namespace: "beta", path: "./beta" }] },
    "doctor",
  ).map((match) => match.ref);
  expect(refs[0]).toBe("ue/doctor_ddc");
  expect(refs.slice(1, 3)).toEqual(["beta/zeta", "beta/alpha"]);
  expect(refs.slice(3)).toEqual(["userland/alpha", "userland/zeta"]);
});

test("why log source is --log, then run id, then the newest failed run", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-why-log-"));
  const logs = path.join(dir, ".bolt", "logs");
  mkdirSync(logs, { recursive: true });
  const older = path.join(logs, "bolt_2020-01-01T00-00-00.log");
  const newer = path.join(logs, "bolt_2021-01-01T00-00-00.log");
  writeFileSync(older, "<< build: FAILED (1.0s)\n");
  writeFileSync(newer, "<< build: SUCCESS (1.0s)\n");
  const explicit = path.join(dir, "explicit.log");
  writeFileSync(explicit, "explicit\n");

  const recent = resolveWhyLog({ configDir: dir });
  expect(recent.ok && recent.log.run_id).toBe("bolt_2020-01-01T00-00-00");

  const byId = resolveWhyLog({ configDir: dir, runId: "2020-01-01T00-00-00" });
  expect(byId.ok && byId.log.path).toBe(older);
  expect(byId.ok && byId.log.kind).toBe("run");

  const flagged = resolveWhyLog({
    configDir: dir,
    cwd: dir,
    logFlag: "explicit.log",
    runId: "2020-01-01T00-00-00",
  });
  expect(flagged.ok && flagged.log.kind).toBe("explicit");
  expect(flagged.ok && flagged.log.path).toBe(explicit);
  expect(flagged.ok && flagged.log.run_id).toBeNull();

  expect(resolveWhyLog({ configDir: dir, runId: "../explicit.log" }).ok).toBe(false);
  expect(resolveWhyLog({ configDir: dir, logFlag: "missing.log", cwd: dir }).ok).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

test("core source has no cook or DDC section strings", () => {
  const terms = [
    "InstalledDerivedDataBackendGraph",
    "DerivedDataBackendGraph",
    "Unknown Cook Failure",
    "LogCook",
    "BuildCookRun",
  ];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "plugins" || entry.name === "tests") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(path.join(REPO, "src"));
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const term of terms) {
      if (text.includes(term)) hits.push(`${path.relative(REPO, file)}: ${term}`);
    }
  }
  expect(hits).toEqual([]);
  const plugin = readFileSync(path.join(REPO, "src/plugins/ue-doctor-ddc.ts"), "utf8");
  expect(plugin).toContain("InstalledDerivedDataBackendGraph");
  expect(plugin).toContain("DerivedDataBackendGraph");
});

test("ddc section check flags the inactive ini section and passes once moved", () => {
  const iniPath = "/proj/Config/DefaultEngine.ini";
  const wrong = "[InstalledDerivedDataBackendGraph]\nRoot=(Type=FileSystem)\n";
  const bad = ddcSectionCheck({ iniPath, iniText: wrong, installed: false });
  expect(bad.level).toBe("error");
  expect(bad.fix && bad.fix.length > 0).toBe(true);
  expect(bad.id).toBe("ue.ddc.installed_vs_source");

  const fixed = wrong.replace("[InstalledDerivedDataBackendGraph]", "[DerivedDataBackendGraph]");
  const good = ddcSectionCheck({ iniPath, iniText: fixed, installed: false });
  expect(good.level).toBe("pass");

  const installedWrong = "[DerivedDataBackendGraph]\nRoot=(Type=FileSystem)\n";
  expect(ddcSectionCheck({ iniPath, iniText: installedWrong, installed: true }).level).toBe(
    "error",
  );
  expect(
    ddcSectionCheck({
      iniPath,
      iniText: installedWrong.replace(
        "[DerivedDataBackendGraph]",
        "[InstalledDerivedDataBackendGraph]",
      ),
      installed: true,
    }).level,
  ).toBe("pass");
});

test("doctor envelope, fan-out, --only, --fix, and status fail", async () => {
  const dir = project(`${YAML_HEAD}capabilities:
  doctor: alpha/check
plugins:
  - namespace: ue
    config:
      engine:
        path: ./engine
      project:
        path: ./game
      uproject: ./game/Demo.uproject
  - namespace: beta
    path: ./beta
  - namespace: alpha
    path: ./alpha
`);
  mkdirSync(path.join(dir, "engine"), { recursive: true });
  mkdirSync(path.join(dir, "game", "Config"), { recursive: true });
  writeFileSync(
    path.join(dir, "game", "Config", "DefaultEngine.ini"),
    "[DerivedDataBackendGraph]\nRoot=(Type=FileSystem, Path=SENTINEL_INI_BODY)\n",
  );
  plugin(
    dir,
    "beta",
    doctorPlugin(
      "beta",
      `async () => ({ status: "ok", data: { checks: [{ id: "beta.one", level: "warn", message: "warm", fix: "look" }] } })`,
    ),
  );
  plugin(
    dir,
    "alpha",
    doctorPlugin(
      "alpha",
      `async () => ({ status: "fail", summary: "bad", data: { checks: [{ id: "alpha.err", level: "error", message: "broken", fix: "repair" }] } })`,
    ),
  );
  try {
    const bodyRun = await bolt(["doctor", "--json"], dir);
    expect(bodyRun.code).toBe(0);
    const body = parseStdout(bodyRun.out);
    expect(Object.keys(body)).toEqual([
      "schema",
      "bolt",
      "ok",
      "config",
      "data",
      "warnings",
      "errors",
    ]);
    expect(body.schema).toBe("bolt.doctor/v1");
    expect(body.bolt).toBe(VERSION);
    expect(body.ok).toBe(true);
    expect(bodyRun.out).not.toContain("SENTINEL_INI_BODY");
    const data = body.data as {
      checks: Array<{ id: string; source: string; level: string }>;
      summary: { pass: number; info: number; warn: number; error: number };
    };
    expect(data.checks.map((check) => check.id)).toEqual([
      "ue.ddc.installed_vs_source",
      "beta.one",
      "alpha.err",
    ]);
    expect(data.checks.map((check) => check.source)).toEqual([
      "ue/doctor_ddc",
      "beta/check",
      "alpha/check",
    ]);
    expect(data.summary).toEqual({ pass: 1, info: 0, warn: 1, error: 1 });
    const warnings = body.warnings as Array<{ code: string; message: string }>;
    expect(warnings.filter((item) => item.code === "CAPABILITY_WARNING")).toHaveLength(1);
    expect(warnings[0]?.message).toContain("doctor");
    expect(warnings[0]?.message).toContain("ignored");
    expect(body.errors).toEqual([]);

    const fixed = await bolt(["doctor", "--fix", "--json"], dir);
    expect(fixed.code).toBe(1);
    const failed = parseStdout(fixed.out);
    expect(failed.ok).toBe(false);
    expect((failed.errors as Array<{ code: string }>)[0]?.code).toBe("DOCTOR_FAILED");

    const warnOnly = await bolt(["doctor", "--fix", "--only=beta.one", "--json"], dir);
    expect(warnOnly.code).toBe(0);
    const warnBody = parseStdout(warnOnly.out);
    expect(warnBody.ok).toBe(true);
    expect(
      (warnBody.data as { summary: { pass: number; info: number; warn: number; error: number } })
        .summary,
    ).toEqual({
      pass: 0,
      info: 0,
      warn: 1,
      error: 0,
    });

    const prefix = await bolt(["doctor", "--only=ue.ddc", "--json"], dir);
    expect(prefix.code).toBe(0);
    const prefixData = parseStdout(prefix.out).data as { checks: Array<{ id: string }> };
    expect(prefixData.checks.map((check) => check.id)).toEqual(["ue.ddc.installed_vs_source"]);

    const empty = await bolt(["doctor", "--fix", "--only=ue.ddcfoo", "--json"], dir);
    expect(empty.code).toBe(0);
    const emptyBody = parseStdout(empty.out);
    expect(emptyBody.ok).toBe(true);
    expect((emptyBody.data as { checks: unknown[] }).checks).toEqual([]);
    expect(
      (emptyBody.warnings as Array<{ code: string }>).some(
        (item) => item.code === "DOCTOR_ONLY_UNKNOWN",
      ),
    ).toBe(true);

    const human = await bolt(["doctor"], dir);
    expect(human.code).toBe(0);
    expect(human.out).toContain("alpha.err");
    expect(human.out).toContain("Fix: repair");
    expect(human.out).not.toContain("SENTINEL_INI_BODY");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("ue/doctor_ddc reports an ini section mismatch, then pass on the fixed fixture", async () => {
  const dir = project(`${YAML_HEAD}plugins:
  - namespace: ue
    config:
      engine:
        path: ./engine
      project:
        path: ./game
      uproject: ./game/Demo.uproject
`);
  mkdirSync(path.join(dir, "game", "Config"), { recursive: true });
  mkdirSync(path.join(dir, "engine"), { recursive: true });
  const ini = path.join(dir, "game", "Config", "DefaultEngine.ini");
  writeFileSync(ini, "[InstalledDerivedDataBackendGraph]\nRoot=(Type=FileSystem)\n");
  try {
    const bad = await bolt(["doctor", "--json", "--only=ue.ddc.installed_vs_source"], dir);
    expect(bad.code).toBe(0);
    const badCheck = (
      parseStdout(bad.out).data as {
        checks: Array<{ level: string; fix?: string; source: string }>;
      }
    ).checks[0];
    expect(badCheck?.level).toBe("error");
    expect(badCheck?.source).toBe("ue/doctor_ddc");
    expect(badCheck?.fix && badCheck.fix.length > 0).toBe(true);

    writeFileSync(ini, "[DerivedDataBackendGraph]\nRoot=(Type=FileSystem)\n");
    const good = await bolt(["doctor", "--json", "--only=ue.ddc.installed_vs_source"], dir);
    expect(good.code).toBe(0);
    const goodCheck = parseStdout(good.out).data as {
      checks: Array<{ level: string }>;
      summary: { pass: number };
    };
    expect(goodCheck.checks[0]?.level).toBe("pass");
    expect(goodCheck.summary.pass).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);

test("diagnostics fallback and a thrown handler", async () => {
  const dir = project(`${YAML_HEAD}plugins:
  - namespace: diag
    path: ./diag
  - namespace: boom
    path: ./boom
`);
  plugin(
    dir,
    "diag",
    doctorPlugin(
      "diag",
      `async () => ({ status: "ok", diagnostics: [{ level: "error", code: "FROM_DIAG", message: "from diag", fix: "use checks" }] })`,
    ),
  );
  plugin(dir, "boom", doctorPlugin("boom", `async () => { throw new Error("handler blew up"); }`));
  try {
    const onlyDiag = project(`${YAML_HEAD}plugins:
  - namespace: diag
    path: ${path.join(dir, "diag")}
`);
    const mapped = await bolt(["doctor", "--json"], onlyDiag);
    expect(mapped.code).toBe(0);
    const checks = (parseStdout(mapped.out).data as { checks: Array<Record<string, unknown>> })
      .checks;
    expect(checks[0]).toMatchObject({
      id: "FROM_DIAG",
      level: "error",
      fix: "use checks",
      source: "diag/check",
    });
    expect(checks.some((check) => check.level === "pass")).toBe(false);

    const thrown = await bolt(["doctor", "--json"], dir);
    expect(thrown.code).toBe(1);
    const body = parseStdout(thrown.out);
    expect(body.ok).toBe(false);
    expect((body.errors as Array<{ code: string }>)[0]?.code).toBe("RUN_FAILED");
    rmSync(onlyDiag, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);

test("why envelope, missing source, no diagnose provider, and --fail", async () => {
  const dir = project(YAML_HEAD);
  const log = path.join(dir, "notes.log");
  writeFileSync(log, "SENTINEL_RAW_LOG\nline two\n");
  try {
    const none = await bolt(["why", "--json"], dir);
    expect(none.code).toBe(1);
    const missing = parseStdout(none.out);
    expect(missing.schema).toBe("bolt.why/v1");
    expect(missing.ok).toBe(false);
    expect((missing.errors as Array<{ code: string }>)[0]?.code).toBe("WHY_NO_SOURCE");
    expect(missing.data).toEqual({
      run_id: null,
      log: null,
      diagnostics: [],
      primary: null,
    });

    const bare = await bolt(["why", "--log", log, "--json"], dir);
    expect(bare.code).toBe(0);
    const body = parseStdout(bare.out);
    expect(body.ok).toBe(true);
    expect(body.bolt).toBe(VERSION);
    expect(bare.out).not.toContain("SENTINEL_RAW_LOG");
    const data = body.data as {
      diagnostics: unknown[];
      primary: null;
      log: { path: string; kind: string };
    };
    expect(data.diagnostics).toEqual([]);
    expect(data.primary).toBeNull();
    expect(data.log).toEqual({ path: log, kind: "explicit" });
    expect(
      (body.warnings as Array<{ code: string }>).some((item) => item.code === "WHY_NO_PROVIDERS"),
    ).toBe(false);

    plugin(
      dir,
      "ue-shadow",
      `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: "ue",
  version: "1.0.0",
  description: "shadow",
  apiVersion: 2,
  handlers: {
    info: defineHandler({ ai: true, description: "info" }, async () => ({ status: "ok" })),
  },
});
`,
    );
    writeFileSync(
      path.join(dir, "bolt.yaml"),
      `${YAML_HEAD}plugins:
  - namespace: ue
    path: ./ue-shadow
`,
    );
    const shadowed = await bolt(["why", "--log", log, "--json"], dir);
    expect(shadowed.code).toBe(0);
    const shadowBody = parseStdout(shadowed.out);
    expect(shadowed.out).not.toContain("SENTINEL_RAW_LOG");
    expect(
      (shadowBody.warnings as Array<{ code: string }>).some(
        (item) => item.code === "WHY_NO_PROVIDERS",
      ),
    ).toBe(true);
    expect((shadowBody.data as { diagnostics: unknown[]; primary: null }).diagnostics).toEqual([]);
    expect((shadowBody.data as { primary: null }).primary).toBeNull();

    plugin(
      dir,
      "alpha",
      diagnosePlugin(
        "alpha",
        `async (params) => ({ status: "ok", diagnostics: [{ level: "info", code: "ALPHA", message: "saw " + params.kind }] })`,
      ),
    );
    plugin(
      dir,
      "beta",
      diagnosePlugin(
        "beta",
        `async () => ({ status: "fail", summary: "bad", diagnostics: [{ level: "error", code: "BETA", message: "root", fix: "do this" }] })`,
      ),
    );
    writeFileSync(
      path.join(dir, "bolt.yaml"),
      `${YAML_HEAD}plugins:
  - namespace: alpha
    path: ./alpha
  - namespace: beta
    path: ./beta
`,
    );
    const explained = await bolt(["why", "--log", log, "--json"], dir);
    expect(explained.code).toBe(0);
    const explainedBody = parseStdout(explained.out);
    expect(explained.out).not.toContain("SENTINEL_RAW_LOG");
    const diagnostics = explainedBody.data as {
      diagnostics: Array<{ code: string; source: string; message: string }>;
      primary: { code: string; fix?: string };
    };
    expect(diagnostics.diagnostics.map((item) => item.code)).toEqual(["ALPHA", "BETA"]);
    expect(diagnostics.diagnostics.map((item) => item.source)).toEqual(["alpha/read", "beta/read"]);
    expect(diagnostics.primary.code).toBe("BETA");
    expect(diagnostics.diagnostics[0]?.message).toContain("explicit");
    expect(explainedBody.ok).toBe(true);

    const failed = await bolt(["why", "--log", log, "--fail", "--json"], dir);
    expect(failed.code).toBe(1);
    const failedBody = parseStdout(failed.out);
    expect(failedBody.ok).toBe(false);
    expect((failedBody.errors as Array<{ code: string; hint?: string }>)[0]?.code).toBe(
      "WHY_FAILED",
    );

    writeFileSync(
      path.join(dir, "bolt.yaml"),
      `${YAML_HEAD}plugins:
  - namespace: alpha
    path: ./alpha
`,
    );
    const warnOnly = await bolt(["why", "--log", log, "--fail", "--json"], dir);
    expect(warnOnly.code).toBe(0);
    expect(parseStdout(warnOnly.out).ok).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

test("missing bolt.yaml is a config error with a null config", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-m3-empty-"));
  try {
    const run = await bolt(["doctor", "--json"], dir);
    expect(run.code).toBe(3);
    const body = parseStdout(run.out);
    expect(body.ok).toBe(false);
    expect(body.config).toBeNull();
    expect(body.schema).toBe("bolt.doctor/v1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
