import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { parse } from "yaml";
import { checkConfig, loadConfig } from "../config";
import { findLegacyKeys, migrateLegacyConfig } from "../legacy-config";
import { backupPath, writeAtomic } from "../commands/migrate";
import { mkdirSync, readdirSync } from "fs";

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
  '  where: [{ run: "echo ${{ project.engine_repo.path }} ${{ project.project_repo.path }} ${{ project.uproject }} ${{ project.studio }} ${{ project.name }}" }]',
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
  expect(result.errors.some((e) => e.path === "bolt.local.yaml: plugins.p4")).toBe(true);
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
    vars: {
      region: "eu",
      engine_path: "D:/UE",
      project_path: "D:/Proj",
      uproject: "D:/Proj/MyProject.uproject",
    },
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
  expect((result.shared.tasks as any).where[0].run).toBe(
    "echo ${{ vars.engine_path }} ${{ vars.project_path }} ${{ vars.uproject }} ${{ vars.studio }} ${{ project.name }}",
  );
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

test("migration keeps existing local plugin overrides and notes conflicts", () => {
  const local = {
    engine_path: "D:/UE-old",
    uproject: "D:/Proj/P.uproject",
    plugins: {
      ue: { engine: { path: "E:/UE" }, project: { path: "E:/Proj" } },
      p4: { port: "1666" },
    },
  };
  const result = migrateLegacyConfig(parse(V20_SHARED), local);
  expect((result.local as any).plugins).toEqual({
    ue: { engine: { path: "E:/UE" }, project: { path: "E:/Proj" }, uproject: "D:/Proj/P.uproject" },
    p4: { port: "1666" },
  });
  expect(result.notes.join("\n")).toContain(
    'plugins.ue.engine.path: kept the existing "E:/UE"; the v2.0 value "D:/UE-old" was not written',
  );
});

test("migration deep-merges into an existing ue plugin config, existing values win", () => {
  const shared = parse(V20_SHARED);
  shared.plugins = [
    {
      namespace: "ue",
      config: { engine: { branch: "release" }, targets: { game: { kind: "game" } } },
    },
  ];
  const result = migrateLegacyConfig(shared, undefined);
  const ue = (result.shared.plugins as any[])[0].config;
  expect(ue.engine).toEqual({ vcs: "git", branch: "release" });
  expect(ue.project).toEqual({ vcs: "svn", url: "svn://example/trunk" });
  expect(Object.keys(ue.targets).sort()).toEqual(["editor", "game"]);
  expect(result.notes.join("\n")).toContain(
    'plugins[ue].config.engine.branch: kept the existing "release"',
  );
});

test("migration moves only scalar project keys and notes the rest", () => {
  const shared = { project: { name: "P", studio: "Acme", year: 2024, meta: { a: 1 }, list: [1] } };
  const result = migrateLegacyConfig(shared, undefined);
  expect(result.shared.vars).toEqual({ studio: "Acme", year: "2024" });
  expect((result.shared.project as any).meta).toEqual({ a: 1 });
  expect((result.shared.project as any).list).toEqual([1]);
  const notes = result.notes.join("\n");
  expect(notes).toContain("project.meta is not a string");
  expect(notes).toContain("project.list is not a string");
});

test("migration notes project references it cannot map", () => {
  const shared = {
    version: 1,
    project: { name: "P" },
    tasks: { t: [{ run: "echo ${{ project.engine_repo.branch }}" }] },
  };
  const result = migrateLegacyConfig(shared, undefined);
  expect(result.notes.join("\n")).toContain(
    "project.engine_repo.branch }} has no version 1 equivalent",
  );
  expect(result.changed).toBe(false);
});

test("bolt check flags unknown project references", async () => {
  const dir = dirWith(
    BASE.replace("tasks:", 'tasks:\n  bad: [{ run: "echo ${{ project.uproject }}" }]'),
  );
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  const err = result.errors.find((e) => e.path === "tasks.bad[0].run");
  expect(err?.message).toContain("only project.name exists");
});

test("deepMerge ignores prototype keys", async () => {
  const { deepMerge } = await import("../config");
  const merged = deepMerge(
    { a: 1 },
    JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"x": 1}, "b": 2}'),
  ) as any;
  expect(merged.b).toBe(2);
  expect(({} as any).polluted).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(merged, "constructor")).toBe(false);
});

