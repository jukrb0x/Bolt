import { expect, test } from "bun:test";
import { loadConfig } from "../config";
import path from "path";
import os from "os";
import { writeFileSync, rmSync } from "fs";

const fixture = path.join(import.meta.dir, "../../tests/fixtures/bolt.yaml");

test("loads project fields", async () => {
  const cfg = await loadConfig(fixture);
  expect(cfg.project.name).toBe("MyProject");
  expect(cfg.project.ue_path).toBe("C:/UnrealEngine");
  expect(cfg.project.project_path).toBe("C:/Projects/MyProject");
});

test("loads targets", async () => {
  const cfg = await loadConfig(fixture);
  expect(cfg.targets.editor.type).toBe("editor");
  expect(cfg.targets.editor.build_type).toBe("debug");
  expect(cfg.targets.client.type).toBe("program");
  expect(cfg.targets.client.name).toBe("MyClient");
});

test("loads actions", async () => {
  const cfg = await loadConfig(fixture);
  expect(cfg.actions.daily_check.steps).toHaveLength(2);
  expect(cfg.actions.build_editor.steps[0].uses).toBe("ue/build");
  expect(cfg.actions.build_editor.steps[0].with?.target).toBe("editor");
});

test("throws on missing project.ue_path", async () => {
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
  writeFileSync(tmpFile, [
    "project:",
    "  name: Test",
    "  ue_path: C:/UE",
    "  project_path: C:/proj",
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
  ].join("\n"));
  const cfg = await loadConfig(tmpFile);
  expect(cfg.notifications?.on_start).toBe(true);
  expect(cfg.notifications?.providers).toHaveLength(2);
  expect(cfg.notifications?.providers[0].type).toBe("wecom");
  expect(cfg.notifications?.providers[1].type).toBe("telegram");
  rmSync(tmpFile);
});
