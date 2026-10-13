import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import {
  bolt,
  callsMatching,
  dispose,
  findCall,
  git,
  installEngine,
  makeProject,
  placeTargetBinary,
  readCalls,
  slash,
  writeBolt,
} from "./harness";
import type { EngineLayout } from "./harness";

function tool(log: string, fragment: string, cwd: string) {
  const call = findCall(log, fragment);
  expect(slash(call.cwd)).toBe(slash(cwd));
  return call;
}

test("ue/build editor and client pass target, config, and project to Build and UnrealBuildTool", async () => {
  const project = makeProject();
  try {
    const editor = await bolt(project.dir, ["run", "build-editor", "--config=debug"]);
    expect(editor.exitCode).toBe(0);
    const build = tool(editor.log, "Engine/Build/BatchFiles/Build.", project.dir);
    expect(build.argv).toContain("-Target=SampleEditor Win64 Debug");
    expect(build.argv).toContain("-Target=ShaderCompileWorker Win64 Development -Quiet");
    expect(build.argv.some((arg) => arg.includes("Sample.uproject"))).toBe(true);
    expect(build.argv).toContain("-WaitMutex");
    expect(slash(build.tool)).toContain(
      slash(path.join(project.engine, "Engine/Build/BatchFiles/Build.bat")),
    );
    const ubt = tool(editor.log, "UnrealBuildTool", project.dir);
    expect(ubt.argv).toContain("-Target=SampleEditor Win64 Debug");
    expect(ubt.exit).toBe(0);
    expect(editor.output).toContain("Result: Succeeded");

    const client = await bolt(project.dir, ["run", "build-client"]);
    expect(client.exitCode).toBe(0);
    const clientBuild = tool(client.log, "Engine/Build/BatchFiles/Build.", project.dir);
    expect(clientBuild.argv).toContain("SampleClient");
    expect(clientBuild.argv).toContain("Win64");
    expect(clientBuild.argv).toContain("Shipping");
    expect(
      clientBuild.argv.some((arg) => arg.includes("SampleClient") && arg.includes("Win64")),
    ).toBe(false);
    expect(clientBuild.argv.some((arg) => arg.includes("Sample.uproject"))).toBe(true);
    expect(clientBuild.argv).not.toContain("-Target=ShaderCompileWorker Win64 Development -Quiet");
  } finally {
    dispose(project.dir);
  }
});

test("ue/build_program and a failing Build.bat exit", async () => {
  const project = makeProject();
  try {
    const program = await bolt(project.dir, ["run", "build-program"]);
    expect(program.exitCode).toBe(0);
    const programBuild = tool(program.log, "Engine/Build/BatchFiles/Build.", project.dir);
    expect(programBuild.argv).toContain("CustomProgram");
    expect(programBuild.argv).toContain("Win64");
    expect(programBuild.argv).toContain("Development");
    expect(
      programBuild.argv.some(
        (arg) => arg.startsWith("-project=") && arg.includes("Sample.uproject"),
      ),
    ).toBe(true);
    expect(programBuild.argv).toContain("-FromMsBuild");

    const failed = await bolt(project.dir, ["run", "build-editor"], { BOLT_FAKE_FAIL: "Build" });
    expect(failed.exitCode).not.toBe(0);
    expect(failed.output).toContain("Result: Failed");
    expect(findCall(failed.log, "Engine/Build/BatchFiles/Build.").exit).toBe(6);
    expect(callsMatching(failed.log, "UnrealBuildTool")).toHaveLength(0);
  } finally {
    dispose(project.dir);
  }
});

