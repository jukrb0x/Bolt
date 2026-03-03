import { expect, test } from "bun:test";
import { loadConfig, checkConfig } from "../config";
import path from "path";
import os from "os";
import { writeFileSync, rmSync } from "fs";

const fixture = path.join(import.meta.dir, "../../tests/fixtures/bolt.yaml");

test("loads project fields", async () => {
  const cfg = await loadConfig(fixture);
  expect(cfg.project.name).toBe("MyProject");
  expect(cfg.project.engine_repo.path).toBe("C:/UnrealEngine");
  expect(cfg.project.project_repo.path).toBe("C:/Projects/MyProject");
  expect(cfg.project.uproject).toBe("C:/Projects/MyProject/MyProject.uproject");
});

test("loads targets", async () => {
  const cfg = await loadConfig(fixture);
  expect(cfg.targets.editor.kind).toBe("editor");
  expect(cfg.targets.editor.config).toBe("debug");
  expect(cfg.targets.client.kind).toBe("program");
  expect(cfg.targets.client.name).toBe("MyClient");
});

test("loads actions", async () => {
  const cfg = await loadConfig(fixture);
  expect(cfg.actions.daily_check.steps).toHaveLength(2);
  expect(cfg.actions.build_editor.steps[0].uses).toBe("ue/build");
  expect(cfg.actions.build_editor.steps[0].with?.target).toBe("editor");
});

test("throws on missing required fields", async () => {
  expect(
    loadConfig(path.join(import.meta.dir, "../../tests/fixtures/invalid.yaml")),
  ).rejects.toThrow();
});

test("accepts plugins array", async () => {
  const cfg = await loadConfig(fixture);
  expect(Array.isArray(cfg.plugins)).toBe(true);
});

test("accepts timeout_hours as undefined when not set", async () => {
  const cfg = await loadConfig(fixture);
  expect(cfg.timeout_hours).toBeUndefined();
});

test("notifications config parses wecom and telegram providers", async () => {
  const tmpFile = `${os.tmpdir()}/bolt-notify-test.yaml`;
  writeFileSync(
    tmpFile,
    [
      "project:",
      "  name: Test",
      "  engine_repo:",
      "    path: C:/UE",
      "  project_repo:",
      "    path: C:/proj",
      "  uproject: C:/proj/Test.uproject",
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
    ].join("\n"),
  );
  const cfg = await loadConfig(tmpFile);
  expect(cfg.notifications?.on_start).toBe(true);
  expect(cfg.notifications?.providers).toHaveLength(2);
  expect(cfg.notifications?.providers[0].type).toBe("wecom");
  expect(cfg.notifications?.providers[1].type).toBe("telegram");
  rmSync(tmpFile);
});

// ---------------------------------------------------------------------------
// checkConfig
// ---------------------------------------------------------------------------

test("checkConfig returns ok:true for valid fixture", async () => {
  const result = await checkConfig(fixture);
  expect(result.ok).toBe(true);
  expect(result.errors).toHaveLength(0);
});

test("checkConfig returns ok:false with errors for invalid yaml", async () => {
  const tmpFile = `${os.tmpdir()}/bolt-check-invalid.yaml`;
  writeFileSync(
    tmpFile,
    [
      "project:",
      "  name: Test",
      "  engine_repo:",
      "    path: C:/UE",
      "  project_repo:",
      "    path: C:/proj",
      "  uproject: C:/proj/Test.uproject",
      "targets:",
      "  editor:",
      "    kind: invalid_kind", // not a valid kind value
    ].join("\n"),
  );
  const result = await checkConfig(tmpFile);
  expect(result.ok).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.errors.some((e) => e.path.includes("kind"))).toBe(true);
  rmSync(tmpFile);
});

test("checkConfig returns ok:false when file does not exist", async () => {
  const result = await checkConfig("/nonexistent/path/bolt.yaml");
  expect(result.ok).toBe(false);
  expect(result.errors[0].path).toBe("<file>");
});

test("engine_repo.vcs defaults to git when omitted", async () => {
  const tmpFile = `${os.tmpdir()}/bolt-vcs-defaults.yaml`;
  writeFileSync(
    tmpFile,
    [
      "project:",
      "  name: Defaults",
      "  engine_repo:",
      "    path: C:/Engine",
      "  project_repo:",
      "    path: C:/Project",
      "  uproject: C:/Project/Defaults.uproject",
    ].join("\n"),
  );
  const cfg = await loadConfig(tmpFile);
  expect(cfg.project.engine_repo.vcs).toBe("git");
  expect(cfg.project.project_repo.vcs).toBe("git");
  rmSync(tmpFile);
});

test("preserves extra string fields for interpolation", async () => {
  const tmpFile = `${os.tmpdir()}/bolt-extra-fields.yaml`;
  writeFileSync(
    tmpFile,
    [
      "project:",
      "  name: Extra",
      "  engine_repo:",
      "    path: C:/Engine",
      "  project_repo:",
      "    path: C:/Project",
      "  uproject: C:/Project/Extra.uproject",
      "  custom_field: custom_value",
    ].join("\n"),
  );
  const cfg = await loadConfig(tmpFile);
  expect((cfg.project as Record<string, unknown>)["custom_field"]).toBe("custom_value");
  rmSync(tmpFile);
});

test("loads engine_repo with url and branch", async () => {
  const tmpFile = `${os.tmpdir()}/bolt-repo-url.yaml`;
  writeFileSync(
    tmpFile,
    [
      "project:",
      "  name: UrlTest",
      "  engine_repo:",
      "    path: ./engine",
      "    vcs: git",
      "    url: https://github.com/example/engine.git",
      "    branch: '5.3'",
      "  project_repo:",
      "    path: ./project",
      "    vcs: svn",
      "    url: svn://svn.example.com/project",
      "  uproject: ./project/UrlTest.uproject",
    ].join("\n"),
  );
  const cfg = await loadConfig(tmpFile);
  expect(cfg.project.engine_repo.url).toBe("https://github.com/example/engine.git");
  expect(cfg.project.engine_repo.branch).toBe("5.3");
  expect(cfg.project.project_repo.url).toBe("svn://svn.example.com/project");
  rmSync(tmpFile);
});
