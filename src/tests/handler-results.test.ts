import "../virtual-module";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { Runner, type StepResult } from "../runner";
import { PluginRegistry } from "../plugin-registry";
import { Logger } from "../logger";
import {
  PluginBase,
  createTestContext,
  defineHandler,
  definePlugin,
  fail,
  handler,
  ok,
  warn,
  type BoltPlugin,
  type BoltPluginContext,
} from "../plugin";
import type { StampedEvent } from "../handler-result";
import { testCfg } from "./env";
import type { BoltConfig } from "../config";

const tmp = mkdtempSync(path.join(os.tmpdir(), "bolt-results-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Harness {
  lines: string[];
  logFile: string;
  results: StepResult[];
  events: StampedEvent[];
  run: (task?: string) => Promise<void>;
  runFlow: (flow: string) => Promise<void>;
}

let counter = 0;
function harness(plugins: BoltPlugin[], tasks?: BoltConfig["tasks"], flows = {}): Harness {
  const lines: string[] = [];
  const logFile = path.join(tmp, `run-${++counter}.log`);
  const logger = new Logger({ sink: (l) => lines.push(l), logFile });
  const results: StepResult[] = [];
  const events: StampedEvent[] = [];
  const cfg: BoltConfig = {
    ...testCfg,
    tasks: tasks ?? { t: [{ uses: `${plugins[0].namespace}/run` }] },
    flows,
  };
  const runner = new Runner(cfg, {
    logger,
    onStepResult: (r) => results.push(r),
    onEvent: (e) => events.push(e),
  });
  const reg = new PluginRegistry();
  for (const plugin of plugins) reg.register(plugin);
  (runner as unknown as { registry: PluginRegistry }).registry = reg;
  const finish = async (p: Promise<void>) => {
    try {
      await p;
    } finally {
      logger.close();
      await Bun.sleep(5);
    }
  };
  return {
    lines,
    logFile,
    results,
    events,
    run: (task = "t") => finish(runner.runTask(task)),
    runFlow: (flow) => finish(runner.runFlow(flow)),
  };
}

function v1(fn: (ctx: BoltPluginContext) => Promise<unknown>, namespace = "legacy") {
  return definePlugin({
    namespace,
    version: "1.0.0",
    description: "v1",
    handlers: { run: defineHandler({}, async (_p, ctx) => fn(ctx) as Promise<void>) },
  });
}

function v2(fn: (ctx: BoltPluginContext) => Promise<unknown>, namespace = "modern") {
  return definePlugin({
    namespace,
    version: "1.0.0",
    description: "v2",
    apiVersion: 2,
    handlers: { run: defineHandler({}, async (_p, ctx) => fn(ctx) as Promise<void>) },
  });
}

// --- plugin API v1: return values are ignored -------------------------------

test("v1 plugin returns {status: 'fail'} → step still succeeds", async () => {
  const h = harness([v1(async () => ({ status: "fail", data: { from: "api" } }))]);
  await h.run();
  expect(h.results).toEqual([]);
  expect(h.lines.some((l) => l.includes("SUCCESS"))).toBe(true);
});

test("v1 returns {status: 'success', summary} → succeeds, debug note only in the log file", async () => {
  const h = harness([v1(async () => ({ status: "success", summary: "done" }))]);
  await h.run();
  expect(h.lines.some((l) => l.includes("returned a value"))).toBe(false);
  expect(readFileSync(h.logFile, "utf8")).toContain(
    "legacy/run (plugin API v1) returned a value; ignored. Declare apiVersion: 2 to report results.",
  );
});

test("v1 class plugin and unbranded object plugin returning fail still succeed", async () => {
  class Legacy extends PluginBase {
    namespace = "cls";
    @handler()
    async run() {
      return { status: "fail" } as never;
    }
  }
  const objectPlugin: BoltPlugin = {
    namespace: "obj",
    handlers: { run: async () => ({ status: "fail" }) as never },
  };
  const h = harness([new Legacy(), objectPlugin], {
    t: [{ uses: "cls/run" }, { uses: "obj/run" }],
  });
  await h.run();
  expect(h.results).toEqual([]);
});

test("an unchanged v1 plugin file loads and runs exactly as before", async () => {
  const dir = path.join(tmp, "old-plugin");
  require("fs").mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "index.ts");
  writeFileSync(
    file,
    `import { definePlugin, defineHandler } from "boltstack";
export default definePlugin({
  namespace: "old",
  version: "0.1.0",
  description: "written for plugin API v1",
  handlers: {
    run: defineHandler({ ai: true }, async (_p, ctx) => {
      ctx.logger.info("old plugin ran");
      return { status: "fail" } as any;
    }),
  },
});
`,
  );
  const reg = new PluginRegistry();
  await reg.loadFromPath("old", file, dir);
  const plugin = reg.get("old")!;
  expect(plugin.apiVersion).toBe(1);
  expect(plugin.manifest?.handlers.run).toEqual({ ai: true });
  const h = harness([plugin]);
  await h.run();
  expect(h.lines.some((l) => l.includes("old plugin ran"))).toBe(true);
  expect(h.lines.some((l) => l.includes("SUCCESS"))).toBe(true);
});

