import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import path from "path";
import { PluginRegistry, buildRegistry } from "../plugin-registry";
import { Runner } from "../runner";
import { fs as fsPlugin, git as gitPlugin, json as jsonPlugin, svn as svnPlugin } from "../plugins";
import ue from "../plugins/ue";
import {
  PLUGIN_API_VERSION,
  PLUGIN_BRAND,
  brandPlugin,
  defineHandler,
  definePlugin,
  isBrandedPlugin,
} from "../plugin";
import { z } from "zod";
import { testCfg } from "./env";

const tmp = path.join(import.meta.dir, ".tmp-plugin-manifest");

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("string @handler on ue produces a manifest and does not invent params", () => {
  expect(ue.manifest.namespace).toBe("ue");
  expect(ue.manifest.version).toBe("1.0.0");
  expect(ue.manifest.description).toBe("Unreal Engine build and editor automation");
  expect(ue.manifest.handlers.build).toEqual({
    description: "Build target: ${target} with config: ${config}",
    ai: "confirm",
  });
  expect(ue.manifest.handlers.ini_get).toEqual({ ai: true });
  expect(ue.manifest.handlers.ini_read_all.ai).toBe(true);
  expect(ue.manifest.handlers.info.ai).toBe(true);
  expect(Object.keys(ue.manifest.handlers).sort()).toEqual(Object.keys(ue.handlers).sort());
  expect("deps" in ue.manifest).toBe(false);

  const reg = new PluginRegistry();
  reg.register(ue);
  expect(reg.get("ue")).toBe(ue);
  expect(reg.get("ue")!.manifest!.handlers.kill.ai).toBe(false);
});

test("plain object plugins are reflected as ai false with no params", () => {
  const reg = new PluginRegistry();
  const plugin = {
    namespace: "plain",
    handlers: { copy: async () => {}, drop: async () => {} },
  };
  reg.register(plugin);
  expect(reg.get("plain")?.manifest).toEqual({
    namespace: "plain",
    version: "",
    description: "",
    handlers: { copy: { ai: false }, drop: { ai: false } },
  });
  expect("deps" in (fsPlugin.manifest ?? {})).toBe(false);
  expect(fsPlugin.manifest?.handlers.copy?.ai).toBe("confirm");
  expect(fsPlugin.manifest?.handlers.delete?.ai).toBe(false);
  expect(jsonPlugin.manifest?.handlers.set?.ai).toBe("confirm");
});

test("built-in git and svn declare plugin API v2 with per-handler ai and vcs tags", () => {
  const reg = new PluginRegistry();
  reg.register(gitPlugin);
  reg.register(svnPlugin);
  const summary = (ns: string) =>
    Object.fromEntries(
      Object.entries(reg.get(ns)!.manifest!.handlers).map(([name, h]) => [
        name,
        { ai: h.ai, capabilities: h.capabilities },
      ]),
    );
  expect(gitPlugin.apiVersion).toBe(2);
  expect(svnPlugin.apiVersion).toBe(2);
  expect(summary("git")).toEqual({
    pull: { ai: "confirm", capabilities: ["vcs.sync"] },
    status: { ai: "confirm", capabilities: undefined },
    info: { ai: true, capabilities: ["vcs.info"] },
    checkout: { ai: false, capabilities: undefined },
    clone: { ai: false, capabilities: undefined },
  });
  expect(summary("svn")).toEqual({
    update: { ai: "confirm", capabilities: ["vcs.sync"] },
    cleanup: { ai: false, capabilities: undefined },
    revert: { ai: false, capabilities: undefined },
    info: { ai: true, capabilities: ["vcs.info"] },
    commit: { ai: false, capabilities: undefined },
    add: { ai: false, capabilities: undefined },
    status: { ai: "confirm", capabilities: undefined },
  });
  expect(reg.findByCapability("vcs.sync").map((m) => m.ref)).toEqual(["git/pull", "svn/update"]);
  expect(reg.findByCapability("vcs", { exact: false }).map((m) => m.ref)).toEqual([
    "git/info",
    "git/pull",
    "svn/info",
    "svn/update",
  ]);
  expect(reg.findByCapability("vcs")).toEqual([]);
});

