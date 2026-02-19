import { expect, test } from "bun:test";
import { Runner } from "../runner";
import { testCfg } from "./env";
import type { BoltConfig } from "../config";

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
