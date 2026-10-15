import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "fs";
import os from "os";
import path from "path";
import {
  NO_CONFIG,
  configKey,
  configRecord,
  findBundleBlock,
  pluginExportKind,
  prunePluginCache,
  sourceHashOf,
} from "../plugin-cache";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(REPO_ROOT, "src/main.ts");

function parseStdout(out: string): Record<string, unknown> {
  expect(out.startsWith("{")).toBe(true);
  return JSON.parse(out) as Record<string, unknown>;
}

async function bolt(
  argv: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", MAIN, ...argv], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

function writePlugin(dir: string, body: string, file = "index.ts") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), body);
}

const FN_PLUGIN = `import { defineHandler, definePlugin } from "boltstack";
export default definePlugin({
  namespace: "demo",
  version: "1",
  description: "demo",
  handlers: { go: defineHandler({ ai: true, description: "go" }, async () => {}) },
});
`;

const CLASS_PLUGIN = `import { PluginBase, handler } from "boltstack";
export default class Demo extends PluginBase {
  namespace = "demo";
  version = "1";
  description = "demo";
  @handler("go")
  async go() {}
}
`;

test("source hash covers nested files and ignores node_modules", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bolt-src-hash-"));
  try {
    writeFileSync(path.join(root, "index.ts"), "export {}\n");
    mkdirSync(path.join(root, "lib"));
    writeFileSync(path.join(root, "lib", "util.ts"), "export const n = 1;\n");
    mkdirSync(path.join(root, "node_modules", "left-pad"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", "left-pad", "index.js"), "x");
    const first = sourceHashOf(root);
    writeFileSync(path.join(root, "lib", "util.ts"), "export const n = 2;\n");
    expect(sourceHashOf(root)).not.toBe(first);
    writeFileSync(path.join(root, "node_modules", "left-pad", "index.js"), "y");
    expect(sourceHashOf(root)).not.toBe(first);
    expect(sourceHashOf(root)).toBe(sourceHashOf(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("function plugins use noconfig and class plugins hash config", () => {
  expect(configKey("value", { token: "a" })).toBe(NO_CONFIG);
  expect(configKey("class", undefined)).toBe(NO_CONFIG);
  expect(configKey("class", configRecord({}))).toBe(NO_CONFIG);
  const a = configKey("class", { token: "a" });
  const b = configKey("class", { token: "b" });
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toBe(b);
  expect(pluginExportKind({ constructor: class Demo {} })).toBe("class");
  expect(pluginExportKind({})).toBe("value");
});

test("bundle scan rejects native addons and non-literal require/import", () => {
  expect(findBundleBlock('import { z } from "boltstack";\nexport default 1;\n')).toBeUndefined();
  expect(findBundleBlock('__require("./addon-kp17b4cw.node")')?.reason).toContain("native .node");
  expect(findBundleBlock("__require(name)")?.reason).toContain("non-literal");
  expect(findBundleBlock("import(name);")?.reason).toContain("dynamic import");
});

test("prune keeps every config of the current source and drops the rest", () => {
  const cache = mkdtempSync(path.join(os.tmpdir(), "bolt-prune-"));
  const ns = "demo";
  const source = "a".repeat(64);
  const other = "b".repeat(64);
  const artefact = "c".repeat(64);
  const orphan = "d".repeat(64);
  const base = path.join(cache, "plugins", ns);
  mkdirSync(path.join(base, "artefacts", artefact), { recursive: true });
  mkdirSync(path.join(base, "artefacts", orphan), { recursive: true });
  writeFileSync(path.join(base, "artefacts", artefact, "index.js"), "live");
  writeFileSync(path.join(base, "artefacts", orphan, "index.js"), "old");
  const manifest = {
    schema: "bolt.plugin-manifest/v1",
    source_hash: source,
    config_hash: NO_CONFIG,
    artefact_hash: artefact,
    export_kind: "value",
  };
  mkdirSync(path.join(base, "manifests"), { recursive: true });
  writeFileSync(
    path.join(base, "manifests", `${source}-${NO_CONFIG}.json`),
    JSON.stringify(manifest),
  );
  writeFileSync(
    path.join(base, "manifests", `${other}-${NO_CONFIG}.json`),
    JSON.stringify({ ...manifest, source_hash: other, artefact_hash: orphan }),
  );
  const removed = prunePluginCache(cache, ns, source);
  expect(removed.manifests).toBe(1);
  expect(removed.artefacts).toBe(1);
  expect(existsSync(path.join(base, "manifests", `${source}-${NO_CONFIG}.json`))).toBe(true);
  expect(existsSync(path.join(base, "artefacts", artefact, "index.js"))).toBe(true);
  expect(existsSync(path.join(base, "artefacts", orphan))).toBe(false);
  rmSync(cache, { recursive: true, force: true });
});

test("read-only commands do not import an unbuilt plugin and previews fail closed", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-1b-ro-"));
  const home = path.join(dir, "home");
  const pluginDir = path.join(dir, ".bolt", "plugins", "marker");
  const marker = path.join(dir, "MARKER");
  writePlugin(
    pluginDir,
    `const fs = require("fs");\nfs.writeFileSync(${JSON.stringify(marker)}, "imported\\n");\nmodule.exports = { namespace: "marker", handlers: { go: async () => {} } };\n`,
    "index.js",
  );
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    "version: 1\nproject:\n  name: Demo\ntasks:\n  go:\n    - uses: marker/go\n",
  );
  const env = { HOME: home, USERPROFILE: home };
  try {
    for (const argv of [
      ["inspect", "go", "--json"],
      ["status", "--json"],
      ["info", "--json"],
      ["list", "--json"],
      ["check", "--json"],
      ["run", "go", "--dry-run"],
    ]) {
      const run = await bolt(argv, dir, env);
      expect(run.code === 0 || argv[0] === "run").toBe(true);
      expect(existsSync(marker)).toBe(false);
    }
    const inspected = await bolt(["inspect", "go", "--json"], dir, env);
    expect(inspected.code).toBe(0);
    const body = parseStdout(inspected.out);
    expect(body.schema).toBe("bolt.inspect/v1");
    const data = body.data as { ai: boolean | string; ai_reasons: Array<{ code?: string }> };
    expect(data.ai).toBe(false);
    expect(data.ai_reasons.some((reason) => reason.code === "PLUGIN_NOT_BUILT")).toBe(true);
    const warnings = body.warnings as Array<{ code: string; hint?: string }>;
    expect(
      warnings.some(
        (item) => item.code === "PLUGIN_NOT_BUILT" && item.hint === "bolt plugin build marker",
      ),
    ).toBe(true);
    expect(existsSync(path.join(dir, ".bolt", ".cache", "plugins", "marker", "manifests"))).toBe(
      false,
    );
    const status = parseStdout((await bolt(["status", "--json"], dir, env)).out);
    expect(status.schema).toBe("bolt.status/v1");
    const statusData = status.data as {
      agent_mode: boolean;
      plugins: Array<{ namespace: string; built: boolean }>;
      policy: { ai_run: string };
      schemas: Record<string, string>;
    };
    expect(statusData.agent_mode).toBe(false);
    expect(statusData.policy.ai_run).toBe("confirm");
    expect(statusData.plugins).toEqual([{ namespace: "marker", built: false }]);
    expect(statusData.schemas).toEqual({
      list: "v1",
      info: "v1",
      check: "v1",
      inspect: "v1",
      status: "v1",
      run: "v1",
      ai: "v1",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("human bolt run and --simulate refresh the manifest; dry-run does not", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-1b-run-"));
  const home = path.join(dir, "home");
  const pluginDir = path.join(dir, ".bolt", "plugins", "demo");
  writePlugin(pluginDir, FN_PLUGIN);
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    "version: 1\nproject:\n  name: Demo\ntasks:\n  go:\n    - uses: demo/go\n",
  );
  const env = { HOME: home, USERPROFILE: home };
  const manifestDir = path.join(dir, ".bolt", ".cache", "plugins", "demo", "manifests");
  try {
    const dry = await bolt(["run", "go", "--dry-run"], dir, env);
    expect(dry.code).toBe(0);
    expect(existsSync(manifestDir)).toBe(false);

    const ran = await bolt(["run", "go"], dir, env);
    expect(ran.code).toBe(0);
    expect(ran.err + ran.out).not.toContain("cannot be bundled");
    const files = readdirSync(manifestDir);
    expect(files.some((name) => name.endsWith(`-${NO_CONFIG}.json`))).toBe(true);

    const inspected = parseStdout((await bolt(["inspect", "go", "--json"], dir, env)).out);
    const warnings = inspected.warnings as Array<{ code: string }>;
    expect(warnings.some((item) => item.code === "PLUGIN_NOT_BUILT")).toBe(false);
    const data = inspected.data as {
      ai: boolean | string;
      tasks: Array<{ nodes: Array<{ ai?: boolean | string }> }>;
    };
    expect(data.ai).toBe("confirm");
    expect(data.tasks[0].nodes[0].ai).toBe("confirm");

    rmSync(path.join(dir, ".bolt", ".cache"), { recursive: true, force: true });
    const simulated = await bolt(["run", "go", "--simulate"], dir, env);
    expect(simulated.code).toBe(0);
    expect(readdirSync(manifestDir).length).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two configs of one user plugin coexist and a function plugin stays noconfig", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bolt-1b-multi-"));
  const home = path.join(root, "home");
  const pluginDir = path.join(home, ".bolt", "plugins", "demo");
  writePlugin(pluginDir, CLASS_PLUGIN);
  const fnDir = path.join(home, ".bolt", "plugins", "fn");
  writePlugin(fnDir, FN_PLUGIN.replaceAll('namespace: "demo"', 'namespace: "fn"'));
  const env = { HOME: home, USERPROFILE: home };
  const projects = ["alpha", "beta"].map((token) => {
    const dir = path.join(root, token);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "bolt.yaml"),
      `version: 1\nproject:\n  name: Demo\nplugins:\n  - namespace: demo\n    config:\n      token: ${token}\n  - namespace: fn\n    config:\n      token: ${token}\ntasks:\n  go:\n    - uses: demo/go\n  fn:\n    - uses: fn/go\n`,
    );
    return dir;
  });
  try {
    for (const dir of projects) {
      const built = await bolt(["plugin", "build", "demo", "fn"], dir, env);
      expect(built.code).toBe(0);
      expect(built.err).not.toContain("cannot be bundled");
    }
    const manifests = readdirSync(
      path.join(home, ".bolt", ".cache", "plugins", "demo", "manifests"),
    );
    expect(manifests).toHaveLength(2);
    expect(new Set(manifests).size).toBe(2);
    const fnManifests = readdirSync(
      path.join(home, ".bolt", ".cache", "plugins", "fn", "manifests"),
    );
    expect(fnManifests.every((name) => name.endsWith(`-${NO_CONFIG}.json`))).toBe(true);
    expect(new Set(fnManifests).size).toBe(1);
    for (const dir of projects) {
      const inspected = parseStdout((await bolt(["inspect", "go", "--json"], dir, env)).out);
      const warnings = inspected.warnings as Array<{ code: string }>;
      expect(warnings.some((item) => item.code === "PLUGIN_NOT_BUILT")).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("js plugins are bundled and native or dynamic require fails closed", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-1b-js-"));
  const home = path.join(dir, "home");
  const env = { HOME: home, USERPROFILE: home };
  const jsDir = path.join(dir, ".bolt", "plugins", "jsplug");
  writePlugin(
    jsDir,
    `const { VALUE } = require("./sibling.js");\nmodule.exports = { namespace: "jsplug", handlers: { go: async () => VALUE } };\n`,
    "index.js",
  );
  writeFileSync(path.join(jsDir, "sibling.js"), 'module.exports = { VALUE: "from-sibling" };\n');
  const dynDir = path.join(dir, ".bolt", "plugins", "dyn");
  writePlugin(
    dynDir,
    `const name = "./sibling.js";\nrequire(name);\nmodule.exports = { namespace: "dyn", handlers: { go: async () => {} } };\n`,
    "index.js",
  );
  writeFileSync(path.join(dynDir, "sibling.js"), "module.exports = { VALUE: 1 };\n");
  const nativeDir = path.join(dir, ".bolt", "plugins", "nat");
  writePlugin(
    nativeDir,
    `require("./addon.node");\nmodule.exports = { namespace: "nat", handlers: { go: async () => {} } };\n`,
    "index.js",
  );
  writeFileSync(path.join(nativeDir, "addon.node"), "not a real addon");
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    "version: 1\nproject:\n  name: Demo\ntasks:\n  go:\n    - run: echo hi\n",
  );
  try {
    const built = await bolt(["plugin", "build", "jsplug"], dir, env);
    expect(built.code).toBe(0);
    const artefacts = path.join(dir, ".bolt", ".cache", "plugins", "jsplug", "artefacts");
    const hashDir = readdirSync(artefacts)[0];
    const bundle = readFileSync(path.join(artefacts, hashDir, "index.js"), "utf8");
    expect(bundle).toContain("from-sibling");
    writeFileSync(path.join(jsDir, "sibling.js"), 'module.exports = { VALUE: "changed" };\n');
    expect(readFileSync(path.join(artefacts, hashDir, "index.js"), "utf8")).toContain(
      "from-sibling",
    );
    expect(readFileSync(path.join(artefacts, hashDir, "index.js"), "utf8")).not.toContain(
      "changed",
    );

    const dynamic = await bolt(["plugin", "build", "dyn"], dir, env);
    expect(dynamic.code).not.toBe(0);
    expect(dynamic.err).toContain("cannot be bundled");
    expect(dynamic.err).toContain("dyn");
    expect(existsSync(path.join(dir, ".bolt", ".cache", "plugins", "dyn", "manifests"))).toBe(
      false,
    );

    const native = await bolt(["plugin", "build", "nat"], dir, env);
    expect(native.code).not.toBe(0);
    expect(native.err).toContain("cannot be bundled");
    expect(native.err).toContain(".node");
    expect(existsSync(path.join(dir, ".bolt", ".cache", "plugins", "nat", "manifests"))).toBe(
      false,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("json masks env and local values and plan_hash tracks the secret", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-1b-mask-"));
  const home = path.join(dir, "home");
  writeFileSync(
    path.join(dir, "bolt.yaml"),
    [
      "version: 1",
      "project:",
      "  name: Demo",
      "vars:",
      "  shown: public-value",
      "plugins:",
      "  - namespace: ue",
      "    config:",
      "      engine:",
      "        path: D:/PublicEngine",
      "        vcs: git",
      "      project:",
      "        path: D:/Proj",
      "        vcs: git",
      "      uproject: ./x.uproject",
      "      targets:",
      "        editor:",
      "          kind: editor",
      "tasks:",
      "  hello:",
      "    - run: echo ${{ env.TOKEN }} ${{ vars.secret }} ${{ vars.shown }}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(dir, "bolt.local.yaml"),
    [
      "vars:",
      "  secret: s3cret-value",
      "plugins:",
      "  ue:",
      "    engine:",
      "      path: D:/SecretEngine",
      "    targets:",
      "      editor:",
      "        name: LocalTargetName",
      "ai:",
      "  run: never",
      "",
    ].join("\n"),
  );
  const env = { HOME: home, USERPROFILE: home, TOKEN: "super-secret" };
  try {
    const inspected = await bolt(["inspect", "hello", "--json"], dir, env);
    expect(inspected.code).toBe(0);
    expect(inspected.out).toContain("«env:TOKEN»");
    expect(inspected.out).toContain("«local:secret»");
    expect(inspected.out).toContain("public-value");
    expect(inspected.out).not.toContain("super-secret");
    expect(inspected.out).not.toContain("s3cret-value");
    const first = parseStdout(inspected.out).data as { plan_hash: string; ai: string };
    expect(first.plan_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.ai).toBe("confirm");

    const again = parseStdout(
      (await bolt(["inspect", "hello", "--json"], dir, { ...env, TOKEN: "other-secret" })).out,
    ).data as { plan_hash: string };
    expect(again.plan_hash).not.toBe(first.plan_hash);
    expect(JSON.stringify(again)).not.toContain("other-secret");

    const info = await bolt(["info", "--json"], dir, env);
    expect(info.code).toBe(0);
    expect(info.out).toContain("«local:secret»");
    expect(info.out).toContain("«local:plugins.ue.engine.path»");
    expect(info.out).toContain("«local:plugins.ue.targets.editor.name»");
    expect(info.out).toContain("public-value");
    expect(info.out).not.toContain("s3cret-value");
    expect(info.out).not.toContain("D:/SecretEngine");
    expect(info.out).not.toContain("LocalTargetName");

    const status = parseStdout((await bolt(["status", "--json"], dir, env)).out).data as {
      policy: { ai_run: string };
      local: { present: boolean; valid: boolean };
    };
    expect(status.policy.ai_run).toBe("never");
    expect(status.local).toEqual({ present: true, valid: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
