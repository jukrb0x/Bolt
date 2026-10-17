import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import { VERSION_CAPABILITIES } from "../plugin-compat";
import fsPlugin from "../plugins/fs";
import gitPlugin from "../plugins/git";
import jsonPlugin from "../plugins/json";
import svnPlugin from "../plugins/svn";
import ue from "../plugins/ue";
import type { AiMode, BoltPlugin } from "../plugin";

const SKILL = path.join(import.meta.dir, "../../skills/boltstack/SKILL.md");

function flags(plugin: BoltPlugin): Record<string, AiMode> {
  const handlers = plugin.manifest?.handlers;
  if (!handlers) throw new Error(`${plugin.namespace} has no manifest`);
  return Object.fromEntries(Object.entries(handlers).map(([name, entry]) => [name, entry.ai]));
}

test("builtin confirm tier is signed off", () => {
  expect(flags(ue)).toEqual({
    build: "confirm",
    build_engine: "confirm",
    diagnose_uat: true,
    doctor_ddc: true,
    build_program: "confirm",
    fillddc: false,
    fix_dll: false,
    generate_project: "confirm",
    info: true,
    ini_get: true,
    ini_override: "confirm",
    ini_read_all: true,
    ini_remove: false,
    ini_set: "confirm",
    kill: false,
    setup: "confirm",
    start: "confirm",
    svn_cleanup: false,
    svn_revert: false,
    update_engine: "confirm",
    update_project: "confirm",
  });
  expect(flags(gitPlugin)).toEqual({
    checkout: false,
    clone: false,
    info: true,
    pull: "confirm",
    status: "confirm",
  });
  expect(flags(svnPlugin)).toEqual({
    add: false,
    cleanup: false,
    commit: false,
    info: true,
    revert: false,
    status: "confirm",
    update: "confirm",
  });
  expect(flags(fsPlugin)).toEqual({
    copy: "confirm",
    delete: false,
    mkdir: "confirm",
    move: "confirm",
  });
  expect(flags(jsonPlugin)).toEqual({
    merge: "confirm",
    set: "confirm",
  });
});

test("version capabilities append confirm after agent and execute", () => {
  expect(VERSION_CAPABILITIES).toContain("agent");
  expect(VERSION_CAPABILITIES).toContain("execute");
  const executeAt = VERSION_CAPABILITIES.indexOf("execute");
  expect(VERSION_CAPABILITIES[executeAt + 1]).toBe("confirm");
  expect(VERSION_CAPABILITIES.indexOf("confirm")).toBe(VERSION_CAPABILITIES.length - 1);
});

test("skill claims execute and does not skip confirmation", () => {
  const skill = readFileSync(SKILL, "utf8");
  expect(skill).not.toContain("no execute path");
  expect(skill).not.toContain("Phase 2b is not done");
  expect(skill).toContain("bolt version --json");
  expect(skill).toContain("bolt run --dry-run");
  expect(skill).toContain("--execute");
  expect(skill).toContain("--plan=");
  expect(skill).toContain("--confirmed-by-user");
  expect(skill).toContain("`agent`");
  expect(skill).toContain("`execute`");
  expect(skill).toContain("`confirm`");
  expect(skill.toLowerCase()).toContain("do not skip confirmation");
  expect(skill).toContain("Never auto-allow");
  expect(skill).toContain("--confirmed-by-user");
});
