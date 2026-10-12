import { expect, test } from "bun:test";
import { RELEASE_BINARIES, releaseUploadNames } from "../../scripts/release-targets";

test("release binaries are win-x64, linux-x64, and both darwin arches", () => {
  expect(RELEASE_BINARIES.map((binary) => binary.filename)).toEqual([
    "bolt-win-x64.exe",
    "bolt-linux-x64",
    "bolt-mac-arm64",
    "bolt-mac-x64",
  ]);
  expect(RELEASE_BINARIES.map((binary) => binary.target)).toEqual([
    "bun-windows-x64",
    "bun-linux-x64",
    "bun-darwin-arm64",
    "bun-darwin-x64",
  ]);
  expect(RELEASE_BINARIES.map((binary) => binary.runner)).toEqual([
    "windows-latest",
    "ubuntu-latest",
    "macos-latest",
    "macos-latest",
  ]);
  expect(releaseUploadNames()).toEqual([
    "bolt-win-x64.exe",
    "bolt-linux-x64",
    "bolt-mac-arm64",
    "bolt-mac-x64",
    "bolt.d.ts",
    "SHA256SUMS",
  ]);
});
