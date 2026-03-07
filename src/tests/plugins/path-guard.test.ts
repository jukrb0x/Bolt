import { expect, test } from "bun:test";
import { safePath } from "../../plugins/path-guard";
import path from "path";
import os from "os";

const root = path.join(os.tmpdir(), "bolt-pathguard-test");

test("allows path inside root", () => {
  const result = safePath("subdir/file.txt", root);
  expect(result).toBe(path.resolve(root, "subdir/file.txt"));
});

test("allows path equal to root", () => {
  const result = safePath(".", root);
  expect(result).toBe(path.resolve(root));
});

test("rejects path traversal with ../", () => {
  expect(() => safePath("../../etc/passwd", root)).toThrow("escapes project root");
});

test("rejects absolute path outside root", () => {
  // Use a path that is definitely not under root
  const outside = path.resolve(root, "..", "other");
  expect(() => safePath(outside, root)).toThrow("escapes project root");
});

test("rejects sneaky traversal that resolves outside root", () => {
  expect(() => safePath("subdir/../../..", root)).toThrow("escapes project root");
});

test("allows absolute path that is inside root", () => {
  const inside = path.join(root, "data", "file.json");
  const result = safePath(inside, root);
  expect(result).toBe(path.resolve(inside));
});
