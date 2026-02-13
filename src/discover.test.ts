import { expect, test } from "bun:test"
import { findConfig } from "./discover"
import path from "path"

test("finds bolt.yaml in current dir", async () => {
  const result = await findConfig(path.join(import.meta.dir, "../tests/fixtures"))
  expect(result).toContain("bolt.yaml")
})

test("finds bolt.yaml in parent dir", async () => {
  const result = await findConfig(path.join(import.meta.dir, "../tests/fixtures/subdir"))
  expect(result).toContain("bolt.yaml")
})

test("returns null when not found", async () => {
  const result = await findConfig("/tmp")
  expect(result).toBeNull()
})
