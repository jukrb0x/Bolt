import { expect, test } from "bun:test";
import { Runner } from "../runner";
import { testCfg } from "./env";
import type { BoltConfig } from "../config";
import { Notifier } from "../notify";
import type { NotifyEvent } from "../notify";

// ---------------------------------------------------------------------------
// runTask — steps run in order
// ---------------------------------------------------------------------------

const cfg: BoltConfig = {
  ...testCfg,
  tasks: {
    a: [{ run: "echo a" }],
    ab: [{ run: "echo a" }, { run: "echo b" }],
  },
};

test("runTask runs steps in order", async () => {
  const ran: string[] = [];
  const runner = new Runner(cfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.runTask("ab");
  expect(ran).toEqual(["echo a", "echo b"]);
});

test("run() is an alias for runTask", async () => {
  const ran: string[] = [];
  const runner = new Runner(cfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.run("a");
  expect(ran).toEqual(["echo a"]);
});

test("runTask throws on unknown task", async () => {
  const runner = new Runner(cfg, { dryRun: true });
  expect(runner.runTask("nope")).rejects.toThrow("Unknown task: nope");
});

// ---------------------------------------------------------------------------
// task/ composition + cycle detection
// ---------------------------------------------------------------------------

test("task/ composition runs the composed task's steps in order", async () => {
  const ran: string[] = [];
  const composed: BoltConfig = {
    ...testCfg,
    tasks: {
      inner: [{ run: "echo inner1" }, { run: "echo inner2" }],
      outer: [{ run: "echo before" }, { uses: "task/inner" }, { run: "echo after" }],
    },
  };
  const runner = new Runner(composed, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.runTask("outer");
  // onStep also fires with the `uses` string for the composition step itself.
  expect(ran).toEqual(["echo before", "task/inner", "echo inner1", "echo inner2", "echo after"]);
});

test("task/ composition throws on unknown composed task", async () => {
  const composed: BoltConfig = {
    ...testCfg,
    tasks: { outer: [{ uses: "task/missing" }] },
  };
  const runner = new Runner(composed, { dryRun: true });
  expect(runner.runTask("outer")).rejects.toThrow("Unknown task: missing");
});

test("detects direct dependency cycles", async () => {
  const cyclic: BoltConfig = {
    ...testCfg,
    tasks: { x: [{ uses: "task/x" }] },
  };
  const runner = new Runner(cyclic, { dryRun: true });
  expect(runner.runTask("x")).rejects.toThrow("Dependency cycle detected at: x");
});

test("detects indirect dependency cycles", async () => {
  const cyclic: BoltConfig = {
    ...testCfg,
    tasks: {
      x: [{ uses: "task/y" }],
      y: [{ uses: "task/x" }],
    },
  };
  const runner = new Runner(cyclic, { dryRun: true });
  expect(runner.runTask("x")).rejects.toThrow("Dependency cycle detected");
});

// ---------------------------------------------------------------------------
// params — applied to steps + available as ${{ params.x }}
// ---------------------------------------------------------------------------

test("params are exposed as ${{ params.x }} in run steps", async () => {
  const ran: string[] = [];
  const paramCfg: BoltConfig = {
    ...testCfg,
    tasks: { greet: [{ run: "echo ${{ params.msg }}" }] },
  };
  const runner = new Runner(paramCfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.runTask("greet", { msg: "hello" });
  expect(ran).toEqual(["echo hello"]);
});

test("params flow through task/ composition and win over with:", async () => {
  const ran: string[] = [];
  const paramCfg: BoltConfig = {
    ...testCfg,
    tasks: {
      inner: [{ run: "echo ${{ params.x }}" }],
      outer: [{ uses: "task/inner", with: { x: "fromWith" } }],
    },
  };
  const echoes = () => ran.filter((s) => s.startsWith("echo"));

  // No params: step.with default is used.
  let runner = new Runner(paramCfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.runTask("outer");
  expect(echoes()).toEqual(["echo fromWith"]);

  // CLI params override step.with.
  ran.length = 0;
  runner = new Runner(paramCfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.runTask("outer", { x: "fromParams" });
  expect(echoes()).toEqual(["echo fromParams"]);
});

test("params are applied to plugin handler via step.with merge", async () => {
  const logged: string[] = [];
  const buildCfg: BoltConfig = {
    ...testCfg,
    tasks: { build: [{ uses: "ue/build", with: { target: "editor" } }] },
  };
  const { Logger } = await import("../logger");
  const logger = new Logger({ sink: (l) => logged.push(l) });
  const runner = new Runner(buildCfg, { dryRun: true, logger });
  await runner.runTask("build", { config: "debug" });
  const cmd = logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Debug");
});

test("CLI params win over step with: for plugin handlers", async () => {
  const logged: string[] = [];
  const buildCfg: BoltConfig = {
    ...testCfg,
    tasks: { build: [{ uses: "ue/build", with: { target: "editor", config: "shipping" } }] },
  };
  const { Logger } = await import("../logger");
  const logger = new Logger({ sink: (l) => logged.push(l) });
  const runner = new Runner(buildCfg, { dryRun: true, logger });
  await runner.runTask("build", { config: "debug" });
  const cmd = logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Debug");
});

test("no params falls back to step with: defaults", async () => {
  const logged: string[] = [];
  const buildCfg: BoltConfig = {
    ...testCfg,
    tasks: { build: [{ uses: "ue/build", with: { target: "editor" } }] },
  };
  const { Logger } = await import("../logger");
  const logger = new Logger({ sink: (l) => logged.push(l) });
  const runner = new Runner(buildCfg, { dryRun: true, logger });
  await runner.runTask("build");
  const cmd = logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Development");
});

// ---------------------------------------------------------------------------
// runFlow — order + continue_on_fail policy (fail-fast by default)
// ---------------------------------------------------------------------------

const flowCfg: BoltConfig = {
  ...testCfg,
  tasks: {
    ok1: [{ run: "echo ok1" }],
    ok2: [{ run: "echo ok2" }],
    boom: [{ uses: "task/__missing__" }], // throws "Unknown task: __missing__"
  },
  flows: {
    happy: { steps: ["ok1", "ok2"], continue_on_fail: [] },
    stops: { steps: ["ok1", "boom", "ok2"], continue_on_fail: [] }, // default fail-fast
    continues: { steps: ["ok1", "boom", "ok2"], continue_on_fail: ["boom"] },
  },
};

test("runFlow runs tasks in listed order", async () => {
  const ran: string[] = [];
  const runner = new Runner(flowCfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.runFlow("happy");
  expect(ran).toEqual(["echo ok1", "echo ok2"]);
});

test("runFlow throws on unknown flow", async () => {
  const runner = new Runner(flowCfg, { dryRun: true });
  expect(runner.runFlow("nope")).rejects.toThrow("Unknown flow: nope");
});

test("runFlow aborts by default (fail-fast) when a task fails", async () => {
  const ran: string[] = [];
  const runner = new Runner(flowCfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await expect(runner.runFlow("stops")).rejects.toThrow("Unknown task: __missing__");
  // ok1 ran, boom was attempted, ok2 never ran.
  expect(ran).toContain("echo ok1");
  expect(ran).not.toContain("echo ok2");
});

test("runFlow continues when a failing task is in continue_on_fail", async () => {
  const ran: string[] = [];
  const runner = new Runner(flowCfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.runFlow("continues");
  // boom failed but flow continued to ok2.
  expect(ran).toContain("echo ok1");
  expect(ran).toContain("echo ok2");
});

// ---------------------------------------------------------------------------
// runFlow — timeout_hours guard
// ---------------------------------------------------------------------------

test("runFlow throws when timeout_hours is exceeded", async () => {
  const cfgWithTimeout: BoltConfig = {
    ...testCfg,
    tasks: {
      slow: [{ run: "echo slow" }],
      slow2: [{ run: "echo slow2" }],
    },
    flows: { drag: { steps: ["slow", "slow2"], continue_on_fail: [] } },
    timeout_hours: 0.000001, // ~3.6ms — exceeded after a short spin
  };
  let firstStep = true;
  const runner = new Runner(cfgWithTimeout, {
    dryRun: true,
    onStep: () => {
      if (firstStep) {
        firstStep = false;
        const end = Date.now() + 10; // spin for 10ms
        while (Date.now() < end) {
          /* busy-wait */
        }
      }
    },
  });
  await expect(runner.runFlow("drag")).rejects.toThrow("timed out");
});

test("runFlow does not timeout when timeout_hours is undefined", async () => {
  const cfgNoTimeout: BoltConfig = {
    ...testCfg,
    tasks: { a: [{ run: "echo a" }] },
    flows: { one: { steps: ["a"], continue_on_fail: [] } },
    timeout_hours: undefined,
  };
  const runner = new Runner(cfgNoTimeout, { dryRun: true });
  await expect(runner.runFlow("one")).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function fakeNotifier(events: NotifyEvent[]): Notifier {
  return new Notifier(
    [{ send: async (e: NotifyEvent) => void events.push(e) }],
    { on_start: true, on_op_complete: true, on_failure: true, on_complete: true },
  );
}

test("runTask fires start and complete notifications", async () => {
  const events: NotifyEvent[] = [];
  const runner = new Runner(cfg, { dryRun: true, notifier: fakeNotifier(events) });
  await runner.runTask("a");
  expect(events.some((e) => e.kind === "start")).toBe(true);
  expect(events.some((e) => e.kind === "complete")).toBe(true);
});

test("runFlow fires start and complete notifications", async () => {
  const events: NotifyEvent[] = [];
  const runner = new Runner(flowCfg, { dryRun: true, notifier: fakeNotifier(events) });
  await runner.runFlow("happy");
  expect(events.some((e) => e.kind === "start")).toBe(true);
  expect(events.some((e) => e.kind === "complete")).toBe(true);
});

test("runFlow fires op_failure notification on task error", async () => {
  const events: NotifyEvent[] = [];
  const runner = new Runner(flowCfg, { dryRun: true, notifier: fakeNotifier(events) });
  await runner.runFlow("stops").catch(() => {});
  expect(events.some((e) => e.kind === "op_failure" && e.opName === "boom")).toBe(true);
});
