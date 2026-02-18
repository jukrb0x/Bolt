import { expect, test } from "bun:test"
import uePlugin from "../../plugins/ue"
import { testCfg, PROJECT_NAME } from "../env"
import type { BoltPluginContext } from "../../plugin"
import { Logger } from "../../logger"

function makeCtx(dryRun = true): BoltPluginContext & { logged: string[] } {
  const logged: string[] = []
  const logger = new Logger({ sink: (l: string) => logged.push(l) })
  return { cfg: testCfg, dryRun, logger, logged }
}

test("build editor target produces correct command", async () => {
  const ctx = makeCtx()
  await uePlugin.handlers["build"]({ target: "editor" }, ctx)
  const cmd = ctx.logged.find(l => l.includes("Build.bat")) ?? ""
  expect(cmd).toContain("Build.bat")
  expect(cmd).toContain(`${PROJECT_NAME}Editor`)
  expect(cmd).toContain("Development")
  expect(cmd).toContain(`${PROJECT_NAME}.uproject`)
})

test("build program target uses target.name", async () => {
  const ctx = makeCtx()
  await uePlugin.handlers["build"]({ target: "client" }, ctx)
  const cmd = ctx.logged.find(l => l.includes("Build.bat")) ?? ""
  expect(cmd).toContain("MyClient")
  expect(cmd).toContain("Shipping")
})

test("build throws on unknown target", async () => {
  const ctx = makeCtx()
  await expect(uePlugin.handlers["build"]({ target: "nope" }, ctx)).rejects.toThrow("Unknown target")
})

test("update-git produces git pull command", async () => {
  const ctx = makeCtx()
  await uePlugin.handlers["update-git"]({}, ctx)
  expect(ctx.logged.some(l => l.includes("git") && l.includes("pull"))).toBe(true)
})

test("update-svn produces svn update command", async () => {
  const ctx = makeCtx()
  await uePlugin.handlers["update-svn"]({}, ctx)
  expect(ctx.logged.some(l => l.includes("svn update"))).toBe(true)
})

test("generate-project produces GenerateProjectFiles command", async () => {
  const ctx = makeCtx()
  await uePlugin.handlers["generate-project"]({}, ctx)
  expect(ctx.logged.some(l => l.includes("GenerateProjectFiles.bat"))).toBe(true)
})