test("engine build runs Setup, GenerateProjectFiles, and Build", async () => {
  const project = makeProject();
  try {
    const result = await bolt(project.dir, ["run", "build-engine"]);
    expect(result.exitCode).toBe(0);
    const setup = tool(result.log, "/Setup.", project.dir);
    expect(setup.argv).toContain("--force");
    expect(slash(setup.tool)).toContain(slash(path.join(project.engine, "Setup.bat")));
    const generated = callsMatching(result.log, "GenerateProjectFiles").filter(
      (call) => !slash(call.tool).includes("BatchFiles"),
    );
    expect(generated).toHaveLength(1);
    const build = tool(result.log, "Engine/Build/BatchFiles/Build.", project.dir);
    expect(build.argv).toContain("-Target=UE4Editor Win64 Development");
    expect(build.argv).toContain("-Target=ShaderCompileWorker Win64 Development -Quiet");
    expect(tool(result.log, "UnrealBuildTool", project.dir).exit).toBe(0);
  } finally {
    dispose(project.dir);
  }
});

const ue5Layouts: Array<{ name: string; layout: EngineLayout }> = [
  { name: "Build.version 5", layout: { major: 5 } },
  { name: "UnrealEditor binaries only", layout: { major: 5, buildVersion: false } },
];

for (const { name, layout } of ue5Layouts) {
  test(`UE5 engine (${name}) builds, fills DDC, and starts UnrealEditor`, async () => {
    const project = makeProject({ engine: layout });
    try {
      expect(existsSync(path.join(project.engine, "Engine/Binaries/Win64/UE4Editor.exe"))).toBe(
        false,
      );
      const built = await bolt(project.dir, ["run", "build-engine"]);
      expect(built.exitCode).toBe(0);
      const build = tool(built.log, "Engine/Build/BatchFiles/Build.", project.dir);
      expect(build.argv).toContain("-Target=UnrealEditor Win64 Development");
      expect(build.argv.some((arg) => arg.includes("UE4Editor"))).toBe(false);
      const ubt = tool(built.log, "UnrealBuildTool/UnrealBuildTool", project.dir);
      expect(ubt.exit).toBe(0);

      const filled = await bolt(project.dir, ["run", "fill"]);
      expect(filled.exitCode).toBe(0);
      const editor = tool(filled.log, "UnrealEditor-Cmd.exe", project.dir);
      expect(editor.argv.some((arg) => arg.includes("FillDDCForPIETest"))).toBe(true);
      expect(callsMatching(filled.log, "UE4Editor")).toHaveLength(0);

      const started = await bolt(project.dir, ["run", "start"]);
      expect(started.exitCode).toBe(0);
      const cmd = tool(started.log, "/cmd", project.dir);
      expect(cmd.argv.some((arg) => slash(arg).endsWith("UnrealEditor.exe"))).toBe(true);

      const info = await bolt(project.dir, ["run", "info"]);
      expect(info.output).toContain("Engine: UE5, editor UnrealEditor");
    } finally {
      dispose(project.dir);
    }
  });
}

test("engine.version and editor_target override the detected engine", async () => {
  const pinned = makeProject({ engine: { major: 5 }, engineConfig: "        version: 4\n" });
  try {
    const built = await bolt(pinned.dir, ["run", "build-engine"]);
    expect(built.exitCode).toBe(0);
    const build = tool(built.log, "Engine/Build/BatchFiles/Build.", pinned.dir);
    expect(build.argv).toContain("-Target=UE4Editor Win64 Development");
    // The UE5 tree has no UE4Editor-Cmd.exe, so the pinned version is really used.
    const filled = await bolt(pinned.dir, ["run", "fill"]);
    expect(filled.exitCode).not.toBe(0);
    expect(callsMatching(filled.log, "UnrealEditor")).toHaveLength(0);
  } finally {
    dispose(pinned.dir);
  }

  const named = makeProject({
    engine: { major: 4 },
    ueConfig: "      editor_target: UnrealEditor\n",
  });
  try {
    const built = await bolt(named.dir, ["run", "build-engine"]);
    expect(built.exitCode).toBe(0);
    const build = tool(built.log, "Engine/Build/BatchFiles/Build.", named.dir);
    expect(build.argv).toContain("-Target=UnrealEditor Win64 Development");
  } finally {
    dispose(named.dir);
  }
});

