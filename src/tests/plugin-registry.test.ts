import { expect, test, beforeEach, afterEach } from "bun:test"
import { PluginRegistry, buildRegistry } from "../plugin-registry"
import type { BoltPlugin } from "../plugin"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import os from "os"
import path from "path"

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

const tmpDir = path.join(os.tmpdir(), "bolt-registry-test")

test("loadFromPath loads a plugin file", async () => {
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(
    path.join(tmpDir, "myplugin.ts"),
    `const plugin = { namespace: "myplugin", handlers: { "do": async () => {} } }; export default plugin`
  )
  const reg = new PluginRegistry()
  await reg.loadFromPath("myplugin", path.join(tmpDir, "myplugin.ts"))
  expect(reg.get("myplugin")).toBeDefined()
  rmSync(tmpDir, { recursive: true, force: true })
})

test("loadDirectory discovers plugins in subdirectories", async () => {
  const pluginDir = path.join(tmpDir, "myplugin")
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(
    path.join(pluginDir, "index.ts"),
    `const plugin = { namespace: "myplugin", handlers: { "do": async () => {} } }; export default plugin`
  )
  const reg = new PluginRegistry()
  await reg.loadDirectory(tmpDir)
  expect(reg.get("myplugin")).toBeDefined()
  rmSync(tmpDir, { recursive: true, force: true })
})

test("loadDirectory silently skips missing directory", async () => {
  const reg = new PluginRegistry()
  await expect(reg.loadDirectory("/nonexistent/path/xyz")).resolves.toBeUndefined()
})

test("buildRegistry applies priority: explicit > project > user > builtins", async () => {
  // Create a project plugin that overrides builtin "ue"
  const projectPluginDir = path.join(tmpDir, ".bolt", "plugins", "ue")
  mkdirSync(projectPluginDir, { recursive: true })
  writeFileSync(
    path.join(projectPluginDir, "index.ts"),
    `const plugin = { namespace: "ue", handlers: { "custom": async () => {} } }; export default plugin`
  )
  const builtinUe: BoltPlugin = { namespace: "ue", handlers: { "build": async () => {} } }
  const reg = await buildRegistry({ plugins: [] }, tmpDir, [builtinUe])
  // Project auto-discovery should have overridden the builtin
  expect(reg.get("ue")?.handlers["custom"]).toBeDefined()
  expect(reg.get("ue")?.handlers["build"]).toBeUndefined()
  rmSync(tmpDir, { recursive: true, force: true })
})
