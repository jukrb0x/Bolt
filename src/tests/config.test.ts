import { expect, test } from "bun:test";
import { loadConfig } from "../config";
import path from "path";

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
