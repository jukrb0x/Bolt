// src/tests/init/integration.test.ts
import { expect, test, describe } from "bun:test";
import { generateConfig } from "../../init/generator";
import { parseTemplate, removeInitSection } from "../../init/template-parser";
import { interpolateTemplate } from "../../init/interpolate";
import { getBundledTemplate } from "../../init/template";
import { readFileSync, rmSync, existsSync } from "fs";
import path from "path";
import os from "os";

describe("integration: template-driven init", () => {
  test("full pipeline: parse, answer, interpolate, remove _init", () => {
    const template = getBundledTemplate();
    const parsed = parseTemplate(template);

    const answers = {
      bolt_project_name: "TestGame",
      engine_repo_path: "./engine",
      engine_repo_vcs: "git",
      engine_repo_url: "",
      engine_repo_branch: "main",
      project_repo_path: "./project",
      project_repo_vcs: "svn",
      project_repo_url: "",
      uproject: "./project/TestGame.uproject",
    };

    // Verify _init section exists before
    expect(parsed.initSection.bolt_project_name).toBeDefined();

    // Interpolate
    const interpolated = interpolateTemplate(template, answers);
    expect(interpolated).toContain("name: TestGame");
    expect(interpolated).toContain("vcs: git");
    expect(interpolated).toContain("vcs: svn");

    // Remove _init section
    const finalContent = removeInitSection(interpolated);
    expect(finalContent).not.toContain("_init");
    expect(finalContent).toContain("project:");
    expect(finalContent).toContain("targets:");
  });

  test("bundled template has all required _init fields", () => {
    const template = getBundledTemplate();
    const parsed = parseTemplate(template);

    const requiredFields = [
      "bolt_project_name",
      "engine_repo_path",
      "engine_repo_vcs",
      "engine_repo_url",
      "engine_repo_branch",
      "project_repo_path",
      "project_repo_vcs",
      "project_repo_url",
      "uproject",
    ];

    for (const field of requiredFields) {
      expect(parsed.initSection[field]).toBeDefined();
      expect(parsed.initSection[field].prompt).toBeDefined();
    }
  });

  test("conditional questions work correctly", () => {
    const template = getBundledTemplate();
    const parsed = parseTemplate(template);

    // engine_repo_branch has condition
    expect(parsed.initSection.engine_repo_branch.condition).toBe("engine_repo_vcs == 'git'");
  });

  test("generator creates valid bolt.yaml", () => {
    const tempDir = path.join(os.tmpdir(), `bolt-integration-test-${Date.now()}`);
    const template = getBundledTemplate();

    const answers = {
      bolt_project_name: "IntegrationTest",
      engine_repo_path: "./engine",
      engine_repo_vcs: "git",
      engine_repo_url: "",
      engine_repo_branch: "main",
      project_repo_path: "./project",
      project_repo_vcs: "svn",
      project_repo_url: "",
      uproject: "./project/IntegrationTest.uproject",
      location: tempDir,
    };

    const result = generateConfig(answers, template);
    expect(result.ok).toBe(true);

    if (result.ok) {
      // Verify file was created
      expect(existsSync(result.path)).toBe(true);

      // Read and verify content
      const content = readFileSync(result.path, "utf8");
      expect(content).toContain("name: IntegrationTest");
      expect(content).not.toContain("_init");

      // Cleanup
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
