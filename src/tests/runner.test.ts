import { describe, expect, test } from "bun:test";
import { Runner } from "../runner";
import { mockRuntime, testCfg } from "./env";
import type { Runtime } from "../runtime/types";
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
  expect(runner.runTask("nope")).rejects.toThrow('Unknown task: "nope"');
});

// ---------------------------------------------------------------------------
// call composition + cycle detection
// ---------------------------------------------------------------------------

test("rejects legacy task references at runtime with a migration hint", async () => {
  const legacy: BoltConfig = {
    ...testCfg,
    tasks: {
      inner: [{ run: "echo inner" }],
      outer: [{ uses: "task/inner" }],
    },
  };
  await expect(new Runner(legacy, { dryRun: true }).runTask("outer")).rejects.toThrow(
    'replace with "call: inner"',
  );
});

test("call executes a task inline without mutating its definition", async () => {
  const ran: string[] = [];
  const composed: BoltConfig = {
    ...testCfg,
    tasks: {
      inner: [{ run: "echo ${{ params.mode }}" }],
      outer: [{ call: "inner", with: { mode: "debug" } }],
    },
  };
  const runner = new Runner(composed, { dryRun: true, onStep: (s) => ran.push(s) });
  await runner.runTask("outer");
  expect(ran).toContain("echo debug");
  expect(composed.tasks.inner).toEqual([{ run: "echo ${{ params.mode }}" }]);
});

test("call throws on an unknown called task", async () => {
  const composed: BoltConfig = {
    ...testCfg,
    tasks: { outer: [{ call: "missing" }] },
  };
  const runner = new Runner(composed, { dryRun: true });
  expect(runner.runTask("outer")).rejects.toThrow('Unknown task: "missing"');
});

test("call reports the complete cycle path", async () => {
  const cyclic: BoltConfig = {
    ...testCfg,
    tasks: {
      a: [{ call: "b" }],
      b: [{ call: "a" }],
    },
  };
  await expect(new Runner(cyclic, { dryRun: true }).runTask("a")).rejects.toThrow("a -> b -> a");
});

