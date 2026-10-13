import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { parse } from "yaml";
import { checkConfig, loadConfig } from "../config";
import { findLegacyKeys, migrateLegacyConfig } from "../legacy-config";

const BASE = [
  "version: 1",
  "project: { name: MyProject }",
  "tasks:",
  "  build: [{ uses: ue/build, with: { target: editor } }]",
  "plugins:",
  "  - namespace: ue",
  "    config:",
  "      engine: { path: ./engine, vcs: git, branch: main }",
  "      project: { path: ./project, vcs: svn }",
  "      uproject: ./project/MyProject.uproject",
  "      targets:",
  "        editor: { kind: editor }",
  "  - namespace: svn",
].join("\n");

const V20_SHARED = [
  "project:",
  "  name: MyProject",
  "  engine: { vcs: git, branch: main }",
  "  project: { vcs: svn, url: svn://example/trunk }",
  "  studio: Acme",
  "targets:",
  "  editor: { kind: editor, config: development }",
  "tasks:",
  "  build: [{ uses: ue/build, with: { target: editor } }]",
].join("\n");

const V20_LOCAL = [
  "engine_path: D:/UE",
  "project_path: D:/Proj",
  "uproject: D:/Proj/MyProject.uproject",
  "use_tortoise: true",
  "vars: { region: eu }",
].join("\n");

function dirWith(shared: string, local?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-legacy-"));
  writeFileSync(path.join(dir, "bolt.yaml"), shared);
  if (local !== undefined) writeFileSync(path.join(dir, "bolt.local.yaml"), local);
  return dir;
}

test("bolt.local.yaml plugins deep-merge over the bolt.yaml plugin config", async () => {
  const dir = dirWith(
    BASE,
    "plugins:\n  ue: { engine: { path: D:/UE } }\n  svn: { use_tortoise: true }\n",
  );
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  const ue = cfg.plugins.find((p) => p.namespace === "ue")!.config as any;
  expect(ue.engine).toEqual({ path: "D:/UE", vcs: "git", branch: "main" });
  expect(ue.project.path).toBe("./project");
  expect(ue.targets.editor.kind).toBe("editor");
  expect(cfg.plugins.find((p) => p.namespace === "svn")!.config).toEqual({ use_tortoise: true });
  expect((await checkConfig(path.join(dir, "bolt.yaml"))).ok).toBe(true);
});

test("machine paths can live only in bolt.local.yaml", async () => {
  const shared = BASE.replace("path: ./engine, ", "")
    .replace("path: ./project, ", "")
    .replace("      uproject: ./project/MyProject.uproject\n", "");
  const local =
    "plugins:\n  ue:\n    engine: { path: D:/UE }\n    project: { path: D:/Proj }\n    uproject: D:/Proj/P.uproject\n";
  const dir = dirWith(shared, local);
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.errors).toEqual([]);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  expect((cfg.plugins[0].config as any).uproject).toBe("D:/Proj/P.uproject");
});

test("a local override is validated after the merge", async () => {
  const dir = dirWith(BASE, "plugins:\n  svn: { use_tortoise: maybe }\n");
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
});

test("a local override for an undeclared namespace is an error", async () => {
  const dir = dirWith(BASE, "plugins:\n  p4: { port: 1666 }\n");
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.errors.some((e) => e.path === "bolt.local.yaml.plugins.p4")).toBe(true);
  await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(/namespace p4/);
});

test("checkConfig lists v2.0 keys in both files", async () => {
  const dir = dirWith(V20_SHARED, V20_LOCAL);
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  const keys = result.legacy.map((l) => `${l.file}:${l.path}`);
  expect(keys).toEqual(
    expect.arrayContaining([
      "bolt.yaml:version",
      "bolt.yaml:targets",
      "bolt.yaml:project.engine",
      "bolt.yaml:project.project",
      "bolt.yaml:project.studio",
      "bolt.local.yaml:engine_path",
      "bolt.local.yaml:project_path",
      "bolt.local.yaml:uproject",
      "bolt.local.yaml:use_tortoise",
    ]),
  );
});

test("a version 1 config has no legacy findings", async () => {
  const dir = dirWith(BASE, "vars: { region: eu }\n");
  expect((await checkConfig(path.join(dir, "bolt.yaml"))).legacy).toEqual([]);
  expect(findLegacyKeys(parse(BASE), { vars: {} })).toEqual([]);
  expect(migrateLegacyConfig(parse(BASE), undefined).changed).toBe(false);
});

test("migrating a v2.0 config gives files that pass bolt check", async () => {
  const result = migrateLegacyConfig(parse(V20_SHARED), parse(V20_LOCAL));
  expect(result.changed).toBe(true);
  expect(Object.keys(result.shared)[0]).toBe("version");
  expect(result.local).toEqual({
    vars: { region: "eu" },
    plugins: {
      ue: {
        engine: { path: "D:/UE" },
        project: { path: "D:/Proj" },
        uproject: "D:/Proj/MyProject.uproject",
      },
      svn: { use_tortoise: true },
    },
  });
  expect((result.shared.vars as any).studio).toBe("Acme");
  expect(result.notes.join("\n")).toContain("vars.studio");
  const { stringify } = await import("yaml");
  const dir = dirWith(stringify(result.shared), stringify(result.local));
  const checked = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(checked.errors).toEqual([]);
  expect(checked.legacy).toEqual([]);
  const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
  const ue = cfg.plugins.find((p) => p.namespace === "ue")!.config as any;
  expect(ue.engine).toEqual({ vcs: "git", branch: "main", path: "D:/UE" });
  expect(ue.targets.editor).toEqual({ kind: "editor", config: "development" });
});

const main = path.resolve(import.meta.dir, "../main.ts");
function bolt(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync([process.execPath, main, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { status: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test("bolt check prints a migration snippet for a v2.0 config", () => {
  const dir = dirWith(V20_SHARED, V20_LOCAL);
  const r = bolt(dir, "check");
  expect(r.status).toBe(1);
  expect(r.out).toContain("bolt v2.0 config");
  expect(r.out).toContain("bolt migrate");
  expect(r.out).toContain("# bolt.local.yaml");
  expect(r.out).toContain("use_tortoise: true");
});

test("bolt migrate --dry-run writes nothing; bolt migrate rewrites with backups", () => {
  const dir = dirWith(V20_SHARED, V20_LOCAL);
  const dry = bolt(dir, "migrate", "--dry-run");
  expect(dry.status).toBe(0);
  expect(dry.out).toContain("Dry run");
  expect(readFileSync(path.join(dir, "bolt.yaml"), "utf8")).toBe(V20_SHARED);
  expect(existsSync(path.join(dir, "bolt.yaml.v2.0.bak"))).toBe(false);

  const real = bolt(dir, "migrate");
  expect(real.out).toContain("bolt.yaml is valid");
  expect(real.status).toBe(0);
  expect(readFileSync(path.join(dir, "bolt.yaml.v2.0.bak"), "utf8")).toBe(V20_SHARED);
  expect(readFileSync(path.join(dir, "bolt.local.yaml.v2.0.bak"), "utf8")).toBe(V20_LOCAL);
  expect(bolt(dir, "check").status).toBe(0);
  expect(bolt(dir, "migrate").out).toContain("Nothing to migrate");
});
