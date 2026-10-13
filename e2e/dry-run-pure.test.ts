/**
 * BOLT-P0-1: `bolt run --dry-run` and `bolt inspect` are pure. Mirrors the acceptance
 * matrix D-01..D-11: snapshot the project and ~/.bolt before/after, track spawns through
 * marker files (plugin top level, hooks, handlers, local actions, run: steps, a fake `git`
 * on PATH), and, when strace is installed, assert there is no execve besides bolt itself.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  readFileSync,
} from "fs";
import os from "os";
import path from "path";
import { repoRoot } from "./harness";

const posix = process.platform !== "win32";
const entry = path.join(repoRoot, "src/main.ts");
const strace = posix && Bun.which("strace") !== null;

interface Fixture {
  root: string;
  proj: string;
  fresh: string;
  home: string;
  markers: string;
  bin: string;
}

function plugin(dir: string, ns: string, markers: string): void {
  mkdirSync(dir, { recursive: true });
  const m = JSON.stringify(markers);
  writeFileSync(
    path.join(dir, "index.ts"),
    `import { appendFileSync } from "fs";
const mark = (m: string) => appendFileSync(${m} + "/${ns}." + m, m + "\\n");
mark("toplevel");
export default {
  namespace: "${ns}",
  handlers: { hello: async () => { mark("handler"); } },
  onInit: async () => { mark("onInit"); },
  onBeforeStep: async () => { mark("onBeforeStep"); },
  onAfterStep: async () => { mark("onAfterStep"); },
};
`,
  );
  // Runtime dependencies without node_modules: loading would run `bun install`.
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: ns, type: "module", dependencies: { "left-pad": "^1.3.0" } }),
  );
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "bolt-p01-"));
  const f: Fixture = {
    root,
    proj: path.join(root, "proj"),
    fresh: path.join(root, "fresh"),
    home: path.join(root, "home"),
    markers: path.join(root, "markers"),
    bin: path.join(root, "bin"),
  };
  for (const d of [f.proj, f.fresh, f.home, f.markers, f.bin]) mkdirSync(d, { recursive: true });
  const M = f.markers;

  // A fake git on PATH records any spawn (D-07: notifications look up the git branch).
  const realGit = Bun.which("git") ?? "/usr/bin/git";
  writeFileSync(
    path.join(f.bin, "git"),
    `#!/bin/sh\necho "$@" >> ${JSON.stringify(path.join(M, "git.spawned"))}\nexec ${realGit} "$@"\n`,
  );
  chmodSync(path.join(f.bin, "git"), 0o755);

  writeFileSync(
    path.join(f.proj, "bolt.yaml"),
    `version: 1
project:
  name: fx
tasks:
  shell:
    - run: echo shell-step > ${M}/shell.ran
  local:
    - uses: ./local
      with:
        target: editor
  plug:
    - uses: proj/hello
  user:
    - uses: usr/hello
  nested:
    - call: shell
    - uses: ./local
      with:
        target: client
    - run: echo nested
flows:
  all:
    steps: [nested, plug]
notifications:
  providers:
    - type: telegram
      bot_token: t
      chat_id: "1"
`,
  );
  mkdirSync(path.join(f.proj, "local"));
  writeFileSync(path.join(f.proj, "local/action.yaml"), "name: local\n");
  writeFileSync(
    path.join(f.proj, "local/run.sh"),
    `#!/bin/sh\necho "local $BOLT_INPUT_TARGET" >> ${M}/local.ran\n`,
  );
  chmodSync(path.join(f.proj, "local/run.sh"), 0o755);
  plugin(path.join(f.proj, ".bolt/plugins/proj"), "proj", M);
  plugin(path.join(f.home, ".bolt/plugins/usr"), "usr", M);
  Bun.spawnSync([realGit, "init", "-q", "."], { cwd: f.proj });

  writeFileSync(
    path.join(f.fresh, "bolt.yaml"),
    `version: 1\nproject:\n  name: fresh\ntasks:\n  shell:\n    - run: echo hi > ${M}/fresh.ran\n`,
  );
  return f;
}

/** `path size mtime` for every entry under `dir` (skipping .git), sorted. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === ".git") continue;
      const p = path.join(d, name);
      const st = statSync(p);
      out.push(`${path.relative(dir, p)} ${st.isDirectory() ? "dir" : st.size} ${st.mtimeMs}`);
      if (st.isDirectory()) walk(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

interface Outcome {
  exitCode: number;
  output: string;
  changed: string[];
  markers: string[];
  execves: number | undefined;
}

let f: Fixture;
beforeAll(() => {
  f = makeFixture();
});
afterAll(() => {
  rmSync(f.root, { recursive: true, force: true });
});

async function runCase(cwd: string, args: string[]): Promise<Outcome> {
  for (const m of readdirSync(f.markers)) rmSync(path.join(f.markers, m));
  const before = [...snapshot(cwd), ...snapshot(path.join(f.home, ".bolt"))];
  const traceFile = path.join(f.root, "strace.log");
  const bolt = ["bun", entry, ...args];
  const cmd = strace
    ? ["strace", "-f", "-qq", "-e", "trace=execve", "-o", traceFile, ...bolt]
    : bolt;
  const proc = Bun.spawn(cmd, {
    cwd,
    env: {
      ...process.env,
      HOME: f.home,
      USERPROFILE: f.home,
      PATH: `${f.bin}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const after = [...snapshot(cwd), ...snapshot(path.join(f.home, ".bolt"))];
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const changed = [
    ...before.filter((l) => !afterSet.has(l)).map((l) => `- ${l}`),
    ...after.filter((l) => !beforeSet.has(l)).map((l) => `+ ${l}`),
  ];
  let execves: number | undefined;
  if (strace) {
    const lines = readFileSync(traceFile, "utf8").split("\n");
    // Count successful execve calls; the first is bolt (bun) itself.
    execves =
      lines.filter((l) => /execve\(/.test(l) && !/= -1 /.test(l) && !/unfinished/.test(l)).length +
      lines.filter((l) => /<\.\.\. execve resumed>.*= 0/.test(l)).length -
      1;
  }
  return {
    exitCode,
    output: `${stdout}\n${stderr}`,
    changed,
    markers: readdirSync(f.markers).sort(),
    execves,
  };
}

function expectPure(o: Outcome): void {
  expect(o.changed).toEqual([]);
  expect(o.markers).toEqual([]);
  if (o.execves !== undefined) expect(o.execves).toBe(0);
  expect(o.exitCode).toBe(0);
}

// Dry-run and inspect never execute anything, so these run on every platform. Only the
// strace check (inside runCase) is Linux-only.
describe("BOLT-P0-1 dry-run is pure", () => {
  test("D-01 run: steps only: full plan, no writes, no spawns", async () => {
    const o = await runCase(f.proj, ["run", "shell", "--dry-run"]);
    expectPure(o);
    expect(o.output).toContain(`would run: echo shell-step > ${f.markers}/shell.ran`);
    expect(o.output).toContain("Nothing was executed");
    expect(o.output).toContain("--simulate");
  });

  test("D-02 uses: ./local with with: shows would-run and params", async () => {
    const o = await runCase(f.proj, ["run", "local", "--dry-run"]);
    expectPure(o);
    expect(o.output).toContain("would run uses: ./local  target=editor");
    expect(o.output).toContain("would execute ./local/run.sh with BOLT_INPUT_TARGET=editor");
  });

  test("D-03/D-04 project plugin is not imported, compiled, installed, or called", async () => {
    const o = await runCase(f.proj, ["run", "plug", "--dry-run"]);
    expectPure(o);
    expect(existsSync(path.join(f.proj, ".bolt/.cache"))).toBe(false);
    expect(existsSync(path.join(f.proj, ".bolt/plugins/proj/node_modules"))).toBe(false);
    expect(o.output).toContain("would run uses: proj/hello");
    expect(o.output).toContain("project plugin .bolt/plugins/proj: not loaded in dry-run");
  });

  test("D-05 user plugin: ~/.bolt is unchanged", async () => {
    const o = await runCase(f.proj, ["run", "user", "--dry-run"]);
    expectPure(o);
    expect(o.output).toContain("user plugin ~/.bolt/plugins/usr: not loaded in dry-run");
  });

  test("D-06 nested call: matches bolt inspect", async () => {
    const names = ["nested", "plug", "user"];
    const dry = await runCase(f.proj, ["run", ...names, "--dry-run"]);
    expectPure(dry);
    const inspect = await runCase(f.proj, ["inspect", ...names]);
    expectPure(inspect);
    const planLines = (text: string, dryRun: boolean) =>
      text
        .split("\n")
        .filter((l) => /^(>>|\s+(would |call:|run:|uses:))/.test(l))
        .map((l) => (dryRun ? l.replace(/^(\s*)would (run (?=uses:))?/, "$1") : l));
    expect(planLines(inspect.output, false).length).toBeGreaterThan(5);
    expect(planLines(dry.output, true)).toEqual(planLines(inspect.output, false));
  });

  test("D-07 git repo with notifications: git is not spawned", async () => {
    const o = await runCase(f.proj, ["run", "all", "--dry-run"]);
    expectPure(o);
    expect(o.markers).not.toContain("git.spawned");
  });

  test("D-08 first run: no .bolt/ directory is created", async () => {
    const o = await runCase(f.fresh, ["run", "shell", "--dry-run"]);
    expectPure(o);
    expect(existsSync(path.join(f.fresh, ".bolt"))).toBe(false);
  });

  test("D-09 bolt inspect is pure", async () => {
    expectPure(await runCase(f.proj, ["inspect", "all"]));
    expectPure(await runCase(f.fresh, ["inspect", "shell"]));
  });
});

// The positive controls execute shell scripts (run.sh, the git shim): POSIX only.
describe.skipIf(!posix)("BOLT-P0-1 positive controls", () => {
  test("D-10 --simulate is the positive control: writes and hooks are detected", async () => {
    const o = await runCase(f.proj, ["run", "plug", "nested", "--simulate"]);
    expect(o.exitCode).toBe(0);
    expect(o.changed.some((l) => l.includes(".bolt/logs"))).toBe(true);
    expect(o.markers).toEqual(
      expect.arrayContaining([
        "proj.toplevel",
        "proj.onInit",
        "proj.onBeforeStep",
        "proj.handler",
        "proj.onAfterStep",
      ]),
    );
    // run: steps and local actions are still skipped in simulate.
    expect(o.markers).not.toContain("shell.ran");
    expect(o.markers).not.toContain("local.ran");
    if (o.execves !== undefined) expect(o.execves).toBeGreaterThan(0);
  });

  test("D-11 a normal run still runs local actions, shell steps, and writes a log", async () => {
    const o = await runCase(f.proj, ["run", "nested", "plug"]);
    expect(o.exitCode).toBe(0);
    expect(o.markers).toEqual(expect.arrayContaining(["shell.ran", "local.ran", "proj.handler"]));
    expect(o.changed.some((l) => l.includes(".bolt/logs"))).toBe(true);
  });
});

describe("BOLT-P0-1 config errors exit 3", () => {
  const cases: Array<[string, string | undefined, string[]]> = [
    ["missing bolt.yaml", undefined, ["bolt.yaml not found in", "bolt init"]],
    ["unparseable YAML", "version: 1\nproject: [oops\n", ["could not be parsed", "bolt check"]],
    [
      "schema error",
      "version: 1\nproject:\n  name: x\ntasks:\n  a:\n    - nope: 1\n",
      ["bolt.yaml invalid", "bolt check"],
    ],
    [
      "call cycle",
      "version: 1\nproject:\n  name: x\ntasks:\n  a:\n    - call: b\n  b:\n    - call: a\n",
      ["Task call cycle: a -> b -> a", "Fix bolt.yaml"],
    ],
    [
      "legacy task/ reference",
      "version: 1\nproject:\n  name: x\ntasks:\n  a:\n    - uses: task/b\n  b:\n    - run: echo b\n",
      ['replace with "call: b"'],
    ],
  ];
  for (const [label, yaml, messages] of cases) {
    for (const args of [
      ["run", "a"],
      ["run", "a", "--dry-run"],
      ["inspect", "a"],
    ]) {
      test(`${label}: bolt ${args.join(" ")} exits 3 and writes nothing`, async () => {
        const dir = mkdtempSync(path.join(f.root, "cfg-"));
        if (yaml !== undefined) writeFileSync(path.join(dir, "bolt.yaml"), yaml);
        const o = await runCase(dir, args);
        expect(o.exitCode).toBe(3);
        for (const m of messages) expect(o.output).toContain(m);
        expect(o.changed).toEqual([]);
        expect(o.markers).toEqual([]);
      });
    }
  }

  test("dry-run config problems (bad built-in param, unknown op, missing script) exit 3", async () => {
    const dir = mkdtempSync(path.join(f.root, "cfg-"));
    writeFileSync(
      path.join(dir, "bolt.yaml"),
      "version: 1\nproject:\n  name: x\ntasks:\n  a:\n    - uses: fs/copy\n      with:\n        src: a\n        dest: b\n  b:\n    - uses: fs/nope\n  c:\n    - uses: ./missing\n",
    );
    for (const t of ["a", "b", "c"]) {
      const o = await runCase(dir, ["run", t, "--dry-run"]);
      expect(o.exitCode).toBe(3);
      expect(o.changed).toEqual([]);
    }
    const typo = await runCase(dir, ["run", "a", "--dry-run"]);
    expect(typo.output).toContain('missing param "dst" (you passed "dest"; did you mean "dst"?)');
  });

  test("--simulate with a bad built-in param names it once, without a native error", async () => {
    const dir = mkdtempSync(path.join(f.root, "cfg-"));
    writeFileSync(
      path.join(dir, "bolt.yaml"),
      "version: 1\nproject:\n  name: x\ntasks:\n  a:\n    - uses: fs/copy\n      with:\n        src: a\n        dest: b\n",
    );
    const o = await runCase(dir, ["run", "a", "--simulate"]);
    expect(o.exitCode).toBe(1);
    expect(o.output).not.toContain("paths[1]");
    expect(o.output.split('Invalid params for "fs/copy"').length - 1).toBe(1);
    expect(o.output).toContain("Fix the step's with: in bolt.yaml.");
  });

  test("migrate and config exit 3 when bolt.yaml is missing", async () => {
    const dir = mkdtempSync(path.join(f.root, "cfg-"));
    for (const args of [["migrate"], ["config"]]) {
      const o = await runCase(dir, args);
      expect(o.exitCode).toBe(3);
      expect(o.output).toContain("bolt.yaml not found in");
    }
  });

  test("bolt list / check also exit 3 on a config error", async () => {
    const dir = mkdtempSync(path.join(f.root, "cfg-"));
    writeFileSync(path.join(dir, "bolt.yaml"), "version: 1\nproject: [oops\n");
    expect((await runCase(dir, ["list"])).exitCode).toBe(3);
    expect((await runCase(dir, ["check"])).exitCode).toBe(3);
  });

  // chmod 000 does not make a file unreadable on Windows or for root.
  test.skipIf(!posix || process.getuid?.() === 0)("an unreadable bolt.yaml exits 3", async () => {
    const dir = mkdtempSync(path.join(f.root, "cfg-"));
    writeFileSync(path.join(dir, "bolt.yaml"), "version: 1\nproject:\n  name: x\ntasks: {}\n");
    chmodSync(path.join(dir, "bolt.yaml"), 0o000);
    const o = await runCase(dir, ["run", "a", "--dry-run"]);
    const check = await runCase(dir, ["check"]);
    chmodSync(path.join(dir, "bolt.yaml"), 0o644);
    expect(o.exitCode).toBe(3);
    expect(o.output).toContain("Permission denied reading");
    expect(o.output).toContain("Check the file permissions");
    expect(check.exitCode).toBe(3);
    expect(check.output).toContain("Check the file permissions");
  });

  test("a native handler error names the task and step, and is printed once", async () => {
    const dir = mkdtempSync(path.join(f.root, "cfg-"));
    mkdirSync(path.join(dir, ".bolt/plugins/boom"), { recursive: true });
    writeFileSync(
      path.join(dir, ".bolt/plugins/boom/index.js"),
      'import { readFileSync } from "fs";\nexport default { namespace: "boom", handlers: { go: async () => { readFileSync("no-such-file.txt"); } } };\n',
    );
    writeFileSync(
      path.join(dir, "bolt.yaml"),
      "version: 1\nproject:\n  name: x\ntasks:\n  outer:\n    - call: inner\n  inner:\n    - uses: boom/go\n",
    );
    for (const args of [
      ["run", "outer", "--simulate"],
      ["run", "outer"],
    ]) {
      const o = await runCase(dir, args);
      expect(o.exitCode).toBe(1);
      const lines = o.output.split("\n").filter((l) => l.includes("no-such-file.txt"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("outer > inner > boom/go: ENOENT");
    }
  });

  test("a usage error still exits 2 and a task failure exits 1", async () => {
    const dir = mkdtempSync(path.join(f.root, "cfg-"));
    writeFileSync(
      path.join(dir, "bolt.yaml"),
      "version: 1\nproject:\n  name: x\ntasks:\n  a:\n    - run: exit 7\n",
    );
    expect((await runCase(dir, ["run", "nope", "--dry-run"])).exitCode).toBe(2);
    expect((await runCase(dir, ["run", "a"])).exitCode).toBe(1);
  });
});
