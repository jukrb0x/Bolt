import { expect, test } from "bun:test";
import { loadConfig, checkConfig } from "../config";
import path from "path";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

// --- Helpers ---------------------------------------------------------------

/** v2 shared bolt.yaml — committed team contract (no machine paths). */
const SHARED_YAML = [
  "project:",
  "  name: MyProject",
  "  engine: { vcs: git, url: https://github.com/EpicGames/UnrealEngine.git, branch: main }",
  "  project: { vcs: svn, url: svn://svn.example.com/project/trunk }",
  "  custom_field: custom_value",
  "",
  "targets:",
  "  editor: { kind: editor, config: debug }",
  "  client: { kind: program, name: MyClient, config: shipping }",
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
].join("\n");

/** v2 per-machine bolt.local.yaml — gitignored (uses relative paths to test resolution). */
const LOCAL_YAML = [
  "engine_path: ./engine",
  "project_path: ./project",
  "uproject: ./project/MyProject.uproject",
  "use_tortoise: true",
  "vars:",
  "  region: eu",
].join("\n");

/** Create a temp config dir with bolt.yaml and (optionally) bolt.local.yaml. */
function makeConfigDir(shared: string = SHARED_YAML, local?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cfg-"));
  writeFileSync(path.join(dir, "bolt.yaml"), shared);
  if (local !== undefined) writeFileSync(path.join(dir, "bolt.local.yaml"), local);
  return dir;
}

// --- loadConfig: schema + merge -------------------------------------------

test("loads project name and merged uproject from local", async () => {
  const dir = makeConfigDir(SHARED_YAML, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.project.name).toBe("MyProject");
  expect(cfg.project.uproject).toBe(path.resolve(dir, "project/MyProject.uproject"));
  expect(cfg.project.use_tortoise).toBe(true);
});

test("engine_repo.path comes from local, identity from shared", async () => {
  const dir = makeConfigDir(SHARED_YAML, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.project.engine_repo.path).toBe(path.resolve(dir, "engine"));
  expect(cfg.project.engine_repo.vcs).toBe("git");
  expect(cfg.project.engine_repo.url).toBe("https://github.com/EpicGames/UnrealEngine.git");
  expect(cfg.project.engine_repo.branch).toBe("main");
  expect(cfg.project.project_repo.path).toBe(path.resolve(dir, "project"));
  expect(cfg.project.project_repo.vcs).toBe("svn");
});

test("absolute local paths pass through unchanged", async () => {
  const dir = makeConfigDir(
    SHARED_YAML,
    [
      "engine_path: C:/UnrealEngine",
      "project_path: C:/Projects/MyProject",
      "uproject: C:/Projects/MyProject/MyProject.uproject",
    ].join("\n"),
  );
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.project.engine_repo.path).toBe("C:/UnrealEngine");
  expect(cfg.project.uproject).toBe("C:/Projects/MyProject/MyProject.uproject");
  expect(cfg.project.use_tortoise).toBeUndefined();
});

test("loads targets", async () => {
  const dir = makeConfigDir(SHARED_YAML, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.targets.editor.kind).toBe("editor");
  expect(cfg.targets.editor.config).toBe("debug");
  expect(cfg.targets.client.kind).toBe("program");
  expect(cfg.targets.client.name).toBe("MyClient");
});

test("normalizes target DebugGame config", async () => {
  const shared = SHARED_YAML.replace(
    "editor: { kind: editor, config: debug }",
    "editor: { kind: editor, config: DebugGame }",
  );
  const dir = makeConfigDir(shared, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.targets.editor.config).toBe("debuggame");
});

test("parses tasks as step arrays", async () => {
  const dir = makeConfigDir(SHARED_YAML, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.tasks.update).toHaveLength(2);
  expect(cfg.tasks.build[0]).toMatchObject({ uses: "ue/build", with: { target: "editor" } });
  expect(cfg.tasks.kill[0]).toMatchObject({ uses: "ue/kill" });
});

test("parses call steps", async () => {
  const shared = SHARED_YAML.replace(
    "  start: [{ uses: ue/start }]",
    "  start: [{ uses: ue/start }]\n  inner: [{ run: echo inner }]\n  outer: [{ call: inner }]",
  );
  const dir = makeConfigDir(shared, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.tasks.outer[0]).toEqual({ call: "inner" });
});

test("rejects steps with multiple execution fields", async () => {
  const shared = SHARED_YAML.replace(
    "  start: [{ uses: ue/start }]",
    "  start: [{ uses: ue/start }]\n  broken: [{ uses: ue/build, call: build }]",
  );
  const dir = makeConfigDir(shared, LOCAL_YAML);
  await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow();
});

