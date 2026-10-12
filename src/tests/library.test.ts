// src/tests/library.test.ts
import { expect, test, describe } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { createContext, loadConfig, run } from "../index";
import { git, fs, builtinPlugins, ue } from "../plugins/index";
import { createRuntime } from "../core/index";
import { Logger } from "../logger";
import { mockRuntime } from "./env";

describe("Library API", () => {
  test("createContext creates valid context", () => {
    const ctx = createContext({
      project: {
        name: "TestProject",
      },
    });

    expect(ctx.cfg.project.name).toBe("TestProject");
    expect(ctx.dryRun).toBe(false);
    expect(ctx.runtime).toBeDefined();
    expect(ctx.logger).toBeDefined();
  });

  test("builtinPlugins contains all plugins", () => {
    expect(builtinPlugins.git).toBeDefined();
    expect(builtinPlugins.svn).toBeDefined();
    expect(builtinPlugins.ue).toBeDefined();
    expect(builtinPlugins.fs).toBeDefined();
    expect(builtinPlugins.json).toBeDefined();
  });

  test("plugins have handlers", () => {
    expect(git.handlers.pull).toBeDefined();
    expect(git.handlers.status).toBeDefined();
    expect(fs.handlers.copy).toBeDefined();
  });

  test("createRuntime returns runtime with all methods", () => {
    const runtime = createRuntime();
    expect(runtime.spawn).toBeDefined();
    expect(runtime.spawnSync).toBeDefined();
    expect(runtime.shell).toBeDefined();
    expect(runtime.parseYaml).toBeDefined();
  });

  test("runtime.parseYaml parses YAML correctly", () => {
    const runtime = createRuntime();
    const result = runtime.parseYaml("name: test\nvalue: 123") as any;
    expect(result.name).toBe("test");
    expect(result.value).toBe(123);
  });

  test("createContext with dryRun option", () => {
    const ctx = createContext({
      project: {
        name: "TestProject",
      },
      dryRun: true,
    });

    expect(ctx.dryRun).toBe(true);
  });

  test("createContext with custom vars", () => {
    const ctx = createContext({
      project: {
        name: "TestProject",
      },
      vars: { MY_VAR: "my_value" },
    });

    expect(ctx.cfg.vars.MY_VAR).toBe("my_value");
  });

  test("run throws when bolt.yaml is not found", async () => {
    await expect(run("build", { cwd: "/tmp" })).rejects.toThrow(/bolt\.yaml not found/);
  });

  test("createContext uses the plugins array and ignores an unrelated bolt.yaml", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-ctx-plugins-"));
    const other = mkdtempSync(path.join(os.tmpdir(), "bolt-ctx-decoy-"));
    try {
      writeFileSync(
        path.join(dir, "bolt.yaml"),
        [
          "version: 1",
          "project: { name: FromFile }",
          "plugins:",
          "  - namespace: ue",
          "    config:",
          "      engine: { path: /from-file/engine }",
          "      project: { path: /from-file/project }",
          "      uproject: /from-file/FromFile.uproject",
          "      targets:",
          "        editor: { kind: editor, config: development }",
        ].join("\n"),
      );
      writeFileSync(
        path.join(other, "bolt.yaml"),
        [
          "version: 1",
          "project: { name: Decoy }",
          "plugins:",
          "  - namespace: ue",
          "    config:",
          "      engine: { path: /decoy/engine }",
          "      project: { path: /decoy/project }",
          "      uproject: /decoy/Decoy.uproject",
        ].join("\n"),
      );
      const cfg = await loadConfig(path.join(dir, "bolt.yaml"));
      const logged: string[] = [];
      const ctx = createContext({
        project: cfg.project,
        plugins: cfg.plugins,
        configDir: other,
        dryRun: true,
        runtime: mockRuntime,
        logger: new Logger({ sink: (line) => logged.push(line) }),
      });
      expect(ctx.cfg.plugins).toBe(cfg.plugins);
      await ue.handlers["build"]({ target: "editor" }, ctx);
      const cmd = logged.find((line) => line.includes("Build.bat")) ?? "";
      expect(cmd).toContain("/from-file/engine".replace(/\//g, "\\"));
      expect(cmd).not.toContain("decoy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("createContext with an empty plugins list does not read bolt.yaml", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "bolt-ctx-empty-"));
    try {
      writeFileSync(
        path.join(dir, "bolt.yaml"),
        [
          "version: 1",
          "project: { name: FromFile }",
          "plugins:",
          "  - namespace: ue",
          "    config:",
          "      engine: { path: /from-file/engine }",
          "      project: { path: /from-file/project }",
          "      uproject: /from-file/FromFile.uproject",
          "      targets:",
          "        editor: { kind: editor, config: development }",
        ].join("\n"),
      );
      const ctx = createContext({
        project: { name: "InMemory" },
        plugins: [],
        configDir: dir,
        dryRun: true,
        runtime: mockRuntime,
      });
      await expect(ue.handlers["build"]({ target: "editor" }, ctx)).rejects.toThrow(
        /ue plugin config is missing/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