test("errors in a local override are labeled as bolt.local.yaml", async () => {
  const dir = dirWith(BASE, "plugins:\n  ue: { targets: { editor: { kind: tablet } } }\n");
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.ok).toBe(false);
  expect(
    result.errors.some((e) => e.path.startsWith("bolt.local.yaml: plugins.ue.targets.editor")),
  ).toBe(true);
});

test("a root-level local error is labeled bolt.local.yaml", async () => {
  const dir = dirWith(BASE, "nope: 1\n");
  const result = await checkConfig(path.join(dir, "bolt.yaml"));
  expect(result.errors.some((e) => e.path === "bolt.local.yaml")).toBe(true);
});

test("loadConfig suggests bolt migrate for v2.0 keys in bolt.local.yaml", async () => {
  const dir = dirWith(BASE, "engine_path: D:/UE\n");
  await expect(loadConfig(path.join(dir, "bolt.yaml"))).rejects.toThrow(/bolt migrate/);
});

test("backupPath picks .bak.N when the backup exists", () => {
  const dir = dirWith(BASE);
  const file = path.join(dir, "bolt.yaml");
  expect(backupPath(file)).toBe(`${file}.v2.0.bak`);
  writeFileSync(`${file}.v2.0.bak`, "x");
  writeFileSync(`${file}.v2.0.bak.1`, "x");
  expect(backupPath(file)).toBe(`${file}.v2.0.bak.2`);
});

test("bolt migrate writes nothing when the converted config would be invalid", () => {
  // No engine_path or project_path locally, so the merged ue config lacks paths.
  const dir = dirWith(V20_SHARED, "vars: { region: eu }\n");
  const r = bolt(dir, "migrate");
  expect(r.status).toBe(1);
  expect(r.out).toContain("No files were written");
  expect(readFileSync(path.join(dir, "bolt.yaml"), "utf8")).toBe(V20_SHARED);
  expect(existsSync(path.join(dir, "bolt.yaml.v2.0.bak"))).toBe(false);
  const forced = bolt(dir, "migrate", "--force");
  expect(forced.status).toBe(1);
  expect(forced.out).toContain("written because of --force");
  expect(existsSync(path.join(dir, "bolt.yaml.v2.0.bak"))).toBe(true);
});

test("a second migrate run keeps the first backup and uses .bak.1", () => {
  const dir = dirWith(V20_SHARED, V20_LOCAL);
  writeFileSync(path.join(dir, "bolt.yaml.v2.0.bak"), "older");
  const r = bolt(dir, "migrate");
  expect(r.status).toBe(0);
  expect(readFileSync(path.join(dir, "bolt.yaml.v2.0.bak"), "utf8")).toBe("older");
  expect(readFileSync(path.join(dir, "bolt.yaml.v2.0.bak.1"), "utf8")).toBe(V20_SHARED);
});

test("vars that replace v2.0 path references are absolute against the config dir", () => {
  const shared = {
    project: { name: "P" },
    tasks: {
      t: [
        {
          run: "echo ${{ project.engine_repo.path }} ${{ project.uproject }} ${{ project.project_repo.path }}",
        },
      ],
    },
  };
  const local = { engine_path: "../UE", uproject: "D:/Proj/P.uproject", project_path: "/abs/proj" };
  const configDir = path.resolve("/work/game");
  const result = migrateLegacyConfig(shared, local, configDir);
  expect((result.local as any).vars).toEqual({
    engine_path: path.resolve(configDir, "../UE"),
    uproject: "D:/Proj/P.uproject",
    project_path: "/abs/proj",
  });
  // Plugin config keeps the written value; the ue plugin resolves it against the config dir itself.
  expect((result.local as any).plugins.ue.engine.path).toBe("../UE");
});

test("writeAtomic uses a random temp name and cleans up when the rename fails", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-atomic-"));
  const file = path.join(dir, "bolt.yaml");
  writeAtomic(file, "a: 1\n");
  expect(readFileSync(file, "utf8")).toBe("a: 1\n");
  const blocked = path.join(dir, "blocked");
  mkdirSync(blocked);
  writeFileSync(path.join(blocked, "x"), "keep");
  expect(() => writeAtomic(blocked, "b: 2\n")).toThrow();
  expect(readdirSync(dir).filter((n) => n.includes(".migrate-"))).toEqual([]);
});