test("rejects with parameters on run steps", async () => {
  const shared = SHARED_YAML.replace(
    "  start: [{ uses: ue/start }]",
    "  start:\n    - run: echo hi\n      with: { mode: debug }",
  );
  const dir = makeConfigDir(shared, LOCAL_YAML);
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
  const dir = makeConfigDir(shared, LOCAL_YAML);
  await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(
    'replace with "call: build"',
  );
});

test("parses flows with steps and continue_on_fail", async () => {
  const dir = makeConfigDir(SHARED_YAML, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.flows.daily.description).toBe("Update, build, launch editor");
  expect(cfg.flows.daily.steps).toEqual(["update", "build", "start"]);
  expect(cfg.flows.daily.continue_on_fail).toEqual(["start"]);
  // continue_on_fail defaults to [] when omitted
  expect(cfg.flows.reset.continue_on_fail).toEqual([]);
});

test("local.vars shallow-override bolt.yaml vars", async () => {
  const dir = makeConfigDir(SHARED_YAML, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.vars.region).toBe("eu"); // local wins
  expect(cfg.vars.shared_only).toBe("yes-shared"); // shared preserved
});

test("preserves extra string fields on project for interpolation", async () => {
  const dir = makeConfigDir(SHARED_YAML, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect((cfg.project as Record<string, unknown>)["custom_field"]).toBe("custom_value");
});

test("engine identity vcs defaults to git when omitted", async () => {
  const shared = ["project:", "  name: Defaults", "  engine: {}", "  project: {}"].join("\n");
  const dir = makeConfigDir(shared, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.project.engine_repo.vcs).toBe("git");
  expect(cfg.project.project_repo.vcs).toBe("git");
});

test("notifications config parses wecom and telegram providers", async () => {
  const shared = [
    "project:",
    "  name: Test",
    "  engine: {}",
    "  project: {}",
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
  const dir = makeConfigDir(shared, LOCAL_YAML);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.notifications?.on_start).toBe(true);
  expect(cfg.notifications?.providers).toHaveLength(2);
  expect(cfg.notifications?.providers[0].type).toBe("wecom");
  expect(cfg.notifications?.providers[1].type).toBe("telegram");
});

// --- loadConfig: failure paths --------------------------------------------

test("throws when bolt.local.yaml is missing", async () => {
  const dir = makeConfigDir(SHARED_YAML); // no local file
  expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(
    /bolt\.local\.yaml missing or invalid/,
  );
});

test("throws when bolt.local.yaml is missing required fields", async () => {
  const dir = makeConfigDir(SHARED_YAML, "engine_path: ./engine"); // no project_path/uproject
  expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(
    /bolt\.local\.yaml missing or invalid/,
  );
});

test("throws on invalid bolt.yaml (missing project)", async () => {
  const dir = makeConfigDir("vars: {}", LOCAL_YAML);
  expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow();
});

// --- checkConfig -----------------------------------------------------------

test("checkConfig returns ok:true for a valid bolt.yaml + bolt.local.yaml pair", async () => {
  const dir = makeConfigDir(SHARED_YAML, LOCAL_YAML);
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(true);
  expect(result.errors).toHaveLength(0);
});

test("checkConfig surfaces missing local file as an error (does not throw)", async () => {
  const dir = makeConfigDir(SHARED_YAML); // no local file
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  expect(result.errors.some((e) => e.path === "bolt.local.yaml")).toBe(true);
});

test("checkConfig reports invalid local field", async () => {
  const dir = makeConfigDir(SHARED_YAML, "engine_path: ./engine"); // missing project_path/uproject
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  expect(result.errors.some((e) => e.path.startsWith("bolt.local.yaml"))).toBe(true);
});

test("checkConfig returns ok:false with errors for invalid target kind", async () => {
  const shared = [
    "project:",
    "  name: Test",
    "  engine: {}",
    "  project: {}",
    "targets:",
    "  editor:",
    "    kind: invalid_kind",
  ].join("\n");
  const dir = makeConfigDir(shared, LOCAL_YAML);
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  expect(result.errors.some((e) => e.path.includes("kind"))).toBe(true);
});

test("checkConfig returns ok:false when file does not exist", async () => {
  const result = await checkConfig("/nonexistent/path/bolt.yaml");
  expect(result.ok).toBe(false);
  expect(result.errors[0].path).toBe("<file>");
});
