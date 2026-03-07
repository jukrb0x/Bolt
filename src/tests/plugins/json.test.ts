import { expect, test, beforeEach, afterEach } from "bun:test";
import jsonPlugin from "../../plugins/json";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { testCfg, mockRuntime } from "../env";
import type { BoltPluginContext } from "../../plugin";
import { Logger } from "../../logger";

const tmp = "/tmp/bolt-json-plugin-test";
const file = `${tmp}/data.json`;
const ctx: BoltPluginContext = { cfg: testCfg, configDir: tmp, dryRun: false, logger: new Logger(), runtime: mockRuntime };

beforeEach(() => {
  mkdirSync(tmp, { recursive: true });
  writeFileSync(file, JSON.stringify({ a: 1, b: { c: 2 } }));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test("set top-level key", async () => {
  await jsonPlugin.handlers["set"]({ file, key: "a", value: "99" }, ctx);
  expect(JSON.parse(readFileSync(file, "utf8")).a).toBe("99");
});

test("set nested key with dot-path", async () => {
  await jsonPlugin.handlers["set"]({ file, key: "b.c", value: "42" }, ctx);
  expect(JSON.parse(readFileSync(file, "utf8")).b.c).toBe("42");
});

test("set rejects __proto__ key segment", async () => {
  await expect(
    jsonPlugin.handlers["set"]({ file, key: "__proto__.polluted", value: "true" }, ctx),
  ).rejects.toThrow("Forbidden key segment");
});

test("set rejects constructor key segment", async () => {
  await expect(
    jsonPlugin.handlers["set"]({ file, key: "constructor.prototype.x", value: "1" }, ctx),
  ).rejects.toThrow("Forbidden key segment");
});

test("set rejects prototype key segment", async () => {
  await expect(
    jsonPlugin.handlers["set"]({ file, key: "a.prototype.y", value: "1" }, ctx),
  ).rejects.toThrow("Forbidden key segment");
});

test("set rejects file path escaping project root", async () => {
  await expect(
    jsonPlugin.handlers["set"]({ file: "/etc/important.json", key: "a", value: "1" }, ctx),
  ).rejects.toThrow("escapes project root");
});

test("merge rejects patch path escaping project root", async () => {
  const patchFile = `${tmp}/patch.json`;
  writeFileSync(patchFile, JSON.stringify({ d: 4 }));
  await expect(
    jsonPlugin.handlers["merge"]({ file, patch: "/etc/other.json" }, ctx),
  ).rejects.toThrow("escapes project root");
});
