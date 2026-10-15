import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { generateAiContext, aiContextPlugins, collectAiContext } from "../ai-context";
import type { BoltConfig } from "../config";
import { defineHandler, definePlugin } from "../plugin";
import { PluginRegistry } from "../plugin-registry";
import { builtinPlugins } from "../plugins";
import { testCfg } from "./env";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO_ROOT, "src/main.ts");

const bare: BoltConfig = {
  ...testCfg,
  plugins: [],
  tasks: { hello: [{ run: "echo hi" }] },
  flows: {},
};

function plugin(
  namespace: string,
  aiContext?: (input: { cfg: BoltConfig; configDir: string }) => {
    markdown?: string[];
    info?: Record<string, unknown>;
  },
  apiVersion?: 1 | 2,
) {
  return definePlugin({
    namespace,
    version: "1.0.0",
    description: namespace,
    ...(apiVersion ? { apiVersion } : {}),
    handlers: { go: defineHandler({ ai: false }, async () => {}) },
    ...(aiContext ? { aiContext } : {}),
  });
}

function parseStdout(out: string): Record<string, unknown> {
  expect(out.startsWith("{")).toBe(true);
  return JSON.parse(out) as Record<string, unknown>;
}

async function bolt(argv: string[], cwd: string) {
  const proc = Bun.spawn(["bun", MAIN, ...argv], {
    cwd,
    env: { ...process.env, BOLT_AGENT: "" },
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

test("non-UE ai context has no engine tagline, Targets, or debuggame", () => {
  const context = generateAiContext(bare, import.meta.path, new PluginRegistry());
  expect(context).toContain("Bolt is a CLI tool for workflow automation.");
  expect(context).not.toContain("Unreal Engine");
  expect(context).not.toContain("## Targets");
  expect(context).not.toContain("debuggame");
});

test("UE ai context keeps targets and the DebugGame flag out of the core tagline", () => {
  const context = generateAiContext(testCfg, import.meta.path, new PluginRegistry());
  expect(context).toContain("Bolt is a CLI tool for workflow automation.");
  expect(context).not.toContain("Unreal Engine workflow");
  expect(context).toContain("**editor**: editor · development");
  expect(context).toContain("**client**: program · MyClient · shipping");
  expect(context).toContain("`--config=debuggame` (aliases: `dbggame`, `DebugGame`)");
});

test("a configured ue plugin with no targets omits info.targets", () => {
  const cfg: BoltConfig = {
    ...bare,
    plugins: [
      {
        namespace: "ue",
        config: {
          engine: { path: "D:/UE", vcs: "git" },
          project: { path: "D:/Game", vcs: "git" },
          uproject: "D:/Game/Game.uproject",
          targets: {},
        },
      },
    ],
  };
  const { info, markdown } = collectAiContext([builtinPlugins.ue], {
    cfg,
    configDir: "/tmp",
  });
  expect(info).not.toHaveProperty("targets");
  expect(markdown.join("\n")).not.toContain("## Targets");
  expect(markdown.join("\n")).toContain("debuggame");
});

test("info merge keeps distinct keys, lets a later plugin win, and skips empty info", () => {
  const { info, markdown } = collectAiContext(
    [
      plugin("one", () => ({ markdown: ["one"], info: { alpha: 1, shared: "one" } })),
      plugin("empty", () => ({ info: {} })),
      plugin("note", () => ({ markdown: ["note"] })),
      plugin("absent"),
      plugin("two", () => ({ markdown: ["two"], info: { beta: 2, shared: "two" } })),
    ],
    { cfg: bare, configDir: "/tmp" },
  );
  expect(info).toEqual({ alpha: 1, shared: "two", beta: 2 });
  expect(info).not.toHaveProperty("targets");
  expect(markdown).toEqual(["one", "note", "two"]);
});

test("aiContext runs by method presence, including apiVersion 1", () => {
  const old = plugin("old", () => ({ info: { old: true } }));
  expect(old.apiVersion).toBe(1);
  const { info } = collectAiContext([old], { cfg: bare, configDir: "/tmp" });
  expect(info).toEqual({ old: true });
});

test("aiContext plugin order is builtins, then plugins[] path plugins", () => {
  const tail = plugin("tail", () => ({ info: { tail: true } }), 2);
  const registry = new PluginRegistry();
  registry.register(builtinPlugins.json);
  registry.register(builtinPlugins.git);
  registry.register(tail, "path");
  const cfg: BoltConfig = {
    ...bare,
    plugins: [{ namespace: "tail", path: "./tail" }],
  };
  expect(aiContextPlugins(cfg, registry).map((item) => item.namespace)).toEqual([
    "git",
    "svn",
    "ue",
    "fs",
    "json",
    "tail",
  ]);
});

test("a later path plugin overwrites the same info key the ue builtin contributed", () => {
  const shadow = plugin("ue", () => ({ info: { targets: { from: "shadow" } } }), 2);
  const registry = new PluginRegistry();
  registry.register(shadow, "path");
  const plugins = aiContextPlugins(testCfg, registry);
  expect(plugins.map((item) => item.namespace)).toEqual(["git", "svn", "ue", "fs", "json", "ue"]);
  expect(plugins[2]).toBe(builtinPlugins.ue);
  expect(plugins[5]).toBe(shadow);
  const { info } = collectAiContext(plugins, {
    cfg: testCfg,
    configDir: path.dirname(import.meta.path),
  });
  expect(info.targets).toEqual({ from: "shadow" });
});

test("info --json omits targets without ue and includes masked targets with ue", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-info-targets-"));
  const ueYaml = [
    "version: 1",
    "project:",
    "  name: Demo",
    "plugins:",
    "  - namespace: ue",
    "    config:",
    "      engine:",
    "        path: D:/UE",
    "        vcs: git",
    "      project:",
    "        path: D:/Game",
    "        vcs: git",
    "      uproject: D:/Game/Game.uproject",
    "      targets:",
    "        editor:",
    "          kind: editor",
    "          config: DebugGame",
    "        client:",
    "          kind: program",
    "          name: MyClient",
    "          config: shipping",
    "tasks:",
    "  hello:",
    "    - run: echo hi",
    "",
  ].join("\n");
  try {
    writeFileSync(path.join(dir, "bolt.yaml"), "version: 1\nproject:\n  name: Demo\n");
    const plain = await bolt(["info", "--json"], dir);
    expect(plain.code).toBe(0);
    const plainData = parseStdout(plain.out).data as Record<string, unknown>;
    expect(plainData).not.toHaveProperty("targets");

    writeFileSync(path.join(dir, "bolt.yaml"), ueYaml);
    const ue = await bolt(["info", "--json"], dir);
    expect(ue.code).toBe(0);
    const ueData = parseStdout(ue.out).data as Record<string, unknown>;
    expect(ueData.targets).toEqual({
      client: { kind: "program", name: "MyClient", config: "shipping" },
      editor: { kind: "editor", config: "debuggame" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
