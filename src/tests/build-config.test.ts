import { describe, expect, test } from "bun:test";
import {
  type BuildConfig,
  BuildConfigSchema,
  normalizeBuildConfig,
  toUnrealBuildConfig,
} from "../build-config";

describe("normalizeBuildConfig", () => {
  test.each<[string, BuildConfig]>([
    ["development", "development"],
    ["dev", "development"],
    ["debug", "debug"],
    ["dbg", "debug"],
    ["debuggame", "debuggame"],
    ["dbggame", "debuggame"],
    ["DebugGame", "debuggame"],
    ["shipping", "shipping"],
    ["test", "test"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeBuildConfig(input)).toEqual({ ok: true, value: expected });
  });

  test("rejects an unknown build configuration", () => {
    const result = normalizeBuildConfig("profile");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("profile");
  });
});

test("BuildConfigSchema emits canonical values", () => {
  expect(BuildConfigSchema.parse("DebugGame")).toBe("debuggame");
  expect(BuildConfigSchema.parse("dbggame")).toBe("debuggame");
});

test("Unreal rendering preserves DebugGame casing", () => {
  expect(toUnrealBuildConfig("debuggame")).toBe("DebugGame");
});
