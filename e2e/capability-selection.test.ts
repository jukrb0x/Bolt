/**
 * BOLT-EXT-2 CLI proofs for design §6 (exit 3, inspect, dry-run source lines).
 * #7b and #10 stay deferred: no plan_hash integration.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { bolt, dispose } from "./harness";
import { computeSourcesHash } from "../src/static-plugin-manifest";

function writeProject(yaml: string, local?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-ext2-"));
  writeFileSync(path.join(dir, "bolt.yaml"), `version: 1\nproject:\n  name: Sample\n${yaml}`);
  if (local !== undefined) writeFileSync(path.join(dir, "bolt.local.yaml"), local);
  return dir;
}

test("unknown key, bad ref, ambiguous, and missing are exit 3", async () => {
  const unknown = writeProject(
    "capabilities:\n  vcs.syn: git/pull\ntasks:\n  hi:\n    - run: echo hi\n",
  );
  const bad = writeProject(
    "capabilities:\n  vcs.sync: git/pul\ntasks:\n  hi:\n    - run: echo hi\n",
  );
  const ambiguous = writeProject("tasks:\n  sync:\n    - uses: vcs.sync\n");
  const missing = writeProject("tasks:\n  rev:\n    - uses: artifact.store\n");
  try {
    const unknownRun = await bolt(unknown, ["check"]);
    expect(unknownRun.exitCode).toBe(3);
    expect(unknownRun.output).toContain("bolt.yaml: capabilities.vcs.syn");
    expect(unknownRun.output).toContain('unknown capability "vcs.syn"');
    expect(unknownRun.output).toContain('Did you mean "vcs.sync"?');

    const badRun = await bolt(bad, ["check"]);
    expect(badRun.exitCode).toBe(3);
    expect(badRun.output).toContain("CAPABILITY_SELECTION_INVALID");
    expect(badRun.output).toContain("bolt.yaml: capabilities.vcs.sync");
    expect(badRun.output).toContain('Did you mean "git/pull"?');

    const ambiguousRun = await bolt(ambiguous, ["inspect", "sync"]);
    expect(ambiguousRun.exitCode).toBe(3);
    expect(ambiguousRun.output).toContain("CAPABILITY_AMBIGUOUS");
    expect(ambiguousRun.output).toContain("vcs.sync");

    const missingRun = await bolt(missing, ["inspect", "rev"]);
    expect(missingRun.exitCode).toBe(3);
    expect(missingRun.output).toContain("CAPABILITY_MISSING");
    expect(missingRun.output).toContain("artifact.store");
  } finally {
    dispose(unknown);
    dispose(bad);
    dispose(ambiguous);
    dispose(missing);
  }
});

test("fan-out selection warns once and inspect still succeeds", async () => {
  const dir = writeProject(
    "capabilities:\n  doctor: git/pull\n  detect: svn/update\ntasks:\n  hi:\n    - run: echo hi\n",
  );
  try {
    const result = await bolt(dir, ["check"]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("ignored");
    expect(result.output).toContain("doctor");
    expect(result.output).toContain("detect");
    const warnings = result.output.split("\n").filter((line) => line.includes("fan-out"));
    expect(warnings).toHaveLength(1);
  } finally {
    dispose(dir);
  }
});

test("inspect and dry-run name bolt.yaml, bolt.local.yaml, and auto: only match", async () => {
  const dir = writeProject(
    ["capabilities:", "  vcs.info: git/info", "tasks:", "  hi:", "    - run: echo hi", ""].join(
      "\n",
    ),
    "capabilities:\n  vcs.sync: svn/update\n",
  );
  const pluginRoot = path.join(dir, ".bolt", "plugins", "acme");
  mkdirSync(pluginRoot, { recursive: true });
  writeFileSync(
    path.join(pluginRoot, "index.ts"),
    'export default { namespace: "acme", handlers: { go: async () => {} } };\n',
  );
  writeFileSync(
    path.join(pluginRoot, "bolt.plugin.json"),
    JSON.stringify({
      namespace: "acme",
      sourcesHash: computeSourcesHash(pluginRoot),
      handlers: { go: { ai: false, capabilities: ["acme.go"] } },
    }),
  );
  try {
    const inspected = await bolt(dir, ["inspect", "hi"]);
    expect(inspected.exitCode).toBe(0);
    expect(inspected.output).toContain("vcs.sync: svn/update (bolt.local.yaml)");
    expect(inspected.output).toContain("vcs.info: git/info (bolt.yaml)");
    expect(inspected.output).toContain("acme.go: acme/go (auto: only match)");

    const dry = await bolt(dir, ["run", "hi", "--dry-run"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.output).toContain("vcs.sync: svn/update (bolt.local.yaml)");
    expect(dry.output).toContain("vcs.info: git/info (bolt.yaml)");
    expect(dry.output).toContain("(auto: only match)");
  } finally {
    dispose(dir);
  }
});

test("11. selection of a built handler succeeds when a sibling plugin is not built", async () => {
  const dir = writeProject(
    "capabilities:\n  vcs.sync: git/pull\ntasks:\n  sync:\n    - uses: vcs.sync\n",
  );
  const unbuilt = path.join(dir, ".bolt", "plugins", "p4");
  mkdirSync(unbuilt, { recursive: true });
  writeFileSync(
    path.join(unbuilt, "index.ts"),
    "export default { namespace: 'p4', handlers: {} };\n",
  );
  try {
    const inspected = await bolt(dir, ["inspect", "sync"]);
    expect(inspected.exitCode).toBe(0);
    expect(inspected.output).toContain("vcs.sync: git/pull (bolt.yaml)");
    expect(inspected.output).not.toContain("CAPABILITY_AMBIGUOUS");
    expect(inspected.output).not.toContain("CAPABILITY_MISSING");
    expect(inspected.output).not.toContain("CAPABILITY_SELECTION_INVALID");

    const dry = await bolt(dir, ["run", "sync", "--dry-run"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.output).toContain("vcs.sync: git/pull (bolt.yaml)");
    expect(dry.output).not.toContain("CAPABILITY_AMBIGUOUS");
  } finally {
    dispose(dir);
  }
});

test("selection of an unbuilt plugin is incomplete with a build hint", async () => {
  const dir = writeProject(
    "capabilities:\n  vcs.sync: p4/sync\ntasks:\n  sync:\n    - uses: vcs.sync\n",
  );
  const unbuilt = path.join(dir, ".bolt", "plugins", "p4");
  mkdirSync(unbuilt, { recursive: true });
  writeFileSync(
    path.join(unbuilt, "index.ts"),
    "export default { namespace: 'p4', handlers: {} };\n",
  );
  try {
    const inspected = await bolt(dir, ["inspect", "sync"]);
    expect(inspected.exitCode).toBe(3);
    expect(inspected.output).toContain('plugin "p4" not built');
    expect(inspected.output).toContain("Run: bolt plugin build p4");
    expect(inspected.output).toContain(`${path.join(dir, "bolt.yaml")}: capabilities.vcs.sync`);
    expect(inspected.output).not.toContain("CAPABILITY_AMBIGUOUS");
    expect(inspected.output).not.toContain("CAPABILITY_MISSING");
    expect(inspected.output).not.toContain("CAPABILITY_SELECTION_INVALID");
  } finally {
    dispose(dir);
  }
});
