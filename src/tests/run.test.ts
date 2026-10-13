import { expect, test, describe } from "bun:test";
import { Runner } from "../runner";
import { testCfg } from "./env";
import type { BoltConfig } from "../config";
import { parseRunArgs, dispatchRun, UsageError, RESERVED_FLAGS } from "../commands/run";
import { checkCommandName, checkGlobalArgs } from "../global-args";
import { closest, closestMatches, formatDidYouMean, shellQuote } from "../suggest";
import { commands } from "../commands";
import { missingNameMessage, renamedParam, unknownNamesMessage } from "../commands/run";
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
  await expect(dispatchRun(runner, cfg, ["nope"], {})).rejects.toThrow('Unknown task "nope".');
});

test("a multi-name list containing a flow name errors (flow only runs solo)", async () => {
  const runner = new Runner(cfg, { dryRun: true });
  // "daily" is a flow, not a task, so it is invalid inside a multi-task list.
  await expect(dispatchRun(runner, cfg, ["a", "daily"], {})).rejects.toThrow(
    '"daily" is a flow; a flow runs on its own: bolt run daily',
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
      const rename = `my_${name.replace(/-/g, "_")}`;
      const rn = `rename it, e.g. in bolt.yaml use ${rename} and pass -- ${rename}=x.`;
      const flagForm = `--${name} is reserved by bolt and not supported yet. If this is a task param, ${rn}`;
      const param = `"${name}" cannot be used as a param name (--${name} is reserved by bolt and not supported yet). R${rn.slice(1).replace("it,", "the param,")}`;
      expect(usage(["build", `--${name}`])).toBe(
        `--${name} is reserved by bolt and not supported yet. Remove it from the command.`,
      );
      expect(usage(["build", `--${name}=x`])).toBe(flagForm);
      expect(usage(["build", "--", `${name}=x`])).toBe(param);
      expect(usage(["build", `--${name}=x`], { flags: [], command: "inspect" })).toBe(flagForm);
    });
  }

  test("dry-run cannot be passed as a param after --", () => {
    const msg = usage(["build", "--", "dry-run=1"]);
    expect(msg).toContain('"dry-run" cannot be used as a param name');
    expect(msg).toContain("use my_dry_run and pass -- my_dry_run=1");
    expect(msg).toContain("pass --dry-run without a value");
  });

  test("dry-run=false says to just remove --dry-run, before the rename hint", () => {
    const msg = usage(["build", "--", "dry-run=false"]);
    expect(msg).toStartWith('"dry-run=false" is not a param');
    expect(msg.indexOf("just remove --dry-run")).toBeLessThan(msg.indexOf("my_dry_run"));
    expect(usage(["build", "--dry-run=false"])).toBe(
      'Flag "--dry-run" does not take a value. To run for real, just remove --dry-run.',
    );
    expect(usage(["build", "--dry-run=yes"])).toContain("Use --dry-run on its own.");
  });

  test("suggested commands quote values with spaces", () => {
    expect(usage(["build", "--", "plan=yes please"])).toContain('pass -- my_plan="yes please".');
    expect(usage(["build", "--", "plan=a$b"])).toContain("pass -- my_plan='a$b'.");
    expect(usage(["build", "--", "plan="])).toContain('pass -- my_plan="".');
  });

  test("inspect --dry-run explains inspect is already a preview", () => {
    for (const arg of ["--dry-run", "--dry-run=1"]) {
      expect(usage(["build", arg], { flags: [], command: "inspect" })).toContain(
        "bolt inspect never executes, it is already a side-effect-free preview. Remove --dry-run.",
      );
    }
  });

  test("reserved names are case-sensitive", () => {
    expect(parseRunArgs(["build", "--PLAN=x", "--", "Json=y"]).params).toEqual({
      PLAN: "x",
      Json: "y",
    });
  });

  test("valued forms of future flags say not supported yet and offer a rename", () => {
    expect(usage(["build", "--json=v1"])).toBe(
      "--json is reserved by bolt and not supported yet. If this is a task param, rename it, e.g. in bolt.yaml use my_json and pass -- my_json=v1.",
    );
    expect(usage(["build", "--plan=abc123"])).toContain(
      "--plan is reserved by bolt and not supported yet. If this is a task param",
    );
    expect(usage(["build", "--", "json=v1"])).toContain(
      "--json is reserved by bolt and not supported yet",
    );
  });

  test("inspect never suggests --dry-run", () => {
    const msg = usage(["build", "--", "dry-run=1"], { flags: [], command: "inspect" });
    expect(msg).not.toContain("pass --dry-run");
    expect(msg).toContain("bolt inspect never executes, it is already a side-effect-free preview");
    expect(msg).toContain("pass -- my_dry_run=1");
  });

  test("--help with a value and help= after -- are rejected", () => {
    const expected =
      "--help takes no value. Use: bolt run --help. If this is a task param, rename it, e.g. in bolt.yaml use my_help and pass -- my_help=1.";
    expect(usage(["build", "--help=1"])).toBe(expected);
    expect(usage(["build", "--", "help=1"])).toBe(
      '"help" cannot be used as a param name (it is a bolt flag). Rename the param, e.g. in bolt.yaml use my_help and pass -- my_help=1.',
    );
    expect(usage(["build", "--", "help=1"])).not.toContain("--help takes no value");
    expect(usage(["build", "--help="], { flags: [], command: "inspect" })).toContain(
      "Use: bolt inspect --help",
    );
    expect(parseRunArgs(["build", "--help"]).names).toEqual(["build"]);
    expect(parseRunArgs(["build", "-h"]).names).toEqual(["build"]);
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
    expect(checkGlobalArgs(["--dry-run", "run", "deploy"])).not.toContain("Did you mean");
    expect(checkGlobalArgs(["--verison"])).toContain('Did you mean "--version"?');
    expect(checkGlobalArgs(["--verison", "run"])).toBe(
      'Unknown global flag "--verison". Did you mean "--version"? ' +
        "Flags go after the command, e.g. bolt run <task> --dry-run. " +
        "Only -h, --help and --version may come before it.",
    );
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

describe("checkGlobalArgs edge cases", () => {
  test("valued, bundled and bare dashes before the subcommand", () => {
    expect(checkGlobalArgs(["-hx", "run", "mark"])).toContain('Unknown global flag "-hx"');
    expect(checkGlobalArgs(["-", "run", "mark"])).toContain('Unknown global flag "-"');
    expect(checkGlobalArgs(["-h=1"])).toContain("-h takes no value");
    expect(checkGlobalArgs(["--version", "--bogus"])).toContain('Unknown global flag "--bogus"');
    expect(checkGlobalArgs(["--DRY-RUN", "run"])).toContain('"--DRY-RUN"');
    expect(checkGlobalArgs(["--", "run"])).toContain('Unknown global flag "--"');
  });

  test("flags after the subcommand are not its business", () => {
    expect(checkGlobalArgs(["run", "-x", "--version=1", "--", "a=b"])).toBeUndefined();
    expect(checkGlobalArgs(["run", "--help"])).toBeUndefined();
  });
});

describe("checkCommandName", () => {
  const root = { subCommands: commands };
  test("suggests the closest command and lists all commands", () => {
    const msg = checkCommandName(["rn", "mark"], root)!;
    expect(msg).toStartWith('Unknown command "rn". Did you mean "run"?');
    expect(msg).toContain("Commands: run, list,");
    expect(msg).toContain("Run bolt --help for details.");
    expect(checkCommandName(["inspec", "mark"], root)).toContain('Did you mean "inspect"?');
  });
  test("checks nested commands and omits a far-off suggestion", () => {
    expect(checkCommandName(["plugin", "nw"], root)).toContain('Did you mean "new"?');
    expect(checkCommandName(["plugin", "nw"], root)).toContain("Run bolt plugin --help");
    expect(checkCommandName(["xyzzy"], root)).toBe(
      `Unknown command "xyzzy".\n  Commands: ${Object.keys(commands).join(", ")}\n  Run bolt --help for details.`,
    );
  });
  test("accepts known commands, help and leaves positional args alone", () => {
    expect(checkCommandName(["run", "mrk"], root)).toBeUndefined();
    expect(checkCommandName(["plugin", "new", "x"], root)).toBeUndefined();
    expect(checkCommandName(["rn", "--help"], root)).toBeUndefined();
    expect(checkCommandName([], root)).toBeUndefined();
  });
  test("bolt plugin with no subcommand is a usage error", () => {
    const msg = checkCommandName(["plugin"], root)!;
    expect(msg).toStartWith("No command specified.");
    expect(msg).toContain("Commands: new, list");
    expect(msg).toContain("Run bolt plugin --help for details.");
  });
  test("aliases and forgot-run suggestions", () => {
    expect(checkCommandName(["help"], root)).toContain('Did you mean "bolt --help"?');
    expect(checkCommandName(["update"], root)).toContain('Did you mean "bolt self-update"?');
    expect(checkCommandName(["upgrade"], root)).toContain('Did you mean "bolt self-update"?');
    expect(checkCommandName(["build"], root, ["build", "deploy"])).toContain(
      'Did you mean "bolt run build"?',
    );
    expect(checkCommandName(["build"], root)).toBe(
      `Unknown command "build".\n  Commands: ${Object.keys(commands).join(", ")}\n  Run bolt --help for details.`,
    );
  });
});

describe("task suggestions and usage", () => {
  test("unknown task suggests the closest name and lists tasks", () => {
    const msg = unknownNamesMessage(cfg, ["gret"])!;
    expect(msg).toStartWith('Unknown task "gret". Did you mean "greet"?');
    expect(msg).not.toContain("case-sensitive");
    expect(msg).toContain("Tasks: ");
    expect(msg).toContain("Run bolt list for details.");
    expect(unknownNamesMessage(cfg, ["daily"])).toBeUndefined();
    expect(unknownNamesMessage(cfg, ["zzzzzzzz"])).toStartWith('Unknown task "zzzzzzzz".\n');
  });
  test("case-only task mismatch notes that names are case-sensitive", () => {
    const msg = unknownNamesMessage(cfg, ["Greet"])!;
    expect(msg).toStartWith(
      'Unknown task "Greet". Did you mean "greet"? Task names are case-sensitive.',
    );
    expect(msg).toContain("Run bolt list for details.");
    // Exact case-insensitive match wins alone before prefix/distance (Build vs build-editor).
    const withPrefix = {
      ...cfg,
      tasks: { build: [{ run: "echo" }], "build-editor": [{ run: "echo" }] },
    };
    const buildMsg = unknownNamesMessage(withPrefix, ["Build"])!;
    expect(buildMsg.split("\n")[0]).toBe(
      'Unknown task "Build". Did you mean "build"? Task names are case-sensitive.',
    );
    expect(buildMsg.split("\n")[0]).not.toContain("build-editor");
  });
  test("missing task lists the project's tasks, or hints bolt list", () => {
    const msg = missingNameMessage("run", { kind: "loaded", cfg });
    expect(msg).toContain("Usage: bolt run <task...|flow>");
    expect(msg).toContain(`Tasks: ${Object.keys(cfg.tasks).join(", ")}`);
    expect(msg).not.toContain("build start");
    expect(missingNameMessage("run", { kind: "missing" })).toContain("bolt list");
    expect(missingNameMessage("inspect", { kind: "invalid", path: "/p/bolt.yaml" })).toContain(
      "bolt check",
    );
    const empty = { ...cfg, tasks: {}, flows: {} };
    expect(missingNameMessage("run", { kind: "loaded", cfg: empty })).toContain("bolt list");
  });
  test("helpers", () => {
    expect(renamedParam("confirmed-by-user")).toBe("my_confirmed_by_user");
    expect(renamedParam("help")).toBe("my_help");
    expect(closest("rn", ["run", "list"])).toBe("run");
    expect(closest("qqq", ["run", "list"])).toBeUndefined();
    expect(shellQuote("abc")).toBe("abc");
    expect(shellQuote("a b")).toBe('"a b"');
  });
  test("ambiguous prefix lists candidates; long task lists truncate", () => {
    const names = [
      "build",
      "build-editor",
      "deploy",
      ...Array.from({ length: 11 }, (_, i) => `task${String(i + 1).padStart(2, "0")}`),
    ];
    const wide = {
      ...cfg,
      tasks: Object.fromEntries(names.map((n) => [n, [{ run: "echo" }]])),
    };
    const msg = unknownNamesMessage(wide, ["bu"])!;
    expect(msg).toStartWith('Unknown task "bu". Did you mean "build" or "build-editor"?');
    expect(msg).toContain("and 4 more (see bolt list)");
    expect(msg).toContain("task01");
    expect(msg).not.toContain("task11");
  });
  test("flow typo says Unknown flow", () => {
    const msg = unknownNamesMessage(cfg, ["daly"])!;
    expect(msg).toStartWith('Unknown flow "daly". Did you mean "daily"?');
  });
});

describe("closest threshold (P1)", () => {
  const cmds = [
    "run",
    "list",
    "info",
    "check",
    "migrate",
    "config",
    "init",
    "types",
    "plugin",
    "inspect",
    "self-update",
    "ai",
    "version",
  ];
  test("short inputs do not guess wildly (bolt x / run d locked)", () => {
    // Locked: bolt x and bolt run d must never suggest.
    expect(closest("x", cmds)).toBeUndefined();
    expect(checkCommandName(["x"], { subCommands: commands })).not.toContain("Did you mean");
    expect(closest("d", ["b", "build", "deploy"])).toBeUndefined();
    expect(
      unknownNamesMessage(
        {
          ...cfg,
          tasks: { b: [{ run: "e" }], build: [{ run: "e" }], deploy: [{ run: "e" }] },
          flows: {},
        },
        ["d"],
      ),
    ).not.toContain("Did you mean");
    for (const input of ["c", "l", "a", "i", "s"]) {
      expect(closest(input, cmds)).toBeUndefined();
    }
    expect(closest("c", ["b", "build"])).toBeUndefined();
    expect(closest("zz", ["b"])).toBeUndefined();
  });
  test("adjacent transposition (OSA) and real typos still match", () => {
    expect(closest("mrak", ["mark", "build"])).toBe("mark");
    expect(closest("makr", ["mark", "build"])).toBe("mark");
    expect(closest("buidl", ["build", "mark"])).toBe("build");
    expect(closest("biuld", ["build", "mark"])).toBe("build");
    expect(closest("rn", cmds)).toBe("run");
    expect(closest("lst", cmds)).toBe("list");
    expect(closest("ver", cmds)).toBe("version");
    expect(closest("--verison", ["--version", "--help", "-h"])).toBe("--version");
    expect(closestMatches("bu", ["build", "build-editor", "deploy"])).toEqual([
      "build",
      "build-editor",
    ]);
    expect(closest("bu", ["build", "build-editor", "deploy"])).toBeUndefined();
    expect(closestMatches("Build", ["build", "build-editor"])).toEqual(["build"]);
    expect(formatDidYouMean(["build", "build-editor"])).toBe(
      ' Did you mean "build" or "build-editor"?',
    );
  });
});

describe("suggestion follow-ups (PR #30 review P2)", () => {
  test("top-level bolt zz and run b do not suggest", () => {
    expect(checkCommandName(["zz"], { subCommands: commands })).not.toContain("Did you mean");
    expect(closest("b", ["build", "bench", "deploy"])).toBeUndefined();
    const bCfg = {
      ...cfg,
      tasks: { build: [{ run: "e" }], bench: [{ run: "e" }], deploy: [{ run: "e" }] },
      flows: {},
    };
    expect(unknownNamesMessage(bCfg, ["b"])).not.toContain("Did you mean");
  });
  test("task list keeps declaration order (non-alphabetical)", () => {
    const ordered = {
      ...cfg,
      tasks: { zeta: [{ run: "e" }], alpha: [{ run: "e" }], mid: [{ run: "e" }] },
      flows: {},
    };
    expect(missingNameMessage("run", { kind: "loaded", cfg: ordered })).toContain(
      "Tasks: zeta, alpha, mid",
    );
  });
  test("exact task name beats fuzzy command match", () => {
    const msg = checkCommandName(["lint"], { subCommands: commands }, ["lint", "build"])!;
    expect(msg).toStartWith('Unknown command "lint". Did you mean "bolt run lint"?');
  });
  test("-v / -V suggest --version", () => {
    expect(checkGlobalArgs(["-v"])).toContain('Did you mean "--version"?');
    expect(checkGlobalArgs(["-V"])).toContain('Did you mean "--version"?');
  });
  test("--dryrn suggests --dry-run (separators ignored for flags)", () => {
    expect(() => parseRunArgs(["build", "--dryrn"])).toThrow('Did you mean "--dry-run"?');
  });
  test("several case-insensitive exact matches are all listed", () => {
    expect(closestMatches("MARK", ["mark", "Mark", "build"])).toEqual(["mark", "Mark"]);
    expect(closestMatches("Mark", ["mark", "Mark"])).toEqual(["Mark"]);
    const both = { ...cfg, tasks: { mark: [{ run: "e" }], Mark: [{ run: "e" }] }, flows: {} };
    expect(unknownNamesMessage(both, ["MARK"])).toStartWith(
      'Unknown task "MARK". Did you mean "mark" or "Mark"?',
    );
  });
});
