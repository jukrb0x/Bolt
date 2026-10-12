import { describe, test, expect, afterEach } from "bun:test";
import { scaffoldPlugin } from "../src/commands/plugin-new";
import { rmSync, readFileSync, existsSync } from "fs";
import path from "path";

const TEST_DIR = path.join(import.meta.dir, ".tmp-scaffold-test");

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("scaffoldPlugin", () => {
  test("generates a definePlugin template", async () => {
    const pluginDir = await scaffoldPlugin({ name: "my-deploy", baseDir: TEST_DIR, isUser: false });
    const indexTs = readFileSync(path.join(pluginDir, "index.ts"), "utf8");

    expect(indexTs).toContain('from "boltstack"');
    expect(indexTs).toContain("definePlugin(");
    expect(indexTs).toContain("defineHandler(");
    expect(indexTs).not.toContain("PluginBase.withDescriptor(");
    expect(indexTs).not.toContain("@handler(");
    expect(indexTs).not.toContain("@param(");
    expect(indexTs).toContain('"my-deploy"');
    expect(indexTs).toContain("export default definePlugin");
  });

  test("generates package.json with boltstack as devDependency", async () => {
    const pluginDir = await scaffoldPlugin({ name: "test-pkg", baseDir: TEST_DIR, isUser: false });
    const pkg = JSON.parse(readFileSync(path.join(pluginDir, "package.json"), "utf8"));

    expect(pkg.devDependencies?.boltstack).toBeDefined();
    // Should NOT be in regular dependencies
    expect(pkg.dependencies?.boltstack).toBeUndefined();
  });

  test("does not scaffold a decorator tsconfig", async () => {
    const pluginDir = await scaffoldPlugin({
      name: "with-tsconfig",
      baseDir: TEST_DIR,
      isUser: false,
    });
    expect(existsSync(path.join(pluginDir, "tsconfig.json"))).toBe(false);
    expect(existsSync(path.join(pluginDir, "index.ts"))).toBe(true);
  });
});