// --- plugin API v2 -----------------------------------------------------------

test("v2 undefined return → ok", async () => {
  const h = harness([v2(async () => undefined)]);
  await h.run();
  expect(h.results).toEqual([{ status: "ok", ref: "modern/run", step: "t > modern/run" }]);
});

test("v2 returns {status: 'success'} → RESULT_INVALID with field path and fix", async () => {
  const h = harness([v2(async () => ({ status: "success" }))]);
  const err = await h.run().catch((e) => e);
  expect(err.code).toBe("RESULT_INVALID");
  expect(err.message).toContain(
    'modern/run returned an invalid HandlerResult: status "success" — expected "ok" | "warn" | "fail" | "skipped"',
  );
  expect(err.message).toContain("Fix: return ok()/warn()/fail()/skipped()");
});

test("v2 wrong type on a known field or non-JSON data → RESULT_INVALID", async () => {
  for (const [value, needle] of [
    [{ status: "ok", summary: 42 }, "summary must be a string"],
    [{ status: "ok", data: { when: new Date() } }, "data.when is not JSON-serialisable"],
    [{ status: "ok", diagnostics: [{ level: "fatal", message: "x" }] }, "diagnostics[0].level"],
    ["done", "must be undefined or a plain object"],
  ] as const) {
    const err = await harness([v2(async () => value)])
      .run()
      .catch((e) => e);
    expect(err.code).toBe("RESULT_INVALID");
    expect(err.message).toContain(needle);
  }
});

test("v2 unknown top-level and nested keys warn and are dropped; the step succeeds", async () => {
  const h = harness([
    v2(async () => ({
      status: "ok",
      future: 1,
      diagnostics: [{ level: "info", message: "m", severity: 3 }],
    })),
  ]);
  await h.run();
  expect(h.results[0]).toEqual({
    status: "ok",
    diagnostics: [{ level: "info", message: "m" }],
    ref: "modern/run",
    step: "t > modern/run",
  });
  expect(
    h.lines.some((l) =>
      l.includes('RESULT_UNKNOWN_KEY: modern/run returned unknown field "future"'),
    ),
  ).toBe(true);
  expect(h.lines.some((l) => l.includes('"diagnostics[0].severity"'))).toBe(true);
});

test("v2 oversize values are truncated with a warning, never failed", async () => {
  const h = harness([v2(async () => ok("x".repeat(300), { data: { log: "y".repeat(9000) } }))]);
  await h.run();
  expect(h.results[0].summary).toHaveLength(200);
  expect((h.results[0].data as { log: string }).log).toHaveLength(8192);
  expect(h.lines.some((l) => l.includes("RESULT_TRUNCATED: data.log truncated"))).toBe(true);
});

test("v2 diagnostics and summaries render; backslashes in file are normalised", async () => {
  const h = harness([
    v2(async () =>
      warn("Shared DDC unreachable", {
        diagnostics: [
          {
            level: "warn",
            code: "DDC_SHARED_MISSING",
            message: "no share",
            file: "Config\\DefaultEngine.ini",
            line: 3,
            fix: "Set the shared path",
          },
        ],
      }),
    ),
  ]);
  await h.run();
  expect(h.results[0].diagnostics?.[0].file).toBe("Config/DefaultEngine.ini");
  expect(h.lines.some((l) => l.includes("[WARN] modern/run: Shared DDC unreachable"))).toBe(true);
  expect(
    h.lines.some((l) =>
      l.includes(
        "DDC_SHARED_MISSING: no share (Config/DefaultEngine.ini:3) Fix: Set the shared path",
      ),
    ),
  ).toBe(true);
});

