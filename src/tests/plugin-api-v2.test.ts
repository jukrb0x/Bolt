import { expect, spyOn, test } from "bun:test";
import { PluginRegistry } from "../plugin-registry";
import { PluginBase, defineHandler, definePlugin, handler } from "../plugin";
import { normalizeCapabilities } from "../capabilities";
import { staleAiContextWarning } from "../ai-context";
import {
  MIN_BOLT_FOR_PLUGIN_API_2,
  minBoltIsPlaceholder,
  pluginApi2Requirement,
} from "../plugin-compat";

function tagged(capability: unknown, apiVersion?: 1 | 2, namespace = "ue") {
  return () =>
    definePlugin({
      namespace,
      version: "1.0.0",
      description: "d",
      ...(apiVersion ? { apiVersion } : {}),
      handlers: {
        doctor_ddc: defineHandler({ capability: capability as string }, async () => {}),
      },
    });
}

test("capability without apiVersion 2 is a definition-time error with the fix", () => {
  expect(tagged("doctor")).toThrow(
    'handler "ue/doctor_ddc" uses capability, which requires plugin API v2. Fix: add `apiVersion: 2` to definePlugin({ ... }).',
  );
  expect(tagged("doctor")).toThrow(/bolt version --json.*plugin-api-2/);
  expect(tagged("doctor", 1)).toThrow(/requires plugin API v2/);
});

test("v2 tags are sorted, deduped, and land in the manifest", () => {
  const plugin = tagged(["doctor", "ue.cook", "doctor", "x-acme.audit"], 2)();
  expect(plugin.manifest.handlers.doctor_ddc.capabilities).toEqual([
    "doctor",
    "ue.cook",
    "x-acme.audit",
  ]);
});

test("untagged handlers omit capabilities, so v1 manifests are unchanged", () => {
  const plugin = definePlugin({
    namespace: "plain",
    version: "1.0.0",
    description: "d",
    handlers: { run: defineHandler({ ai: true }, async () => {}) },
  });
  expect(plugin.manifest.handlers.run).toEqual({ ai: true });
});

test("vocabulary: reserved areas, unknown bare tags, vendor and namespace forms, cap", () => {
  expect(() => normalizeCapabilities("vcs.whatever", "vcs", "vcs/x")).toThrow(
    'capability "vcs.whatever" is in reserved core area "vcs"; core tags here: vcs.sync, vcs.info, vcs.revision',
  );
  expect(() => normalizeCapabilities("doctr", "ue", "ue/x")).toThrow(/Did you mean "doctor"\?/);
  expect(() => normalizeCapabilities("cook", "ue", "ue/x")).toThrow(/"ue\.<name>"/);
  expect(() => normalizeCapabilities("other.cook", "ue", "ue/x")).toThrow(/unknown capability/);
  expect(() => normalizeCapabilities("Doctor", "ue", "ue/x")).toThrow(/not a valid tag/);
  expect(normalizeCapabilities(["x-acme.audit", "ue.cook"], "ue", "ue/x")).toEqual([
    "ue.cook",
    "x-acme.audit",
  ]);
  const nine = Array.from({ length: 9 }, (_, i) => `ue.t${i}`);
  expect(() => normalizeCapabilities(nine, "ue", "ue/doctor")).toThrow(
    "ue/doctor: 9 capabilities (max 8). Tags describe roles; split the handler if it fills more than 8.",
  );
});

test("class plugin: capability without the instance field fails at registration", () => {
  class NoV2 extends PluginBase {
    namespace = "cls";
    @handler({ capability: "doctor" })
    async check() {}
  }
  const reg = new PluginRegistry();
  expect(() => reg.register(new NoV2())).toThrow(
    /handler "cls\/check" uses capability.*add the instance field `apiVersion = 2;` to the class \(not `static`\)/,
  );
});

test("class plugin: instance field apiVersion = 2 enables tags", () => {
  class WithV2 extends PluginBase {
    namespace = "cls";
    override apiVersion = 2;
    @handler({ capability: ["doctor", "cls.deep"] })
    async check() {}
  }
  const reg = new PluginRegistry();
  reg.register(new WithV2());
  expect(reg.get("cls")!.manifest!.handlers.check.capabilities).toEqual(["cls.deep", "doctor"]);
  expect(reg.get("cls")!.manifest!.pluginApi).toBe(2);
  expect(reg.findByCapability("doctor")).toEqual([
    {
      ref: "cls/check",
      namespace: "cls",
      handler: "check",
      ai: false,
      source: "builtin",
      capabilities: ["cls.deep", "doctor"],
    },
  ]);
});