test("a hand-written manifest on an object plugin is replaced", () => {
  const reg = new PluginRegistry();
  const plugin = {
    namespace: "fake",
    handlers: { run: async () => {} },
    manifest: {
      namespace: "fake",
      version: "9.9.9",
      description: "hand maintained",
      handlers: { run: { ai: true as const } },
    },
  };
  reg.register(plugin);
  expect(reg.get("fake")?.manifest).toEqual({
    namespace: "fake",
    version: "",
    description: "",
    handlers: { run: { ai: false } },
  });
});

test("loadFromPath keeps the manifest definePlugin generated", async () => {
  const dir = path.join(tmp, "defined");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "index.ts"),
    `
import { defineHandler, definePlugin } from ${JSON.stringify(path.join(import.meta.dir, "../plugin.ts"))};
import { z } from "zod";
export default definePlugin({
  namespace: "defined",
  version: "0.2.0",
  description: "defined from a file",
  handlers: {
    run: defineHandler({ ai: true, params: z.object({ name: z.string() }) }, async () => {}),
  },
});
`,
  );
  const reg = new PluginRegistry();
  await reg.loadFromPath("defined", path.join(dir, "index.ts"));
  const manifest = reg.get("defined")?.manifest;
  expect(manifest?.version).toBe("0.2.0");
  expect(manifest?.handlers.run?.ai).toBe(true);
  expect(manifest?.handlers.run?.paramsSchema).toEqual({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  });
});

test("auto-discover load failure prints the directory and does not warn-and-skip", async () => {
  const pluginsDir = path.join(tmp, "plugins");
  const pluginDir = path.join(pluginsDir, "broken");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(path.join(pluginDir, "index.ts"), "export default { namespace: 'broken' };\n");

  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const reg = new PluginRegistry();
    await expect(reg.loadDirectory(pluginsDir)).rejects.toThrow(pluginDir);
    await expect(reg.loadDirectory(pluginsDir)).rejects.toThrow(/no default export with handlers/);
  } finally {
    console.warn = original;
  }
  expect(warnings).toEqual([]);
});

test("project auto-discover compile failure fails with the plugin directory", async () => {
  const root = path.join(tmp, "project");
  const pluginDir = path.join(root, ".bolt", "plugins", "syntax");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(path.join(pluginDir, "index.ts"), "export default class {\n");

  const reg = new PluginRegistry();
  await expect(reg.loadDirectory(path.join(root, ".bolt", "plugins"), root)).rejects.toThrow(
    pluginDir,
  );
  await expect(reg.loadDirectory(path.join(root, ".bolt", "plugins"), root)).rejects.toThrow(
    /Expected "}"/,
  );
});

test("explicit plugins: failure fails with the directory", async () => {
  const root = path.join(tmp, "explicit");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "missing-plugin.ts"), "export default {};\n");

  await expect(
    buildRegistry({ plugins: [{ namespace: "missing", path: "./missing-plugin.ts" }] }, root, []),
  ).rejects.toThrow(root);
  await expect(
    buildRegistry({ plugins: [{ namespace: "missing", path: "./missing-plugin.ts" }] }, root, []),
  ).rejects.toThrow(/no default export with handlers/);
});

test("runner safeParses params and does not prompt for ai confirm", async () => {
  const root = path.join(tmp, "run");
  const outFile = path.join(root, "out.json");
  mkdirSync(root, { recursive: true });
  const source = [
    'import { writeFileSync } from "fs";',
    `import { defineHandler, definePlugin } from ${JSON.stringify(path.join(import.meta.dir, "../plugin.ts"))};`,
    'import { z } from "zod";',
    "",
    "let hooks = 0;",
    "export default definePlugin({",
    '  namespace: "echo",',
    '  version: "1.0.0",',
    '  description: "echo",',
    "  handlers: {",
    "    run: defineHandler(",
    "      {",
    '        ai: "confirm",',
    "        params: z.object({",
    "          n: z.coerce.number(),",
    '          name: z.string().default("x"),',
    "        }),",
    "      },",
    "      async (params) => {",
    `        writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ params, hooks }));`,
    "      },",
    "    ),",
    "  },",
    "});",
    "",
  ].join("\n");
  writeFileSync(path.join(root, "echo.ts"), source);

  const cfg = {
    ...testCfg,
    plugins: [{ namespace: "echo", path: "./echo.ts" }],
    tasks: { go: [{ uses: "echo/run", with: { n: "4" } }] },
    flows: {},
  };
  await new Runner(cfg, { dryRun: true, configDir: root }).runTask("go");
  expect(JSON.parse(readFileSync(outFile, "utf8"))).toEqual({
    params: { n: 4, name: "x" },
    hooks: 0,
  });

  rmSync(outFile);
  const bad = {
    ...cfg,
    tasks: { go: [{ uses: "echo/run", with: { n: "nope" } }] },
  };
  await expect(new Runner(bad, { dryRun: true, configDir: root }).runTask("go")).rejects.toThrow(
    /Invalid params for "echo\/run":\s+n:/,
  );
  expect(existsSync(outFile)).toBe(false);
});

