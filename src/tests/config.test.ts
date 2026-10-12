import { expect, test } from "bun:test";
import { loadConfig, checkConfig, pluginMetadataErrors } from "../config";
import path from "path";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

const SHARED_YAML = [
  "version: 1",
  "project:",
  "  name: MyProject",
  "",
  "tasks:",
  "  kill: [{ uses: ue/kill }]",
  "  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]",
  "  build: [{ uses: ue/build, with: { target: editor } }]",
  "  start: [{ uses: ue/start }]",
  "",
  "flows:",
  "  daily:",
  "    description: Update, build, launch editor",
  "    steps: [update, build, start]",
  "    continue_on_fail: [start]",
  "  reset:",
  "    steps: [kill, update, build]",
  "",
  "vars:",
  "  region: us",
  "  shared_only: yes-shared",
  "",
  "plugins:",
  "  - namespace: ue",
  "    config:",
  "      engine: { path: ./engine, vcs: git, url: https://github.com/EpicGames/UnrealEngine.git, branch: main }",
  "      project: { path: ./project, vcs: svn, url: svn://svn.example.com/project/trunk }",
  "      uproject: ./project/MyProject.uproject",
  "      targets:",
  "        editor: { kind: editor, config: debug }",
  "        client: { kind: program, name: MyClient, config: shipping }",
].join("\n");

const LOCAL_YAML = ["vars:", "  region: eu"].join("\n");

function makeConfigDir(shared: string = SHARED_YAML, local?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cfg-"));
  writeFileSync(path.join(dir, "bolt.yaml"), shared);
  if (local !== undefined) writeFileSync(path.join(dir, "bolt.local.yaml"), local);
  return dir;
}

test("loads version, project name, tasks, and flows without a local file", async () => {
  const dir = makeConfigDir(SHARED_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.version).toBe(1);
  expect(cfg.project.name).toBe("MyProject");
  expect(cfg.plugins).toEqual([
    {
      namespace: "ue",
      config: {
        engine: {
          path: "./engine",
          vcs: "git",
          url: "https://github.com/EpicGames/UnrealEngine.git",
          branch: "main",
        },
        project: {
          path: "./project",
          vcs: "svn",
          url: "svn://svn.example.com/project/trunk",
        },
        uproject: "./project/MyProject.uproject",
        targets: {
          editor: { kind: "editor", config: "debug" },
          client: { kind: "program", name: "MyClient", config: "shipping" },
        },
      },
    },
  ]);
  expect(cfg.tasks.update).toHaveLength(2);
  expect(cfg.flows.daily.steps).toEqual(["update", "build", "start"]);
});

test("local.vars shallow-override bolt.yaml vars", async () => {
  const dir = makeConfigDir(SHARED_YAML, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.vars.region).toBe("eu");
  expect(cfg.vars.shared_only).toBe("yes-shared");
});

test("keeps plugin entries that have a path", async () => {
  const shared = [
    SHARED_YAML,
    "  - namespace: extra",
    "    path: ./plugins/extra.ts",
    "    config: { host: example }",
  ].join("\n");
  const dir = makeConfigDir(shared);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.plugins.map((entry) => entry.namespace)).toEqual(["ue", "extra"]);
  expect(cfg.plugins[1]).toEqual({
    namespace: "extra",
    path: "./plugins/extra.ts",
    config: { host: "example" },
  });
  expect(cfg.plugins[0].path).toBeUndefined();
});

test("parses call steps", async () => {
  const shared = SHARED_YAML.replace(
    "  start: [{ uses: ue/start }]",
    "  start: [{ uses: ue/start }]\n  inner: [{ run: echo inner }]\n  outer: [{ call: inner }]",
  );
  const dir = makeConfigDir(shared);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.tasks.outer[0]).toEqual({ call: "inner" });
});

test("rejects steps with multiple execution fields", async () => {
  const shared = SHARED_YAML.replace(
    "  start: [{ uses: ue/start }]",
    "  start: [{ uses: ue/start }]\n  broken: [{ uses: ue/build, call: build }]",
  );
  const dir = makeConfigDir(shared);
  await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow();
});

test("rejects with parameters on run steps", async () => {
  const shared = SHARED_YAML.replace(
    "  start: [{ uses: ue/start }]",
    "  start:\n    - run: echo hi\n      with: { mode: debug }",
  );
  const dir = makeConfigDir(shared);
  const configPath = path.join(dir, "bolt.yaml");

  await expect(loadConfig(configPath)).rejects.toThrow();

  const result = await checkConfig(configPath);
  expect(result.ok).toBe(false);
  expect(result.errors).toContainEqual({
    path: "tasks.start.0",
    message: "Invalid input",
  });
});

test("rejects legacy task references with a migration hint", async () => {
  const shared = SHARED_YAML.replace(
    "  start: [{ uses: ue/start }]",
    "  start: [{ uses: ue/start }]\n  legacy: [{ uses: task/build }]",
  );
  const dir = makeConfigDir(shared);
  await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(
    'replace with "call: build"',
  );
});