test("class plugin: invalid tag is reported at registration", () => {
  class BadTag extends PluginBase {
    namespace = "cls";
    override apiVersion = 2;
    @handler({ capability: "vcs.custom" })
    async check() {}
  }
  expect(() => new PluginRegistry().register(new BadTag())).toThrow(/reserved core area "vcs"/);
});

test("static apiVersion that differs from the instance field is rejected with the fix", () => {
  class StaticOnly extends PluginBase {
    static apiVersion = 2;
    namespace = "st";
    @handler()
    async run() {}
  }
  expect(() => new PluginRegistry().register(new StaticOnly())).toThrow(
    'Plugin "st": static apiVersion conflicts with the instance field (static 2, instance 1). Fix: remove the static field and use the instance field `apiVersion = 2;`.',
  );
});

test("static apiVersion equal to the instance field only warns", () => {
  class Both extends PluginBase {
    static apiVersion = 1;
    namespace = "both";
    @handler()
    async run() {}
  }
  const reg = new PluginRegistry();
  reg.register(new Both());
  expect(reg.warnings).toEqual([
    'Plugin "both": static apiVersion is redundant (bolt reads only the instance field). Remove it; the instance field `apiVersion = 1;` already declares the version.',
  ]);
});

test("findByCapability orders by plugins[] config order, then source, then ref", () => {
  const mk = (ns: string) => tagged("doctor", 2, ns)();
  const reg = new PluginRegistry();
  reg.register(mk("zeta"), "builtin");
  reg.register(mk("alpha"), "user");
  reg.register(mk("mid"), "path");
  reg.setConfigOrder(["zeta"]);
  expect(reg.findByCapability("doctor").map((m) => `${m.ref}:${m.source}`)).toEqual([
    "zeta/doctor_ddc:builtin",
    "mid/doctor_ddc:path",
    "alpha/doctor_ddc:user",
  ]);
});

test("the minimum-bolt hint leads with bolt version --json and hides the placeholder", () => {
  expect(pluginApi2Requirement()).toContain('`bolt version --json` lists "plugin-api-2"');
  if (minBoltIsPlaceholder()) {
    expect(MIN_BOLT_FOR_PLUGIN_API_2).toBe("<X>");
    expect(pluginApi2Requirement()).not.toContain("<X>");
  } else {
    expect(pluginApi2Requirement()).toContain(`bolt ${MIN_BOLT_FOR_PLUGIN_API_2} or later`);
  }
});

test("bolt version --json lists plugin_api and capabilities", async () => {
  const logged: unknown[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args) => {
    logged.push(args[0]);
  });
  const mod = await import("../commands/version");
  await (mod.default as any).run({ args: { json: true } });
  spy.mockRestore();
  const info = JSON.parse(String(logged[0]));
  expect(info.plugin_api).toEqual([1, 2]);
  expect(info.manifest_format).toBe(2);
  expect(info.capabilities).toEqual([
    "handler-results",
    "capability-tags",
    "plugin-api-2",
    "plugin-manifest",
  ]);
});

test("a stale .bolt/ai-context.md prompts a rebuild with bolt ai", () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("fs");
  const path = require("path");
  const dir = mkdtempSync(path.join(require("os").tmpdir(), "bolt-aictx-"));
  try {
    expect(staleAiContextWarning(dir)).toBeUndefined();
    mkdirSync(path.join(dir, ".bolt"));
    const file = path.join(dir, ".bolt", "ai-context.md");
    writeFileSync(file, "<!-- generated by bolt ai — do not edit manually -->\n");
    expect(staleAiContextWarning(dir)).toBe(
      "AI_CONTEXT_STALE: .bolt/ai-context.md was generated by an older bolt (manifest format m1, need m2); plugin capabilities and AI permissions in it are out of date. Run: bolt ai",
    );
    writeFileSync(file, "<!-- manifest format: 2 -->\n");
    expect(staleAiContextWarning(dir)).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
