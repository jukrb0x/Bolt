import { describe, test, expect } from "bun:test";
import { handler, PluginBase, definePlugin, defineHandler } from "../src/plugin";
import { z } from "zod";

const flatSchema = z.object({
  target: z.string().describe("Build target"),
  count: z.coerce.number().default(1),
  flag: z.coerce.boolean().optional(),
  mode: z.enum(["a", "b"]),
});

const flatJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    target: { type: "string", description: "Build target" },
    count: { type: "number", default: 1 },
    flag: { type: "boolean" },
    mode: { type: "string", enum: ["a", "b"] },
  },
  required: ["target", "mode"],
};

describe("@handler", () => {
  test("string form still fills a manifest with ai false", () => {
    class Legacy extends PluginBase {
      namespace = "legacy";

      @handler("Build ${target}", "build-it")
      async build(_params: Record<string, string>, _ctx: any) {}

      @handler()
      async kill(_params: Record<string, string>, _ctx: any) {}
    }

    const instance = new Legacy();
    expect(Object.keys(instance.handlers)).toEqual(["build-it", "kill"]);
    expect(instance.manifest.handlers["build-it"]).toEqual({
      description: "Build ${target}",
      ai: false,
    });
    expect(instance.manifest.handlers.kill).toEqual({ ai: false });
    expect(instance.describe("build-it", { target: "editor" })).toBe("Build editor");
    expect("deps" in instance.manifest).toBe(false);
  });

  test("object form shares HandlerDef fields and emits JSON Schema", () => {
    class Modern extends PluginBase {
      namespace = "modern";

      @handler({
        description: "Build ${target}",
        ai: "confirm",
        alias: "build-it",
        params: flatSchema,
      })
      async build(_params: Record<string, string>, _ctx: any) {}
    }

    const entry = new Modern().manifest.handlers["build-it"];
    expect(entry?.ai).toBe("confirm");
    expect(entry?.description).toBe("Build ${target}");
    expect(entry?.paramsSchema).toEqual(flatJsonSchema);
    expect(entry?.params).toBe(flatSchema);
  });
});

describe("params schema subset", () => {
  test("rejects schemas outside the flat subset", () => {
    const bad = [
      z.string(),
      z.object({ a: z.array(z.string()) }),
      z.object({ a: z.object({ b: z.string() }) }),
      z.object({ a: z.union([z.string(), z.enum(["x"])]) }),
      z.object({ a: z.string().transform((value) => value) }),
      z.object({ a: z.number() }),
      z.object({ a: z.boolean() }),
      z.object({ a: z.string().min(1) }),
      z.object({ a: z.string() }).strict(),
    ];
    for (const params of bad) {
      expect(() => defineHandler({ params }, async () => {})).toThrow(/params|Unsupported/);
    }
  });

  test("rejects ai values outside false, true, and confirm", () => {
    expect(() => defineHandler({ ai: "ask" as "confirm" }, async () => {})).toThrow(
      /ai must be false/,
    );
  });
});

describe("definePlugin()", () => {
  test("returns a plugin object and a manifest, not a descriptor", () => {
    const metadata = z.object({ host: z.string() });
    const plugin = definePlugin({
      namespace: "my-plugin",
      version: "1.0.0",
      description: "A test plugin",
      metadata,
      handlers: {
        run: defineHandler(
          { description: "Run ${input}", ai: true, params: z.object({ input: z.string() }) },
          async () => {},
        ),
      },
    });

    expect(plugin.namespace).toBe("my-plugin");
    expect(plugin.handlers.run).toBeFunction();
    expect(plugin.manifest).toEqual({
      namespace: "my-plugin",
      version: "1.0.0",
      description: "A test plugin",
      metadata,
      handlers: {
        run: {
          description: "Run ${input}",
          ai: true,
          params: expect.any(Object),
          paramsSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: { input: { type: "string" } },
            required: ["input"],
          },
        },
      },
    });
    expect("deps" in plugin.manifest).toBe(false);
    expect(plugin.describe?.("run", { input: "job" })).toBe("Run job");
  });

  test("rejects unimplemented deps and the old configSchema field", () => {
    expect(() =>
      definePlugin({
        namespace: "with-deps",
        version: "1.0.0",
        description: "Depends on others",
        handlers: { run: defineHandler({}, async () => {}) },
        deps: ["git"],
      } as any),
    ).toThrow(/deps/);
  });

  test("requires defineHandler for each handler", () => {
    expect(() =>
      definePlugin({
        namespace: "raw",
        version: "1.0.0",
        description: "raw",
        handlers: { run: async () => {} },
      } as any),
    ).toThrow(/defineHandler/);
  });
});

test("keeps a false boolean default in JSON Schema", () => {
  const plugin = definePlugin({
    namespace: "flag",
    version: "1.0.0",
    description: "flag",
    handlers: {
      run: defineHandler(
        { params: z.object({ force: z.coerce.boolean().default(false) }) },
        async () => {},
      ),
    },
  });
  expect(plugin.manifest.handlers.run?.paramsSchema).toEqual({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: { force: { type: "boolean", default: false } },
  });
  expect(plugin.manifest.handlers.run?.paramsSchema).not.toHaveProperty("required");
});

describe("PluginBase.withDescriptor()", () => {
  test("sets plugin fields and keeps deps off the manifest", () => {
    class MyPlugin extends PluginBase.withDescriptor({
      namespace: "test-wd",
      version: "1.0.0",
      description: "Test withDescriptor",
      metadata: z.object({ token: z.string() }),
    }) {
      @handler("Say hello")
      async hello(_params: Record<string, string>, _ctx: any) {}

      async onInit() {}
    }

    const instance = new MyPlugin({ token: "abc" }, { git: { namespace: "git", handlers: {} } });
    expect(instance.namespace).toBe("test-wd");
    expect(instance.version).toBe("1.0.0");
    expect(instance.description).toBe("Test withDescriptor");
    expect(instance.config).toEqual({ token: "abc" });
    expect(instance.deps?.git.namespace).toBe("git");
    expect(instance.manifest.metadata?.safeParse({ token: "abc" }).success).toBe(true);
    expect("deps" in instance.manifest).toBe(false);
    expect("onInit" in instance.manifest).toBe(false);
    expect(instance.onInit).toBeFunction();
    expect(instance.manifest.handlers.hello).toEqual({ description: "Say hello", ai: false });
  });
});
