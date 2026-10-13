import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { z } from "zod";
import { generateAiContext } from "../ai-context";
import type { BoltConfig } from "../config";
import { defineHandler, definePlugin, handler, PluginBase } from "../plugin";
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

    @handler({
      description: "Copy ${src} to ${dst}",
      ai: true,
      params: z.object({
        dst: z.string().describe("Destination file"),
        src: z.string().describe("Source file"),
      }),
    })
    async copy(_params: Record<string, string>, _ctx: unknown) {}

    @handler({ ai: true })
    async ping(_params: Record<string, string>, _ctx: unknown) {}
  }

  const registry = new PluginRegistry();
  registry.register(new Demo());
  registry.register(
    definePlugin({
      namespace: "alpha",
      version: "1.0.0",
      description: "Alpha",
      handlers: {
        mid: defineHandler({ ai: true, description: "Middle step" }, async () => {}),
        zed: defineHandler({ ai: true }, async () => {}),
      },
    }),
  );

  const context = generateAiContext(cfg, import.meta.path, registry);
  const tasksAt = context.indexOf("## Tasks");
  const flowsAt = context.indexOf("## Flows");
  const pluginsAt = context.indexOf("## Plugins");
  const flagsAt = context.indexOf("## Flags");
  expect(tasksAt).toBeGreaterThan(-1);
  expect(flowsAt).toBeGreaterThan(tasksAt);
  expect(pluginsAt).toBeGreaterThan(flowsAt);
  expect(flagsAt).toBeGreaterThan(pluginsAt);

  const plugins = context.slice(pluginsAt, flagsAt);
  const alpha = plugins.indexOf("### `alpha`");
  const demo = plugins.indexOf("### `demo`");
  expect(alpha).toBeGreaterThan(-1);
  expect(demo).toBeGreaterThan(alpha);

  const alphaBlock = plugins.slice(alpha, demo);
  expect(alphaBlock.indexOf("**mid**")).toBeLessThan(alphaBlock.indexOf("**zed**"));
  expect(alphaBlock).toContain("**mid** — Middle step");

  expect(plugins).toContain("**copy** — Copy ${src} to ${dst}");
  expect(plugins).toContain("**ping**");
  const copyAt = plugins.indexOf("**copy**");
  const pingAt = plugins.indexOf("**ping**");
  const copyBlock = plugins.slice(copyAt, pingAt);
  expect(copyBlock.indexOf("`dst` (string, required): Destination file")).toBeLessThan(
    copyBlock.indexOf("`src` (string, required): Source file"),
  );
});

test("reads plugin.manifest, drops ai false, and notes confirm side effects", () => {
  const registry = new PluginRegistry();
  registry.register(
    definePlugin({
      namespace: "zeta",
      version: "1.0.0",
      description: "Zeta tools",
      handlers: {
        ship: defineHandler(
          {
            description: "Ship the build",
            ai: "confirm",
            params: z.object({
              host: z.string().describe("Target host"),
              force: z.coerce.boolean().default(false),
            }),
          },
          async () => {},
        ),
        peek: defineHandler({ description: "Read status", ai: true }, async () => {}),
        hidden: defineHandler({ description: "Do not list", ai: false }, async () => {}),
        plain: defineHandler({ description: "No flag yet", ai: true }, async () => {}),
      },
    }),
  );

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

test("handler ai false is omitted; no flag is listed", () => {
  const registry = new PluginRegistry();
  registry.register(
    definePlugin({
      namespace: "mix",
      version: "1.0.0",
      description: "Mix",
      handlers: {
        hidden: defineHandler({ ai: false }, async () => {}),
        shown: defineHandler({ ai: true, description: "shown" }, async () => {}),
      },
    }),
  );

  const context = generateAiContext(cfg, import.meta.path, registry);
  expect(context).toContain("**shown** — shown");
  expect(context).not.toContain("**hidden**");
});

test("catalog order does not change the hash; catalog contents do", () => {
  const configPath = writeProject("name: stable\n");

  const same = (namespace: string, names: string[]) =>
    definePlugin({
      namespace,
      version: "1.0.0",
      description: namespace,
      handlers: Object.fromEntries(
        names.map((name) => [
          name,
          defineHandler({ ai: true, description: "Same" }, async () => {}),
        ]),
      ),
    });

  const forward = new PluginRegistry();
  forward.register(same("b", ["one"]));
  forward.register(same("a", ["two", "one"]));

  const backward = new PluginRegistry();
  backward.register(same("a", ["one", "two"]));
  backward.register(same("b", ["one"]));

  const left = generateAiContext(cfg, configPath, forward);
  const right = generateAiContext(cfg, configPath, backward);
  expect(left).toBe(right);

  const smaller = new PluginRegistry();
  smaller.register(same("a", ["one"]));
  expect(hashOf(generateAiContext(cfg, configPath, smaller))).not.toBe(hashOf(left));
});

test("omits the plugins section when every handler is ai false", () => {
  const registry = new PluginRegistry();
  registry.register(
    definePlugin({
      namespace: "quiet",
      version: "1.0.0",
      description: "Quiet",
      handlers: {
        secret: defineHandler({ ai: false, description: "Secret" }, async () => {}),
      },
    }),
  );

  const context = generateAiContext(cfg, import.meta.path, registry);
  expect(context).toMatch(/<!-- context hash: [0-9a-f]{16} -->/);
  expect(context).not.toContain("## Plugins");
  expect(context).not.toContain("quiet");
  expect(context).not.toContain("Secret");
});

test("lists UE targets from the ue plugin config", () => {
  const registry = new PluginRegistry();
  const context = generateAiContext(
    {
      ...cfg,
      plugins: [
        {
          namespace: "ue",
          config: {
            engine: { path: "D:/UE", vcs: "git" },
            project: { path: "D:/Game", vcs: "svn" },
            uproject: "D:/Game/Game.uproject",
            targets: {
              editor: { kind: "editor", config: "DebugGame" },
              client: { kind: "program", name: "MyClient", config: "shipping" },
            },
          },
        },
      ],
    },
    import.meta.path,
    registry,
  );

  expect(context).toContain("**editor**: editor · debuggame");
  expect(context).toContain("**client**: program · MyClient · shipping");
});

test("ai command uses builtinPlugins instead of a hard-coded list", () => {
  const src = readFileSync(new URL("../commands/ai.ts", import.meta.url), "utf8");
  expect(src).toContain("builtinPlugins");
  expect(src).not.toMatch(/uePlugin|fsPlugin|jsonPlugin|gitPlugin|svnPlugin/);
});

test("capability tags appear in the catalog and change the context hash", () => {
  const configPath = writeProject("project: { name: Demo }\n");
  const make = (capability?: string) =>
    definePlugin({
      namespace: "probe",
      version: "1.0.0",
      description: "Probe",
      apiVersion: 2,
      handlers: {
        check: defineHandler(
          { ai: true, description: "Check", ...(capability ? { capability } : {}) },
          async () => {},
        ),
      },
    });
  const untagged = new PluginRegistry();
  untagged.register(make());
  const tagged = new PluginRegistry();
  tagged.register(make("doctor"));
  const before = generateAiContext(cfg, configPath, untagged);
  const after = generateAiContext(cfg, configPath, tagged);
  expect(after).toContain("<!-- manifest format: 2 -->");
  expect(after).toContain("  - capabilities: doctor");
  expect(before).not.toContain("capabilities:");
  expect(hashOf(after)).not.toBe(hashOf(before));
});
