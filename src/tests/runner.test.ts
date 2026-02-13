import { expect, test } from "bun:test"
import { Runner } from "../runner"
import { testCfg } from "./env"
import type { BoltConfig } from "../config"

const cfg: BoltConfig = {
  ...testCfg,
  actions: {
    a: { steps: [{ run: "echo a" }] },
    b: { depends: ["a"], steps: [{ run: "echo b" }] },
  },
}

test("runs action steps in order", async () => {
  const ran: string[] = []
  const runner = new Runner(cfg, { dryRun: true, onStep: (s) => ran.push(s) })
  await runner.run("a")
  expect(ran).toEqual(["echo a"])
})

test("runs depends before action", async () => {
  const ran: string[] = []
  const runner = new Runner(cfg, { dryRun: true, onStep: (s) => ran.push(s) })
  await runner.run("b")
  expect(ran).toEqual(["echo a", "echo b"])
})

test("detects dependency cycles", async () => {
  const cyclic: BoltConfig = {
    ...cfg,
    actions: {
      x: { depends: ["y"], steps: [] },
      y: { depends: ["x"], steps: [] },
    },
  }
  const runner = new Runner(cyclic, { dryRun: true })
  expect(runner.run("x")).rejects.toThrow("cycle")
})

test("throws on unknown action", async () => {
  const runner = new Runner(cfg, { dryRun: true })
  expect(runner.run("nope")).rejects.toThrow("nope")
})
