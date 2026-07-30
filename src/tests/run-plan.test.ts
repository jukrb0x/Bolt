import { expect, test } from "bun:test";
import type { BoltConfig } from "../config";
import { formatPlanErrors, resolveRunPlan } from "../run-plan";
import { testCfg } from "./env";

const cfg: BoltConfig = {
  ...testCfg,
  tasks: {
    update: [{ uses: "ue/update_engine" }, { uses: "ue/update_project" }],
    build: [{ uses: "ue/build", with: { target: "editor", config: "development" } }],
    build_editor: [{ call: "build", with: { config: "debuggame" } }],
  },
  flows: { daily: { steps: ["update", "build_editor"], continue_on_fail: ["build_editor"] } },
};

test("resolves A+B task hierarchy in typed order", () => {
  const result = resolveRunPlan(cfg, {
    kind: "tasks",
    names: ["update", "build_editor"],
    params: { config: "debuggame" },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.plan.tasks.map((task) => task.name)).toEqual(["update", "build_editor"]);
  expect(result.plan.tasks[0].nodes.map((node) => node.kind === "uses" && node.ref)).toEqual([
    "ue/update_engine",
    "ue/update_project",
  ]);
  expect(result.plan.tasks[1].nodes[0]).toMatchObject({ kind: "call", name: "build" });
});

test("resolves effective params through a call", () => {
  const result = resolveRunPlan(cfg, {
    kind: "tasks",
    names: ["build_editor"],
    params: { config: "shipping" },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const call = result.plan.tasks[0].nodes[0];
  expect(call.kind).toBe("call");
  if (call.kind !== "call") return;
  expect(call.nodes[0]).toMatchObject({
    kind: "uses",
    ref: "ue/build",
    params: { target: "editor", config: "shipping" },
  });
});

test("materializes flow continuation policy in planned tasks", () => {
  const result = resolveRunPlan(cfg, { kind: "flow", name: "daily", params: {} });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(
    result.plan.tasks.map(({ name, continueOnFailure }) => ({ name, continueOnFailure })),
  ).toEqual([
    { name: "update", continueOnFailure: false },
    { name: "build_editor", continueOnFailure: true },
  ]);
});

test("keeps ad-hoc task plans fail-fast", () => {
  const result = resolveRunPlan(cfg, {
    kind: "tasks",
    names: ["build_editor"],
    params: {},
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.plan.tasks[0].continueOnFailure).toBe(false);
});

test("returns structured errors without a partial plan", () => {
  const result = resolveRunPlan(cfg, { kind: "tasks", names: ["missing"], params: {} });
  expect(result).toEqual({
    ok: false,
    errors: [{ path: "tasks[0]", message: 'Unknown task: "missing"' }],
  });
});

test("resolves interpolated run nodes with failure policy", () => {
  const runCfg: BoltConfig = {
    ...cfg,
    tasks: {
      script: [{ run: "echo ${{ params.message }}", "continue-on-error": true }],
    },
  };
  const result = resolveRunPlan(runCfg, {
    kind: "tasks",
    names: ["script"],
    params: { message: "hello" },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.plan.tasks[0].nodes).toEqual([
    { kind: "run", command: "echo hello", continueOnError: true },
  ]);
});

test("returns a structured unknown-flow error", () => {
  expect(resolveRunPlan(cfg, { kind: "flow", name: "missing", params: {} })).toEqual({
    ok: false,
    errors: [{ path: "flow", message: 'Unknown flow: "missing"' }],
  });
});

test("returns a structured call-cycle error with the complete path", () => {
  const cycleCfg: BoltConfig = {
    ...cfg,
    tasks: {
      first: [{ call: "second" }],
      second: [{ call: "first" }],
    },
  };

  expect(resolveRunPlan(cycleCfg, { kind: "tasks", names: ["first"], params: {} })).toEqual({
    ok: false,
    errors: [
      {
        path: "tasks[0].steps[0].call.steps[0].call",
        message: "Task call cycle: first -> second -> first",
      },
    ],
  });
});

test("formats structured plan errors", () => {
  expect(
    formatPlanErrors([
      { path: "tasks[0]", message: "first" },
      { path: "tasks[1]", message: "second" },
    ]),
  ).toBe("tasks[0]: first\ntasks[1]: second");
});
