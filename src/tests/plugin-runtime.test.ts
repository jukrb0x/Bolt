import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { PluginRegistry, pluginCacheFile, pluginInstallInvocation } from "../plugin-registry";

test("plugin install invokes this executable with BUN_BE_BUN", () => {
  const call = pluginInstallInvocation({ PATH: "/usr/bin" });
  expect(call.command).toBe(process.execPath);
  expect(call.args).toEqual(["install"]);
  expect(call.env.BUN_BE_BUN).toBe("1");
  expect(call.command).not.toBe("bun");
});

test("runtime dependencies install through this executable, not PATH bun", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bolt-plugin-deps-"));
  const pluginDir = path.join(root, ".bolt", "plugins", "needs-dep");
  const depDir = path.join(root, "local-dep");
  mkdirSync(pluginDir, { recursive: true });
  mkdirSync(depDir, { recursive: true });
  writeFileSync(
    path.join(depDir, "package.json"),
    `${JSON.stringify({ name: "local-dep", version: "1.0.0", type: "module" })}\n`,
  );
  writeFileSync(path.join(depDir, "index.js"), "export const marker = 1;\n");
  writeFileSync(
    path.join(pluginDir, "package.json"),
    `${JSON.stringify({
      name: "needs-dep",
      dependencies: { "local-dep": `file:${depDir}` },
    })}\n`,
  );
  writeFileSync(
    path.join(pluginDir, "index.ts"),
    [
      'import { marker } from "local-dep";',
      "if (marker !== 1) throw new Error(`marker ${marker}`);",
      "export default { namespace: 'needs-dep', handlers: { run: async () => {} } };",
      "",
    ].join("\n"),
  );

  const savedPath = process.env.PATH;
  const savedWinPath = process.env.Path;
  const hidden = process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin";
  process.env.PATH = hidden;
  process.env.Path = hidden;
  try {
    const reg = new PluginRegistry();
    await reg.loadDirectory(path.join(root, ".bolt", "plugins"), root);
    expect(typeof reg.get("needs-dep")?.handlers.run).toBe("function");
  } finally {
    process.env.PATH = savedPath;
    process.env.Path = savedWinPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("class @handler is compiled outside the repo tsconfig", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bolt-decor-"));
  const pluginDir = path.join(root, "plugin");
  mkdirSync(pluginDir);
  const pluginSource = path.join(import.meta.dir, "../plugin.ts");
  writeFileSync(
    path.join(pluginDir, "index.ts"),
    [
      `import { PluginBase, handler } from ${JSON.stringify(pluginSource)};`,
      "class Decor extends PluginBase {",
      '  namespace = "decor";',
      '  @handler("ping")',
      "  async ping() {}",
      "}",
      "export default Decor;",
      "",
    ].join("\n"),
  );

  try {
    const reg = new PluginRegistry();
    await reg.loadFromPath("decor", path.join(pluginDir, "index.ts"), root);
    expect(typeof reg.get("decor")?.handlers.ping).toBe("function");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an explicit plugin does not run the auto-discovered build for the same namespace", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bolt-plugin-cache-"));
  const discovered = path.join(root, ".bolt", "plugins", "echo", "index.ts");
  const explicit = path.join(root, "explicit", "index.ts");
  mkdirSync(path.dirname(discovered), { recursive: true });
  mkdirSync(path.dirname(explicit), { recursive: true });
  const source = (marker: string) =>
    `export default { namespace: "echo", marker: ${JSON.stringify(marker)}, handlers: { run: async () => {} } };\n`;
  writeFileSync(discovered, source("discovered"));
  writeFileSync(explicit, source("explicit"));
  const past = new Date(Date.now() - 60_000);
  utimesSync(explicit, past, past);

  try {
    const reg = new PluginRegistry();
    await reg.loadDirectory(path.join(root, ".bolt", "plugins"), root);
    expect((reg.get("echo") as { marker?: string }).marker).toBe("discovered");
    await reg.loadFromPath("echo", explicit, root);
    expect((reg.get("echo") as { marker?: string }).marker).toBe("explicit");
    const discoveredCache = pluginCacheFile(root, "echo", discovered);
    const explicitCache = pluginCacheFile(root, "echo", explicit);
    expect(discoveredCache).not.toBe(explicitCache);
    expect(existsSync(discoveredCache)).toBe(true);
    expect(existsSync(explicitCache)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a compiled plugin keeps import.meta on the source file", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bolt-plugin-meta-"));
  const pluginDir = path.join(root, "plugin");
  const entry = path.join(pluginDir, "index.ts");
  mkdirSync(pluginDir);
  writeFileSync(path.join(pluginDir, "asset.txt"), "hello\n");
  writeFileSync(
    entry,
    [
      'import { readFileSync } from "fs";',
      'import path from "path";',
      'const text = readFileSync(path.join(import.meta.dir, "asset.txt"), "utf8");',
      "export default {",
      '  namespace: "assets",',
      "  text,",
      "  located: import.meta.url,",
      "  handlers: { run: async () => {} },",
      "};",
      "",
    ].join("\n"),
  );

  try {
    const reg = new PluginRegistry();
    await reg.loadFromPath("assets", entry, root);
    const plugin = reg.get("assets") as { text?: string; located?: string };
    expect(plugin.text).toBe("hello\n");
    expect(plugin.located).toBe(pathToFileURL(realpathSync(entry)).href);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a branded export with a missing or nonnumeric apiVersion is rejected", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "bolt-plugin-api-"));
  const missing = path.join(root, "missing.js");
  const text = path.join(root, "text.js");
  const source = (fields: string) =>
    [
      'const brand = Symbol.for("boltstack.plugin");',
      `const plugin = { namespace: "bad", handlers: { run: async () => {} }${fields} };`,
      "Object.defineProperty(plugin, brand, { value: true });",
      "export default plugin;",
      "",
    ].join("\n");
  writeFileSync(missing, source(""));
  writeFileSync(text, source(', apiVersion: "1"'));

  try {
    const missingReg = new PluginRegistry();
    await expect(missingReg.loadFromPath("bad", missing)).rejects.toThrow(/plugin API none/);
    expect(missingReg.get("bad")).toBeUndefined();

    const textReg = new PluginRegistry();
    await expect(textReg.loadFromPath("bad", text)).rejects.toThrow(/"1"/);
    expect(textReg.get("bad")).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
