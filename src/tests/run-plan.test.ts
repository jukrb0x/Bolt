import { expect, test } from "bun:test";
import { generateAiContext } from "../ai-context";
import type { BoltConfig } from "../config";
import { formatPlanNodes } from "../inspect-utils";
import { PluginRegistry } from "../plugin-registry";
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

test("formats nested call ownership for inspect", () => {
  const result = resolveRunPlan(cfg, {
    kind: "tasks",
    names: ["build_editor"],
    params: { config: "debuggame" },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const lines = formatPlanNodes(result.plan.tasks[0].nodes);
  expect(lines).toEqual(["call: build", "  uses: ue/build  target=editor  config=debuggame"]);
});

test("AI context recursively describes explicit task calls", () => {
  const context = generateAiContext(cfg, import.meta.path, new PluginRegistry());

  expect(context).toContain("| build_editor | `bolt run build_editor` | ue/build |");
  expect(context).toContain("`uses`: plugin/local action");
  expect(context).toContain("`call`: reusable task");
  expect(context).toContain("`run`: shell command");
  expect(context).toContain("`--config=debuggame` (aliases: `dbggame`, `DebugGame`)");
  expect(context).toContain(
    "Start notifications show the top-level task list and recursively owned actions once per invocation.",
  );
});

test("AI task descriptions use resolved effective params through calls", () => {
  const paramCfg: BoltConfig = {
    ...cfg,
    tasks: {
      leaf: [
        {
          uses: "fake/show",
          with: { target: "editor", config: "development" },
        },
      ],
      wrapper: [
        {
          call: "leaf",
          with: { config: "${{ params.requested }}" },
        },
      ],
    },
  };
  const registry = new PluginRegistry();
  registry.register({
    namespace: "fake",
    handlers: { show: async () => {} },
    describe: (_handler, params) => `${params.target}:${params.config}`,
  });

  const callContext = generateAiContext(paramCfg, import.meta.path, registry, {
    requested: "debuggame",
  });
  expect(callContext).toContain("| wrapper | `bolt run wrapper` | editor:debuggame |");

  const invocationContext = generateAiContext(paramCfg, import.meta.path, registry, {
    requested: "debuggame",
    config: "shipping",
  });
  expect(invocationContext).toContain("| wrapper | `bolt run wrapper` | editor:shipping |");
});

test("AI context protects against malformed in-memory call cycles", () => {
  const cycleCfg: BoltConfig = {
    ...cfg,
    tasks: {
      first: [{ call: "second" }],
      second: [{ call: "first" }],
    },
  };

  const context = generateAiContext(cycleCfg, import.meta.path, new PluginRegistry());
  expect(context).toContain("call:first (cycle)");
});
