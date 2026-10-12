import { expect, test } from "bun:test";
import { RELEASE_BINARIES } from "../../scripts/release-targets";

test("release binaries cover win-x64, its baseline, linux-x64, and both darwin arches", () => {
  expect(RELEASE_BINARIES.map((binary) => binary.filename)).toEqual([
    "bolt-win-x64.exe",
    "bolt-win-x64-baseline.exe",
    "bolt-linux-x64",
    "bolt-mac-arm64",
    "bolt-mac-x64",
  ]);
  expect(RELEASE_BINARIES.map((binary) => binary.target)).toEqual([
    "bun-windows-x64",
    "bun-windows-x64-baseline",
    "bun-linux-x64",
    "bun-darwin-arm64",
    "bun-darwin-x64",
  ]);
});
