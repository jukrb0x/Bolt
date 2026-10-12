import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { applyDotenv, loadDotenvFile } from "./setup";

test("applyDotenv sets unset keys and keeps existing ones", () => {
  const env: Record<string, string | undefined> = { KEEP: "already" };
  applyDotenv(
    [
      "# comment",
      'export ENGINE_ROOT="C:/Unreal"',
      "PROJECT_ROOT=C:/Projects",
      "KEEP=nope",
      "bad line",
    ].join("\n"),
    env,
  );
  expect(env.ENGINE_ROOT).toBe("C:/Unreal");
  expect(env.PROJECT_ROOT).toBe("C:/Projects");
  expect(env.KEEP).toBe("already");
});

test("loadDotenvFile skips a missing file", () => {
  const env: Record<string, string | undefined> = {};
  let called = false;
  loadDotenvFile(path.join(tmpdir(), "bolt-missing.env.local"), env, () => {
    called = true;
  });
  expect(called).toBe(false);
  expect(env).toEqual({});
});

test("loadDotenvFile parses when loadEnvFile is missing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-env-"));
  const file = path.join(dir, ".env.local");
  writeFileSync(file, "ENGINE_ROOT=/from/file\n");
  const env: Record<string, string | undefined> = {};
  loadDotenvFile(file, env, undefined);
  expect(env.ENGINE_ROOT).toBe("/from/file");
  rmSync(dir, { recursive: true, force: true });
});

test("loadDotenvFile uses loadEnvFile when it is a function", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-env-"));
  const file = path.join(dir, ".env.local");
  writeFileSync(file, "ENGINE_ROOT=/from/file\n");
  const env: Record<string, string | undefined> = {};
  let called = "";
  loadDotenvFile(file, env, (p) => {
    called = p;
  });
  expect(called).toBe(file);
  expect(env.ENGINE_ROOT).toBeUndefined();
  rmSync(dir, { recursive: true, force: true });
});
