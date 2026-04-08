import { describe, test, expect, afterEach } from "bun:test";
import { scaffoldPlugin } from "../src/commands/plugin-new";
import { rmSync, readFileSync, existsSync } from "fs";
import path from "path";

const TEST_DIR = path.join(import.meta.dir, ".tmp-scaffold-test");

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("scaffoldPlugin", () => {
  test("generates class-based plugin template", async () => {
    const pluginDir = await scaffoldPlugin({ name: "my-deploy", baseDir: TEST_DIR, isUser: false });
    const indexTs = readFileSync(path.join(pluginDir, "index.ts"), "utf8");

    // Must import from "boltstack"
    expect(indexTs).toContain('from "boltstack"');
    // Must use definePlugin
    expect(indexTs).toContain("definePlugin(");
    // Must use PluginBase.withDescriptor
    expect(indexTs).toContain("PluginBase.withDescriptor(");
    // Must use @handler decorator
    expect(indexTs).toContain("@handler(");
    // Must use @param decorator
    expect(indexTs).toContain("@param(");
    // Must have the plugin namespace
    expect(indexTs).toContain('"my-deploy"');
    // Must export default class
    expect(indexTs).toContain("export default");
  });

  test("generates package.json with boltstack as devDependency", async () => {
    const pluginDir = await scaffoldPlugin({ name: "test-pkg", baseDir: TEST_DIR, isUser: false });
    const pkg = JSON.parse(readFileSync(path.join(pluginDir, "package.json"), "utf8"));

    expect(pkg.devDependencies?.boltstack).toBeDefined();
    // Should NOT be in regular dependencies
    expect(pkg.dependencies?.boltstack).toBeUndefined();
  });

  test("does not generate tsconfig.json", async () => {
    const pluginDir = await scaffoldPlugin({ name: "no-tsconfig", baseDir: TEST_DIR, isUser: false });
    expect(existsSync(path.join(pluginDir, "tsconfig.json"))).toBe(false);
  });
});
