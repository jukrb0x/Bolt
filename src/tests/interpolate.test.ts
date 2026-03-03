import { expect, test } from "bun:test";
import { interpolate } from "../interpolate";
import { ENGINE_ROOT, PROJECT_NAME } from "./env";

const ctx = {
  project: { name: PROJECT_NAME, engine_root: ENGINE_ROOT },
  vars: { depot: "D:/Depot/MyProject", tools: "C:/Tools" },
  env: { BUILD_VERSION: "1.2.3" },
};

test("interpolates project variable", () => {
  expect(interpolate("Hello ${{ project.name }}", ctx)).toBe(`Hello ${PROJECT_NAME}`);
});

test("interpolates env variable", () => {
  expect(interpolate("v${{ env.BUILD_VERSION }}", ctx)).toBe("v1.2.3");
});

test("interpolates vars variable", () => {
  expect(interpolate("${{ vars.depot }}", ctx)).toBe("D:/Depot/MyProject");
});

test("interpolates multiple vars in one string", () => {
  expect(interpolate("${{ vars.depot }} and ${{ vars.tools }}", ctx)).toBe(
    "D:/Depot/MyProject and C:/Tools",
  );
});

test("leaves unknown variables as-is", () => {
  expect(interpolate("${{ unknown.var }}", ctx)).toBe("${{ unknown.var }}");
});

test("no-op on plain string", () => {
  expect(interpolate("hello world", ctx)).toBe("hello world");
});
