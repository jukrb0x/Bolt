import { expect, test } from "bun:test";
import { isNewer } from "../commands/update";

test("isNewer: same version is not newer", () => {
  expect(isNewer("1.2.3", "1.2.3")).toBe(false);
});

test("isNewer: patch bump is newer", () => {
  expect(isNewer("1.2.3", "1.2.4")).toBe(true);
});

test("isNewer: minor bump is newer", () => {
  expect(isNewer("1.2.3", "1.3.0")).toBe(true);
});

test("isNewer: major bump is newer", () => {
  expect(isNewer("1.2.3", "2.0.0")).toBe(true);
});

test("isNewer: older version is not newer", () => {
  expect(isNewer("1.2.3", "1.2.2")).toBe(false);
});

test("isNewer: handles v-prefixed latest tag", () => {
  expect(isNewer("1.2.3", "v1.2.4")).toBe(true);
  expect(isNewer("1.2.3", "v1.2.3")).toBe(false);
});

test("isNewer: dev-suffixed current does not suppress updates", () => {
  expect(isNewer("0.1.0-dev", "0.1.1")).toBe(true);
  expect(isNewer("0.1.0-dev", "0.1.0")).toBe(false);
});
