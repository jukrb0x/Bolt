import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { generateAiContext } from "../ai-context";
import type { BoltConfig } from "../config";
import { handler, param, PluginBase } from "../plugin";
import { PluginRegistry } from "../plugin-registry";
import { testCfg } from "./env";

const cfg: BoltConfig = {
  ...testCfg,
  tasks: { build: [{ uses: "ue/build" }] },
  flows: { daily: { steps: ["build"], continue_on_fail: [] } },
};

const CONFIRM = "This step has side effects and the user must run `bolt run` themselves.";

function hashOf(content: string): string {
  const match = content.match(/<!-- context hash: ([0-9a-f]{16}) -->/);
  expect(match).not.toBeNull();
  return match![1];
}

function writeProject(yaml: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-ai-"));
  const configPath = path.join(dir, "bolt.yaml");
  writeFileSync(configPath, yaml);
  return configPath;
}

test("context hash covers bolt.yaml and the written plugin catalog", () => {
  const configPath = writeProject("project: { name: Demo }\n");
  const dir = path.dirname(configPath);
  writeFileSync(path.join(dir, "bolt.local.yaml"), "notifications: {}\n");
  mkdirSync(path.join(dir, "node_modules"));
  writeFileSync(path.join(dir, "node_modules", "pkg.js"), "ignored\n");
  writeFileSync(path.join(dir, "plugin.ts"), "export {}\n");

  const registry = new PluginRegistry();
  const context = generateAiContext(cfg, configPath, registry);

  const hashAt = context.indexOf("<!-- context hash:");
  const inputsAt = context.indexOf("<!-- inputs: bolt.yaml, plugin manifests -->");
  expect(hashAt).toBeGreaterThan(-1);
  expect(inputsAt).toBeGreaterThan(hashAt);
  expect(context).not.toContain("bolt.yaml hash:");
  expect(hashOf(context)).toMatch(/^[0-9a-f]{16}$/);

  const hash = hashOf(context);
  writeFileSync(path.join(dir, "bolt.local.yaml"), "notifications: { slack: true }\n");
  writeFileSync(path.join(dir, "node_modules", "pkg.js"), "changed\n");
  writeFileSync(path.join(dir, "plugin.ts"), "export const changed = true;\n");
  expect(hashOf(generateAiContext(cfg, configPath, registry))).toBe(hash);

  writeFileSync(configPath, "project: { name: Other }\n");
  expect(hashOf(generateAiContext(cfg, configPath, registry))).not.toBe(hash);
});

test("lists loaded plugins after tasks and flows", () => {
  class Demo extends PluginBase {
    namespace = "demo";

    @handler("Copy ${src} to ${dst}")
    async copy(
      @param("src", "Source file")
      @param("dst", "Destination file")
      _params: Record<string, string>,
      _ctx: unknown,
    ) {}

    @handler()
    async ping(_params: Record<string, string>, _ctx: unknown) {}
  }

  const registry = new PluginRegistry();
  registry.register(new Demo());
  registry.register({
    namespace: "alpha",
    handlers: { zed: async () => {}, mid: async () => {} },
    describe: (name) => (name === "mid" ? "Middle step" : undefined),
  });

  const context = generateAiContext(cfg, import.meta.path, registry);
  const tasksAt = context.indexOf("## Tasks");
  const flowsAt = context.indexOf("## Flows");
  const pluginsAt = context.indexOf("## Plugins");
  const targetsAt = context.indexOf("## Targets");
  expect(tasksAt).toBeGreaterThan(-1);
  expect(flowsAt).toBeGreaterThan(tasksAt);
  expect(pluginsAt).toBeGreaterThan(flowsAt);
  expect(targetsAt).toBeGreaterThan(pluginsAt);

  const plugins = context.slice(pluginsAt, targetsAt);
  const alpha = plugins.indexOf("### `alpha`");
  const demo = plugins.indexOf("### `demo`");
  expect(alpha).toBeGreaterThan(-1);
  expect(demo).toBeGreaterThan(alpha);

  const alphaBlock = plugins.slice(alpha, demo);
  expect(alphaBlock.indexOf("**mid**")).toBeLessThan(alphaBlock.indexOf("**zed**"));
  expect(alphaBlock).toContain("**mid** — Middle step");

  expect(plugins).toContain("**copy** — Copy src to dst");
  expect(plugins).toContain("**ping**");
  const copyAt = plugins.indexOf("**copy**");
  const pingAt = plugins.indexOf("**ping**");
  const copyBlock = plugins.slice(copyAt, pingAt);
  expect(copyBlock.indexOf("`dst`: Destination file")).toBeLessThan(
    copyBlock.indexOf("`src`: Source file"),
  );
});

