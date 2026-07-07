import { expect, test, describe } from "bun:test";
import { Runner } from "../runner";
import { testCfg } from "./env";
import type { BoltConfig } from "../config";
import { parseRunArgs, dispatchRun } from "../commands/run";

// A v2 config with a couple of tasks + a flow for resolution tests.
const cfg: BoltConfig = {
  ...testCfg,
  tasks: {
    a: [{ run: "echo a" }],
    b: [{ run: "echo b" }],
    greet: [{ run: "echo ${{ params.msg }}" }],
  },
  flows: {
    daily: { steps: ["a", "b"], continue_on_fail: [] },
  },
};

// ---------------------------------------------------------------------------
// parseRunArgs
// ---------------------------------------------------------------------------

describe("parseRunArgs", () => {
  test("collects positional names in typed order", () => {
    const parsed = parseRunArgs(["build", "start"]);
    expect(parsed.names).toEqual(["build", "start"]);
    expect(parsed.params).toEqual({});
    expect(parsed.dryRun).toBe(false);
  });

  test("collects --k=v params and --dry-run", () => {
    const parsed = parseRunArgs(["build", "--target=program", "--dry-run"]);
    expect(parsed.names).toEqual(["build"]);
    expect(parsed.params).toEqual({ target: "program" });
    expect(parsed.dryRun).toBe(true);
  });

  test("expands config shorthand (dev/dbg)", () => {
    expect(parseRunArgs(["build", "--config=dev"]).params).toEqual({ config: "development" });
    expect(parseRunArgs(["build", "--config=dbg"]).params).toEqual({ config: "debug" });
    expect(parseRunArgs(["build", "--config=shipping"]).params).toEqual({ config: "shipping" });
  });
});

// ---------------------------------------------------------------------------
// dispatchRun — resolution + execution
// ---------------------------------------------------------------------------

test("(a) multiple tasks run in typed order", async () => {
  const ran: string[] = [];
  const runner = new Runner(cfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await dispatchRun(runner, cfg, ["b", "a"], {});
  expect(ran).toEqual(["echo b", "echo a"]);
});

test("(b) a single flow name runs the flow", async () => {
  const ran: string[] = [];
  const runner = new Runner(cfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await dispatchRun(runner, cfg, ["daily"], {});
  expect(ran).toEqual(["echo a", "echo b"]);
});

test("(c) params from --k=v reach the task", async () => {
  const ran: string[] = [];
  const { names, params } = parseRunArgs(["greet", "--msg=hello"]);
  const runner = new Runner(cfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await dispatchRun(runner, cfg, names, params);
  expect(ran).toEqual(["echo hello"]);
});

test("(d) an unknown name errors and lists available tasks/flows", async () => {
  const runner = new Runner(cfg, { dryRun: true });
  await expect(dispatchRun(runner, cfg, ["nope"], {})).rejects.toThrow('Unknown task or flow: "nope"');
});

test("a multi-name list containing a flow name errors (flow only runs solo)", async () => {
  const runner = new Runner(cfg, { dryRun: true });
  // "daily" is a flow, not a task, so it is invalid inside a multi-task list.
  await expect(dispatchRun(runner, cfg, ["a", "daily"], {})).rejects.toThrow(
    'Unknown task or flow: "daily"',
  );
});

test("empty name list errors", async () => {
  const runner = new Runner(cfg, { dryRun: true });
  await expect(dispatchRun(runner, cfg, [], {})).rejects.toThrow("No task or flow specified");
});
