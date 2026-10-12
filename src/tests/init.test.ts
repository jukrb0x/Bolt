import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { boltConfigJsonSchema } from "../config-schema";
import { scaffoldProject } from "../commands/init";

test("bolt init scaffolds a generic project", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-init-"));
  const result = scaffoldProject(dir, { force: false });

  expect(result.wrote).toEqual(
    expect.arrayContaining([
      "bolt.yaml",
      ".bolt/bolt.schema.json",
      ".bolt/types/boltstack.d.ts",
      "tsconfig.json",
      ".vscode/extensions.json",
      ".gitignore",
    ]),
  );

  const yaml = readFileSync(path.join(dir, "bolt.yaml"), "utf8");
  expect(yaml.startsWith("# yaml-language-server: $schema=./.bolt/bolt.schema.json\n")).toBe(true);
  expect(yaml).toContain("version: 1");
  expect(yaml).toContain("name: MyProject");
  expect(yaml).not.toMatch(/^targets:/m);
  expect(yaml).not.toContain("uproject:");
  expect(existsSync(path.join(dir, "bolt.local.yaml"))).toBe(false);
});

test("init schema, types, and gitignore match this bolt", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-init-"));
  scaffoldProject(dir, { force: false });

  expect(JSON.parse(readFileSync(path.join(dir, ".bolt/bolt.schema.json"), "utf8"))).toEqual(
    boltConfigJsonSchema(),
  );
  const dts = readFileSync(path.join(dir, ".bolt/types/boltstack.d.ts"), "utf8");
  expect(dts).toContain("export declare function definePlugin");
  const tsconfig = JSON.parse(readFileSync(path.join(dir, "tsconfig.json"), "utf8"));
  expect(tsconfig.compilerOptions.experimentalDecorators).toBe(true);
  expect(tsconfig.compilerOptions.paths.boltstack).toEqual(["./.bolt/types/boltstack.d.ts"]);

  const ignore = readFileSync(path.join(dir, ".gitignore"), "utf8");
  expect(ignore).toContain(".bolt/.cache\n");
  expect(ignore).toContain("bolt.local.yaml\n");
  const extensions = JSON.parse(readFileSync(path.join(dir, ".vscode/extensions.json"), "utf8"));
  expect(extensions.recommendations).toContain("redhat.vscode-yaml");
});

test("init does not write bolt.local.yaml and will not clobber user files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-init-"));
  writeFileSync(path.join(dir, "bolt.yaml"), "sentinel\n");
  writeFileSync(path.join(dir, "tsconfig.json"), '{"keep":true}\n');
  mkdirSync(path.join(dir, ".vscode"));
  writeFileSync(path.join(dir, ".vscode/extensions.json"), '{"recommendations":["other"]}\n');
  writeFileSync(path.join(dir, ".gitignore"), "node_modules\nbolt.local.yaml\n");

  const result = scaffoldProject(dir, { force: false });
  expect(result.skipped).toEqual(
    expect.arrayContaining(["bolt.yaml", "tsconfig.json", ".vscode/extensions.json"]),
  );
  expect(result.wrote).not.toContain("bolt.local.yaml");
  expect(readFileSync(path.join(dir, "bolt.yaml"), "utf8")).toBe("sentinel\n");
  expect(readFileSync(path.join(dir, "tsconfig.json"), "utf8")).toBe('{"keep":true}\n');
  expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain("node_modules\n");
  expect(
    readFileSync(path.join(dir, ".gitignore"), "utf8").match(/bolt\.local\.yaml/g),
  ).toHaveLength(1);
  expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain(".bolt/.cache\n");

  scaffoldProject(dir, { force: true });
  expect(readFileSync(path.join(dir, "bolt.yaml"), "utf8")).toContain("version: 1");
  const tsconfig = JSON.parse(readFileSync(path.join(dir, "tsconfig.json"), "utf8"));
  expect(tsconfig.compilerOptions.paths.boltstack).toEqual(["./.bolt/types/boltstack.d.ts"]);
});
