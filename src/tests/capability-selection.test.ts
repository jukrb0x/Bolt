/**
 * BOLT-EXT-2 design §6 proofs #1–#9 and #11.
 * #7b and #10 are deferred until BOLT-AI-2 wires this digest into plan_hash.
 * This file does not add a plan_hash surface.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  assessCapabilities,
  capabilitySelectionHash,
  effectiveCapabilitySelection,
  loadCapabilityIndex,
  mergeCapabilityMaps,
  resolveCapabilitySelection,
} from "../capability-selection";
import { checkConfig, loadConfig } from "../config";
import { boltConfigJsonSchema, boltLocalConfigJsonSchema } from "../config-schema";
import { renderDryRun } from "../dry-run";
import { git, svn } from "../plugins";
import { Runner } from "../runner";
import { capabilityUsesInPlan, resolveRunPlan } from "../run-plan";
import { testCfg } from "./env";

const root = path.resolve(import.meta.dir, "../..");

function projectYaml(extra = ""): string {
  return `version: 1\nproject:\n  name: Sample\n${extra}`;
}

test("1. local capabilities win per key and {} is the same as omitting the key", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-merge-"));
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    projectYaml("capabilities:\n  vcs.sync: git/pull\n  vcs.info: git/info\n"),
  );
  writeFileSync(path.join(dir, "bolt.local.yaml"), "capabilities:\n  vcs.sync: svn/update\n");
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(cfg.capabilities).toEqual({ "vcs.sync": "svn/update", "vcs.info": "git/info" });
  expect(cfg.capabilitySources).toEqual({
    "vcs.sync": "bolt.local.yaml",
    "vcs.info": "bolt.yaml",
  });

  writeFileSync(path.join(dir, "bolt.local.yaml"), "capabilities: {}\n");
  const emptied = await loadConfig(path.join(dir, "bolt.yaml"));
  expect(emptied.capabilities).toEqual({ "vcs.sync": "git/pull", "vcs.info": "git/info" });
  expect(emptied.capabilitySources?.["vcs.sync"]).toBe("bolt.yaml");

  const omitted = mergeCapabilityMaps({ "vcs.sync": "git/pull" }, undefined);
  expect(omitted).toEqual(mergeCapabilityMaps({ "vcs.sync": "git/pull" }, {}));
});

test("2. JSON schema accepts a capabilities map on bolt.yaml and bolt.local.yaml", () => {
  const shared = boltConfigJsonSchema();
  const local = boltLocalConfigJsonSchema();
  const sharedCaps = (shared.properties as Record<string, { type?: string }>).capabilities;
  const localCaps = (local.properties as Record<string, { type?: string }>).capabilities;
  expect(sharedCaps?.type).toBe("object");
  expect(localCaps?.type).toBe("object");
  const committed = JSON.parse(readFileSync(path.join(root, "schema/v1/bolt.schema.json"), "utf8"));
  const committedLocal = JSON.parse(
    readFileSync(path.join(root, "schema/v1/bolt.local.schema.json"), "utf8"),
  );
  expect(committed.properties.capabilities).toEqual(sharedCaps);
  expect(committedLocal.properties.capabilities).toEqual(localCaps);
});

test("3. unknown capability key exits as a config error with path, key, and did-you-mean", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-unknown-"));
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    projectYaml("capabilities:\n  vcs.syn: git/pull\ntasks:\n  sync:\n    - run: echo hi\n"),
  );
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  const hit = result.errors.find((error) => error.path.includes("vcs.syn"));
  expect(hit?.path).toBe(`${path.resolve(dir, "bolt.yaml")}: capabilities.vcs.syn`);
  expect(hit?.message).toContain('unknown capability "vcs.syn"');
  expect(hit?.message).toContain('Did you mean "vcs.sync"?');
  expect(hit?.message).not.toContain("CAPABILITY_AMBIGUOUS");
  expect(hit?.message).not.toContain("CAPABILITY_SELECTION_INVALID");
});

test("4. a bad handler ref is CAPABILITY_SELECTION_INVALID with path, key, and did-you-mean", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-ref-"));
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    projectYaml("capabilities:\n  vcs.sync: git/pul\ntasks:\n  sync:\n    - run: echo hi\n"),
  );
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  const hit = result.errors.find((error) => error.path.includes("vcs.sync"));
  expect(hit?.path).toBe(`${path.resolve(dir, "bolt.yaml")}: capabilities.vcs.sync`);
  expect(hit?.message.startsWith("CAPABILITY_SELECTION_INVALID:")).toBe(true);
  expect(hit?.message).toContain('"git/pul"');
  expect(hit?.message).toContain('Did you mean "git/pull"?');
});

test("5. two built providers and no selection is CAPABILITY_AMBIGUOUS (exit 3 shape)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-amb-"));
  const report = assessCapabilities({ tasks: { sync: [{ uses: "vcs.sync" }] } }, dir, {
    home: dir,
    builtins: { git, svn },
    requested: ["vcs.sync"],
  });
  expect(report.errors).toHaveLength(1);
  expect(report.errors[0].code).toBe("CAPABILITY_AMBIGUOUS");
  expect(report.errors[0].path).toBe(`${path.resolve(dir, "bolt.yaml")}: capabilities.vcs.sync`);
  expect(report.errors[0].message).toContain("git/pull");
  expect(report.errors[0].message).toContain("svn/update");
  expect(report.errors[0].message).toContain(
    "Add to bolt.yaml (or bolt.local.yaml): capabilities: { vcs.sync:",
  );
});

test("6. a singleton with no handler is CAPABILITY_MISSING", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-miss-"));
  const report = assessCapabilities({ tasks: { rev: [{ uses: "vcs.revision" }] } }, dir, {
    home: dir,
    builtins: { git, svn },
    requested: ["vcs.revision"],
  });
  expect(report.errors.map((error) => error.code)).toEqual(["CAPABILITY_MISSING"]);
  expect(report.errors[0].message).toContain('no handler provides "vcs.revision"');
  expect(report.errors[0].message).toContain("Enable a provider");
});

test("7. capabilitySelectionHash matches the canonical golden digest", () => {
  expect(capabilitySelectionHash({})).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  expect(
    capabilitySelectionHash({
      "vcs.sync": "git/pull",
      "vcs.info": "svn/info",
    }),
  ).toBe("e8c340b270d7da11ad2c8958afc131e412ba7563ef076a0982a68b16da96aa1c");
  // Key order in the object does not change the digest.
  expect(capabilitySelectionHash({ "vcs.info": "svn/info", "vcs.sync": "git/pull" })).toBe(
    capabilitySelectionHash({ "vcs.sync": "git/pull", "vcs.info": "svn/info" }),
  );
  const withFanout = { doctor: "git/pull", "vcs.sync": "git/pull" };
  expect(capabilitySelectionHash(effectiveCapabilitySelection(withFanout))).toBe(
    capabilitySelectionHash({ "vcs.sync": "git/pull" }),
  );
  const source = readFileSync(path.join(root, "src/capability-selection.ts"), "utf8");
  expect(source).toContain("TODO(BOLT-AI-2)");
  expect(source).toContain("plan_hash");
  expect(source).not.toMatch(/function planHash|function plan_hash/);
});

test("8. fan-out keys in the map warn once and are ignored", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-fan-"));
  const report = assessCapabilities(
    { capabilities: { doctor: "git/pull", detect: "svn/update" }, capabilitySources: {} },
    dir,
    { home: dir, builtins: { git, svn } },
  );
  expect(report.warnings).toHaveLength(1);
  expect(report.warnings[0]).toContain("doctor");
  expect(report.warnings[0]).toContain("detect");
  expect(report.warnings[0]).toContain("ignored");
  expect(report.errors).toEqual([]);
  expect(report.resolved.find((item) => item.capability === "doctor")).toBeUndefined();
  expect(report.resolved.find((item) => item.capability === "detect")).toBeUndefined();
});

test("9. preview source lines name bolt.yaml, bolt.local.yaml, and auto: only match", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-src-"));
  const auto = assessCapabilities({}, dir, {
    home: dir,
    builtins: { git },
    requested: ["vcs.sync"],
    catalog: true,
  });
  expect(auto.lines).toContain("vcs.sync: git/pull (auto: only match)");

  const picked = assessCapabilities(
    {
      capabilities: { "vcs.sync": "svn/update", "vcs.info": "git/info" },
      capabilitySources: { "vcs.sync": "bolt.local.yaml", "vcs.info": "bolt.yaml" },
    },
    dir,
    { home: dir, builtins: { git, svn }, catalog: true },
  );
  expect(picked.errors).toEqual([]);
  expect(picked.lines).toContain("vcs.sync: svn/update (bolt.local.yaml)");
  expect(picked.lines).toContain("vcs.info: git/info (bolt.yaml)");

  const cfg = {
    ...testCfg,
    tasks: { sync: [{ uses: "vcs.sync" as const }] },
    capabilities: { "vcs.sync": "git/pull" },
    capabilitySources: { "vcs.sync": "bolt.yaml" as const },
    plugins: [],
  };
  const planned = resolveRunPlan(cfg, { kind: "tasks", names: ["sync"], params: {} });
  if (!planned.ok) throw new Error("plan failed");
  expect(capabilityUsesInPlan(planned.plan)).toEqual(["vcs.sync"]);
  const dry = renderDryRun(cfg, planned.plan, { configDir: dir, cwd: dir, home: dir });
  expect(dry.problems).toEqual([]);
  expect(dry.lines.join("\n")).toContain("vcs.sync: git/pull (bolt.yaml)");
});

test("11. a selection that hits a built handler ignores an unbuilt sibling", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-unbuilt-"));
  const index = loadCapabilityIndex({ plugins: [] }, dir, { home: dir, builtins: { git, svn } });
  index.unbuilt.push({ namespace: "p4", where: "project plugin .bolt/plugins/p4" });
  const selected = resolveCapabilitySelection({
    map: { "vcs.sync": "git/pull" },
    sources: { "vcs.sync": "bolt.yaml" },
    index,
    requested: ["vcs.sync"],
  });
  expect(selected.errors).toEqual([]);
  expect(selected.lines).toEqual(["vcs.sync: git/pull (bolt.yaml)"]);

  const open = resolveCapabilitySelection({
    map: {},
    index,
    requested: ["vcs.sync"],
  });
  expect(open.errors).toHaveLength(1);
  expect(open.errors[0].code).toBeUndefined();
  expect(open.errors[0].message).toContain('plugin "p4" not built');
  expect(open.errors[0].message).toContain("Run: bolt plugin build p4");
  expect(open.errors[0].message).not.toContain("CAPABILITY_AMBIGUOUS");
  expect(open.errors[0].message).not.toContain("CAPABILITY_MISSING");
  expect(open.errors[0].message).not.toContain("CAPABILITY_SELECTION_INVALID");
});

test("no selection and one built match stays auto when another plugin is unbuilt", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-unique-"));
  const index = loadCapabilityIndex({ plugins: [] }, dir, { home: dir, builtins: { git } });
  index.unbuilt.push({ namespace: "p4", where: "project plugin .bolt/plugins/p4" });
  const report = resolveCapabilitySelection({
    map: {},
    index,
    requested: ["vcs.sync"],
  });
  expect(report.errors).toEqual([]);
  expect(report.lines).toEqual(["vcs.sync: git/pull (auto: only match)"]);
});

test("a selection that names an unbuilt plugin is incomplete with a build hint", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-sel-unbuilt-"));
  const index = loadCapabilityIndex({ plugins: [] }, dir, { home: dir, builtins: { git } });
  index.unbuilt.push({ namespace: "p4", where: "project plugin .bolt/plugins/p4" });
  const report = resolveCapabilitySelection({
    map: { "vcs.sync": "p4/sync" },
    sources: { "vcs.sync": "bolt.yaml" },
    index,
    configDir: dir,
    requested: ["vcs.sync"],
  });
  expect(report.errors).toHaveLength(1);
  expect(report.errors[0].code).toBeUndefined();
  expect(report.errors[0].path).toBe(`${path.resolve(dir, "bolt.yaml")}: capabilities.vcs.sync`);
  expect(report.errors[0].message).toContain('plugin "p4" not built');
  expect(report.errors[0].message).toContain("Run: bolt plugin build p4");
  expect(report.errors[0].message).not.toContain("CAPABILITY_AMBIGUOUS");
  expect(report.errors[0].message).not.toContain("CAPABILITY_MISSING");
  expect(report.errors[0].message).not.toContain("CAPABILITY_SELECTION_INVALID");
  expect(report.resolved).toEqual([]);
});

test("uses: vcs.sync runs the selected built-in handler", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-cap-run-"));
  const ran: string[] = [];
  const cfg = {
    ...testCfg,
    plugins: [],
    configDir: dir,
    tasks: { sync: [{ uses: "vcs.sync", with: { path: "." } }] },
    capabilities: { "vcs.sync": "git/pull" },
    capabilitySources: { "vcs.sync": "bolt.yaml" as const },
  };
  await new Runner(cfg, { dryRun: true, configDir: dir, onStep: (step) => ran.push(step) }).runTask(
    "sync",
  );
  expect(ran).toEqual(["git/pull"]);
});