test("class @handler params are safeParsed and string @handler params stay strings", async () => {
  const root = path.join(tmp, "class-run");
  const outFile = path.join(root, "out.json");
  mkdirSync(root, { recursive: true });
  const source = [
    'import { writeFileSync } from "fs";',
    `import { PluginBase, handler } from ${JSON.stringify(path.join(import.meta.dir, "../plugin.ts"))};`,
    'import { z } from "zod";',
    "",
    "class Echo extends PluginBase {",
    '  namespace = "echo";',
    "  @handler({",
    '    ai: "confirm",',
    "    params: z.object({ n: z.coerce.number() }),",
    "  })",
    "  async run(params: { n: number }) {",
    `    writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(params));`,
    "  }",
    "  @handler('Keep ${input}')",
    "  async raw(params: Record<string, string>) {",
    `    writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(params));`,
    "  }",
    "}",
    "export default Echo;",
    "",
  ].join("\n");
  writeFileSync(path.join(root, "echo.ts"), source);

  const base = { ...testCfg, plugins: [{ namespace: "echo", path: "./echo.ts" }], flows: {} };
  await new Runner(
    { ...base, tasks: { go: [{ uses: "echo/run", with: { n: "2" } }] } },
    { dryRun: true, configDir: root },
  ).runTask("go");
  expect(JSON.parse(readFileSync(outFile, "utf8"))).toEqual({ n: 2 });

  await new Runner(
    { ...base, tasks: { go: [{ uses: "echo/raw", with: { input: "hi" } }] } },
    { dryRun: true, configDir: root },
  ).runTask("go");
  expect(JSON.parse(readFileSync(outFile, "utf8"))).toEqual({ input: "hi" });
});

test("definePlugin metadata is on the manifest and unused by this file's registry reflection", () => {
  const metadata = z.object({ host: z.string() });
  const plugin = definePlugin({
    namespace: "meta",
    version: "1.0.0",
    description: "owns metadata",
    metadata,
    handlers: { run: defineHandler({}, async () => {}) },
  });
  const reg = new PluginRegistry();
  reg.register(plugin);
  expect(reg.get("meta")?.manifest?.metadata).toBe(metadata);
  expect("deps" in (reg.get("meta")?.manifest ?? {})).toBe(false);
});

test("a branded plugin from another copy keeps its manifest without instanceof", () => {
  const manifest = {
    namespace: "foreign",
    version: "1.2.3",
    description: "other copy",
    handlers: { run: { ai: false as const } },
  };
  const proto = {};
  Object.defineProperty(proto, "manifest", {
    get() {
      return manifest;
    },
  });
  const plugin = Object.assign(Object.create(proto), {
    namespace: "foreign",
    handlers: { run: async () => {} },
  });
  brandPlugin(plugin, PLUGIN_API_VERSION);

  const reg = new PluginRegistry();
  reg.register(plugin);
  expect(reg.get("foreign")).toBe(plugin);
  expect(reg.get("foreign")?.manifest).toBe(manifest);
  expect(isBrandedPlugin(plugin)).toBe(true);
  expect(plugin.apiVersion).toBe(PLUGIN_API_VERSION);
});