test("call permits a completed task to run again", async () => {
  const ran: string[] = [];
  const composed: BoltConfig = {
    ...testCfg,
    tasks: {
      inner: [{ run: "echo inner" }],
      outer: [{ call: "inner" }, { call: "inner" }],
    },
  };
  const runner = new Runner(composed, { dryRun: true, onStep: (step) => ran.push(step) });
  await runner.runTask("outer");
  expect(ran).toEqual(["call:inner", "echo inner", "call:inner", "echo inner"]);
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

test("params flow through call and win over with:", async () => {
  const ran: string[] = [];
  const paramCfg: BoltConfig = {
    ...testCfg,
    tasks: {
      inner: [{ run: "echo ${{ params.x }}" }],
      outer: [{ call: "inner", with: { x: "fromWith" } }],
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
    boom: [{ uses: "missing/run" }],
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
  expect(runner.runFlow("nope")).rejects.toThrow('Unknown flow: "nope"');
});

test("runFlow aborts by default (fail-fast) when a task fails", async () => {
  const ran: string[] = [];
  const runner = new Runner(flowCfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await expect(runner.runFlow("stops")).rejects.toThrow('Unknown plugin namespace: "missing"');
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
  return new Notifier([{ send: async (e: NotifyEvent) => void events.push(e) }], {
    on_start: true,
    on_op_complete: true,
    on_failure: true,
    on_complete: true,
  });
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

test("runTasks sends one A+B start and one complete event", async () => {
  const events: NotifyEvent[] = [];
  const planCfg: BoltConfig = {
    ...testCfg,
    tasks: {
      update: [{ uses: "ue/update_engine" }, { uses: "ue/update_project" }],
      build: [{ uses: "ue/build", with: { target: "editor" } }],
      build_editor: [{ call: "build", with: { config: "debuggame" } }],
    },
  };
  const runner = new Runner(planCfg, {
    dryRun: true,
    notifier: fakeNotifier(events),
  });

  await runner.runTasks(["update", "build_editor"], { config: "debuggame" });

  const starts = events.filter((event) => event.kind === "start");
  const completes = events.filter((event) => event.kind === "complete");
  expect(starts).toHaveLength(1);
  expect(completes).toHaveLength(1);
  expect(starts[0].plan?.tasks.map((task) => task.name)).toEqual(["update", "build_editor"]);
  expect(completes[0].results?.map((result) => result.op)).toEqual(["update", "build_editor"]);
});

test("runTasks fails fast with one partial final summary", async () => {
  const events: NotifyEvent[] = [];
  const ran: string[] = [];
  const failing: BoltConfig = {
    ...testCfg,
    tasks: {
      first: [{ run: "echo first" }],
      boom: [{ uses: "missing/run" }],
      later: [{ run: "echo later" }],
    },
  };
  const runner = new Runner(failing, {
    dryRun: true,
    notifier: fakeNotifier(events),
    onStep: (step) => ran.push(step),
  });

  await expect(runner.runTasks(["first", "boom", "later"])).rejects.toThrow(
    'Unknown plugin namespace: "missing"',
  );

  expect(events.filter((event) => event.kind === "start")).toHaveLength(1);
  expect(events.filter((event) => event.kind === "op_failure")).toHaveLength(1);
  const complete = events.find((event) => event.kind === "complete");
  expect(complete?.results?.map((result) => result.op)).toEqual(["first", "boom"]);
  expect(ran).not.toContain("echo later");
});

test("planning errors do not start a notification lifecycle", async () => {
  const events: NotifyEvent[] = [];
  const invalid: BoltConfig = {
    ...testCfg,
    tasks: { outer: [{ call: "missing" }] },
  };
  const runner = new Runner(invalid, {
    dryRun: true,
    notifier: fakeNotifier(events),
  });

  await expect(runner.runTask("outer")).rejects.toThrow('Unknown task: "missing"');
  expect(events).toEqual([]);
});

// ---------------------------------------------------------------------------
// dry-run has no side effects (BOLT-FIX-2)
// ---------------------------------------------------------------------------

function recordingRuntime(calls: string[]): Runtime {
  return {
    ...mockRuntime,
    spawn: async (cmd) => {
      calls.push(`spawn ${cmd.join(" ")}`);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    spawnSync: (cmd) => {
      calls.push(`spawnSync ${cmd.join(" ")}`);
      return { exitCode: 0, stdout: "main\n", stderr: "" };
    },
    shell: async (cmd) => {
      calls.push(`shell ${cmd}`);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

const localCfg: BoltConfig = {
  ...testCfg,
  tasks: {
    local: [{ uses: "./actions/does-not-exist", with: { mode: "x" } }, { run: "echo hi" }],
  },
};

test("dry-run does not execute local actions, shell steps, or git", async () => {
  const calls: string[] = [];
  const ran: string[] = [];
  const runner = new Runner(localCfg, {
    dryRun: true,
    runtime: recordingRuntime(calls),
    onStep: (s) => ran.push(s),
  });
  await runner.runTask("local");
  expect(ran).toEqual(["./actions/does-not-exist", "echo hi"]);
  expect(calls).toEqual([]);
});

test("a real run still looks up the git branch and runs shell steps", async () => {
  const calls: string[] = [];
  const cfg: BoltConfig = { ...testCfg, tasks: { a: [{ run: "echo hi" }] } };
  await new Runner(cfg, { runtime: recordingRuntime(calls) }).runTask("a");
  expect(calls).toContain("spawnSync git branch --show-current");
  expect(calls).toContain("shell echo hi");
});

// ---------------------------------------------------------------------------
// AI invocation: core rejects out-of-project paths for git/info and svn/info
// ---------------------------------------------------------------------------

for (const ref of ["git/info", "svn/info"]) {
  test(`AI invocation of ${ref} with an out-of-project path is rejected by core`, async () => {
    const aiCfg: BoltConfig = {
      ...testCfg,
      tasks: { peek: [{ uses: ref, with: { path: "../Engine" } }] },
    };
    const calls: string[] = [];
    const runner = new Runner(aiCfg, {
      dryRun: true,
      aiInvocation: true,
      configDir: process.cwd(),
      onStep: (s) => calls.push(s),
    });
    const run = runner.runTask("peek");
    await expect(run).rejects.toMatchObject({ code: "AI_FORBIDDEN" });
    await expect(
      new Runner(aiCfg, { dryRun: true, aiInvocation: true }).runTask("peek"),
    ).rejects.toThrow(/outside the project directory.*Fix:/);
  });

  test(`human run of ${ref} with the same path is not rejected by core`, async () => {
    const humanCfg: BoltConfig = {
      ...testCfg,
      tasks: { peek: [{ uses: ref, with: { path: "../Engine" } }] },
    };
    await expect(
      new Runner(humanCfg, { dryRun: true, runtime: mockRuntime }).runTask("peek"),
    ).resolves.toBeUndefined();
  });
}

test("AI invocation fails closed when the path cannot be resolved (symlink loop); humans only warn", async () => {
  if (process.platform === "win32") return;
  const { mkdtempSync, rmSync, symlinkSync } = await import("fs");
  const os = await import("os");
  const pathMod = await import("path");
  const dir = mkdtempSync(pathMod.join(os.tmpdir(), "bolt-ai-loop-"));
  try {
    symlinkSync(pathMod.join(dir, "b"), pathMod.join(dir, "a"));
    symlinkSync(pathMod.join(dir, "a"), pathMod.join(dir, "b"));
    const loopCfg: BoltConfig = {
      ...testCfg,
      tasks: { peek: [{ uses: "git/info", with: { path: "a" } }] },
    };
    const ai = new Runner(loopCfg, { dryRun: true, aiInvocation: true, configDir: dir });
    await expect(ai.runTask("peek")).rejects.toMatchObject({
      code: "AI_FORBIDDEN",
      message: expect.stringMatching(/cannot be verified.*symlink loop.*Fix:/),
    });
    const human = new Runner(loopCfg, { dryRun: true, configDir: dir, runtime: mockRuntime });
    await expect(human.runTask("peek")).resolves.toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("fs/* and json/* through an in-project symlink to outside", () => {
  const setup = async () => {
    const { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } = await import("fs");
    const os = await import("os");
    const p = await import("path");
    const base = mkdtempSync(p.join(os.tmpdir(), "bolt-fs-link-"));
    const root = p.join(base, "project");
    const outside = p.join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(p.join(root, "in.txt"), "inside");
    writeFileSync(p.join(outside, "secret.txt"), "outside");
    symlinkSync(outside, p.join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    return { base, root, outside, p };
  };

  test("human fs/copy into the symlink succeeds with no warning (main behavior)", async () => {
    const { base, root, outside, p } = await setup();
    const { existsSync, rmSync } = await import("fs");
    try {
      const lines: string[] = [];
      const { Logger } = await import("../logger");
      const humanCfg: BoltConfig = {
        ...testCfg,
        tasks: { cp: [{ uses: "fs/copy", with: { src: "in.txt", dst: "link/copied.txt" } }] },
      };
      const runner = new Runner(humanCfg, {
        configDir: root,
        logger: new Logger({ sink: (l) => lines.push(l) }),
      });
      await runner.runTask("cp");
      expect(existsSync(p.join(outside, "copied.txt"))).toBe(true);
      expect(lines.some((l) => l.includes("WARN"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("AI invocation is rejected for read (src) and write (dst) through the symlink", async () => {
    const { base, root, outside, p } = await setup();
    const { existsSync, rmSync } = await import("fs");
    try {
      const aiCfg: BoltConfig = {
        ...testCfg,
        tasks: {
          read: [{ uses: "fs/copy", with: { src: "link/secret.txt", dst: "got.txt" } }],
          write: [{ uses: "fs/copy", with: { src: "in.txt", dst: "link/planted.txt" } }],
          json: [{ uses: "json/set", with: { file: "link/x.json", key: "a", value: "1" } }],
        },
      };
      const ai = () => new Runner(aiCfg, { configDir: root, aiInvocation: true });
      await expect(ai().runTask("read")).rejects.toMatchObject({ code: "AI_FORBIDDEN" });
      await expect(ai().runTask("write")).rejects.toMatchObject({ code: "AI_FORBIDDEN" });
      await expect(ai().runTask("json")).rejects.toMatchObject({ code: "AI_FORBIDDEN" });
      expect(existsSync(p.join(root, "got.txt"))).toBe(false);
      expect(existsSync(p.join(outside, "planted.txt"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("literal ../ is still rejected for human runs", async () => {
    const humanCfg: BoltConfig = {
      ...testCfg,
      tasks: { cp: [{ uses: "fs/copy", with: { src: "../x", dst: "y" } }] },
    };
    await expect(new Runner(humanCfg, { dryRun: true }).runTask("cp")).rejects.toThrow(
      /escapes project root/,
    );
  });
});
