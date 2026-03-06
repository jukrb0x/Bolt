import { expect, test, describe } from "bun:test";
import { parseGoArgs, resolveOps, sortByPipeline } from "../go";
import { testCfg } from "./env";

// ---------------------------------------------------------------------------
// parseGoArgs
// ---------------------------------------------------------------------------

describe("parseGoArgs", () => {
  test("word style: bare word default variant", () => {
    const [result] = parseGoArgs(["update"]);
    expect(result).toEqual({ name: "update", value: "default", isExact: false, params: {} });
  });

  test("word style: name:value isExact", () => {
    const [result] = parseGoArgs(["update:svn"]);
    expect(result).toEqual({ name: "update", value: "svn", isExact: true, params: {} });
  });

  test("word style: build:client isExact target override", () => {
    const [result] = parseGoArgs(["build:client"]);
    expect(result).toEqual({ name: "build", value: "client", isExact: true, params: {} });
  });

});

// ---------------------------------------------------------------------------
// resolveOps
// ---------------------------------------------------------------------------

describe("resolveOps", () => {
  test("update 2 steps (update-engine + update-project)", () => {
    const parsed = parseGoArgs(["update"]);
    const [op] = resolveOps(parsed, testCfg);
    expect(op.name).toBe("update");
    expect(op.steps).toHaveLength(2);
    expect(op.steps[0].uses).toBe("ue/update-engine");
    expect(op.steps[1].uses).toBe("ue/update-project");
  });

  test("update:project 1 step using project variant", () => {
    const parsed = parseGoArgs(["update:project"]);
    const [op] = resolveOps(parsed, testCfg);
    expect(op.name).toBe("update[project]");
    expect(op.steps).toHaveLength(1);
    expect(op.steps[0].uses).toBe("ue/update-project");
  });

  test("build steps from ops.build.default", () => {
    const parsed = parseGoArgs(["build"]);
    const [op] = resolveOps(parsed, testCfg);
    expect(op.name).toBe("build");
    expect(op.steps).toHaveLength(1);
    expect(op.steps[0].uses).toBe("ue/build");
    expect(op.steps[0].with?.target).toBe("editor");
  });

  test("build:client default steps with with.target overridden", () => {
    const parsed = parseGoArgs(["build:client"]);
    const [op] = resolveOps(parsed, testCfg);
    expect(op.name).toBe("build[client]");
    expect(op.steps).toHaveLength(1);
    expect(op.steps[0].uses).toBe("ue/build");
    expect(op.steps[0].with?.target).toBe("client");
  });

  test("build:client does not mutate original testCfg steps", () => {
    const parsed = parseGoArgs(["build:client"]);
    resolveOps(parsed, testCfg);
    // Original default step should still have "editor"
    expect(testCfg.ops.build.default[0].with?.target).toBe("editor");
  });

  test("unknown op throws", () => {
    const parsed = parseGoArgs(["foo"]);
    expect(() => resolveOps(parsed, testCfg)).toThrow('Unknown op: "foo"');
  });

  test("unknown variant throws", () => {
    const parsed = parseGoArgs(["update"]);
    // Manually set isExact=false, value="bar" to trigger unknown-variant path
    parsed[0].value = "bar";
    expect(() => resolveOps(parsed, testCfg)).toThrow('Unknown variant "bar" for op "update"');
  });
});

// ---------------------------------------------------------------------------
// sortByPipeline
// ---------------------------------------------------------------------------

describe("sortByPipeline", () => {
  const order = ["kill", "update", "build", "start"];

  test("sorts ops by pipeline order", () => {
    const ops = [
      { name: "start", steps: [] },
      { name: "build", steps: [] },
      { name: "update", steps: [] },
    ];
    const sorted = sortByPipeline(ops, order);
    expect(sorted.map((o) => o.name)).toEqual(["update", "build", "start"]);
  });

  test("unknown op goes to end", () => {
    const ops = [
      { name: "unknown", steps: [] },
      { name: "build", steps: [] },
    ];
    const sorted = sortByPipeline(ops, order);
    expect(sorted.map((o) => o.name)).toEqual(["build", "unknown"]);
  });

  test("does not mutate input array", () => {
    const ops = [
      { name: "start", steps: [] },
      { name: "update", steps: [] },
    ];
    const original = [...ops];
    sortByPipeline(ops, order);
    expect(ops[0].name).toBe(original[0].name);
    expect(ops[1].name).toBe(original[1].name);
  });

  test("strips [variant] suffix when matching pipeline order", () => {
    const ops = [
      { name: "start", steps: [] },
      { name: "update[svn]", steps: [] },
    ];
    const sorted = sortByPipeline(ops, order);
    expect(sorted.map((o) => o.name)).toEqual(["update[svn]", "start"]);
  });
});