test("a UE4 tree without Build.version is detected from UE4Editor binaries", async () => {
  const project = makeProject({ engine: { major: 4, buildVersion: false } });
  try {
    const filled = await bolt(project.dir, ["run", "fill"]);
    expect(filled.exitCode).toBe(0);
    expect(tool(filled.log, "UE4Editor-Cmd.exe", project.dir).exit).toBe(0);
    const info = await bolt(project.dir, ["run", "info"]);
    expect(info.output).toContain("Engine: UE4, editor UE4Editor (from binaries)");
  } finally {
    dispose(project.dir);
  }
});

test("generate_project, fillddc, start, and kill hit the fake tools", async () => {
  const project = makeProject();
  try {
    const generated = await bolt(project.dir, ["run", "gen"]);
    expect(generated.exitCode).toBe(0);
    const gen = tool(generated.log, "BatchFiles/GenerateProjectFiles.", project.dir);
    expect(gen.argv.some((arg) => arg.includes("Sample.uproject"))).toBe(true);
    expect(gen.argv).toContain("-Game");

    const filled = await bolt(project.dir, ["run", "fill"]);
    expect(filled.exitCode).toBe(0);
    const editor = tool(filled.log, "UE4Editor-Cmd.exe", project.dir);
    expect(editor.argv.some((arg) => arg.includes("Sample.uproject"))).toBe(true);
    expect(editor.argv.some((arg) => arg.includes("FillDDCForPIETest"))).toBe(true);
    expect(editor.argv).toContain("-unattended");
    expect(editor.argv).toContain("-nullrhi");
    expect(editor.exit).toBe(0);
    expect(filled.output).toContain("Automation Test Queue Empty");
    expect(callsMatching(filled.log, "UnrealEditor-Cmd.")).toHaveLength(0);

    const started = await bolt(project.dir, ["run", "start"]);
    expect(started.exitCode).toBe(0);
    const cmd = tool(started.log, "/cmd", project.dir);
    expect(cmd.exit).toBe(0);
    expect(cmd.argv[0]).toBe("/c");
    expect(cmd.argv[1]).toBe("start");
    expect(cmd.argv.some((arg) => slash(arg).endsWith("UE4Editor.exe"))).toBe(true);
    expect(cmd.argv.some((arg) => arg.includes("Sample.uproject"))).toBe(true);

    const binary = placeTargetBinary(project, "SampleEditor");
    const named = await bolt(project.dir, ["run", "start-named"]);
    expect(named.exitCode).toBe(0);
    const namedCmd = tool(named.log, "/cmd", project.dir);
    expect(namedCmd.exit).toBe(0);
    expect(namedCmd.argv.some((arg) => slash(arg) === slash(binary))).toBe(true);

    const killed = await bolt(project.dir, ["run", "kill"]);
    expect(killed.exitCode).toBe(0);
    const kills = callsMatching(killed.log, "taskkill");
    expect(kills).toHaveLength(7);
    for (const call of kills) {
      expect(slash(call.cwd)).toBe(slash(project.dir));
      expect(call.exit).toBe(0);
      expect(call.argv[0]).toBe("/f");
      expect(call.argv[1]).toBe("/im");
    }
    expect(kills.some((call) => call.argv[2] === "UnrealEditor-Cmd.exe")).toBe(true);
    expect(kills.some((call) => call.argv[2] === "UnrealEditor-Win64-Debug.exe")).toBe(true);
  } finally {
    dispose(project.dir);
  }
});

