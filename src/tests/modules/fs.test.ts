import { expect, test, beforeEach, afterEach } from "bun:test"
import { FsModule } from "../../modules/fs"
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs"

const tmp = "/tmp/bolt-fs-test"
beforeEach(() => mkdirSync(tmp, { recursive: true }))
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

test("copy creates destination file", () => {
  writeFileSync(`${tmp}/a.txt`, "hello")
  new FsModule().copy({ src: `${tmp}/a.txt`, dst: `${tmp}/b.txt` })
  expect(existsSync(`${tmp}/b.txt`)).toBe(true)
})

test("delete removes file", () => {
  writeFileSync(`${tmp}/a.txt`, "hello")
  new FsModule().delete({ path: `${tmp}/a.txt` })
  expect(existsSync(`${tmp}/a.txt`)).toBe(false)
})

test("mkdir creates directory", () => {
  new FsModule().mkdir({ path: `${tmp}/newdir` })
  expect(existsSync(`${tmp}/newdir`)).toBe(true)
})
