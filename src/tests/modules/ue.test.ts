import { expect, test } from "bun:test"
import { UeModule } from "../../modules/ue"
import { testCfg, PROJECT_NAME } from "../env"

test("build command for editor target", () => {
  const ue = new UeModule(testCfg, { dryRun: true })
  const cmds: string[] = []
  ue.onCommand((c) => cmds.push(c))
  ue.build({ target: "editor" })
  expect(cmds[0]).toContain("Build.bat")
  expect(cmds[0]).toContain(`${PROJECT_NAME}Editor`)
  expect(cmds[0]).toContain("Development")
  expect(cmds[0]).toContain(`${PROJECT_NAME}.uproject`)
})

test("build command for program target", () => {
  const ue = new UeModule(testCfg, { dryRun: true })
  const cmds: string[] = []
  ue.onCommand((c) => cmds.push(c))
  ue.build({ target: "client" })
  expect(cmds[0]).toContain("MyClient")
  expect(cmds[0]).toContain("Shipping")
  expect(cmds[0]).toContain(`${PROJECT_NAME}.uproject`)
})

test("throws on unknown target", () => {
  const ue = new UeModule(testCfg, { dryRun: true })
  expect(() => ue.build({ target: "nope" })).toThrow("Unknown target")
})