// ---------------------------------------------------------------------------
// inline params
// ---------------------------------------------------------------------------

test("inline params parsed for single op", () => {
  const result = parseGoArgs(["build-program", "--target=UnrealInsights"]);
  expect(result).toEqual([
    {
      name: "build-program",
      value: "default",
      isExact: false,
      params: { target: "UnrealInsights" },
    },
  ]);
});

test("non-shareable params (target) do not propagate to other ops", () => {
  const result = parseGoArgs(["update", "build-program", "--target=AnvilSmith", "build"]);
  expect(result[0].params).toEqual({}); // update: not affected
  expect(result[1].params).toEqual({ target: "AnvilSmith" }); // build-program: explicit
  expect(result[2].params).toEqual({}); // build: target does not leak
});

test("shared params: config before last op fills forward", () => {
  // bolt go build --config=debug start  → start gets type=debug
  const result = parseGoArgs(["build", "--config=debug", "start"]);
  expect(result[0].params).toEqual({ config: "debug" });
  expect(result[1].params).toEqual({ config: "debug" });
});

test("shared params: config on last op fills backward", () => {
  // bolt go build start --config=debug  → build gets type=debug
  const result = parseGoArgs(["build", "start", "--config=debug"]);
  expect(result[0].params).toEqual({ config: "debug" });
  expect(result[1].params).toEqual({ config: "debug" });
});

test("shared params: explicit per-op override wins", () => {
  // bolt go build --config=debug start --config=development  → each keeps own value
  const result = parseGoArgs(["build", "--config=debug", "start", "--config=development"]);
  expect(result[0].params).toEqual({ config: "debug" });
  expect(result[1].params).toEqual({ config: "development" });
});

test("--dry-run not consumed as inline param", () => {
  const result = parseGoArgs(["build", "--dry-run"]);
  expect(result[0].params).toEqual({});
});

test("variant and inline params coexist", () => {
  const result = parseGoArgs(["build-program:debug", "--target=MyProg"]);
  expect(result[0].value).toBe("debug");
  expect(result[0].isExact).toBe(true);
  expect(result[0].params).toEqual({ target: "MyProg" });
});

// ---------------------------------------------------------------------------
// config shortcuts
// ---------------------------------------------------------------------------

test("config shortcut: dev expands to development", () => {
  const result = parseGoArgs(["build", "--config=dev"]);
  expect(result[0].params).toEqual({ config: "development" });
});

test("config shortcut: dbg expands to debug", () => {
  const result = parseGoArgs(["build", "--config=dbg"]);
  expect(result[0].params).toEqual({ config: "debug" });
});

test("config shortcut: full name is preserved as-is", () => {
  const result = parseGoArgs(["build", "--config=shipping"]);
  expect(result[0].params).toEqual({ config: "shipping" });
});

test("config shortcut expands before shared-param propagation", () => {
  // bolt go build --config=dev start  → both get type=development (not "dev")
  const result = parseGoArgs(["build", "--config=dev", "start"]);
  expect(result[0].params).toEqual({ config: "development" });
  expect(result[1].params).toEqual({ config: "development" });
});

test("config shortcut: dbg propagates as development via last-op backward fill", () => {
  // bolt go build start --config=dbg  → both get type=debug
  const result = parseGoArgs(["build", "start", "--config=dbg"]);
  expect(result[0].params).toEqual({ config: "debug" });
  expect(result[1].params).toEqual({ config: "debug" });
});
