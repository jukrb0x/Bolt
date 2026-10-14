import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { bolt, dispose, makeProject, type Project } from "./harness";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) dispose(dir);
});

function track(project: Project): Project {
  temps.push(project.dir);
  return project;
}

function writeSentinelPlugin(pluginDir: string, sentinelPath: string): void {
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    path.join(pluginDir, "index.ts"),
    `import { writeFileSync } from "fs";
writeFileSync(${JSON.stringify(sentinelPath)}, "executed\\n");
throw new Error("sentinel top-level throw");
export default { namespace: "sentinel", handlers: {} };
`,
    "utf8",
  );
}

function writeManifest(pluginDir: string, namespace: string, sourcesHash: string): void {
  writeFileSync(
    path.join(pluginDir, "bolt.plugin.json"),
    JSON.stringify(
      {
        namespace,
        description: "Sentinel",
        sourcesHash,
        handlers: {
          ping: { ai: true, description: "Ping" },
        },
      },
      null,
      2,
    ) + "\n",
  );
}

async function sourcesHashViaBuild(dir: string, name: string, home?: string): Promise<string> {
  // Compute hash the same way as the CLI by reading files after writing index.ts
  const { createHash } = await import("crypto");
  const pluginDir = path.join(dir, ".bolt", "plugins", name);
  const hash = createHash("sha256");
  const files = readdirSync(pluginDir)
    .filter((e) => e.endsWith(".ts") || e.endsWith(".tsx"))
    .sort();
  for (const f of files) {
    hash.update(f);
    hash.update("\0");
    hash.update(readFileSync(path.join(pluginDir, f)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

test("ai and ai --stdout do not execute project plugin top-level code", async () => {
  const project = track(makeProject());
  const sentinel = path.join(project.dir, "SENTINEL");
  const pluginDir = path.join(project.dir, ".bolt", "plugins", "sentinel");
  writeSentinelPlugin(pluginDir, sentinel);
  const hash = await sourcesHashViaBuild(project.dir, "sentinel");
  writeManifest(pluginDir, "sentinel", hash);

  const out = await bolt(project.dir, ["ai", "--stdout"]);
  expect(out.exitCode).toBe(0);
  expect(existsSync(sentinel)).toBe(false);

  const written = await bolt(project.dir, ["ai"]);
  expect(written.exitCode).toBe(0);
  expect(existsSync(sentinel)).toBe(false);
  expect(existsSync(path.join(project.dir, ".bolt", "ai-context.md"))).toBe(true);
});

test("ai does not create .bolt/.cache; stdout writes nothing under project", async () => {
  const project = track(makeProject());
  // Ensure no .bolt yet from makeProject? makeProject may not create .bolt
  const boltDir = path.join(project.dir, ".bolt");
  if (existsSync(boltDir)) rmSync(boltDir, { recursive: true, force: true });

  const stdout = await bolt(project.dir, ["ai", "--stdout"]);
  expect(stdout.exitCode).toBe(0);
  expect(existsSync(boltDir)).toBe(false);

  const def = await bolt(project.dir, ["ai"]);
  expect(def.exitCode).toBe(0);
  expect(existsSync(path.join(boltDir, "ai-context.md"))).toBe(true);
  expect(existsSync(path.join(boltDir, ".cache"))).toBe(false);
});

test("ai leaves pre-existing .bolt/.cache marker untouched", async () => {
  const project = track(makeProject());
  const marker = path.join(project.dir, ".bolt", ".cache", "marker");
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, "keep\n");
  const before = statSync(marker);

  await Bun.sleep(20);
  const stdout = await bolt(project.dir, ["ai", "--stdout"]);
  expect(stdout.exitCode).toBe(0);
  expect(readFileSync(marker, "utf8")).toBe("keep\n");
  expect(statSync(marker).mtimeMs).toBe(before.mtimeMs);

  await Bun.sleep(20);
  const def = await bolt(project.dir, ["ai"]);
  expect(def.exitCode).toBe(0);
  expect(readFileSync(marker, "utf8")).toBe("keep\n");
  expect(statSync(marker).mtimeMs).toBe(before.mtimeMs);
  expect(existsSync(path.join(project.dir, ".bolt", "ai-context.md"))).toBe(true);
});

test("plugin build executes plugin code; ai does not", async () => {
  const project = track(makeProject());
  const sentinel = path.join(project.dir, "BUILD_SENTINEL");
  const pluginDir = path.join(project.dir, ".bolt", "plugins", "boom");
  mkdirSync(pluginDir, { recursive: true });
  // definePlugin-style so build can load after fixing throw for build path —
  // use a plugin that writes sentinel at top level but still exports a valid plugin.
  writeFileSync(
    path.join(pluginDir, "index.ts"),
    `import { writeFileSync } from "fs";
import { defineHandler, definePlugin } from "boltstack";
writeFileSync(${JSON.stringify(sentinel)}, "executed\\n");
export default definePlugin({
  namespace: "boom",
  version: "0.1.0",
  description: "Boom",
  handlers: {
    ping: defineHandler({ ai: true, description: "Ping" }, async () => {}),
  },
});
`,
  );

  const build = await bolt(project.dir, ["plugin", "build", "boom"]);
  expect(build.exitCode).toBe(0);
  expect(existsSync(sentinel)).toBe(true);
  expect(existsSync(path.join(pluginDir, "bolt.plugin.json"))).toBe(true);

  rmSync(sentinel, { force: true });
  const ai = await bolt(project.dir, ["ai", "--stdout"]);
  expect(ai.exitCode).toBe(0);
  expect(existsSync(sentinel)).toBe(false);
});

test("user plugin missing manifest: exit 3 with absolute path", async () => {
  const project = track(makeProject());
  const home = path.join(project.dir, "home");
  const pluginDir = path.join(home, ".bolt", "plugins", "uplug");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    path.join(pluginDir, "index.ts"),
    `export default { namespace: "uplug", handlers: { x: async () => {} } };\n`,
  );

  const result = await bolt(project.dir, ["ai", "--stdout"], { HOME: home });
  expect(result.exitCode).toBe(3);
  expect(result.output).toContain(path.join(pluginDir, "bolt.plugin.json"));
  expect(result.output).toContain("uplug");
  expect(result.output).toContain("Run: bolt plugin build uplug");
});

test("stale sourcesHash: exit 3 after editing .ts without rebuild", async () => {
  const project = track(makeProject());
  const pluginDir = path.join(project.dir, ".bolt", "plugins", "stale");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    path.join(pluginDir, "index.ts"),
    `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: "stale",
  version: "0.1.0",
  description: "Stale",
  handlers: {
    ping: defineHandler({ ai: true, description: "Ping" }, async () => {}),
  },
});
`,
  );
  const built = await bolt(project.dir, ["plugin", "build", "stale"]);
  expect(built.exitCode).toBe(0);

  writeFileSync(
    path.join(pluginDir, "index.ts"),
    `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: "stale",
  version: "0.1.0",
  description: "Stale changed",
  handlers: {
    ping: defineHandler({ ai: true, description: "Ping2" }, async () => {}),
  },
});
`,
  );

  const result = await bolt(project.dir, ["ai", "--stdout"]);
  expect(result.exitCode).toBe(3);
  expect(result.output).toContain("sourcesHash mismatch");
  expect(result.output).toContain(path.join(pluginDir, "bolt.plugin.json"));
  expect(result.output).toContain("Run: bolt plugin build stale");
});

test("explicit plugins path and invalid JSON exit 3", async () => {
  const project = track(
    makeProject({
      extraPlugins: "  - namespace: custom\n    path: ./tools/custom/index.ts\n",
    }),
  );
  const custom = path.join(project.dir, "tools", "custom");
  mkdirSync(custom, { recursive: true });
  writeFileSync(
    path.join(custom, "index.ts"),
    `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: "custom",
  version: "0.1.0",
  description: "Custom",
  handlers: {
    ping: defineHandler({ ai: true, description: "Ping" }, async () => {}),
  },
});
`,
  );

  const missing = await bolt(project.dir, ["ai", "--stdout"]);
  expect(missing.exitCode).toBe(3);
  expect(missing.output).toContain(path.join(custom, "bolt.plugin.json"));

  writeFileSync(path.join(custom, "bolt.plugin.json"), "{nope");
  const bad = await bolt(project.dir, ["ai", "--stdout"]);
  expect(bad.exitCode).toBe(3);
  expect(bad.output).toContain("invalid JSON");
  expect(bad.output).toContain("Run: bolt plugin build custom");

  const built = await bolt(project.dir, ["plugin", "build", "custom"]);
  expect(built.exitCode).toBe(0);
  const ok = await bolt(project.dir, ["ai", "--stdout"]);
  expect(ok.exitCode).toBe(0);
  expect(ok.stdout).toContain("<!-- context hash:");
});

test("plugin new scaffolds manifest; ai works without separate build", async () => {
  const project = track(makeProject());
  const created = await bolt(project.dir, ["plugin", "new", "fresh"]);
  expect(created.exitCode).toBe(0);
  const manifest = path.join(project.dir, ".bolt", "plugins", "fresh", "bolt.plugin.json");
  expect(existsSync(manifest)).toBe(true);

  const ai = await bolt(project.dir, ["ai", "--stdout"]);
  expect(ai.exitCode).toBe(0);
});
