// src/tests/init/interpolate.test.ts
import { expect, test } from "bun:test";
import { interpolateTemplate } from "../../init/interpolate";

test("interpolates single variable", () => {
  const template = "name: ${{ _init.project_name }}";
  const answers = { project_name: "MyGame" };
  const result = interpolateTemplate(template, answers);
  expect(result).toBe("name: MyGame");
});

test("interpolates multiple variables", () => {
  const template = "name: ${{ _init.a }}\npath: ${{ _init.b }}";
  const answers = { a: "Name", b: "./path" };
  const result = interpolateTemplate(template, answers);
  expect(result).toBe("name: Name\npath: ./path");
});

test("leaves unresolved variables as-is", () => {
  const template = "name: ${{ _init.unknown }}";
  const answers = {};
  const result = interpolateTemplate(template, answers);
  expect(result).toBe("name: ${{ _init.unknown }}");
});

test("handles boolean and array values", () => {
  const template = "flag: ${{ _init.enabled }}\nitems: ${{ _init.list }}";
  const answers = { enabled: true, list: ["a", "b", "c"] };
  const result = interpolateTemplate(template, answers);
  expect(result).toContain("flag: true");
  expect(result).toContain("items: a, b, c");
});
