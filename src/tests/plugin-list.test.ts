import { expect, test } from "bun:test";
import { PluginRegistry } from "../plugin-registry";

test("listNamespaces returns registered namespaces", () => {
  const reg = new PluginRegistry();
  reg.register({ namespace: "foo", handlers: { build: async () => {} } });
  reg.register({ namespace: "bar", handlers: { run: async () => {}, clean: async () => {} } });
  expect(reg.listNamespaces()).toEqual(["foo", "bar"]);
});

test("get returns handlers for namespace", () => {
  const reg = new PluginRegistry();
  reg.register({ namespace: "foo", handlers: { build: async () => {}, run: async () => {} } });
  const plugin = reg.get("foo");
  expect(Object.keys(plugin!.handlers).sort()).toEqual(["build", "run"]);
});
