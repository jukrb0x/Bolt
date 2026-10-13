import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { bolt, dispose } from "./harness";

function project(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-api2-e2e-"));
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    [
      "version: 1",
      "project:",
      "  name: Api2",
      "plugins:",
      "  - namespace: old",
      "    path: ./old/index.ts",
      "  - namespace: modern",
      "    path: ./modern/index.ts",
      "tasks:",
      "  legacy:",
      "    - uses: old/run",
      "  report:",
      "    - uses: modern/report",
      "  broken:",
      "    - uses: modern/broken",
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(dir, "old"));
  writeFileSync(
    path.join(dir, "old", "index.ts"),
    `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: "old",
  version: "0.1.0",
  description: "written for plugin API v1",
  handlers: {
    run: defineHandler({}, async (_p, ctx) => {
      ctx.logger.info("old plugin ran");
      ctx.emit?.({ type: "log", message: "old plugin event" });
      return { status: "fail", summary: "ignored" } as any;
    }),
  },
});
`,
  );
  mkdirSync(path.join(dir, "modern"));
  writeFileSync(
    path.join(dir, "modern", "index.ts"),
    `import { defineHandler, definePlugin, fail, warn } from "boltstack";
export default definePlugin({
  namespace: "modern",
  version: "1.0.0",
  description: "plugin API v2",
  apiVersion: 2,
  handlers: {
    report: defineHandler({ ai: true, capability: "doctor" }, async (_p, ctx) => {
      ctx.emit?.({ type: "progress", message: "scanning", progress: { current: 1, total: 2 } });
      return warn("cache cold", {
        diagnostics: [{ level: "warn", code: "CACHE_COLD", message: "no cache", fix: "run warmup" }],
      });
    }),
    broken: defineHandler({}, async () => fail("disk full")),
  },
});
`,
  );
  return dir;
}

test("an unchanged v1 plugin runs as before; its return value is ignored", async () => {
  const dir = project();
  try {
    const run = await bolt(dir, ["run", "legacy"]);
    expect(run.exitCode, run.output).toBe(0);
    expect(run.output).toContain("old plugin ran");
    expect(run.output).toContain("old/run: old plugin event");
    expect(run.output).toContain("legacy: SUCCESS");
  } finally {
    dispose(dir);
  }
}, 60_000);

test("a v2 plugin reports results and events; a returned fail fails the run", async () => {
  const dir = project();
  try {
    const report = await bolt(dir, ["run", "report"]);
    expect(report.exitCode, report.output).toBe(0);
    expect(report.output).toContain("modern/report progress 1/2: scanning");
    expect(report.output).toContain("modern/report: cache cold");
    expect(report.output).toContain("modern/report: CACHE_COLD: no cache Fix: run warmup");

    const broken = await bolt(dir, ["run", "broken"]);
    expect(broken.exitCode).toBe(1);
    expect(broken.output).toContain('modern/broken returned status "fail": disk full');
    // Printed once (by the runner), not again by the run command.
    expect(broken.output.split('modern/broken returned status "fail": disk full').length - 1).toBe(
      1,
    );
  } finally {
    dispose(dir);
  }
}, 60_000);

test("bolt version --json advertises plugin API v2", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-version-e2e-"));
  try {
    const run = await bolt(dir, ["version", "--json"]);
    expect(run.exitCode, run.output).toBe(0);
    const info = JSON.parse(run.stdout);
    expect(info.plugin_api).toEqual([1, 2]);
    expect(info.capabilities).toContain("plugin-api-2");
  } finally {
    dispose(dir);
  }
}, 60_000);
