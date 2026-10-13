import { expect, test, describe } from "bun:test";
import { Runner } from "../runner";
import { testCfg } from "./env";
import type { BoltConfig } from "../config";
import { parseRunArgs, dispatchRun, UsageError, RESERVED_FLAGS } from "../commands/run";
import { checkGlobalArgs } from "../global-args";
import { formatPlanNodes } from "../inspect-utils";
import { resolveRunPlan } from "../run-plan";

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

  test("leaves --config as typed (aliases belong to ue/build)", () => {
    expect(parseRunArgs(["build", "--config=dev"]).params).toEqual({ config: "dev" });
    expect(parseRunArgs(["build", "--config=dbg"]).params).toEqual({ config: "dbg" });
    expect(parseRunArgs(["build", "--config=DebugGame"]).params).toEqual({ config: "DebugGame" });
  });
});

describe("parseRunArgs strictness (BOLT-FIX-3)", () => {
  const usage = (args: string[], opts?: Parameters<typeof parseRunArgs>[1]) => {
    try {
      parseRunArgs(args, opts);
    } catch (e) {
      expect(e).toBeInstanceOf(UsageError);
      return (e as Error).message;
    }
    throw new Error(`expected UsageError for ${args.join(" ")}`);
  };

  test("rejects unknown long flags and suggests the closest known flag", () => {
    expect(usage(["build", "--dryrun"])).toContain('Did you mean "--dry-run"?');
    expect(usage(["build", "--dry"])).toContain('Unknown flag "--dry"');
    expect(usage(["build", "--frobnicate"])).not.toContain("Did you mean");
  });

  test("rejects unknown short flags, including bundles", () => {
    expect(usage(["build", "-x"])).toContain('Unknown flag "-x"');
    expect(usage(["build", "-xyz"])).toContain('Unknown flag "-xyz"');
    expect(usage(["build", "-n"])).toContain('Unknown flag "-n"');
  });

  test("help flags are left to citty", () => {
    expect(parseRunArgs(["build", "-h"]).names).toEqual(["build"]);
    expect(parseRunArgs(["build", "--help"]).names).toEqual(["build"]);
  });

  test("boolean flags take no value", () => {
    expect(usage(["build", "--dry-run=false"])).toContain('"--dry-run" does not take a value');
    expect(usage(["build", "--dry-run=true"])).toContain("does not take a value");
  });

  test("param values may not start with --", () => {
    expect(usage(["build", "--target=--dry-run"])).toContain("-- target=--dry-run");
    expect(usage(["build", "--=x"])).toContain("Malformed param");
  });

  test("everything after -- is key=value params only", () => {
    const parsed = parseRunArgs(["build", "--dry-run", "--", "extra=--verbose", "a=b=c"]);
    expect(parsed.names).toEqual(["build"]);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.params).toEqual({ extra: "--verbose", a: "b=c" });
    expect(usage(["build", "--", "--execute"])).toContain("Malformed param");
    expect(usage(["build", "--", "--dry-run"])).toContain("Malformed param");
    expect(usage(["build", "--", "start"])).toContain("Malformed param");
  });

  test("a bare -- with nothing after it is allowed", () => {
    expect(parseRunArgs(["build", "--"])).toEqual({ names: ["build"], params: {}, dryRun: false });
  });

  test("inspect accepts no boolean flags", () => {
    expect(usage(["build", "--dry-run"], { flags: [], command: "inspect" })).toContain(
      'Unknown flag "--dry-run" for "bolt inspect"',
    );
    expect(parseRunArgs(["build", "--k=v"], { flags: [] }).params).toEqual({ k: "v" });
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

test("multiple tasks dispatched by the CLI share one notification lifecycle", async () => {
  const events: import("../notify").NotifyEvent[] = [];
  const { Notifier } = await import("../notify");
  const notifier = new Notifier([{ send: async (event) => void events.push(event) }], {
    on_start: true,
    on_op_complete: true,
    on_failure: true,
    on_complete: true,
  });
  const runner = new Runner(cfg, { dryRun: true, notifier });

  await dispatchRun(runner, cfg, ["b", "a"], {});

  expect(events.filter((event) => event.kind === "start")).toHaveLength(1);
  expect(events.filter((event) => event.kind === "complete")).toHaveLength(1);
});

test("(b) a single flow name runs the flow", async () => {
  const ran: string[] = [];
  const runner = new Runner(cfg, { dryRun: true, onStep: (s) => ran.push(s) });
  await dispatchRun(runner, cfg, ["daily"], {});
  expect(ran).toEqual(["echo a", "echo b"]);
});

test("flow dispatch forwards CLI params to every planned task", async () => {
  const ran: string[] = [];
  const flowParamCfg: BoltConfig = {
    ...cfg,
    tasks: { greet: [{ run: "echo ${{ params.msg }}" }] },
    flows: { greeting: { steps: ["greet"], continue_on_fail: [] } },
  };
  const runner = new Runner(flowParamCfg, { dryRun: true, onStep: (step) => ran.push(step) });

  await dispatchRun(runner, flowParamCfg, ["greeting"], { msg: "hello" });

  expect(ran).toEqual(["echo hello"]);
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
  await expect(dispatchRun(runner, cfg, ["nope"], {})).rejects.toThrow(
    'Unknown task or flow: "nope"',
  );
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

test("formats a resolved call tree with effective CLI params", () => {
  const planCfg: BoltConfig = {
    ...cfg,
    tasks: {
      build: [{ uses: "ue/build", with: { target: "editor", config: "development" } }],
      build_editor: [{ call: "build", with: { config: "debuggame" } }],
    },
  };
  const result = resolveRunPlan(planCfg, {
    kind: "tasks",
    names: ["build_editor"],
    params: { config: "shipping" },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(formatPlanNodes(result.plan.tasks[0].nodes)).toEqual([
    "call: build",
    "  uses: ue/build  target=editor  config=shipping",
  ]);
});

describe("reserved flag names (design 0.4)", () => {
  const usage = (args: string[], opts?: Parameters<typeof parseRunArgs>[1]) => {
    try {
      parseRunArgs(args, opts);
    } catch (e) {
      expect(e).toBeInstanceOf(UsageError);
      return (e as Error).message;
    }
    throw new Error(`expected UsageError for ${args.join(" ")}`);
  };
  const unsupported = ["simulate", "json", "agent", "execute", "plan", "confirmed-by-user"];

  test("all seven names are reserved", () => {
    expect([...RESERVED_FLAGS].sort() as string[]).toEqual([...unsupported, "dry-run"].sort());
  });

  for (const name of unsupported) {
    test(`--${name} is rejected in every form`, () => {
      const rename = `build_${name.replace(/-/g, "_")}`;
      const param = `"${name}" is reserved by bolt and cannot be used as a param name. Rename the param, e.g. in bolt.yaml use ${rename} and pass -- ${rename}=x.`;
      expect(usage(["build", `--${name}`])).toBe(
        `--${name} is reserved by bolt and not supported yet. Remove it from the command.`,
      );
      expect(usage(["build", `--${name}=x`])).toBe(param);
      expect(usage(["build", "--", `${name}=x`])).toBe(param);
      expect(usage(["build", `--${name}=x`], { flags: [], command: "inspect" })).toBe(param);
    });
  }

  test("dry-run cannot be passed as a param after --", () => {
    const msg = usage(["build", "--", "dry-run=false"]);
    expect(msg).toContain('"dry-run" is reserved by bolt');
    expect(msg).toContain("use build_dry_run and pass -- build_dry_run=false");
    expect(msg).toContain("pass --dry-run without a value");
  });

  test("non-reserved look-alikes still pass", () => {
    expect(parseRunArgs(["build", "--planner=x", "--", "jsonfile=a"]).params).toEqual({
      planner: "x",
      jsonfile: "a",
    });
  });
});

describe("checkGlobalArgs", () => {
  test("allows help, a lone --version and nothing before the subcommand", () => {
    expect(checkGlobalArgs([])).toBeUndefined();
    expect(checkGlobalArgs(["--version"])).toBeUndefined();
    expect(checkGlobalArgs(["-h"])).toBeUndefined();
    expect(checkGlobalArgs(["--help", "run"])).toBeUndefined();
  });

  test("help wins over --version in any combination", () => {
    for (const argv of [
      ["--help", "--version"],
      ["--version", "--help"],
      ["-h", "--version"],
      ["--version", "-h", "--help"],
      ["--version", "--help", "run", "build"],
    ]) {
      expect(checkGlobalArgs(argv)).toBeUndefined();
    }
    expect(checkGlobalArgs(["run", "build", "--dry-run"])).toBeUndefined();
  });

  test("rejects any other flag before the subcommand", () => {
    expect(checkGlobalArgs(["--dry-run", "run", "deploy"])).toContain('"--dry-run"');
    expect(checkGlobalArgs(["-x", "run", "build"])).toContain('"-x"');
    expect(checkGlobalArgs(["--version", "run", "build"])).toBe(
      "--version must be used on its own. Use: bolt --version",
    );
    expect(checkGlobalArgs(["--version=1"])).toBe("--version takes no value. Use: bolt --version");
    expect(checkGlobalArgs(["--version=1", "run", "x"])).toContain("--version takes no value");
    expect(checkGlobalArgs(["--help=1"])).toContain("--help takes no value");
    expect(checkGlobalArgs(["--help", "--bogus"])).toContain('Unknown global flag "--bogus"');
    expect(checkGlobalArgs(["--bogus"])).toContain('"--bogus"');
  });
});
