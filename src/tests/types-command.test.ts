import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { VERSION } from "../version";
import { pluginDeclarationBody } from "../plugin-declaration";
import { writePluginTypes } from "../commands/types";

const root = path.resolve(import.meta.dir, "../..");

test("types are the bolt.d.ts embedded in this process", () => {
  const source = readFileSync(path.join(root, "src/plugin-declaration.ts"), "utf8");
  expect(source).toContain('from "./plugin-types.txt" with { type: "text" }');
  expect(source).not.toMatch(/githubusercontent|fetch\(/);
  expect(readFileSync(path.join(root, "src/plugin-types.txt"), "utf8")).toBe(
    readFileSync(path.join(root, "bolt.d.ts"), "utf8"),
  );

  const declaration = readFileSync(path.join(root, "bolt.d.ts"), "utf8");
  const body = pluginDeclarationBody(declaration);
  expect(body).toContain("export declare function definePlugin");
  expect(body).toContain("PLUGIN_API_VERSION");
  expect(body).not.toContain('declare module "boltstack"');
});

test("bolt types writes that declaration and a plugin tsconfig", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-types-"));
  const first = writePluginTypes(dir, { force: false });
  expect(first.wrote).toContain(".bolt/types/boltstack.d.ts");
  expect(first.wrote).toContain("tsconfig.json");

  const dts = readFileSync(path.join(dir, ".bolt/types/boltstack.d.ts"), "utf8");
  const body = pluginDeclarationBody(readFileSync(path.join(root, "bolt.d.ts"), "utf8"));
  expect(dts).toContain(`bolt ${VERSION}`);
  expect(dts).toContain(body.trim());
  expect(dts).not.toContain('declare module "boltstack"');

  const tsconfig = JSON.parse(readFileSync(path.join(dir, "tsconfig.json"), "utf8"));
  expect(tsconfig.compilerOptions.experimentalDecorators).toBe(true);
  expect(tsconfig.compilerOptions.useDefineForClassFields).toBe(false);
  expect(tsconfig.compilerOptions.module).toBe("ESNext");
  expect(tsconfig.compilerOptions.moduleResolution).toBe("bundler");
  expect(tsconfig.compilerOptions.paths.boltstack).toEqual(["./.bolt/types/boltstack.d.ts"]);
});

test("bolt types refreshes the declaration and keeps an existing tsconfig", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-types-"));
  writePluginTypes(dir, { force: false });
  writeFileSync(path.join(dir, ".bolt/types/boltstack.d.ts"), "stale\n");
  writeFileSync(path.join(dir, "tsconfig.json"), '{"compilerOptions":{"strict":false}}\n');

  const again = writePluginTypes(dir, { force: false });
  expect(again.wrote).toContain(".bolt/types/boltstack.d.ts");
  expect(again.skipped).toContain("tsconfig.json");
  expect(readFileSync(path.join(dir, ".bolt/types/boltstack.d.ts"), "utf8")).toContain(
    "definePlugin",
  );
  expect(readFileSync(path.join(dir, "tsconfig.json"), "utf8")).toContain('"strict":false');

  writePluginTypes(dir, { force: true });
  const replaced = JSON.parse(readFileSync(path.join(dir, "tsconfig.json"), "utf8"));
  expect(replaced.compilerOptions.paths.boltstack).toEqual(["./.bolt/types/boltstack.d.ts"]);
});

test("bolt types is registered", async () => {
  const proc = Bun.spawn(["bun", "src/main.ts", "types", "--help"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(code).toBe(0);
  expect(`${stdout}\n${stderr}`).toContain("tsconfig");
});
