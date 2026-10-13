import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import os from "os";
import path from "path";
import { safePath } from "../plugins/path-guard";

const base = mkdtempSync(path.join(os.tmpdir(), "bolt-path-guard-"));
const root = path.join(base, "project");
const outside = path.join(base, "outside");
mkdirSync(path.join(root, "sub"), { recursive: true });
mkdirSync(outside);
afterAll(() => rmSync(base, { recursive: true, force: true }));

/** Directory symlinks need extra rights on Windows; skip those cases there if creation fails. */
function link(target: string, at: string): boolean {
  try {
    symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch {
    return false;
  }
}

test("plain ../ is still rejected; in-project paths pass", () => {
  expect(() => safePath("../outside", root)).toThrow(/escapes project root/);
  expect(safePath("sub", root)).toBe(path.join(root, "sub"));
  expect(safePath("sub/missing/file.txt", root)).toBe(path.join(root, "sub/missing/file.txt"));
});

test("an in-project symlink to an outside directory is rejected", () => {
  if (!link(outside, path.join(root, "escape"))) return;
  expect(() => safePath("escape", root)).toThrow(/through a symlink/);
});

test("a nonexistent path under a symlinked parent is judged by the real parent", () => {
  if (!link(outside, path.join(root, "escape2"))) return;
  expect(() => safePath("escape2/not/there", root)).toThrow(/through a symlink/);
  if (!link(path.join(root, "sub"), path.join(root, "inner"))) return;
  expect(safePath("inner/not/there", root)).toBe(path.join(root, "inner/not/there"));
});

test("a symlink loop is rejected with a clear error", () => {
  if (process.platform === "win32") return;
  symlinkSync(path.join(root, "loop-b"), path.join(root, "loop-a"));
  symlinkSync(path.join(root, "loop-a"), path.join(root, "loop-b"));
  expect(() => safePath("loop-a", root)).toThrow(/symlink loop/);
});
