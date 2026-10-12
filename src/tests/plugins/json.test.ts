import { expect, test, beforeEach, afterEach } from "bun:test";
import jsonPlugin from "../../plugins/json";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { testCfg, mockRuntime } from "../env";
import type { BoltPluginContext } from "../../plugin";
import { Logger } from "../../logger";

const tmp = "/tmp/bolt-json-plugin-test";
const file = `${tmp}/data.json`;
const ctx: BoltPluginContext = {
  cfg: testCfg,
  configDir: tmp,
  dryRun: false,
  logger: new Logger(),
  runtime: mockRuntime,
};

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

function dryCtx() {
  const logged: string[] = [];
  const logger = new Logger({ sink: (line) => logged.push(line) });
  return { ...ctx, dryRun: true, logger, logged };
}

test("set throws when an intermediate object is missing", async () => {
  const original = readFileSync(file, "utf8");
  await expect(
    jsonPlugin.handlers["set"]({ file, key: "missing.child", value: "1" }, ctx),
  ).rejects.toThrow();
  expect(readFileSync(file, "utf8")).toBe(original);
});

test("set dry-run logs and does not write", async () => {
  const original = readFileSync(file, "utf8");
  const dry = dryCtx();
  await jsonPlugin.handlers["set"]({ file, key: "a", value: "99" }, dry);
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(dry.logged.some((line) => line.includes("[dry-run]") && line.includes("json/set"))).toBe(
    true,
  );
});

test("set dry-run still rejects forbidden key segments", async () => {
  const original = readFileSync(file, "utf8");
  const dry = dryCtx();
  await expect(
    jsonPlugin.handlers["set"]({ file, key: "__proto__.polluted", value: "true" }, dry),
  ).rejects.toThrow("Forbidden key segment");
  expect(readFileSync(file, "utf8")).toBe(original);
});

test("merge writes a shallow patch", async () => {
  const patchFile = `${tmp}/patch.json`;
  writeFileSync(patchFile, JSON.stringify({ a: 9, d: 4 }));
  await jsonPlugin.handlers["merge"]({ file, patch: patchFile }, ctx);
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ a: 9, b: { c: 2 }, d: 4 });
});

test("merge dry-run logs and does not write", async () => {
  const original = readFileSync(file, "utf8");
  const patchFile = `${tmp}/patch.json`;
  writeFileSync(patchFile, JSON.stringify({ a: 9, d: 4 }));
  const dry = dryCtx();
  await jsonPlugin.handlers["merge"]({ file, patch: patchFile }, dry);
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(dry.logged.some((line) => line.includes("[dry-run]") && line.includes("json/merge"))).toBe(
    true,
  );
});

test("merge rejects __proto__ key", async () => {
  const original = readFileSync(file, "utf8");
  const patchFile = `${tmp}/patch.json`;
  writeFileSync(patchFile, '{"__proto__":{"polluted":true}}');
  await expect(jsonPlugin.handlers["merge"]({ file, patch: patchFile }, ctx)).rejects.toThrow(
    'Forbidden key segment "__proto__"',
  );
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test("merge rejects constructor key", async () => {
  const original = readFileSync(file, "utf8");
  const patchFile = `${tmp}/patch.json`;
  writeFileSync(patchFile, '{"constructor":{"prototype":{"polluted":true}}}');
  await expect(jsonPlugin.handlers["merge"]({ file, patch: patchFile }, ctx)).rejects.toThrow(
    'Forbidden key segment "constructor"',
  );
  expect(readFileSync(file, "utf8")).toBe(original);
});

test("merge rejects prototype key", async () => {
  const original = readFileSync(file, "utf8");
  const patchFile = `${tmp}/patch.json`;
  writeFileSync(patchFile, '{"prototype":{"polluted":true}}');
  await expect(jsonPlugin.handlers["merge"]({ file, patch: patchFile }, ctx)).rejects.toThrow(
    'Forbidden key segment "prototype"',
  );
  expect(readFileSync(file, "utf8")).toBe(original);
});

test("merge rejects nested forbidden key", async () => {
  const original = readFileSync(file, "utf8");
  const patchFile = `${tmp}/patch.json`;
  writeFileSync(patchFile, '{"nested":{"__proto__":{"polluted":true}}}');
  await expect(jsonPlugin.handlers["merge"]({ file, patch: patchFile }, ctx)).rejects.toThrow(
    'Forbidden key segment "__proto__"',
  );
  expect(readFileSync(file, "utf8")).toBe(original);
});

test("merge dry-run still rejects forbidden keys", async () => {
  const original = readFileSync(file, "utf8");
  const patchFile = `${tmp}/patch.json`;
  writeFileSync(patchFile, '{"__proto__":{"polluted":true}}');
  const dry = dryCtx();
  await expect(jsonPlugin.handlers["merge"]({ file, patch: patchFile }, dry)).rejects.toThrow(
    "Forbidden key segment",
  );
  expect(readFileSync(file, "utf8")).toBe(original);
});
