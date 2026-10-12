import { expect, test } from "bun:test";
import { isNewer, releaseAssetName } from "../commands/update";

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

test("releaseAssetName: Intel macOS downloads bolt-mac-x64", () => {
  expect(releaseAssetName("darwin", "x64", "bolt")).toBe("bolt-mac-x64");
});

test("releaseAssetName: Apple Silicon downloads bolt-mac-arm64", () => {
  expect(releaseAssetName("darwin", "arm64", "bolt")).toBe("bolt-mac-arm64");
});

test("releaseAssetName: keeps the installed release asset name", () => {
  expect(releaseAssetName("darwin", "arm64", "bolt-mac-x64")).toBe("bolt-mac-x64");
  expect(releaseAssetName("win32", "x64", "bolt-win-x64-baseline.exe")).toBe(
    "bolt-win-x64-baseline.exe",
  );
});

test("releaseAssetName: linux and windows x64 use their release assets", () => {
  expect(releaseAssetName("linux", "x64", "bolt")).toBe("bolt-linux-x64");
  expect(releaseAssetName("win32", "x64", "bolt.exe")).toBe("bolt-win-x64.exe");
});

test("releaseAssetName: unknown platform has no asset", () => {
  expect(releaseAssetName("freebsd", "x64", "bolt")).toBeUndefined();
});
