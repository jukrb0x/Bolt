import { expect, test, beforeEach, afterEach } from "bun:test"
import jsonPlugin from "../../plugins/json"
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs"
import { testCfg } from "../env"
import type { BoltPluginContext } from "../../plugin"
import { Logger } from "../../logger"

const tmp  = "/tmp/bolt-json-plugin-test"
const file = `${tmp}/data.json`
const ctx: BoltPluginContext = { cfg: testCfg, dryRun: false, logger: new Logger() }

beforeEach(() => {
  mkdirSync(tmp, { recursive: true })
  writeFileSync(file, JSON.stringify({ a: 1, b: { c: 2 } }))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

test("set top-level key", async () => {
  await jsonPlugin.handlers["set"]({ file, key: "a", value: "99" }, ctx)
  expect(JSON.parse(readFileSync(file, "utf8")).a).toBe("99")
})

test("set nested key with dot-path", async () => {
  await jsonPlugin.handlers["set"]({ file, key: "b.c", value: "42" }, ctx)
  expect(JSON.parse(readFileSync(file, "utf8")).b.c).toBe("42")
})
