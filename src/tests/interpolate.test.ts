import { expect, test } from "bun:test"
import { interpolate } from "../interpolate"
import { UE_PATH, PROJECT_NAME } from "./env"

const ctx = {
  project: { name: PROJECT_NAME, ue_path: UE_PATH },
  env: { BUILD_VERSION: "1.2.3" },
}

test("interpolates project variable", () => {
  expect(interpolate("Hello ${{ project.name }}", ctx)).toBe(`Hello ${PROJECT_NAME}`)
})

test("interpolates env variable", () => {
  expect(interpolate("v${{ env.BUILD_VERSION }}", ctx)).toBe("v1.2.3")
})

test("leaves unknown variables as-is", () => {
  expect(interpolate("${{ unknown.var }}", ctx)).toBe("${{ unknown.var }}")
})

test("no-op on plain string", () => {
  expect(interpolate("hello world", ctx)).toBe("hello world")
})
