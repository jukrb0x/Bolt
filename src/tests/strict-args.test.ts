import { expect, test, describe } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { commands } from "../commands";
import {
  parseStrictArgs,
  specFromCittyArgs,
  UsageError,
  formatSupportedFlags,
  knownFlagNames,
  resolveLeafCommand,
  leafAllowsParams,
} from "../strict-args";
import { defineCommand } from "citty";
import { VERSION } from "../version";

function usage(args: string[], spec: ReturnType<typeof specFromCittyArgs>): string {
  try {
    parseStrictArgs(args, spec);
  } catch (e) {
    expect(e).toBeInstanceOf(UsageError);
    return (e as Error).message;
  }
  throw new Error(`expected UsageError for ${args.join(" ")}`);
}

const root = defineCommand({
  meta: { name: "bolt", version: VERSION },
  subCommands: commands,
});

/** Spawn `bun src/main.ts …` and capture exit/stdout/stderr. */
const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO_ROOT, "src/main.ts");

async function bolt(
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", MAIN, ...argv], {
    cwd: opts.cwd ?? REPO_ROOT,
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

describe("specFromCittyArgs", () => {
  test("derives booleans, strings, and aliases", () => {
    const spec = specFromCittyArgs("init", {
      force: { type: "boolean", alias: "f" },
      editor: { type: "string", alias: "e" },
      name: { type: "positional" },
    });
    expect(spec.booleans).toEqual(["force"]);
    expect(spec.strings).toEqual(["editor"]);
    expect(spec.booleanLookup.get("f")).toBe("force");
    expect(spec.stringLookup.get("e")).toBe("editor");
    expect(spec.allowParams).toBe(false);
  });
});

describe("parseStrictArgs citty parity", () => {
  // Semantic parity with citty (forms citty accepts), not object-equality against citty's
  // internal parse result — BOLT-CLI-1 design §5 / Atlas P2-3.

  const init = specFromCittyArgs("init", { force: { type: "boolean", alias: "f" } });
  const config = specFromCittyArgs("config", { editor: { type: "string", alias: "e" } });
  const version = specFromCittyArgs("version", { json: { type: "boolean" } });

  test("--flag and --no-flag for declared booleans", () => {
    expect(parseStrictArgs(["--force"], init).booleans.force).toBe(true);
    expect(parseStrictArgs(["--no-force"], init).booleans.force).toBe(false);
    expect(usage(["--no-x"], init)).toContain("Unknown flag");
  });

  test("string flags accept --str=v and --str v", () => {
    expect(parseStrictArgs(["--editor=code"], config).strings.editor).toBe("code");
    expect(parseStrictArgs(["--editor", "code"], config).strings.editor).toBe("code");
    expect(usage(["--editor"], config)).toContain("needs a value");
  });

  test("aliases -f and -e v work", () => {
    expect(parseStrictArgs(["-f"], init).booleans.force).toBe(true);
    expect(parseStrictArgs(["-e", "vim"], config).strings.editor).toBe("vim");
  });

  test("version --json is declared reserved and works", () => {
    expect(parseStrictArgs(["--json"], version).booleans.json).toBe(true);
  });

  test("undeclared reserved flags fail", () => {
    expect(usage(["--json"], init)).toContain("reserved by bolt and not supported yet");
    expect(usage(["--agent"], init)).toContain("reserved by bolt and not supported yet");
    expect(usage(["--execute"], init)).toContain("reserved by bolt and not supported yet");
  });
});

describe("parseStrictArgs DX", () => {
  const init = specFromCittyArgs("init", { force: { type: "boolean", alias: "f" } });
  const list = specFromCittyArgs("list", {});

  test("lists supported flags and hints --help", () => {
    const msg = usage(["--forse"], init);
    expect(msg).toContain('Did you mean "--force"?');
    expect(msg).toContain("Flags:");
    expect(msg).toContain("--force");
    expect(msg).toContain("Run bolt init --help for details.");
  });

  test("did-you-mean is scoped to this command (no --user from plugin new)", () => {
    const msg = usage(["--user"], init);
    expect(msg).toContain('Unknown flag "--user"');
    expect(msg).not.toMatch(/Did you mean "--user"/);
  });

  test("commands with no flags say so", () => {
    const msg = usage(["--bogus"], list);
    expect(msg).toContain("This command takes no flags");
    expect(formatSupportedFlags(list)).toContain("takes no flags");
  });

  test("unknown short flags fail", () => {
    expect(usage(["-x"], list)).toContain('Unknown flag "-x"');
    expect(usage(["-xyz"], init)).toContain('Unknown flag "-xyz"');
  });

  test("after -- is rejected for non-param commands", () => {
    expect(usage(["--", "x"], list)).toContain('takes no arguments after "--"');
    expect(usage(["--", "--dry-run"], list)).toContain('Bolt flags go before "--"');
  });
});

describe("resolveLeafCommand", () => {
  test("resolves nested plugin new and top-level run", () => {
    const nested = resolveLeafCommand(["plugin", "new", "foo", "--user"], root);
    expect(nested?.path).toEqual(["plugin", "new"]);
    expect(nested?.rest).toEqual(["foo", "--user"]);
    expect(leafAllowsParams(["run"])).toBe(true);
    expect(leafAllowsParams(["inspect"])).toBe(true);
    expect(leafAllowsParams(["list"])).toBe(false);
  });
});

describe("CLI-1 integration via main.ts", () => {
  test("bolt version --json works; bolt --version still prints version", async () => {
    const json = await bolt(["version", "--json"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out).version).toBeTruthy();
    expect(JSON.parse(json.out).capabilities).toBeArray();

    const ver = await bolt(["--version"]);
    expect(ver.code).toBe(0);
    expect(ver.out.trim()).toBe(VERSION);
  });

  test("list/info/check unknown and reserved flags exit 2", async () => {
    for (const cmd of ["list", "info", "check"] as const) {
      const bogus = await bolt([cmd, "--bogus"]);
      expect(bogus.code).toBe(2);
      expect(bogus.err).toContain("Unknown flag");
      const json = await bolt([cmd, "--json"]);
      expect(json.code).toBe(2);
      expect(json.err).toContain("reserved by bolt");
    }
  });

  test("ai --json writes nothing", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-cli1-ai-"));
    writeFileSync(
      path.join(dir, "bolt.yaml"),
      `project:\n  name: t\ntasks:\n  a:\n    - run: echo a\n`,
    );
    const r = await bolt(["ai", "--json"], { cwd: dir });
    expect(r.code).toBe(2);
    expect(r.err).toContain("reserved by bolt");
    expect(existsSync(path.join(dir, ".bolt", "ai-context.md"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("init --forse suggests --force; init --user does not borrow plugin new", async () => {
    const r = await bolt(["init", "--forse"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Did you mean "--force"?');
    const u = await bolt(["init", "--user"]);
    expect(u.code).toBe(2);
    expect(u.err).not.toMatch(/Did you mean "--user"/);
  });

  test("list -- --dry-run hints flags go before --", async () => {
    const r = await bolt(["list", "--", "--dry-run"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Bolt flags go before "--"');
  });

  test("BOLT_LENIENT_FLAGS does not relax strictness", async () => {
    const r = await bolt(["list", "--bogus"], { env: { BOLT_LENIENT_FLAGS: "1" } });
    expect(r.code).toBe(2);
  });

  test("migrate --dry-run is accepted (declared reserved)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-cli1-mig-"));
    // No bolt.yaml: migrate should fail for missing config, not for the flag.
    const r = await bolt(["migrate", "--dry-run"], { cwd: dir });
    expect(r.err + r.out).not.toContain("reserved by bolt");
    expect(r.err + r.out).not.toContain("Unknown flag");
    // exit may be 1/3 for missing config — just not 2 from flags
    if (r.code === 2) {
      // flag parser would say reserved/unknown; other usage is OK
      expect(r.err).not.toMatch(/reserved by bolt|Unknown flag/);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("self-update --version reaches the command (not global --version)", async () => {
    // In bun/dev mode self-update exits 1 saying compiled binary only — but must NOT print VERSION alone.
    const r = await bolt(["self-update", "--version", "v1.2.3"]);
    expect(r.out.trim()).not.toBe(VERSION);
    expect(r.err + r.out).toMatch(/self-update|compiled binary|release|install/i);
  });

  test("generic guard: every registered leaf rejects --definitely-unknown and --agent", async () => {
    type Node = { args?: Record<string, unknown>; subCommands?: Record<string, Node>; meta?: { name?: string } };
    const leaves: string[][] = [];
    const walk = (node: Node, path: string[]) => {
      const subs = node.subCommands ?? {};
      const names = Object.keys(subs);
      if (names.length === 0) {
        if (path.length) leaves.push(path);
        return;
      }
      for (const name of names) walk(subs[name], [...path, name]);
    };
    walk(root as unknown as Node, []);

    expect(leaves.length).toBeGreaterThan(5);
    for (const pathParts of leaves) {
      // plugin new needs a positional; pass a dummy name before the bad flag
      const prefix =
        pathParts.join(" ") === "plugin new" ? [...pathParts, "tmpplug"] : pathParts;
      for (const bad of ["--definitely-unknown", "--agent"] as const) {
        const r = await bolt([...prefix, bad]);
        expect(r.code).toBe(2);
        expect(r.err.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("knownFlagNames scoping", () => {
  test("init known flags do not include user", () => {
    const init = specFromCittyArgs("init", { force: { type: "boolean", alias: "f" } });
    expect(knownFlagNames(init)).toContain("force");
    expect(knownFlagNames(init)).toContain("f");
    expect(knownFlagNames(init)).not.toContain("user");
  });
});
