import { describe, test, expect } from "bun:test";
import { handler, param, getParamMap, PluginBase, PARAMS } from "../src/plugin";

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
