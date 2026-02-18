import { expect, test, beforeEach, afterEach } from "bun:test"
import fsPlugin from "../../plugins/fs"
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs"
import { testCfg } from "../env"
import type { BoltPluginContext } from "../../plugin"
import { Logger } from "../../logger"

const tmp = "/tmp/bolt-fs-plugin-test"
const ctx: BoltPluginContext = { cfg: testCfg, dryRun: false, logger: new Logger() }

beforeEach(() => mkdirSync(tmp, { recursive: true }))
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

test("copy creates destination file", async () => {
  writeFileSync(`${tmp}/a.txt`, "hello")
  await fsPlugin.handlers["copy"]({ src: `${tmp}/a.txt`, dst: `${tmp}/b.txt` }, ctx)
  expect(existsSync(`${tmp}/b.txt`)).toBe(true)
})

test("delete removes file", async () => {
  writeFileSync(`${tmp}/a.txt`, "hello")
  await fsPlugin.handlers["delete"]({ path: `${tmp}/a.txt` }, ctx)
  expect(existsSync(`${tmp}/a.txt`)).toBe(false)
})

test("mkdir creates directory", async () => {
  await fsPlugin.handlers["mkdir"]({ path: `${tmp}/newdir` }, ctx)
  expect(existsSync(`${tmp}/newdir`)).toBe(true)
})
