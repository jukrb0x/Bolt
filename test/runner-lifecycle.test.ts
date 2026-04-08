import { describe, test, expect } from "bun:test";
import { handler, PluginBase } from "../src/plugin";
import type { BoltPluginContext } from "../src/plugin";

describe("Lifecycle hooks", () => {
  test("onBeforeStep and onAfterStep are called in order", async () => {
    const callOrder: string[] = [];

    class LifecyclePlugin extends PluginBase {
      namespace = "lifecycle";

      async onInit(_ctx: BoltPluginContext) {
        callOrder.push("init");
      }

      async onBeforeStep(handlerName: string, _params: Record<string, string>, _ctx: BoltPluginContext) {
        callOrder.push(`before:${handlerName}`);
      }

      async onAfterStep(handlerName: string, _params: Record<string, string>, _ctx: BoltPluginContext) {
        callOrder.push(`after:${handlerName}`);
      }

      @handler()
      async build(_params: Record<string, string>, _ctx: BoltPluginContext) {
        callOrder.push("handler:build");
      }
    }

    const instance = new LifecyclePlugin();

    // Simulate what the runner dispatch does:
    const ctx = {} as BoltPluginContext;
    const params = { target: "editor" };

    // onInit
    await instance.onInit!(ctx);

    // onBeforeStep → handler → onAfterStep
    await instance.onBeforeStep!("build", params, ctx);
    await instance.handlers["build"](params, ctx);
    await instance.onAfterStep!("build", params, ctx);

    expect(callOrder).toEqual(["init", "before:build", "handler:build", "after:build"]);
  });

  test("plugin without lifecycle hooks works fine", () => {
    class SimplePlugin extends PluginBase {
      namespace = "simple";

      @handler()
      async run(_p: any, _c: any) {}
    }

    const instance = new SimplePlugin();
    // Optional hooks are undefined when not overridden
    expect(instance.onInit).toBeUndefined();
    expect(instance.onBeforeStep).toBeUndefined();
    expect(instance.onAfterStep).toBeUndefined();
    expect(instance.handlers["run"]).toBeFunction();
  });
});
