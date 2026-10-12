#!/usr/bin/env bun
/**
 * Releases are built by .github/workflows/release.yml when a v* tag is pushed.
 * This command does not compile, tag, or publish.
 */
const dryRun = process.argv.includes("--dry-run");
const preRelease = process.argv.includes("--pre-release");

console.log("Releases are published by GitHub Actions, not this script.");
console.log("From main: git tag vX.Y.Z && git push origin vX.Y.Z");
console.log("A hyphenated tag such as vX.Y.Z-rc.1 is a GitHub pre-release.");
console.log("The workflow builds the release binaries, smoke-tests them, and uploads SHA256SUMS.");
console.log("It does not publish the boltstack package.");

if (preRelease) {
  console.error("The --pre-release flag does not publish. Push a hyphenated tag instead.");
  process.exit(1);
}

if (!dryRun) {
  console.error("Refusing to create a release locally.");
  process.exit(1);
}
