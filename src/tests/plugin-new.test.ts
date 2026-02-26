import { expect, test, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import path from "path";
import os from "os";
import { scaffoldPlugin } from "../commands/plugin-new";

const tmpDir = path.join(os.tmpdir(), "bolt-plugin-new-test-" + Date.now());

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("scaffoldPlugin creates index.ts, tsconfig.json, package.json", async () => {
  mkdirSync(tmpDir, { recursive: true });
  await scaffoldPlugin({ name: "myplugin", baseDir: tmpDir, isUser: false });

  const pluginDir = path.join(tmpDir, ".bolt", "plugins", "myplugin");
  expect(existsSync(path.join(pluginDir, "index.ts"))).toBe(true);
  expect(existsSync(path.join(pluginDir, "tsconfig.json"))).toBe(true);
  expect(existsSync(path.join(pluginDir, "package.json"))).toBe(true);
});

test("scaffoldPlugin index.ts has correct namespace", async () => {
  mkdirSync(tmpDir, { recursive: true });
  await scaffoldPlugin({ name: "myns", baseDir: tmpDir, isUser: false });

  const indexTs = readFileSync(
    path.join(tmpDir, ".bolt", "plugins", "myns", "index.ts"),
    "utf8"
  );
  expect(indexTs).toContain('namespace: "myns"');
  expect(indexTs).toContain('from "bolt"');
});

test("scaffoldPlugin tsconfig.json has bolt path alias (project-scope)", async () => {
  mkdirSync(tmpDir, { recursive: true });
  await scaffoldPlugin({ name: "myplugin", baseDir: tmpDir, isUser: false });

  const tsconfig = JSON.parse(
    readFileSync(path.join(tmpDir, ".bolt", "plugins", "myplugin", "tsconfig.json"), "utf8")
  );
  expect(tsconfig.compilerOptions.paths["bolt"]).toEqual(["../../bolt.d.ts"]);
});

test("scaffoldPlugin tsconfig.json has absolute bolt path alias (user-scope)", async () => {
  mkdirSync(tmpDir, { recursive: true });
  const userBase = path.join(tmpDir, "userhome");
  mkdirSync(userBase, { recursive: true });
  await scaffoldPlugin({ name: "myplugin", baseDir: userBase, isUser: true });

  const tsconfig = JSON.parse(
    readFileSync(path.join(userBase, "plugins", "myplugin", "tsconfig.json"), "utf8")
  );
  expect(tsconfig.compilerOptions.paths["bolt"][0]).toMatch(/bolt\.d\.ts$/);
  expect(path.isAbsolute(tsconfig.compilerOptions.paths["bolt"][0])).toBe(true);
});

test("scaffoldPlugin throws if directory already exists", async () => {
  mkdirSync(path.join(tmpDir, ".bolt", "plugins", "myplugin"), { recursive: true });
  await expect(
    scaffoldPlugin({ name: "myplugin", baseDir: tmpDir, isUser: false })
  ).rejects.toThrow("already exists");
});
