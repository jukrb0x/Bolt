import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  bolt,
  callsMatching,
  dispose,
  findCall,
  git,
  installEngine,
  joined,
  makeProject,
  placeTargetBinary,
  readCalls,
  slash,
  writeBolt,
} from "./harness";

function tool(log: string, fragment: string) {
  const call = findCall(log, fragment);
  expect(slash(call.cwd)).toBe(slash(readCalls(log)[0]?.cwd ?? call.cwd));
  expect(call.env.BOLT_E2E_UE_SHELL === "posix" || call.env.BOLT_E2E_UE_SHELL === "cmd").toBe(true);
  return call;
}

test("ue/build editor and client pass target, config, and project to Build and UnrealBuildTool", async () => {
  const project = makeProject();
  try {
    const editor = await bolt(project.dir, ["run", "build-editor", "--config=debug"]);
    expect(editor.exitCode).toBe(0);
    const build = tool(editor.log, "Engine/Build/BatchFiles/Build.");
    const text = joined(build);
    expect(text).toContain("SampleEditor");
    expect(text).toContain("Win64 Debug");
    expect(text).toContain("ShaderCompileWorker Win64 Development");
    expect(text).toContain("Sample.uproject");
    expect(text).toContain("-WaitMutex");
    expect(slash(build.cwd)).toBe(slash(project.dir));
    expect(slash(build.tool)).toContain(
      slash(path.join(project.engine, "Engine/Build/BatchFiles")),
    );
    const ubt = findCall(editor.log, "UnrealBuildTool");
    expect(joined(ubt)).toContain("SampleEditor");
    expect(ubt.exit).toBe(0);
    expect(editor.output).toContain("Result: Succeeded");

    const client = await bolt(project.dir, ["run", "build-client"]);
    expect(client.exitCode).toBe(0);
    const clientText = joined(findCall(client.log, "Engine/Build/BatchFiles/Build."));
    expect(clientText).toContain("SampleClient");
    expect(clientText).toContain("Shipping");
    expect(clientText).toContain("Sample.uproject");
    expect(clientText).not.toContain("ShaderCompileWorker");
  } finally {
    dispose(project.dir);
  }
});

test("ue/build_program and a failing Build.bat exit", async () => {
  const project = makeProject();
  try {
    const program = await bolt(project.dir, ["run", "build-program"]);
    expect(program.exitCode).toBe(0);
    const text = joined(findCall(program.log, "Engine/Build/BatchFiles/Build."));
    expect(text).toContain("CustomProgram");
    expect(text).toContain("Win64");
    expect(text).toContain("Development");
    expect(text).toContain("-project=");
    expect(text).toContain("-FromMsBuild");

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
    const setup = findCall(result.log, "/Setup.");
    expect(joined(setup)).toContain("--force");
    expect(slash(setup.tool)).toContain(slash(project.engine));
    const generated = callsMatching(result.log, "GenerateProjectFiles").filter(
      (call) => !slash(call.tool).includes("BatchFiles"),
    );
    expect(generated).toHaveLength(1);
    const build = joined(findCall(result.log, "Engine/Build/BatchFiles/Build."));
    expect(build).toContain("UE4Editor");
    expect(build).toContain("Win64");
    expect(build).toContain("Development");
    expect(build).toContain("ShaderCompileWorker");
    expect(findCall(result.log, "UnrealBuildTool").exit).toBe(0);
  } finally {
    dispose(project.dir);
  }
});

test("generate_project, fillddc, start, and kill hit the fake tools", async () => {
  const project = makeProject();
  try {
    const generated = await bolt(project.dir, ["run", "gen"]);
    expect(generated.exitCode).toBe(0);
    const gen = findCall(generated.log, "BatchFiles/GenerateProjectFiles.");
    expect(joined(gen)).toContain("Sample.uproject");
    expect(joined(gen)).toContain("-Game");

    const filled = await bolt(project.dir, ["run", "fill"]);
    expect(filled.exitCode).toBe(0);
    const editor = findCall(filled.log, "UE4Editor-Cmd.");
    const editorText = joined(editor);
    expect(editorText).toContain("Sample.uproject");
    expect(editorText).toContain("FillDDCForPIETest");
    expect(editorText).toContain("-unattended");
    expect(editorText).toContain("-nullrhi");
    expect(filled.output).toContain("Automation Test Queue Empty");
    expect(callsMatching(filled.log, "UnrealEditor-Cmd.")).toHaveLength(0);

    const started = await bolt(project.dir, ["run", "start"]);
    expect(started.exitCode).toBe(0);
    const cmd = findCall(started.log, "/cmd");
    expect(joined(cmd)).toContain("start");
    expect(joined(cmd)).toContain("Sample.uproject");
    expect(slash(joined(cmd))).toContain("UE4Editor.");

    const binary = placeTargetBinary(project, "SampleEditor");
    const named = await bolt(project.dir, ["run", "start-named"]);
    expect(named.exitCode).toBe(0);
    expect(slash(joined(findCall(named.log, "/cmd")))).toContain(slash(binary));

    const killed = await bolt(project.dir, ["run", "kill"]);
    expect(killed.exitCode).toBe(0);
    const kills = callsMatching(killed.log, "taskkill");
    expect(kills.length).toBe(6);
    expect(kills.map((call) => call.argv.join(" ")).join("\n")).toContain("UnrealEditor-Cmd.exe");
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
    expect(update?.argv).toContain("--non-interactive");
    expect(slash(update?.argv.join(" ") ?? "")).toContain(slash(project.dir));
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
    const proc = findCall(result.log, "TortoiseProc");
    expect(joined(proc)).toContain("/command:cleanup");
    expect(joined(proc)).toContain("/noui");
    expect(slash(joined(proc))).toContain(slash(tortoise.dir));
    expect(findCall(result.log, "where").argv.join(" ")).toContain("TortoiseProc.exe");
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

  const escape = makeProject({
    tasks: `tasks:
  escape:
    - uses: fs/copy
      with: { src: ../outside.txt, dst: out/x.txt }
  bad-json:
    - uses: json/set
      with: { file: ../data.json, key: a, value: "1" }
`,
  });
  try {
    const copied = await bolt(escape.dir, ["run", "escape"]);
    expect(copied.exitCode).not.toBe(0);
    expect(copied.output).toContain("escapes project root");
    const patched = await bolt(escape.dir, ["run", "bad-json"]);
    expect(patched.exitCode).not.toBe(0);
    expect(patched.output).toContain("escapes project root");
  } finally {
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
