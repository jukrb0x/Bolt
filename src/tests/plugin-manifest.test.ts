import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import path from "path";
import { PluginRegistry, buildRegistry } from "../plugin-registry";
import { Runner } from "../runner";
import { fs as fsPlugin, git as gitPlugin, json as jsonPlugin, svn as svnPlugin } from "../plugins";
import ue from "../plugins/ue";
import { defineHandler, definePlugin } from "../plugin";
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
    ai: false,
  });
  expect(ue.manifest.handlers.ini_get).toEqual({ ai: false });
  expect(Object.keys(ue.manifest.handlers).sort()).toEqual(Object.keys(ue.handlers).sort());
  expect("deps" in ue.manifest).toBe(false);

  const reg = new PluginRegistry();
  reg.register(ue);
  expect(reg.get("ue")).toBe(ue);
  expect(reg.get("ue")!.manifest!.handlers.kill.ai).toBe(false);
});

test("object plugins are reflected as ai false with no params", () => {
  const reg = new PluginRegistry();
  for (const plugin of [fsPlugin, jsonPlugin, gitPlugin, svnPlugin]) reg.register(plugin);

  for (const plugin of [fsPlugin, jsonPlugin, gitPlugin, svnPlugin]) {
    const manifest = reg.get(plugin.namespace)?.manifest;
    expect(manifest?.namespace).toBe(plugin.namespace);
    expect(Object.keys(manifest?.handlers ?? {}).sort()).toEqual(
      Object.keys(plugin.handlers).sort(),
    );
    for (const entry of Object.values(manifest?.handlers ?? {})) {
      expect(entry).toEqual({ ai: false });
    }
  }
  expect("deps" in (fsPlugin.manifest ?? {})).toBe(false);
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

test("a class plugin from another PluginBase copy keeps its manifest getter", () => {
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

  const reg = new PluginRegistry();
  reg.register(plugin);
  expect(reg.get("foreign")).toBe(plugin);
  expect(reg.get("foreign")?.manifest).toBe(manifest);
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
