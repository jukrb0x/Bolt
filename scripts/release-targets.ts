/**
 * GitHub Release binaries.
 *
 * Bun 1.4.3 treats `bun-windows-x64-baseline` as an alias of `bun-windows-x64`:
 * one x64 runtime, with AVX chosen when the process starts. A second file would
 * be the same CPU binary, so this list has no baseline asset.
 *
 * Install scripts record the downloaded asset in ~/.bolt/install.json.
 * self-update uses that recorded asset, so an Intel macOS install stays on bolt-mac-x64.
 */
export const RELEASE_BINARIES = [
  { target: "bun-windows-x64", filename: "bolt-win-x64.exe", runner: "windows-latest" },
  { target: "bun-linux-x64", filename: "bolt-linux-x64", runner: "ubuntu-latest" },
  { target: "bun-darwin-arm64", filename: "bolt-mac-arm64", runner: "macos-latest" },
  { target: "bun-darwin-x64", filename: "bolt-mac-x64", runner: "macos-latest" },
] as const;

/** Non-binary files uploaded next to the binaries. */
export const RELEASE_EXTRA_ASSETS = ["bolt.d.ts", "SHA256SUMS"] as const;

export function releaseUploadNames(): string[] {
  return [...RELEASE_BINARIES.map((binary) => binary.filename), ...RELEASE_EXTRA_ASSETS];
}
