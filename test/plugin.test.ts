import { describe, test, expect } from "bun:test";
import { handler, param, getParamMap, PluginBase, PARAMS, definePlugin } from "../src/plugin";
import { z } from "zod";

describe("@param decorator", () => {
  test("stores parameter metadata on the class constructor", () => {
    class TestPlugin extends PluginBase {
      namespace = "test";

      @handler("Build the project")
      async build(
        @param("target", "Build target name")
        @param("config", "Build configuration")
        _params: Record<string, string>,
        _ctx: any,
      ) {}
    }

    const meta = (TestPlugin as any)[PARAMS] as Map<string, Map<string, { description: string }>>;
    expect(meta).toBeDefined();
    const buildParams = meta.get("build");
    expect(buildParams).toBeDefined();
    expect(buildParams!.get("target")).toEqual({ description: "Build target name" });
    expect(buildParams!.get("config")).toEqual({ description: "Build configuration" });
  });

  test("works independently of @handler", () => {
    class Standalone extends PluginBase {
      namespace = "standalone";

      @handler()
      async run(
        @param("file", "File to process")
        _params: Record<string, string>,
        _ctx: any,
      ) {}
    }

    const meta = (Standalone as any)[PARAMS];
    expect(meta.get("run")!.get("file")).toEqual({ description: "File to process" });
  });

  test("getParamMap returns correct data for an instance", () => {
    class WithParams extends PluginBase {
      namespace = "with-params";

      @handler()
      async deploy(
        @param("env", "Target environment")
        @param("version", "Version to deploy")
        _params: Record<string, string>,
        _ctx: any,
      ) {}
    }

    const instance = new WithParams();
    const paramMap = getParamMap(instance, "deploy");
    expect(paramMap).toBeDefined();
    expect(paramMap!.get("env")).toEqual({ description: "Target environment" });
    expect(paramMap!.get("version")).toEqual({ description: "Version to deploy" });
  });

  test("getParamMap returns undefined for methods without @param", () => {
    class NoParams extends PluginBase {
      namespace = "no-params";

      @handler()
      async run(_params: Record<string, string>, _ctx: any) {}
    }

    const instance = new NoParams();
    expect(getParamMap(instance, "run")).toBeUndefined();
  });
});

describe("definePlugin()", () => {
  test("returns a descriptor with required fields", () => {
    const descriptor = definePlugin({
      namespace: "my-plugin",
      version: "1.0.0",
      description: "A test plugin",
    });

    expect(descriptor.namespace).toBe("my-plugin");
    expect(descriptor.version).toBe("1.0.0");
    expect(descriptor.description).toBe("A test plugin");
    expect(descriptor.configSchema).toBeUndefined();
    expect(descriptor.deps).toBeUndefined();
  });

  test("accepts a Zod config schema", () => {
    const descriptor = definePlugin({
      namespace: "configured",
      version: "0.1.0",
      description: "Plugin with config",
      configSchema: z.object({
        apiKey: z.string(),
        retries: z.number().default(3),
      }),
    });

    expect(descriptor.configSchema).toBeDefined();
    // Schema should parse valid config
    const result = descriptor.configSchema!.safeParse({ apiKey: "abc" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retries).toBe(3); // default applied
    }
  });

  test("accepts deps array", () => {
    const descriptor = definePlugin({
      namespace: "with-deps",
      version: "1.0.0",
      description: "Depends on others",
      deps: ["git", "fs"],
    });

    expect(descriptor.deps).toEqual(["git", "fs"]);
  });
});

describe("PluginBase.withDescriptor()", () => {
  test("returns a subclass with namespace pre-set", () => {
    const descriptor = definePlugin({
      namespace: "test-wd",
      version: "1.0.0",
      description: "Test withDescriptor",
    });

    class MyPlugin extends PluginBase.withDescriptor(descriptor) {
      @handler("Say hello")
      async hello(_params: Record<string, string>, _ctx: any) {}
    }

    const instance = new MyPlugin();
    expect(instance.namespace).toBe("test-wd");
    expect(instance.descriptor).toBe(descriptor);
    expect(instance.config).toBeUndefined();
    expect(Object.keys(instance.handlers)).toContain("hello");
  });

  test("accepts config and deps in constructor", () => {
    const descriptor = definePlugin({
      namespace: "configured-wd",
      version: "1.0.0",
      description: "With config",
      configSchema: z.object({ token: z.string() }),
      deps: ["git"],
    });

    class Configured extends PluginBase.withDescriptor(descriptor) {
      @handler()
      async run(_params: Record<string, string>, _ctx: any) {}
    }

    const mockGitPlugin = { namespace: "git", handlers: {} };
    const instance = new Configured({ token: "abc" }, { git: mockGitPlugin });
    expect(instance.config).toEqual({ token: "abc" });
    expect(instance.deps!.git).toBe(mockGitPlugin);
  });
});
