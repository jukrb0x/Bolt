import { expect, test } from "bun:test";
import { Runner } from "../runner";
import { testCfg } from "./env";
import type { BoltConfig } from "../config";
import { Notifier } from "../notify";
import type { NotifyEvent } from "../notify";

const cfg: BoltConfig = {
  ...testCfg,
  actions: {
    a: { steps: [{ run: "echo a" }] },
    b: { depends: ["a"], steps: [{ run: "echo b" }] },
  },
};

test("runs action steps in order", async () => {
  const ran: string[] = [];
  const runner = new Runner(cfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.run("a");
  expect(ran).toEqual(["echo a"]);
});

test("runs depends before action", async () => {
  const ran: string[] = [];
  const runner = new Runner(cfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.run("b");
  expect(ran).toEqual(["echo a", "echo b"]);
});

test("detects dependency cycles", async () => {
  const cyclic: BoltConfig = {
    ...cfg,
    actions: {
      x: { depends: ["y"], steps: [] },
      y: { depends: ["x"], steps: [] },
    },
  };
  const runner = new Runner(cyclic, { dryRun: true });
  expect(runner.run("x")).rejects.toThrow("cycle");
});

test("throws on unknown action", async () => {
  const runner = new Runner(cfg, { dryRun: true });
  expect(runner.run("nope")).rejects.toThrow("nope");
});

test("runOps throws when timeout_hours is exceeded", async () => {
  const cfgWithTimeout: BoltConfig = {
    ...testCfg,
    ops: { slow: { default: [{ run: "echo slow" }] } },
    "go-pipeline": { order: [], fail_stops: [] },
    timeout_hours: 0.000001, // ~3.6ms — will be exceeded immediately
  };
  // Use onStep to busy-wait so elapsed time exceeds the threshold before op 2
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
  const ops = [
    { name: "slow", steps: [{ run: "echo slow" }], params: {} },
    { name: "slow2", steps: [{ run: "echo slow2" }], params: {} },
  ];
  await expect(runner.runOps(ops, cfgWithTimeout["go-pipeline"])).rejects.toThrow("timed out");
});

test("runOps does not timeout when timeout_hours is undefined", async () => {
  const cfgNoTimeout: BoltConfig = { ...testCfg, timeout_hours: undefined };
  const runner = new Runner(cfgNoTimeout, { dryRun: true });
  const ops = [{ name: "a", steps: [{ run: "echo a" }], params: {} }];
  await expect(runner.runOps(ops, cfgNoTimeout["go-pipeline"])).resolves.toBeUndefined();
});

test("runOps fires start and complete notifications", async () => {
  const events: NotifyEvent[] = [];
  const fakeNotifier = new Notifier([{ send: async (e: NotifyEvent) => { events.push(e); } }]);
  const runner = new Runner(testCfg, { dryRun: true, notifier: fakeNotifier });
  await runner.runOps(
    [{ name: "kill", steps: [{ uses: "ue/kill" }] }],
    { order: [], fail_stops: [] },
  );
  expect(events.some((e) => e.kind === "start")).toBe(true);
  expect(events.some((e) => e.kind === "complete")).toBe(true);
});

test("runOps fires failure notification on step error", async () => {
  const events: NotifyEvent[] = [];
  const fakeNotifier = new Notifier([{ send: async (e: NotifyEvent) => { events.push(e); } }]);
  const runner = new Runner(testCfg, { dryRun: false, notifier: fakeNotifier });
  await runner.runOps(
    [{ name: "bad", steps: [{ run: "exit 1" }] }],
    { order: [], fail_stops: ["bad"] },
  ).catch(() => {});
  expect(events.some((e) => e.kind === "failure" && e.opName === "bad")).toBe(true);
});

// ---------------------------------------------------------------------------
// run() with params — CLI overrides propagate to handlers
// ---------------------------------------------------------------------------

test("run() passes params to plugin handler via step.with merge", async () => {
  const logged: string[] = [];
  const cfgWithAction: BoltConfig = {
    ...testCfg,
    actions: {
      build_editor: {
        steps: [{ uses: "ue/build", with: { target: "editor" } }],
      },
    },
  };
  const { Logger } = await import("../logger");
  const logger = new Logger({ sink: (l) => logged.push(l) });
  const runner = new Runner(cfgWithAction, { dryRun: true, logger });
  await runner.run("build_editor", { config: "debug" });
  const cmd = logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Debug");
  expect(cmd).not.toContain("-Target=\"" + testCfg.project.project_name + "Editor Win64 Development\"");
});

test("run() CLI params win over step with: params", async () => {
  const logged: string[] = [];
  const cfgWithAction: BoltConfig = {
    ...testCfg,
    actions: {
      build_editor: {
        steps: [{ uses: "ue/build", with: { target: "editor", config: "shipping" } }],
      },
    },
  };
  const { Logger } = await import("../logger");
  const logger = new Logger({ sink: (l) => logged.push(l) });
  const runner = new Runner(cfgWithAction, { dryRun: true, logger });
  await runner.run("build_editor", { config: "debug" });
  const cmd = logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Debug");
});

test("run() with no params uses step with: defaults", async () => {
  const logged: string[] = [];
  const cfgWithAction: BoltConfig = {
    ...testCfg,
    actions: {
      build_editor: {
        steps: [{ uses: "ue/build", with: { target: "editor" } }],
      },
    },
  };
  const { Logger } = await import("../logger");
  const logger = new Logger({ sink: (l) => logged.push(l) });
  const runner = new Runner(cfgWithAction, { dryRun: true, logger });
  await runner.run("build_editor");
  const cmd = logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Development");
});

test("run() params propagate through depends chain", async () => {
  const logged: string[] = [];
  const cfgChained: BoltConfig = {
    ...testCfg,
    actions: {
      build_editor: {
        steps: [{ uses: "ue/build", with: { target: "editor" } }],
      },
      full: {
        depends: ["build_editor"],
        steps: [{ uses: "ue/start" }],
      },
    },
  };
  const { Logger } = await import("../logger");
  const logger = new Logger({ sink: (l) => logged.push(l) });
  const runner = new Runner(cfgChained, { dryRun: true, logger });
  await runner.run("full", { config: "debug" });
  const buildCmd = logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(buildCmd).toContain("Debug");
});

test("action step with: config passes through ops/ dispatch to plugin", async () => {
  const logged: string[] = [];
  const cfgOps: BoltConfig = {
    ...testCfg,
    ops: {
      ...testCfg.ops,
      build: { default: [{ uses: "ue/build", with: { target: "editor" } }] },
    },
    actions: {
      build_editor: {
        steps: [{ uses: "ops/build", with: { config: "debug" } }],
      },
    },
  };
  const { Logger } = await import("../logger");
  const logger = new Logger({ sink: (l) => logged.push(l) });
  const runner = new Runner(cfgOps, { dryRun: true, logger });
  await runner.run("build_editor");
  const cmd = logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Debug");
});

test("CLI params win over action step with: config when using ops/ dispatch", async () => {
  const logged: string[] = [];
  const cfgOps: BoltConfig = {
    ...testCfg,
    ops: {
      ...testCfg.ops,
      build: { default: [{ uses: "ue/build", with: { target: "editor" } }] },
    },
    actions: {
      build_editor: {
        steps: [{ uses: "ops/build", with: { config: "shipping" } }],
      },
    },
  };
  const { Logger } = await import("../logger");
  const logger = new Logger({ sink: (l) => logged.push(l) });
  const runner = new Runner(cfgOps, { dryRun: true, logger });
  await runner.run("build_editor", { config: "debug" });
  const cmd = logged.find((l) => l.includes("Build.bat")) ?? "";
  expect(cmd).toContain("Debug");
});
