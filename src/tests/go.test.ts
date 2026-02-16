import { expect, test, describe } from "bun:test"
import { parseGoArgs, resolveOps, sortByPipeline } from "../go"
import { testCfg } from "./env"

// ---------------------------------------------------------------------------
// parseGoArgs
// ---------------------------------------------------------------------------

describe("parseGoArgs", () => {
  test("bare flag → default variant", () => {
    const [result] = parseGoArgs(["--update"])
    expect(result).toEqual({ name: "update", value: "default", isExact: false })
  })

  test("flag=value → isExact with variant key", () => {
    const [result] = parseGoArgs(["--update=svn"])
    expect(result).toEqual({ name: "update", value: "svn", isExact: true })
  })

  test("build with target override", () => {
    const [result] = parseGoArgs(["--build=client"])
    expect(result).toEqual({ name: "build", value: "client", isExact: true })
  })

  test("bare build → default", () => {
    const [result] = parseGoArgs(["--build"])
    expect(result).toEqual({ name: "build", value: "default", isExact: false })
  })

  test("word style: bare word → default variant", () => {
    const [result] = parseGoArgs(["update"])
    expect(result).toEqual({ name: "update", value: "default", isExact: false })
  })

  test("word style: name:value → isExact", () => {
    const [result] = parseGoArgs(["update:svn"])
    expect(result).toEqual({ name: "update", value: "svn", isExact: true })
  })

  test("word style: build:client → isExact target override", () => {
    const [result] = parseGoArgs(["build:client"])
    expect(result).toEqual({ name: "build", value: "client", isExact: true })
  })

  test("multiple tokens → array of ParsedOp", () => {
    const result = parseGoArgs(["--update=svn", "--build", "--start"])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ name: "update", value: "svn", isExact: true })
    expect(result[1]).toEqual({ name: "build",  value: "default", isExact: false })
    expect(result[2]).toEqual({ name: "start",  value: "default", isExact: false })
  })
})

// ---------------------------------------------------------------------------
// resolveOps
// ---------------------------------------------------------------------------

describe("resolveOps", () => {
  test("--update → 2 steps (update-git + update-svn)", () => {
    const parsed = parseGoArgs(["--update"])
    const [op] = resolveOps(parsed, testCfg)
    expect(op.name).toBe("update")
    expect(op.steps).toHaveLength(2)
    expect(op.steps[0].uses).toBe("ue/update-git")
    expect(op.steps[1].uses).toBe("ue/update-svn")
  })

  test("--update=svn → 1 step using svn variant", () => {
    const parsed = parseGoArgs(["--update=svn"])
    const [op] = resolveOps(parsed, testCfg)
    expect(op.name).toBe("update[svn]")
    expect(op.steps).toHaveLength(1)
    expect(op.steps[0].uses).toBe("ue/update-svn")
  })

  test("--build → steps from ops.build.default", () => {
    const parsed = parseGoArgs(["--build"])
    const [op] = resolveOps(parsed, testCfg)
    expect(op.name).toBe("build")
    expect(op.steps).toHaveLength(1)
    expect(op.steps[0].uses).toBe("ue/build")
    expect(op.steps[0].with?.target).toBe("editor")
  })

  test("--build=client → default steps with with.target overridden", () => {
    const parsed = parseGoArgs(["--build=client"])
    const [op] = resolveOps(parsed, testCfg)
    expect(op.name).toBe("build[client]")
    expect(op.steps).toHaveLength(1)
    expect(op.steps[0].uses).toBe("ue/build")
    expect(op.steps[0].with?.target).toBe("client")
  })

  test("--build=client does not mutate original testCfg steps", () => {
    const parsed = parseGoArgs(["--build=client"])
    resolveOps(parsed, testCfg)
    // Original default step should still have "editor"
    expect(testCfg.ops.build.default[0].with?.target).toBe("editor")
  })

  test("unknown op → throws", () => {
    const parsed = parseGoArgs(["--foo"])
    expect(() => resolveOps(parsed, testCfg)).toThrow('Unknown op: "foo"')
  })

  test("unknown variant → throws", () => {
    const parsed = parseGoArgs(["--update"])
    // Manually set isExact=false, value="bar" to trigger unknown-variant path
    parsed[0].value = "bar"
    expect(() => resolveOps(parsed, testCfg)).toThrow('Unknown variant "bar" for op "update"')
  })
})

// ---------------------------------------------------------------------------
// sortByPipeline
// ---------------------------------------------------------------------------

describe("sortByPipeline", () => {
  const order = ["kill", "update", "build", "start"]

  test("sorts ops by pipeline order", () => {
    const ops = [
      { name: "start",  steps: [] },
      { name: "build",  steps: [] },
      { name: "update", steps: [] },
    ]
    const sorted = sortByPipeline(ops, order)
    expect(sorted.map(o => o.name)).toEqual(["update", "build", "start"])
  })

  test("unknown op goes to end", () => {
    const ops = [
      { name: "unknown", steps: [] },
      { name: "build",   steps: [] },
    ]
    const sorted = sortByPipeline(ops, order)
    expect(sorted.map(o => o.name)).toEqual(["build", "unknown"])
  })

  test("does not mutate input array", () => {
    const ops = [
      { name: "start",  steps: [] },
      { name: "update", steps: [] },
    ]
    const original = [...ops]
    sortByPipeline(ops, order)
    expect(ops[0].name).toBe(original[0].name)
    expect(ops[1].name).toBe(original[1].name)
  })

  test("strips [variant] suffix when matching pipeline order", () => {
    const ops = [
      { name: "start",      steps: [] },
      { name: "update[svn]", steps: [] },
    ]
    const sorted = sortByPipeline(ops, order)
    expect(sorted.map(o => o.name)).toEqual(["update[svn]", "start"])
  })
})
