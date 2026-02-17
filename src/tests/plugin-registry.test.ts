import { expect, test } from "bun:test"
import { PluginRegistry } from "../plugin-registry"
import type { BoltPlugin } from "../plugin"

const makePlugin = (ns: string): BoltPlugin => ({
  namespace: ns,
  handlers: {
    "do-thing": async () => {},
  },
})

test("register and get a plugin", () => {
  const reg = new PluginRegistry()
  reg.register(makePlugin("myplugin"))
  expect(reg.get("myplugin")).toBeDefined()
})

test("get returns undefined for unknown namespace", () => {
  const reg = new PluginRegistry()
  expect(reg.get("nope")).toBeUndefined()
})

test("later registration overrides earlier for same namespace", () => {
  const reg = new PluginRegistry()
  const a = makePlugin("ns")
  const b: BoltPlugin = { namespace: "ns", handlers: { "other": async () => {} } }
  reg.register(a)
  reg.register(b)
  expect(reg.get("ns")).toBe(b)
})

test("listNamespaces returns all registered namespaces", () => {
  const reg = new PluginRegistry()
  reg.register(makePlugin("a"))
  reg.register(makePlugin("b"))
  expect(reg.listNamespaces().sort()).toEqual(["a", "b"])
})
