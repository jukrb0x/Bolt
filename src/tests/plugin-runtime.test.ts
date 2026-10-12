import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { PluginRegistry, pluginInstallInvocation } from "../plugin-registry";

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
