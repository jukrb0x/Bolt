import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { generateAiContext } from "../ai-context";
import type { BoltConfig } from "../config";
import { builtinPlugins } from "../plugins";
import { PluginRegistry } from "../plugin-registry";
import {
  buildStaticAiRegistry,
  computeSourcesHash,
  parseStaticPluginFile,
  PLUGIN_MANIFEST_FILENAME,
  scaffoldStaticManifest,
  StaticManifestError,
  writeStaticPluginFile,
} from "../static-plugin-manifest";
import { scaffoldPlugin } from "../commands/plugin-new";
import { testCfg } from "./env";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function writeYaml(dir: string, body = "project:\n  name: Demo\n"): string {
  const configPath = path.join(dir, "bolt.yaml");
  writeFileSync(configPath, body);
  return configPath;
}

function hashOf(content: string): string {
  const match = content.match(/<!-- context hash: ([0-9a-f]{16}) -->/);
  expect(match).not.toBeNull();
  return match![1];
}

const cfg: BoltConfig = {
  ...testCfg,
  tasks: { ping: [{ uses: "git/info", with: { path: "." } }] },
  flows: {},
};

test("ai.ts must not call buildRegistry, compilePlugin, or dynamic import", () => {
  const src = readFileSync(path.join(import.meta.dir, "../commands/ai.ts"), "utf8");
  expect(src).not.toMatch(/\bbuildRegistry\b/);
  expect(src).not.toMatch(/\bcompilePlugin\b/);
  expect(src).not.toMatch(/\bimport\s*\(/);
  // Mutation gate: re-adding buildRegistry to ai.ts must fail this test.
  expect(src).toMatch(/buildStaticAiRegistry/);
});

test("static-plugin-manifest module never calls buildRegistry or dynamic import", () => {
  const src = readFileSync(path.join(import.meta.dir, "../static-plugin-manifest.ts"), "utf8");
  expect(src).not.toMatch(/\bbuildRegistry\b/);
  expect(src).not.toMatch(/\bimport\s*\(/);
  expect(src).not.toMatch(/\.compilePlugin\b/);
  expect(src).not.toMatch(/await\s+import\s*\(/);
});

test("builtin-only static registry matches live generateAiContext hash and body", () => {
  const dir = tempDir("bolt-ai3-golden-");
  const configPath = writeYaml(dir);
  const live = new PluginRegistry();
  for (const p of builtinPlugins) live.register(p);
  const liveCtx = generateAiContext(cfg, configPath, live);

  const staticReg = buildStaticAiRegistry({ plugins: [] }, dir, [...builtinPlugins]);
  const staticCtx = generateAiContext(cfg, configPath, staticReg);

  expect(hashOf(staticCtx)).toBe(hashOf(liveCtx));
  expect(staticCtx).toBe(liveCtx);
});

test("sourcesHash hashes compile .ts contents and ignores compiled JS", () => {
  const dir = tempDir("bolt-ai3-hash-");
  const pluginDir = path.join(dir, "plug");
  mkdirSync(pluginDir);
  writeFileSync(path.join(pluginDir, "index.ts"), "export default {}\n");
  const h1 = computeSourcesHash(pluginDir);
  writeFileSync(path.join(pluginDir, "index.js"), "/* compiled */ export default {}\n");
  expect(computeSourcesHash(pluginDir)).toBe(h1);
  writeFileSync(path.join(pluginDir, "index.ts"), "export default { changed: true }\n");
  expect(computeSourcesHash(pluginDir)).not.toBe(h1);
});

test("missing bolt.plugin.json throws exit-3 style error with absolute path", () => {
  const dir = tempDir("bolt-ai3-miss-");
  writeYaml(dir);
  const pluginDir = path.join(dir, ".bolt", "plugins", "sentinel");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(path.join(pluginDir, "index.ts"), "export default {}\n");

  expect(() => buildStaticAiRegistry({ plugins: [] }, dir, [])).toThrow(StaticManifestError);
  try {
    buildStaticAiRegistry({ plugins: [] }, dir, []);
  } catch (e) {
    expect(e).toBeInstanceOf(StaticManifestError);
    const err = e as StaticManifestError;
    expect(err.reason).toBe("missing");
    expect(err.namespace).toBe("sentinel");
    expect(err.manifestPath).toBe(path.join(pluginDir, PLUGIN_MANIFEST_FILENAME));
    expect(path.isAbsolute(err.manifestPath)).toBe(true);
    expect(err.message).toContain("Run: bolt plugin build sentinel");
    expect(err.message).toContain(err.manifestPath);
  }
});

test("stale sourcesHash throws with absolute path and fix command", () => {
  const dir = tempDir("bolt-ai3-stale-");
  writeYaml(dir);
  const pluginDir = path.join(dir, ".bolt", "plugins", "stale");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(path.join(pluginDir, "index.ts"), "export const n = 1\n");
  writeStaticPluginFile(pluginDir, {
    namespace: "stale",
    sourcesHash: "0".repeat(64),
    handlers: { run: { ai: true, description: "Run" } },
  });
  writeFileSync(path.join(pluginDir, "index.ts"), "export const n = 2\n");

  try {
    buildStaticAiRegistry({ plugins: [] }, dir, []);
    expect.unreachable();
  } catch (e) {
    const err = e as StaticManifestError;
    expect(err.reason).toBe("hash mismatch");
    expect(err.message).toContain("sourcesHash mismatch");
    expect(err.message).toContain(path.join(pluginDir, PLUGIN_MANIFEST_FILENAME));
    expect(err.message).toContain("Run: bolt plugin build stale");
  }
});

test("invalid JSON throws exit-3 style error", () => {
  const dir = tempDir("bolt-ai3-badjson-");
  writeYaml(dir);
  const pluginDir = path.join(dir, ".bolt", "plugins", "bad");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(path.join(pluginDir, "index.ts"), "export {}\n");
  writeFileSync(path.join(pluginDir, PLUGIN_MANIFEST_FILENAME), "{not-json");

  try {
    buildStaticAiRegistry({ plugins: [] }, dir, []);
    expect.unreachable();
  } catch (e) {
    const err = e as StaticManifestError;
    expect(err.reason).toBe("invalid");
    expect(err.message).toContain(path.join(pluginDir, PLUGIN_MANIFEST_FILENAME));
    expect(err.message).toContain("Run: bolt plugin build bad");
  }
});

test("shape is catalog/paramsSchema JSON including ai confirm, not Zod dump", () => {
  const dir = tempDir("bolt-ai3-shape-");
  const pluginDir = path.join(dir, "deploy");
  mkdirSync(pluginDir);
  writeFileSync(path.join(pluginDir, "index.ts"), "export {}\n");
  const file = {
    namespace: "deploy",
    description: "Ship it",
    sourcesHash: computeSourcesHash(pluginDir),
    handlers: {
      ship: {
        ai: "confirm" as const,
        description: "Ship ${target}",
        describe: "Ship to prod",
        capabilities: ["deploy.ship"],
        paramsSchema: {
          type: "object",
          properties: { target: { type: "string", description: "Target" } },
          required: ["target"],
        },
      },
      hidden: { ai: false as const, description: "Hidden" },
    },
  };
  const out = writeStaticPluginFile(pluginDir, file);
  expect(out).toBe(path.join(pluginDir, PLUGIN_MANIFEST_FILENAME));
  const raw = readFileSync(out, "utf8");
  expect(raw).not.toContain("_def");
  expect(raw).not.toContain("~standard");
  const parsed = parseStaticPluginFile(raw, "deploy", out);
  expect(parsed.handlers.ship.ai).toBe("confirm");
  expect(parsed.handlers.ship.paramsSchema?.properties).toBeTruthy();
  expect(parsed.handlers.ship.capabilities).toEqual(["deploy.ship"]);
});

test("explicit plugins[].path missing manifest exits with abs path", () => {
  const dir = tempDir("bolt-ai3-path-");
  writeYaml(dir);
  const custom = path.join(dir, "tools", "custom");
  mkdirSync(custom, { recursive: true });
  writeFileSync(path.join(custom, "index.ts"), "export default {}\n");

  try {
    buildStaticAiRegistry(
      { plugins: [{ namespace: "custom", path: "./tools/custom/index.ts" }] },
      dir,
      [],
    );
    expect.unreachable();
  } catch (e) {
    const err = e as StaticManifestError;
    expect(err.namespace).toBe("custom");
    expect(err.manifestPath).toBe(path.join(custom, PLUGIN_MANIFEST_FILENAME));
    expect(path.isAbsolute(err.manifestPath)).toBe(true);
  }
});

test("user-scope missing manifest uses absolute path under HOME", () => {
  const home = tempDir("bolt-ai3-home-");
  const dir = tempDir("bolt-ai3-proj-");
  writeYaml(dir);
  const pluginDir = path.join(home, ".bolt", "plugins", "uplug");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(path.join(pluginDir, "index.ts"), "export {}\n");

  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    try {
      buildStaticAiRegistry({ plugins: [] }, dir, []);
      expect.unreachable();
    } catch (e) {
      const err = e as StaticManifestError;
      expect(err.namespace).toBe("uplug");
      expect(err.manifestPath).toBe(path.join(pluginDir, PLUGIN_MANIFEST_FILENAME));
      expect(err.manifestPath.startsWith(home)).toBe(true);
      expect(err.message).toContain("Run: bolt plugin build uplug");
    }
  } finally {
    process.env.HOME = prev;
  }
});

test("plugin new scaffolds usable bolt.plugin.json", async () => {
  const dir = tempDir("bolt-ai3-new-");
  writeYaml(dir);
  const pluginDir = await scaffoldPlugin({ name: "fresh", baseDir: dir, isUser: false });
  const manifestPath = path.join(pluginDir, PLUGIN_MANIFEST_FILENAME);
  expect(existsSync(manifestPath)).toBe(true);
  const raw = readFileSync(manifestPath, "utf8");
  const parsed = parseStaticPluginFile(raw, "fresh", manifestPath);
  expect(parsed.namespace).toBe("fresh");
  expect(parsed.sourcesHash).toBe(computeSourcesHash(pluginDir));
  expect(parsed.handlers.run?.paramsSchema).toBeTruthy();

  // Static registry loads without executing (no throw from top-level).
  const reg = buildStaticAiRegistry({ plugins: [] }, dir, []);
  expect(reg.get("fresh")?.namespace).toBe("fresh");
});

test("scaffoldStaticManifest sourcesHash matches written sources", () => {
  const dir = tempDir("bolt-ai3-scaf-");
  writeFileSync(path.join(dir, "index.ts"), "export const x = 1\n");
  const file = scaffoldStaticManifest("x", dir);
  expect(file.sourcesHash).toBe(computeSourcesHash(dir));
});
