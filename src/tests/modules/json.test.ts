import { expect, test, beforeEach, afterEach } from "bun:test"
import { JsonModule } from "../../modules/json"
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs"

const tmp = "/tmp/bolt-json-test"
const file = `${tmp}/data.json`

beforeEach(() => {
  mkdirSync(tmp, { recursive: true })
  writeFileSync(file, JSON.stringify({ a: 1, b: { c: 2 } }))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

test("set top-level key", () => {
  new JsonModule().set({ file, key: "a", value: "99" })
  const data = JSON.parse(readFileSync(file, "utf8"))
  expect(data.a).toBe("99")
})

test("set nested key with dot-path", () => {
  new JsonModule().set({ file, key: "b.c", value: "42" })
  const data = JSON.parse(readFileSync(file, "utf8"))
  expect(data.b.c).toBe("42")
})