test("dry-run logs the build command and does not execute fakes or copy files", async () => {
  const project = makeProject();
  try {
    const result = await bolt(project.dir, ["run", "build-editor", "copy", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(readCalls(result.log)).toHaveLength(0);
    expect(result.output).toContain("SampleEditor");
    expect(result.output).toContain("Build.");
    expect(result.output).toContain("[dry-run]");
    expect(result.output).not.toContain("Result: Succeeded");
    expect(existsSync(path.join(project.dir, "out/hello.txt"))).toBe(false);
  } finally {
    dispose(project.dir);
  }
});

test("git pull against a local bare remote updates the engine checkout", async () => {
  const project = makeProject({ git: false });
  try {
    const { rmSync } = await import("fs");
    rmSync(project.engine, { recursive: true, force: true });
    const bare = path.join(project.dir, "origin.git");
    const seed = path.join(project.dir, "seed");
    git(project.dir, ["init", "--bare", "-b", "main", bare]);
    git(project.dir, ["clone", bare, "seed"]);
    writeFileSync(path.join(seed, "README.txt"), "v1\n");
    git(seed, ["add", "README.txt"]);
    git(seed, ["commit", "-m", "v1"]);
    git(seed, ["push", "origin", "HEAD:main"]);
    git(project.dir, ["clone", bare, "engine"]);
    installEngine(project.engine);
    writeFileSync(path.join(seed, "README.txt"), "v2\n");
    git(seed, ["add", "README.txt"]);
    git(seed, ["commit", "-m", "v2"]);
    git(seed, ["push", "origin", "HEAD:main"]);

    const pulled = await bolt(project.dir, ["run", "update-engine"]);
    expect(pulled.exitCode).toBe(0);
    expect(pulled.output).toContain("git");
    expect(readFileSync(path.join(project.engine, "README.txt"), "utf8")).toBe("v2\n");

    const dest = path.join(project.dir, "cloned");
    writeBolt(
      project.dir,
      `tasks:
  clone:
    - uses: git/clone
      with: { url: "${slash(bare)}", path: "${slash(dest)}" }
  status:
    - uses: git/status
      with: { path: "${slash(dest)}" }
  info:
    - uses: git/info
      with: { path: "${slash(dest)}" }
  checkout:
    - uses: git/checkout
      with: { path: "${slash(project.engine)}", branch: main }
`,
    );
    const cloned = await bolt(project.dir, ["run", "clone", "status", "info", "checkout"]);
    expect(cloned.exitCode).toBe(0);
    expect(readFileSync(path.join(dest, "README.txt"), "utf8")).toBe("v2\n");
    expect(cloned.output).toContain("Git branch: main");
  } finally {
    dispose(project.dir);
  }
});

test("svn shims and TortoiseProc record the handler arguments", async () => {
  const project = makeProject();
  try {
    const updated = await bolt(project.dir, ["run", "update-project", "svn-info", "svn-commit"]);
    expect(updated.exitCode).toBe(0);
    const update = callsMatching(updated.log, "/svn").find((call) => call.argv[0] === "update");
    expect(update).toBeDefined();
    expect(slash(update?.cwd ?? "")).toBe(slash(project.dir));
    expect(update?.argv).toContain("--non-interactive");
    expect(update?.argv.some((arg) => slash(arg) === slash(project.dir))).toBe(true);
    expect(updated.output).toContain("URL: file:///bolt-e2e/svn");
    expect(updated.output).toContain("Revision: 1");
    const commit = callsMatching(updated.log, "/svn").find((call) => call.argv[0] === "commit");
    expect(commit?.argv).toContain("e2e");

    const cleaned = await bolt(project.dir, ["run", "svn-cleanup", "svn-revert"]);
    expect(cleaned.exitCode).toBe(0);
    expect(callsMatching(cleaned.log, "/svn").some((call) => call.argv[0] === "cleanup")).toBe(
      true,
    );
    expect(callsMatching(cleaned.log, "/svn").some((call) => call.argv.includes("-R"))).toBe(true);
    expect(callsMatching(cleaned.log, "TortoiseProc")).toHaveLength(0);
  } finally {
    dispose(project.dir);
  }

  const tortoise = makeProject({ tortoise: true });
  try {
    const result = await bolt(tortoise.dir, ["run", "ue-cleanup"]);
    expect(result.exitCode).toBe(0);
    const proc = tool(result.log, "TortoiseProc", tortoise.dir);
    expect(proc.argv).toContain("/command:cleanup");
    expect(proc.argv).toContain("/noui");
    expect(proc.argv.some((arg) => slash(arg).includes(slash(tortoise.dir)))).toBe(true);
    const where = tool(result.log, "where", tortoise.dir);
    expect(where.argv).toContain("TortoiseProc.exe");
  } finally {
    dispose(tortoise.dir);
  }
});

test("fs, json, path guard, ue-ini, and fix_dll", async () => {
  const project = makeProject();
  try {
    const files = await bolt(project.dir, ["run", "mkdir", "copy", "json-set", "json-merge"]);
    expect(files.exitCode).toBe(0);
    expect(existsSync(path.join(project.dir, "nested/dir"))).toBe(true);
    expect(readFileSync(path.join(project.dir, "out/hello.txt"), "utf8")).toBe("hello\n");
    const data = JSON.parse(readFileSync(path.join(project.dir, "data.json"), "utf8"));
    expect(data.a.b).toBe("next");
    expect(data.keep).toBe(2);
    expect(data.extra).toBe(true);

    const moved = await bolt(project.dir, ["run", "move", "delete"]);
    expect(moved.exitCode).toBe(0);
    expect(existsSync(path.join(project.dir, "out/moved.txt"))).toBe(false);
    expect(existsSync(path.join(project.dir, "out/hello.txt"))).toBe(false);

    const ini = await bolt(project.dir, [
      "run",
      "ini-set",
      "ini-get",
      "ini-remove",
      "ini-override",
      "ini-read",
    ]);
    expect(ini.exitCode).toBe(0);
    expect(ini.output).toContain("2");
    const iniText = readFileSync(path.join(project.dir, "Config/DefaultEngine.ini"), "utf8");
    expect(iniText).toContain("Bar=2");
    expect(iniText).not.toContain("Foo=1");
    expect(iniText).toContain("Foo=9");
    expect(ini.output).toContain("[Core.System]");

    const fixed = await bolt(project.dir, ["run", "fix-dll"]);
    expect(fixed.exitCode).toBe(0);
    expect(existsSync(path.join(project.engine, "Engine/Binaries/Win64/Zero.dll"))).toBe(false);
    expect(existsSync(path.join(project.dir, ".bolt/trash-dlls/Zero.dll"))).toBe(true);
  } finally {
    dispose(project.dir);
  }

  const outside = mkdtempSync(path.join(os.tmpdir(), "bolt-e2e-outside-"));
  const sentinel = path.join(outside, "sentinel.txt");
  const outsideJson = path.join(outside, "data.json");
  writeFileSync(sentinel, "sentinel\n");
  writeFileSync(outsideJson, "{}\n");
  const escape = makeProject();
  const rel = (target: string) => JSON.stringify(slash(path.relative(escape.dir, target)));
  writeBolt(
    escape.dir,
    `tasks:
  escape:
    - uses: fs/copy
      with: { src: ${rel(sentinel)}, dst: out/x.txt }
  bad-json:
    - uses: json/set
      with: { file: ${rel(outsideJson)}, key: a, value: "1" }
  proto:
    - uses: json/set
      with: { file: data.json, key: __proto__, value: "1" }
`,
  );
  try {
    const before = readFileSync(sentinel, "utf8");
    const copied = await bolt(escape.dir, ["run", "escape"]);
    expect(copied.exitCode).not.toBe(0);
    expect(copied.output).toContain("escapes project root");
    expect(readFileSync(sentinel, "utf8")).toBe(before);
    expect(existsSync(path.join(escape.dir, "out/x.txt"))).toBe(false);

    const jsonBefore = readFileSync(outsideJson, "utf8");
    const patched = await bolt(escape.dir, ["run", "bad-json"]);
    expect(patched.exitCode).not.toBe(0);
    expect(patched.output).toContain("escapes project root");
    expect(readFileSync(outsideJson, "utf8")).toBe(jsonBefore);

    const dataBefore = readFileSync(path.join(escape.dir, "data.json"), "utf8");
    const proto = await bolt(escape.dir, ["run", "proto"]);
    expect(proto.exitCode).not.toBe(0);
    expect(readFileSync(path.join(escape.dir, "data.json"), "utf8")).toBe(dataBefore);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    dispose(escape.dir);
  }
});

test("notifications post to a local webhook", async () => {
  const hits: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      hits.push(await req.json());
      return new Response("ok");
    },
  });
  const project = makeProject({
    notifications: `notifications:\n  providers:\n    - type: wecom\n      webhook_url: http://127.0.0.1:${server.port}/hook\n`,
    tasks: `tasks:\n  ping:\n    - run: bun -e "process.stdout.write('pong')"\n`,
  });
  try {
    const result = await bolt(project.dir, ["run", "ping"]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("pong");
    const body = JSON.stringify(hits);
    expect(body).toContain("Started");
    expect(body).toContain("Complete");
    expect(body).toContain("Sample");
  } finally {
    server.stop(true);
    dispose(project.dir);
  }
});