test("parses flows with steps and continue_on_fail", async () => {
  const dir = makeConfigDir(SHARED_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.flows.daily.description).toBe("Update, build, launch editor");
  expect(cfg.flows.daily.steps).toEqual(["update", "build", "start"]);
  expect(cfg.flows.daily.continue_on_fail).toEqual(["start"]);
  expect(cfg.flows.reset.continue_on_fail).toEqual([]);
});

test("notifications config parses wecom and telegram providers", async () => {
  const shared = [
    "version: 1",
    "project:",
    "  name: Test",
    "notifications:",
    "  on_start: true",
    "  on_complete: true",
    "  on_failure: true",
    "  providers:",
    "    - type: wecom",
    "      webhook_url: https://qyapi.weixin.qq.com/test",
    "    - type: telegram",
    "      bot_token: '123:ABC'",
    "      chat_id: '-1001234567'",
  ].join("\n");
  const dir = makeConfigDir(shared);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.notifications?.on_start).toBe(true);
  expect(cfg.notifications?.providers).toHaveLength(2);
  expect(cfg.notifications?.providers[0].type).toBe("wecom");
  expect(cfg.notifications?.providers[1].type).toBe("telegram");
});

test("rejects bolt.yaml without a version", async () => {
  const dir = makeConfigDir("project:\n  name: MyProject\n");
  await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(/version/);
});

test("rejects an unsupported config version", async () => {
  const dir = makeConfigDir("version: 2\nproject:\n  name: MyProject\n");
  await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(/version must be 1/);
});

test("rejects core engine, targets, and uproject fields", async () => {
  const dir = makeConfigDir(
    [
      "version: 1",
      "project:",
      "  name: MyProject",
      "  engine: { vcs: git }",
      "targets:",
      "  editor: { kind: editor }",
    ].join("\n"),
  );
  await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(/engine|targets/);
});

test("rejects UE fields in bolt.local.yaml", async () => {
  const dir = makeConfigDir(
    SHARED_YAML,
    "engine_path: ./engine\nuproject: ./p.uproject\nuse_tortoise: true",
  );
  await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(/bolt\.local\.yaml/);
});

test("checkConfig returns ok:true without a local file", async () => {
  const dir = makeConfigDir(SHARED_YAML);
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(true);
  expect(result.errors).toHaveLength(0);
});

test("checkConfig reports invalid local field", async () => {
  const dir = makeConfigDir(SHARED_YAML, "engine_path: ./engine");
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  expect(result.errors.some((e) => e.path.startsWith("bolt.local.yaml"))).toBe(true);
});

test("checkConfig returns ok:false when file does not exist", async () => {
  const result = await checkConfig("/nonexistent/path/bolt.yaml");
  expect(result.ok).toBe(false);
  expect(result.errors[0].path).toBe("<file>");
});

test("shared fixture ue metadata passes plugin checks", async () => {
  const { parse } = await import("yaml");
  expect(pluginMetadataErrors(parse(SHARED_YAML))).toEqual([]);
});

test("plugin metadata errors include an invalid ue target kind", () => {
  const errors = pluginMetadataErrors({
    plugins: [
      {
        namespace: "ue",
        config: {
          engine: { path: "e" },
          project: { path: "p" },
          uproject: "p.uproject",
          targets: { editor: { kind: "invalid_kind" } },
        },
      },
    ],
  });
  expect(errors.some((e) => e.path.includes("kind"))).toBe(true);
});

test("plugin metadata errors when tasks use ue without ue config", () => {
  const errors = pluginMetadataErrors({
    tasks: { build: [{ uses: "ue/build" }] },
  });
  expect(errors.some((e) => e.path === "plugins.ue")).toBe(true);
});

test("plugin metadata errors on svn use_tortoise of the wrong type", () => {
  const errors = pluginMetadataErrors({
    plugins: [{ namespace: "svn", config: { use_tortoise: "yes" } }],
  });
  expect(errors.some((e) => e.path.includes("use_tortoise"))).toBe(true);
});

test("checkConfig rejects malformed ue metadata", async () => {
  const dir = makeConfigDir(
    [
      "version: 1",
      "project: { name: MyProject }",
      "plugins:",
      "  - namespace: ue",
      "    config:",
      "      engine: { path: e }",
      "      project: { path: p }",
      "      uproject: p.uproject",
      "      targets:",
      "        editor: { kind: invalid_kind }",
    ].join("\n"),
  );
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  expect(result.errors.some((e) => e.path.includes("kind"))).toBe(true);
});

test("checkConfig rejects malformed svn metadata", async () => {
  const dir = makeConfigDir(
    [
      "version: 1",
      "project: { name: MyProject }",
      "plugins:",
      "  - namespace: svn",
      '    config: { use_tortoise: "yes" }',
    ].join("\n"),
  );
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  expect(result.errors.some((e) => e.path.includes("use_tortoise"))).toBe(true);
});
