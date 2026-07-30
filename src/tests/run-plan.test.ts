import { expect, test } from "bun:test";
import type { BoltConfig } from "../config";
import { resolveRunPlan } from "../run-plan";
import { testCfg } from "./env";

const cfg: BoltConfig = {
  ...testCfg,
  tasks: {
    update: [{ uses: "ue/update_engine" }, { uses: "ue/update_project" }],
    build: [{ uses: "ue/build", with: { target: "editor", config: "development" } }],
    build_editor: [{ call: "build", with: { config: "debuggame" } }],
  },
  flows: { daily: { steps: ["update", "build_editor"], continue_on_fail: [] } },
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

test("returns structured errors without a partial plan", () => {
  const result = resolveRunPlan(cfg, { kind: "tasks", names: ["missing"], params: {} });
  expect(result).toEqual({
    ok: false,
    errors: [{ path: "tasks[0]", message: 'Unknown task: "missing"' }],
  });
});
