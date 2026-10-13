import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import type { BoltConfig } from "../config";
import { dryRunFooter, renderDryRun } from "../dry-run";
import { formatPlanNodes } from "../inspect-utils";
import { resolveRunPlan, usesRefError } from "../run-plan";
import { testCfg } from "./env";

const root = mkdtempSync(path.join(os.tmpdir(), "bolt-dryrun-unit-"));
const home = path.join(root, "home");
mkdirSync(path.join(root, "act"), { recursive: true });
writeFileSync(path.join(root, "act/action.yaml"), "name: act\n");
writeFileSync(path.join(root, "act/run.sh"), "#!/bin/sh\n");
mkdirSync(path.join(root, ".bolt/plugins/mine"), { recursive: true });
mkdirSync(path.join(home, ".bolt/plugins/theirs"), { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

const cfg: BoltConfig = {
  ...testCfg,
  tasks: {
    shell: [{ run: "echo ${{ params.who }}", "continue-on-error": true }],
    local: [{ uses: "./act", with: { target: "editor" } }],
    plugins: [
      { uses: "mine/go" },
      { uses: "theirs/go" },
      { uses: "fs/copy", with: { src: "a", dst: "b" } },
    ],
    nested: [{ call: "shell" }, { call: "local" }],
    broken: [{ uses: "nope/go" }, { uses: "fs/nope" }, { uses: "./missing" }],
    typo: [{ uses: "fs/copy", with: { src: "a", dest: "b" } }],
  },
};

function render(names: string[], params: Record<string, string> = {}) {
  const r = resolveRunPlan(cfg, { kind: "tasks", names, params });
  if (!r.ok) throw new Error("plan failed");
  return { plan: r.plan, report: renderDryRun(cfg, r.plan, { configDir: root, cwd: root, home }) };
}

test("every step reads 'would …' and interpolates params", () => {
  const { report } = render(["shell", "local"], { who: "me" });
  expect(report.problems).toEqual([]);
  expect(report.lines).toContain("  would run: echo me");
  expect(report.lines).toContain("    -> continue-on-error: a failure is ignored");
  expect(report.lines).toContain("  would run uses: ./act  target=editor  who=me");
  expect(report.lines).toContain(
    "    -> local action: would execute ./act/run.sh with BOLT_INPUT_TARGET=editor BOLT_INPUT_WHO=me",
  );
});

test("plugin sources are named without loading anything", () => {
  const { report } = render(["plugins"]);
  expect(report.problems).toEqual([]);
  const text = report.lines.join("\n");
  expect(text).toContain("project plugin .bolt/plugins/mine: not loaded in dry-run");
  expect(text).toContain("user plugin ~/.bolt/plugins/theirs: not loaded in dry-run");
  expect(text).toContain("built-in plugin fs: handler not called in dry-run");
  expect(text).toContain("Note: project and user plugins are not loaded in dry-run.");
});

test("problems a real run would hit are marked with !", () => {
  const { report } = render(["broken"]);
  expect(report.problems).toHaveLength(3);
  expect(report.problems[0]).toContain('Unknown plugin namespace "nope"');
  expect(report.problems[1]).toContain('Unknown op "nope" in plugin "fs"');
  expect(report.problems[2]).toContain("No action.yaml in");
  expect(dryRunFooter(3)[0]).toContain("found 3 config problem(s)");
});

test("built-in params are validated against their schema and name the typo", () => {
  const { report } = render(["typo"]);
  expect(report.problems).toEqual([
    'Invalid params for "fs/copy": missing param "dst" (you passed "dest"; did you mean "dst"?); fs/copy params: src, dst; Fix the step\'s with: in bolt.yaml.',
  ]);
});

test("run-wide params that a built-in does not use are not an error", () => {
  const { report } = render(["plugins"], { target: "client" });
  expect(report.problems).toEqual([]);
});

test("dry-run step lines match bolt inspect lines", () => {
  const { plan, report } = render(["nested", "plugins"]);
  const inspect = plan.tasks.flatMap((t) => [`>> ${t.name}`, ...formatPlanNodes(t.nodes, 1)]);
  const dry = report.lines
    .filter((l) => /^(>>|\s+would )/.test(l))
    .map((l) => l.replace(/^(\s*)would (run (?=uses:))?/, "$1"));
  expect(dry).toEqual(inspect);
});

test("usesRefError rejects malformed and legacy refs", () => {
  expect(usesRefError("ue/build")).toBeUndefined();
  expect(usesRefError("./x")).toBeUndefined();
  expect(usesRefError("build")).toContain("Invalid uses format");
  expect(usesRefError("ue/")).toContain("Invalid uses format");
  expect(usesRefError("task/build")).toContain('replace with "call: build"');
});