test("reads plugin.manifest, drops ai false, and notes confirm side effects", () => {
  const registry = new PluginRegistry();
  const plugin = {
    namespace: "zeta",
    handlers: {
      ship: async () => {},
      peek: async () => {},
      hidden: async () => {},
      plain: async () => {},
    },
    manifest: {
      description: "Zeta tools",
      handlers: {
        ship: {
          description: "Ship the build",
          ai: "confirm" as const,
          paramsSchema: {
            type: "object",
            required: ["host"],
            properties: {
              host: { type: "string", description: "Target host" },
              force: { type: "boolean", default: false },
            },
          },
        },
        peek: { description: "Read status", ai: true as const },
        hidden: { description: "Do not list", ai: false as const },
        plain: { description: "No flag yet" },
      },
    },
  };
  registry.register(plugin);

  const context = generateAiContext(cfg, import.meta.path, registry);
  const block = context.slice(context.indexOf("### `zeta`"));
  expect(block).toContain("Zeta tools");
  expect(block).not.toContain("hidden");
  expect(block).not.toContain("Do not list");
  expect(block.indexOf("**peek**")).toBeLessThan(block.indexOf("**plain**"));
  expect(block.indexOf("**plain**")).toBeLessThan(block.indexOf("**ship**"));
  expect(block).toContain("**peek** — Read status");
  expect(block).toContain("**plain** — No flag yet");
  expect(block).toContain("**ship** — Ship the build");
  expect(block).toContain("`host` (string, required): Target host");
  expect(block).toContain("`force` (boolean, default false)");
  expect(block).toContain(CONFIRM);
  expect(
    context.match(new RegExp(CONFIRM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length,
  ).toBe(1);
});

test("handler ai false is omitted without a manifest; no flag is listed", () => {
  const hidden = Object.assign(async () => {}, { ai: false as const });
  const shown = async () => {};
  const registry = new PluginRegistry();
  registry.register({
    namespace: "mix",
    handlers: { hidden, shown },
    describe: (name) => name,
  });

  const context = generateAiContext(cfg, import.meta.path, registry);
  expect(context).toContain("**shown** — shown");
  expect(context).not.toContain("**hidden**");
});

test("catalog order does not change the hash; catalog contents do", () => {
  const configPath = writeProject("name: stable\n");

  const forward = new PluginRegistry();
  forward.register({ namespace: "b", handlers: { one: async () => {} } });
  forward.register({
    namespace: "a",
    handlers: { two: async () => {}, one: async () => {} },
    describe: () => "Same",
  });

  const backward = new PluginRegistry();
  backward.register({
    namespace: "a",
    handlers: { one: async () => {}, two: async () => {} },
    describe: () => "Same",
  });
  backward.register({ namespace: "b", handlers: { one: async () => {} } });

  const left = generateAiContext(cfg, configPath, forward);
  const right = generateAiContext(cfg, configPath, backward);
  expect(left).toBe(right);

  const smaller = new PluginRegistry();
  smaller.register({ namespace: "a", handlers: { one: async () => {} }, describe: () => "Same" });
  expect(hashOf(generateAiContext(cfg, configPath, smaller))).not.toBe(hashOf(left));
});

test("omits the plugins section when every handler is ai false", () => {
  const registry = new PluginRegistry();
  const plugin = {
    namespace: "quiet",
    handlers: { secret: async () => {} },
    manifest: { handlers: { secret: { ai: false as const, description: "Secret" } } },
  };
  registry.register(plugin);

  const context = generateAiContext(cfg, import.meta.path, registry);
  expect(context).toMatch(/<!-- context hash: [0-9a-f]{16} -->/);
  expect(context).not.toContain("## Plugins");
  expect(context).not.toContain("quiet");
  expect(context).not.toContain("Secret");
});

test("ai command uses builtinPlugins instead of a hard-coded list", () => {
  const src = readFileSync(new URL("../commands/ai.ts", import.meta.url), "utf8");
  expect(src).toContain("builtinPlugins");
  expect(src).not.toMatch(/uePlugin|fsPlugin|jsonPlugin|gitPlugin|svnPlugin/);
});
