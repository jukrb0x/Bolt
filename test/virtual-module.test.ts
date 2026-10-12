import { describe, test, expect, beforeAll } from "bun:test";

// Import the virtual module registration — this must run before the test
import "../src/virtual-module";

describe("boltstack virtual module", () => {
  test("resolves 'boltstack' to real exports", async () => {
    // Dynamic import to test virtual module resolution
    const mod = await import("boltstack");
    expect(mod.handler).toBeFunction();
    expect(mod.defineHandler).toBeFunction();
    expect(mod.definePlugin).toBeFunction();
    expect(mod.param).toBeUndefined();
    expect(mod.PluginBase).toBeDefined();
    expect(mod.PluginBase.withDescriptor).toBeFunction();
  });

  test("handler decorator works via virtual module", async () => {
    const { handler, PluginBase } = await import("boltstack");

    class TestPlugin extends PluginBase {
      namespace = "vmod-test";

      @handler("Test op")
      async testOp(_p: any, _c: any) {}
    }

    const inst = new TestPlugin();
    expect(inst.handlers["testOp"]).toBeFunction();
  });
});
