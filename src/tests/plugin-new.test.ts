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
  expect(indexTs).toContain('namespace = "myns"');
  expect(indexTs).toContain('class MynsPlugin extends PluginBase');
  expect(indexTs).toContain('@handler');
  expect(indexTs).toContain('from "boltstack"');
});

test("scaffoldPlugin package.json has boltstack devDependency (project-scope)", async () => {
  mkdirSync(tmpDir, { recursive: true });
  await scaffoldPlugin({ name: "myplugin", baseDir: tmpDir, isUser: false });

  const pkg = JSON.parse(
    readFileSync(path.join(tmpDir, ".bolt", "plugins", "myplugin", "package.json"), "utf8")
  );
  expect(pkg.devDependencies["boltstack"]).toBe("latest");
});

test("scaffoldPlugin tsconfig.json includes boltstack in types", async () => {
  mkdirSync(tmpDir, { recursive: true });
  await scaffoldPlugin({ name: "myplugin", baseDir: tmpDir, isUser: false });

  const tsconfig = JSON.parse(
    readFileSync(path.join(tmpDir, ".bolt", "plugins", "myplugin", "tsconfig.json"), "utf8")
  );
  expect(tsconfig.compilerOptions.types).toContain("boltstack");
  expect(tsconfig.compilerOptions.types).toContain("bun-types");
});

test("scaffoldPlugin package.json has boltstack devDependency (user-scope)", async () => {
  mkdirSync(tmpDir, { recursive: true });
  const userBase = path.join(tmpDir, "userhome");
  mkdirSync(userBase, { recursive: true });
  await scaffoldPlugin({ name: "myplugin", baseDir: userBase, isUser: true });

  const pkg = JSON.parse(
    readFileSync(path.join(userBase, "plugins", "myplugin", "package.json"), "utf8")
  );
  expect(pkg.devDependencies["boltstack"]).toBe("latest");
});

test("scaffoldPlugin throws if directory already exists", async () => {
  mkdirSync(path.join(tmpDir, ".bolt", "plugins", "myplugin"), { recursive: true });
  await expect(
    scaffoldPlugin({ name: "myplugin", baseDir: tmpDir, isUser: false })
  ).rejects.toThrow("already exists");
});