test("v2 fail → onAfterStep runs before HANDLER_FAILED", async () => {
  const order: string[] = [];
  class Failing extends PluginBase {
    namespace = "failing";
    override apiVersion = 2;
    async onAfterStep() {
      order.push("after");
    }
    @handler()
    async run() {
      order.push("handler");
      return fail("disk full");
    }
  }
  const h = harness([new Failing()]);
  const err = await h.run().catch((e) => {
    order.push("thrown");
    return e;
  });
  expect(order).toEqual(["handler", "after", "thrown"]);
  expect(err.code).toBe("HANDLER_FAILED");
  expect(err.message).toBe('failing/run returned status "fail": disk full');
});

test("v2 fail without summary gets a default message", async () => {
  const err = await harness([v2(async () => ({ status: "fail" }))])
    .run()
    .catch((e) => e);
  expect(err.message).toBe('modern/run returned status "fail" without summary');
});

test("v2 fail follows continue_on_fail like a throw", async () => {
  const h = harness(
    [v2(async () => fail("nope"))],
    { bad: [{ uses: "modern/run" }], good: [{ run: "true" }] },
    { f: { steps: ["bad", "good"], continue_on_fail: ["bad"] } },
  );
  await h.runFlow("f");
  expect(h.lines.some((l) => l.includes("bad: ") && l.includes("FAILED"))).toBe(true);
  expect(h.lines.some((l) => l.includes("continue_on_fail"))).toBe(true);
});

// --- events -------------------------------------------------------------------

test("events from v1 and v2 handlers and hooks are stamped with seq, ref, and step", async () => {
  class Hooked extends PluginBase {
    namespace = "hooked";
    async onBeforeStep(_h: string, _p: Record<string, string>, ctx: BoltPluginContext) {
      ctx.emit?.({ type: "log", message: "before" });
    }
    @handler()
    async run(_p: Record<string, string>, ctx: BoltPluginContext) {
      ctx.emit?.({ type: "progress", message: "half", progress: { current: 1, total: 2 } });
    }
  }
  const h = harness([new Hooked(), v2(async (ctx) => ctx.emit?.({ type: "log", message: "v2" }))], {
    t: [{ uses: "hooked/run" }, { uses: "modern/run" }],
  });
  await h.run();
  expect(h.events).toEqual([
    { type: "log", message: "before", seq: 1, ref: "hooked/run", step: "t > hooked/run" },
    {
      type: "progress",
      message: "half",
      progress: { current: 1, total: 2 },
      seq: 2,
      ref: "hooked/run",
      step: "t > hooked/run",
    },
    { type: "log", message: "v2", seq: 3, ref: "modern/run", step: "t > modern/run" },
  ]);
  expect(h.lines.some((l) => l.includes("hooked/run progress 1/2: half"))).toBe(true);
  expect(readFileSync(h.logFile, "utf8")).toContain("hooked/run progress 1/2: half");
});

test("emit after the handler settles is dropped with one EMIT_AFTER_SETTLE warning", async () => {
  let late: BoltPluginContext | undefined;
  const h = harness([
    v1(async (ctx) => {
      late = ctx;
    }),
  ]);
  await h.run();
  late!.emit!({ type: "progress" });
  late!.emit!({ type: "progress" });
  const warnings = h.lines.filter((l) => l.includes("EMIT_AFTER_SETTLE"));
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("forgot to await?");
  expect(h.events).toEqual([]);
});

test("invalid events never throw, are dropped, and warn once per type", async () => {
  const h = harness([
    v1(async (ctx) => {
      ctx.emit!({ type: "Bad Type" });
      ctx.emit!({ type: "Bad Type" });
      ctx.emit!(null as never);
    }),
  ]);
  await h.run();
  const warnings = h.lines.filter((l) => l.includes("EVENT_INVALID"));
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toContain("Example: ctx.emit?.(");
  expect(h.events).toEqual([]);
});

test("createTestContext records events and keeps emit callable", async () => {
  const ctx = createTestContext({ dryRun: true });
  const plugin = v2(async (c) => {
    c.emit?.({ type: "progress", progress: { current: 1 } });
    return ok("fine");
  });
  const result = await plugin.handlers.run({}, ctx);
  expect(result).toEqual({ status: "ok", summary: "fine" });
  expect(ctx.events).toEqual([{ type: "progress", progress: { current: 1 } }]);
  expect(ctx.dryRun).toBe(true);
});
