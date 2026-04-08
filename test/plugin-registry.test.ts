import "../src/virtual-module";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from "fs";
import path from "path";
import { PluginRegistry } from "../src/plugin-registry";

const TEST_DIR = path.join(import.meta.dir, ".tmp-registry-test");
const CACHE_DIR = path.join(TEST_DIR, ".bolt", ".cache", "plugins");

// Minimal plugin source that uses "boltstack" import
const PLUGIN_SOURCE = `
import { handler, PluginBase } from "boltstack";

class TestPlugin extends PluginBase {
  namespace = "jit-test";

  @handler("Run test")
  async run(_p, _c) {}
}

export default TestPlugin;
`;

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(path.join(TEST_DIR, ".bolt", "plugins", "jit-test"), { recursive: true });
  writeFileSync(
    path.join(TEST_DIR, ".bolt", "plugins", "jit-test", "index.ts"),
    PLUGIN_SOURCE,
    "utf8",
  );
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("JIT compilation", () => {
  test("compiles plugin to cache on first load", async () => {
    const reg = new PluginRegistry();
    await reg.loadDirectory(path.join(TEST_DIR, ".bolt", "plugins"), TEST_DIR);

    const cached = path.join(CACHE_DIR, "jit-test", "index.js");
    expect(existsSync(cached)).toBe(true);

    const plugin = reg.get("jit-test");
    expect(plugin).toBeDefined();
    expect(plugin!.handlers["run"]).toBeDefined();
  });

  test("uses cache when source unchanged", async () => {
    const reg = new PluginRegistry();
    await reg.loadDirectory(path.join(TEST_DIR, ".bolt", "plugins"), TEST_DIR);

    const cached = path.join(CACHE_DIR, "jit-test", "index.js");
    const firstMtime = statSync(cached).mtimeMs;

    // Load again — should use cache (no recompilation)
    const reg2 = new PluginRegistry();
    await reg2.loadDirectory(path.join(TEST_DIR, ".bolt", "plugins"), TEST_DIR);

    const secondMtime = statSync(cached).mtimeMs;
    expect(secondMtime).toBe(firstMtime);
  });

  test("recompiles when source changes", async () => {
    const reg = new PluginRegistry();
    await reg.loadDirectory(path.join(TEST_DIR, ".bolt", "plugins"), TEST_DIR);

    const cached = path.join(CACHE_DIR, "jit-test", "index.js");
    const firstMtime = statSync(cached).mtimeMs;

    // Wait a tick so mtime differs, then touch the source
    await Bun.sleep(50);
    const srcFile = path.join(TEST_DIR, ".bolt", "plugins", "jit-test", "index.ts");
    writeFileSync(srcFile, PLUGIN_SOURCE + "\n// modified\n", "utf8");

    const reg2 = new PluginRegistry();
    await reg2.loadDirectory(path.join(TEST_DIR, ".bolt", "plugins"), TEST_DIR);

    const secondMtime = statSync(cached).mtimeMs;
    expect(secondMtime).toBeGreaterThan(firstMtime);
  });
});
