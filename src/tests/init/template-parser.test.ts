// src/tests/init/template-parser.test.ts
import { expect, test } from "bun:test";
import { parseTemplate, extractInitSection, findVariables, removeInitSection } from "../../init/template-parser";

test("extractInitSection returns undefined when no _init", () => {
  const yaml = "project:\n  name: test";
  const result = extractInitSection(yaml);
  expect(result).toBeUndefined();
});

test("extractInitSection parses _init section", () => {
  const yaml = `
project:
  name: test
_init:
  bolt_project_name:
    prompt: "Project name"
    default: "my-project"
`;
  const result = extractInitSection(yaml);
  expect(result).toBeDefined();
  expect(result?.bolt_project_name?.prompt).toBe("Project name");
});

test("findVariables extracts ${{ _init.var }} references", () => {
  const yaml = "project:\n  name: \${{ _init.bolt_project_name }}";
  const vars = findVariables(yaml);
  expect(vars.has("bolt_project_name")).toBe(true);
});

test("findVariables returns empty set for no matches", () => {
  const yaml = "project:\n  name: test";
  const vars = findVariables(yaml);
  expect(vars.size).toBe(0);
});

test("findVariables extracts multiple variables", () => {
  const yaml = "a: \${{ _init.var1 }}\nb: \${{ _init.var2 }}\nc: \${{ _init.var1 }}";
  const vars = findVariables(yaml);
  expect(vars.size).toBe(2);
  expect(vars.has("var1")).toBe(true);
  expect(vars.has("var2")).toBe(true);
});

test("findVariables works when called multiple times", () => {
  const yaml = "name: \${{ _init.var }}";
  const vars1 = findVariables(yaml);
  const vars2 = findVariables(yaml);
  expect(vars1.has("var")).toBe(true);
  expect(vars2.has("var")).toBe(true);
});

test("parseTemplate combines extraction and variable finding", () => {
  const yaml = `
project:
  name: \${{ _init.project_name }}
_init:
  project_name:
    prompt: "Name"
`;
  const result = parseTemplate(yaml);
  expect(result.initSection.project_name.prompt).toBe("Name");
  expect(result.variables.has("project_name")).toBe(true);
});

test("removeInitSection removes _init from yaml", () => {
  const yaml = `
project:
  name: test
_init:
  project_name:
    prompt: "Name"
`;
  const result = removeInitSection(yaml);
  expect(result).not.toContain("_init");
  expect(result).toContain("project");
});

test("removeInitSection preserves other sections", () => {
  const yaml = `
project:
  name: test
targets:
  editor:
    kind: editor
_init:
  project_name:
    prompt: "Name"
`;
  const result = removeInitSection(yaml);
  expect(result).toContain("project");
  expect(result).toContain("targets");
  expect(result).toContain("editor");
  expect(result).not.toContain("_init");
});

test("removeInitSection handles yaml without _init", () => {
  const yaml = "project:\n  name: test";
  const result = removeInitSection(yaml);
  expect(result).toContain("project");
  expect(result).toContain("name");
});
