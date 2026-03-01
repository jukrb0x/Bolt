import { expect, test } from "bun:test";
import { loadConfig, checkConfig } from "../config";
import path from "path";
import os from "os";
import { writeFileSync, rmSync } from "fs";

const fixture = path.join(import.meta.dir, "../../tests/fixtures/bolt.yaml");

test("loads project fields", async () => {
  const cfg = await loadConfig(fixture);
  expect(cfg.project.name).toBe("MyProject");
  expect(cfg.project.engine_root).toBe("C:/UnrealEngine");
  expect(cfg.project.project_root).toBe("C:/Projects/MyProject");
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

test("throws on missing project.engine_root", async () => {
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
      "  engine_root: C:/UE",
      "  project_root: C:/proj",
      "  project_name: Test",
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
      "  engine_root: C:/UE",
      "  project_root: C:/proj",
      "  project_name: Test",
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

test("accepts legacy ue_path and project_path", async () => {
  const tmpFile = `${os.tmpdir()}/bolt-legacy-fields.yaml`;
  writeFileSync(
    tmpFile,
    [
      "project:",
      "  name: Legacy",
      "  ue_path: C:/LegacyEngine",
      "  project_path: C:/LegacyProject",
      "  project_name: Legacy",
    ].join("\n"),
  );
  const cfg = await loadConfig(tmpFile);
  expect(cfg.project.engine_root).toBe("C:/LegacyEngine");
  expect(cfg.project.project_root).toBe("C:/LegacyProject");
  rmSync(tmpFile);
});

test("accepts legacy svn_root as project_root fallback", async () => {
  const tmpFile = `${os.tmpdir()}/bolt-svn-root.yaml`;
  writeFileSync(
    tmpFile,
    [
      "project:",
      "  name: SvnOnly",
      "  ue_path: C:/Engine",
      "  svn_root: C:/SvnProject",
      "  project_name: SvnOnly",
    ].join("\n"),
  );
  const cfg = await loadConfig(tmpFile);
  expect(cfg.project.project_root).toBe("C:/SvnProject");
  rmSync(tmpFile);
});

test("engine_vcs defaults to git and project_vcs defaults to svn when omitted", async () => {
  const tmpFile = `${os.tmpdir()}/bolt-vcs-defaults.yaml`;
  writeFileSync(
    tmpFile,
    [
      "project:",
      "  name: Defaults",
      "  engine_root: C:/Engine",
      "  project_root: C:/Project",
      "  project_name: Defaults",
    ].join("\n"),
  );
  const cfg = await loadConfig(tmpFile);
  expect(cfg.project.engine_vcs).toBe("git");
  expect(cfg.project.project_vcs).toBe("svn");
  rmSync(tmpFile);
});
