import { expect, test } from "bun:test";
import { cell } from "../apps/docs/scripts/mdx-text.ts";

test("${name} in a description is not entity-escaped", () => {
  const out = cell("git checkout ${name} in ${path}");
  expect(out).not.toContain("&#123;");
  expect(out).not.toContain("&#125;");
  expect(out).toBe("git checkout \\$\\{name\\} in \\$\\{path\\}");
});
