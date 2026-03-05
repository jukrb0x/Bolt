// src/tests/library.test.ts
import { expect, test, describe } from "bun:test";
import { createContext, loadConfig } from "../index";
import { git, fs, builtinPlugins } from "../plugins/index";
import { Runner, Logger, createRuntime } from "../core/index";

describe("Library API", () => {
  test("createContext creates valid context", () => {
    const ctx = createContext({
      project: {
        name: "TestProject",
        engine_repo: { path: "/engine", vcs: "git" },
        project_repo: { path: "/project", vcs: "svn" },
        uproject: "/project/Test.uproject",
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
        engine_repo: { path: "/engine", vcs: "git" },
        project_repo: { path: "/project", vcs: "svn" },
        uproject: "/project/Test.uproject",
      },
      dryRun: true,
    });

    expect(ctx.dryRun).toBe(true);
  });

  test("createContext with custom vars", () => {
    const ctx = createContext({
      project: {
        name: "TestProject",
        engine_repo: { path: "/engine", vcs: "git" },
        project_repo: { path: "/project", vcs: "svn" },
        uproject: "/project/Test.uproject",
      },
      vars: { MY_VAR: "my_value" },
    });

    expect(ctx.cfg.vars.MY_VAR).toBe("my_value");
  });
});
