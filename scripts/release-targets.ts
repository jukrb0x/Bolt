/**
 * Binaries published to GitHub Releases.
 * Filenames are the release asset names used by installers and `bolt self-update`.
 */
export const RELEASE_BINARIES = [
  { target: "bun-windows-x64", filename: "bolt-win-x64.exe" },
  { target: "bun-windows-x64-baseline", filename: "bolt-win-x64-baseline.exe" },
  { target: "bun-linux-x64", filename: "bolt-linux-x64" },
  { target: "bun-darwin-arm64", filename: "bolt-mac-arm64" },
  { target: "bun-darwin-x64", filename: "bolt-mac-x64" },
] as const;