test("a manifest getter without the plugin brand is rejected", () => {
  const proto = {};
  Object.defineProperty(proto, "manifest", {
    get() {
      return { namespace: "foreign", version: "1", description: "", handlers: {} };
    },
  });
  const plugin = Object.assign(Object.create(proto), {
    namespace: "foreign",
    handlers: { run: async () => {} },
  });
  const reg = new PluginRegistry();
  expect(() => reg.register(plugin)).toThrow(/Symbol\.for\("boltstack\.plugin"\)/);
  expect(() => reg.register(plugin)).toThrow(/apiVersion \(1 or 2\)/);
  expect(() => reg.register(plugin)).toThrow(/Fix: extend PluginBase or use definePlugin/);
});

test("an incompatible plugin apiVersion is rejected", () => {
  const plugin = {
    namespace: "foreign",
    handlers: { run: async () => {} },
    manifest: {
      namespace: "foreign",
      version: "1",
      description: "",
      handlers: { run: { ai: false as const } },
    },
  };
  Object.defineProperty(plugin, PLUGIN_BRAND, { value: true });
  (plugin as { apiVersion?: number }).apiVersion = 3;
  const reg = new PluginRegistry();
  expect(() => reg.register(plugin)).toThrow(/plugin API v3/);
  expect(() => reg.register(plugin)).toThrow(/supports plugin API v1 and v2/);
  expect(() => reg.register(plugin)).toThrow(/bolt self-update/);
  expect(() => reg.register(plugin)).toThrow(/bolt version --json/);
});

test("definePlugin stamps apiVersion 1 when omitted, not the host version", () => {
  const plugin = definePlugin({
    namespace: "branded",
    version: "1.0.0",
    description: "branded",
    handlers: { run: defineHandler({}, async () => {}) },
  });
  expect(isBrandedPlugin(plugin)).toBe(true);
  expect(PLUGIN_API_VERSION).toBe(2);
  expect(plugin.apiVersion).toBe(1);
  expect(plugin.manifest.pluginApi).toBe(1);
  expect((plugin as { [PLUGIN_BRAND]?: boolean })[PLUGIN_BRAND]).toBe(true);
  const v2 = definePlugin({
    namespace: "v2",
    version: "1.0.0",
    description: "v2",
    apiVersion: 2,
    handlers: { run: defineHandler({}, async () => {}) },
  });
  expect(v2.apiVersion).toBe(2);
  expect(v2.manifest.pluginApi).toBe(2);
  const v3 = () =>
    definePlugin({
      namespace: "nope",
      version: "1.0.0",
      description: "nope",
      apiVersion: 3 as 2,
      handlers: { run: defineHandler({}, async () => {}) },
    });
  expect(v3).toThrow(/apiVersion 3 is not supported/);
  expect(v3).toThrow(/bolt self-update/);
});

test("string false and true parse as booleans", async () => {
  const root = path.join(tmp, "bool");
  const outFile = path.join(root, "out.json");
  mkdirSync(root, { recursive: true });
  const source = [
    'import { writeFileSync } from "fs";',
    `import { defineHandler, definePlugin } from ${JSON.stringify(path.join(import.meta.dir, "../plugin.ts"))};`,
    'import { z } from "zod";',
    "export default definePlugin({",
    '  namespace: "flag",',
    '  version: "1.0.0",',
    '  description: "flag",',
    "  handlers: {",
    "    run: defineHandler(",
    "      { params: z.object({ force: z.coerce.boolean() }) },",
    "      async (params) => {",
    `        writeFileSync(${JSON.stringify(outFile)}, JSON.stringify(params));`,
    "      },",
    "    ),",
    "  },",
    "});",
    "",
  ].join("\n");
  writeFileSync(path.join(root, "flag.ts"), source);

  const base = {
    ...testCfg,
    plugins: [{ namespace: "flag", path: "./flag.ts" }],
    flows: {},
  };
  await new Runner(
    { ...base, tasks: { go: [{ uses: "flag/run", with: { force: "false" } }] } },
    { dryRun: true, configDir: root },
  ).runTask("go");
  expect(JSON.parse(readFileSync(outFile, "utf8"))).toEqual({ force: false });

  await new Runner(
    { ...base, tasks: { go: [{ uses: "flag/run", with: { force: "true" } }] } },
    { dryRun: true, configDir: root },
  ).runTask("go");
  expect(JSON.parse(readFileSync(outFile, "utf8"))).toEqual({ force: true });
});