test("flows fail fast, continue_on_fail, and a task/flow name collision", async () => {
  const flows = makeProject({
    tasks: `tasks:
  boom:
    - run: bun -e "process.exit(1)"
  after:
    - run: bun -e "require('fs').writeFileSync('marker.txt','after')"
flows:
  halt:
    steps: [boom, after]
  keep:
    steps: [boom, after]
    continue_on_fail: [boom]
`,
  });
  try {
    const halted = await bolt(flows.dir, ["run", "halt"]);
    expect(halted.exitCode).not.toBe(0);
    expect(existsSync(path.join(flows.dir, "marker.txt"))).toBe(false);
    const kept = await bolt(flows.dir, ["run", "keep"]);
    expect(kept.exitCode).toBe(0);
    expect(readFileSync(path.join(flows.dir, "marker.txt"), "utf8")).toBe("after");
  } finally {
    dispose(flows.dir);
  }

  const collision = makeProject({
    tasks: `tasks:
  ship:
    - run: bun -e "require('fs').writeFileSync('marker.txt','task')"
  via:
    - run: bun -e "require('fs').writeFileSync('marker.txt','flow')"
flows:
  ship:
    description: flow wins when the only name is both a task and a flow
    steps: [via]
`,
  });
  try {
    const result = await bolt(collision.dir, ["run", "ship"]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Flow: ship");
    expect(readFileSync(path.join(collision.dir, "marker.txt"), "utf8")).toBe("flow");
  } finally {
    dispose(collision.dir);
  }
});

test("plugin load failure, bolt check, and bolt ai", async () => {
  const broken = makeProject({
    extraPlugins: "  - namespace: broken\n    path: ./broken/index.ts\n",
    tasks: `tasks:\n  ping:\n    - uses: fs/mkdir\n      with: { path: nested }\n`,
  });
  try {
    mkdirSync(path.join(broken.dir, "broken"));
    writeFileSync(
      path.join(broken.dir, "broken/index.ts"),
      `throw new Error("plugin exploded");\n`,
    );
    const result = await bolt(broken.dir, ["run", "ping"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain('Failed to load plugin "broken"');
    expect(result.output).toContain("plugin exploded");
  } finally {
    dispose(broken.dir);
  }

  const project = makeProject();
  try {
    const ok = await bolt(project.dir, ["check"]);
    expect(ok.exitCode).toBe(0);
    expect(ok.output).toContain("valid");

    const yamlPath = path.join(project.dir, "bolt.yaml");
    const original = readFileSync(yamlPath, "utf8");
    writeFileSync(yamlPath, original.replace("version: 1", "version: 2"));
    const bad = await bolt(project.dir, ["check"]);
    expect(bad.exitCode).not.toBe(0);
    expect(bad.output).toContain("config version must be 1");
    writeFileSync(
      yamlPath,
      `version: 1\nproject:\n  name: Sample\ntasks:\n  build:\n    - uses: ue/build\n      with: { target: editor }\n`,
    );
    const missing = await bolt(project.dir, ["check"]);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.output).toContain("ue metadata is required");

    mkdirSync(path.join(project.dir, "echo"));
    writeFileSync(
      path.join(project.dir, "echo/index.ts"),
      `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: "echo",
  version: "0.0.1",
  description: "Echo fixture",
  handlers: {
    ping: defineHandler({ description: "Say ping", ai: true }, async () => {}),
  },
});
`,
    );
    writeBolt(project.dir, `tasks:\n  ping:\n    - uses: echo/ping\n`, {
      extraPlugins: "  - namespace: echo\n    path: ./echo/index.ts\n",
    });
    const ai = await bolt(project.dir, ["ai", "--stdout"]);
    expect(ai.exitCode).toBe(0);
    expect(ai.output).toContain("# Bolt — Sample");
    expect(ai.output).toContain("## Plugins");
    expect(ai.output).toContain("### `echo`");
    expect(ai.output).toContain("Say ping");
    expect(ai.output).toContain("**editor**: editor · development");
    expect(ai.output).toContain("**client**: program · SampleClient · shipping");
  } finally {
    dispose(project.dir);
  }
});

test("run rejects unknown flags, valued boolean flags and --prefixed values (exit 2, nothing runs)", async () => {
  const project = makeProject({
    tasks: `tasks:
  mark:
    - run: echo "\${{ params.extra }}" > marker.txt
`,
  });
  const marker = path.join(project.dir, "marker.txt");
  try {
    const cases: Array<[string[], string]> = [
      [["run", "mark", "--dryrun"], 'Did you mean "--dry-run"?'],
      [["run", "mark", "-x"], 'Unknown flag "-x"'],
      [["run", "mark", "--dry-run=false"], "does not take a value"],
      [["run", "mark", "--extra=--dry-run"], "-- extra=--dry-run"],
      [["run", "mark", "--", "--execute"], "Malformed param"],
      [["inspect", "mark", "--bogus"], 'Unknown flag "--bogus" for "bolt inspect"'],
      [["--dry-run", "run", "mark"], 'Unknown global flag "--dry-run"'],
      [["--verison"], 'Did you mean "--version"?'],
      [["-x", "run", "mark"], 'Unknown global flag "-x"'],
      [
        ["run", "mark", "--plan=x"],
        "--plan is reserved by bolt and not supported yet. If this is a task param",
      ],
      [["run", "mark", "--json=v1"], "--json is reserved by bolt and not supported yet"],
      [["run", "mark", "--help=1"], "--help takes no value. Use: bolt run --help"],
      [
        ["run", "mark", "--", "help=x"],
        '"help" cannot be used as a param name (it is a bolt flag). Rename the param, e.g. in bolt.yaml use my_help and pass -- my_help=x.',
      ],
      [["inspect", "mark", "--", "dry-run=1"], "already a side-effect-free preview"],
      [["run", "mark", "--execute"], "--execute is reserved by bolt and not supported yet"],
      [["run", "mark", "--", "plan=x"], "in bolt.yaml use my_plan and pass -- my_plan=x"],
      [["run", "mark", "--", "dry-run=false"], "pass -- my_dry_run=false"],
      [["inspect", "mark", "--json"], "--json is reserved by bolt and not supported yet"],
      [["--version=1"], "--version takes no value. Use: bolt --version"],
      [["--version", "run", "mark"], "--version must be used on its own. Use: bolt --version"],
    ];
    for (const [args, message] of cases) {
      const result = await bolt(project.dir, args);
      expect(result.exitCode).toBe(2);
      expect(result.output).toContain(message);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(path.join(project.dir, ".bolt"))).toBe(false);
    }

    for (const args of [
      ["--help", "--version"],
      ["--version", "--help"],
      ["-h", "--version", "run", "mark"],
    ]) {
      const help = await bolt(project.dir, args);
      expect(help.exitCode).toBe(0);
      expect(help.output).toContain("USAGE");
      expect(existsSync(marker)).toBe(false);
    }

    const passthrough = await bolt(project.dir, ["run", "mark", "--", "extra=--verbose"]);
    expect(passthrough.exitCode).toBe(0);
    expect(readFileSync(marker, "utf8").replace(/"/g, "").trim()).toBe("--verbose");

    const param = await bolt(project.dir, ["run", "mark", "--extra=plain"]);
    expect(param.exitCode).toBe(0);
    expect(readFileSync(marker, "utf8").replace(/"/g, "").trim()).toBe("plain");
  } finally {
    dispose(project.dir);
  }
});

test("DX-1: suggest commands and tasks, clear usage, no script path (exit 2, nothing runs)", async () => {
  const project = makeProject({
    tasks: `tasks:
  mark:
    - run: echo "\${{ params.extra }}" > marker.txt
  build:
    - run: echo build > marker.txt
`,
  });
  const marker = path.join(project.dir, "marker.txt");
  try {
    const cases: Array<[string[], string[], string[]]> = [
      [
        ["rn", "mark"],
        ['Unknown command "rn". Did you mean "run"?', "Commands: run, list"],
        ["USAGE"],
      ],
      [["inspec", "mark"], ['Unknown command "inspec". Did you mean "inspect"?'], ["USAGE"]],
      [["plugin", "nw"], ['Unknown command "nw". Did you mean "new"?'], ["USAGE"]],
      [["run", "mrk"], ['Unknown task "mrk". Did you mean "mark"?', "Tasks: "], ["case-sensitive"]],
      [["inspect", "mrk"], ['Unknown task "mrk". Did you mean "mark"?'], ["case-sensitive"]],
      [
        ["run", "Mark"],
        ['Unknown task "Mark". Did you mean "mark"? Task names are case-sensitive.', "Tasks: "],
        [],
      ],
      [["run"], ["Usage: bolt run <task...|flow>", "Example: bolt run "], ["build start"]],
      [["inspect"], ["Usage: bolt inspect <task...|flow>"], []],
      [["run", "mark", "--", "dry-run=false"], ["To run for real, just remove --dry-run"], []],
      [["run", "mark", "--dry-run=false"], ["To run for real, just remove --dry-run"], []],
      [["run", "mark", "--", "plan=yes please"], ['pass -- my_plan="yes please"'], ["build_"]],
      [["inspect", "mark", "--dry-run"], ["already a side-effect-free preview"], []],
      [["inspect", "mark", "--dry-run=1"], ["already a side-effect-free preview"], []],
      [["run", "mark", "--help=1"], ["--help takes no value. Use: bolt run --help"], []],
      [["--verison"], ['Did you mean "--version"?'], []],
      [["plugin"], ["No command specified.", "Commands: new, list"], ["USAGE"]],
      [["help"], ['Did you mean "bolt --help"?'], ["USAGE"]],
      [["update"], ['Did you mean "bolt self-update"?'], ["USAGE"]],
      [["mark"], ['Did you mean "bolt run mark"?'], ["USAGE"]],
      [
        ["run", "zz", "mrk"],
        ['[ERROR] Unknown task "zz".', '[ERROR] Unknown task "mrk". Did you mean "mark"?'],
        ["[ERROR]   Tasks", "[ERROR]   Flows", "[ERROR]   Run bolt list"],
      ],
      [["run", "mrak"], ['Unknown task "mrak". Did you mean "mark"?'], ["case-sensitive"]],
      [["run", "buidl"], ['Unknown task "buidl". Did you mean "build"?'], ["case-sensitive"]],
      [
        ["run", "Build"],
        ['Unknown task "Build". Did you mean "build"? Task names are case-sensitive.'],
        ["build-editor"],
      ],
    ];
    for (const [args, wanted, unwanted] of cases) {
      const result = await bolt(project.dir, args);
      expect(result.exitCode).toBe(2);
      for (const text of wanted) expect(result.output).toContain(text);
      for (const text of unwanted) expect(result.output).not.toContain(text);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(path.join(project.dir, ".bolt"))).toBe(false);
    }

    const outside = await bolt(path.dirname(project.dir), ["run"]);
    expect(outside.exitCode).toBe(2);
    expect(outside.output).toContain("bolt list");

    for (const [args, usage] of [
      [["run", "--help"], "USAGE bolt run"],
      [["inspect", "--help"], "USAGE bolt inspect"],
      [["plugin", "new", "--help"], "USAGE bolt plugin new"],
    ] as Array<[string[], string]>) {
      const help = await bolt(project.dir, args);
      expect(help.exitCode).toBe(0);
      expect(help.output).toContain(usage);
      expect(help.output).not.toContain("main.ts");
    }
  } finally {
    dispose(project.dir);
  }
});
