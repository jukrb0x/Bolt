import { expect, test, beforeEach, afterEach } from "bun:test";
import fsPlugin from "../../plugins/fs";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { testCfg, mockRuntime } from "../env";
import type { BoltPluginContext } from "../../plugin";
import { Logger } from "../../logger";

const tmp = "/tmp/bolt-fs-plugin-test";
const ctx: BoltPluginContext = {
  cfg: testCfg,
  configDir: tmp,
  dryRun: false,
  logger: new Logger(),
  runtime: mockRuntime,
};

beforeEach(() => mkdirSync(tmp, { recursive: true }));
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test("copy creates destination file", async () => {
  writeFileSync(`${tmp}/a.txt`, "hello");
  await fsPlugin.handlers["copy"]({ src: `${tmp}/a.txt`, dst: `${tmp}/b.txt` }, ctx);
  expect(existsSync(`${tmp}/b.txt`)).toBe(true);
});

test("delete removes file", async () => {
  writeFileSync(`${tmp}/a.txt`, "hello");
  await fsPlugin.handlers["delete"]({ path: `${tmp}/a.txt` }, ctx);
  expect(existsSync(`${tmp}/a.txt`)).toBe(false);
});

test("mkdir creates directory", async () => {
  await fsPlugin.handlers["mkdir"]({ path: `${tmp}/newdir` }, ctx);
  expect(existsSync(`${tmp}/newdir`)).toBe(true);
});

test("delete rejects path escaping project root", async () => {
  await expect(fsPlugin.handlers["delete"]({ path: "../../etc/passwd" }, ctx)).rejects.toThrow(
    "escapes project root",
  );
});

test("copy rejects src escaping project root", async () => {
  writeFileSync(`${tmp}/a.txt`, "hello");
  await expect(
    fsPlugin.handlers["copy"]({ src: "/etc/passwd", dst: `${tmp}/b.txt` }, ctx),
  ).rejects.toThrow("escapes project root");
});

test("mkdir rejects path escaping project root", async () => {
  await expect(
    fsPlugin.handlers["mkdir"]({ path: `${tmp}/../../../tmp/evil` }, ctx),
  ).rejects.toThrow("escapes project root");
});

function dryCtx() {
  const logged: string[] = [];
  const logger = new Logger({ sink: (line) => logged.push(line) });
  return { ...ctx, dryRun: true, logger, logged };
}

test("move renames file", async () => {
  writeFileSync(`${tmp}/a.txt`, "hello");
  await fsPlugin.handlers["move"]({ src: `${tmp}/a.txt`, dst: `${tmp}/b.txt` }, ctx);
  expect(existsSync(`${tmp}/a.txt`)).toBe(false);
  expect(existsSync(`${tmp}/b.txt`)).toBe(true);
});

test("delete removes directory recursively", async () => {
  mkdirSync(`${tmp}/dir`, { recursive: true });
  writeFileSync(`${tmp}/dir/nested.txt`, "x");
  await fsPlugin.handlers["delete"]({ path: `${tmp}/dir` }, ctx);
  expect(existsSync(`${tmp}/dir`)).toBe(false);
});

test("copy dry-run logs and does not write", async () => {
  writeFileSync(`${tmp}/a.txt`, "hello");
  const dry = dryCtx();
  await fsPlugin.handlers["copy"]({ src: `${tmp}/a.txt`, dst: `${tmp}/sub/b.txt` }, dry);
  expect(existsSync(`${tmp}/a.txt`)).toBe(true);
  expect(existsSync(`${tmp}/sub`)).toBe(false);
  expect(existsSync(`${tmp}/sub/b.txt`)).toBe(false);
  expect(dry.logged.some((line) => line.includes("[dry-run]") && line.includes("fs/copy"))).toBe(
    true,
  );
});

test("move dry-run logs and does not rename", async () => {
  writeFileSync(`${tmp}/a.txt`, "hello");
  const dry = dryCtx();
  await fsPlugin.handlers["move"]({ src: `${tmp}/a.txt`, dst: `${tmp}/sub/b.txt` }, dry);
  expect(existsSync(`${tmp}/a.txt`)).toBe(true);
  expect(existsSync(`${tmp}/sub`)).toBe(false);
  expect(dry.logged.some((line) => line.includes("[dry-run]") && line.includes("fs/move"))).toBe(
    true,
  );
});

test("delete dry-run does not remove file or directory", async () => {
  writeFileSync(`${tmp}/a.txt`, "hello");
  mkdirSync(`${tmp}/dir`, { recursive: true });
  writeFileSync(`${tmp}/dir/nested.txt`, "keep");
  const dry = dryCtx();
  await fsPlugin.handlers["delete"]({ path: `${tmp}/a.txt` }, dry);
  await fsPlugin.handlers["delete"]({ path: `${tmp}/dir` }, dry);
  expect(existsSync(`${tmp}/a.txt`)).toBe(true);
  expect(existsSync(`${tmp}/dir/nested.txt`)).toBe(true);
  expect(dry.logged.some((line) => line.includes("[dry-run]") && line.includes("fs/delete"))).toBe(
    true,
  );
});

test("mkdir dry-run logs and does not create directory", async () => {
  const dry = dryCtx();
  await fsPlugin.handlers["mkdir"]({ path: `${tmp}/newdir` }, dry);
  expect(existsSync(`${tmp}/newdir`)).toBe(false);
  expect(dry.logged.some((line) => line.includes("[dry-run]") && line.includes("fs/mkdir"))).toBe(
    true,
  );
});

test("delete dry-run still rejects path escaping project root", async () => {
  const dry = dryCtx();
  await expect(fsPlugin.handlers["delete"]({ path: "../../etc/passwd" }, dry)).rejects.toThrow(
    "escapes project root",
  );
});
