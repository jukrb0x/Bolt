import { expect, test } from "bun:test";
import { bunVersionError, pinnedBunVersion } from "./setup";

test("pinnedBunVersion reads packageManager", () => {
  expect(pinnedBunVersion({ packageManager: "bun@1.4.3" })).toBe("1.4.3");
  expect(pinnedBunVersion({ packageManager: "npm@10.0.0" })).toBeUndefined();
  expect(pinnedBunVersion({})).toBeUndefined();
});

test("a matching Bun passes", () => {
  expect(bunVersionError("1.4.3", "1.4.3")).toBeNull();
});

test("a different Bun fails with the required and found versions", () => {
  const msg = bunVersionError("1.3.0", "1.4.3");
  expect(msg).toContain("requires Bun 1.4.3, found 1.3.0");
  expect(msg).toContain("bun upgrade --version 1.4.3");
});

test("a missing pin fails clearly", () => {
  expect(bunVersionError("1.4.3", undefined)).toContain("packageManager");
});
