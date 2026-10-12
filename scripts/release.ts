#!/usr/bin/env bun
/**
 * Releases are built by .github/workflows/release.yml when a v* tag is pushed.
 * This command does not compile, tag, or publish.
 */
const dryRun = process.argv.includes("--dry-run");

console.log("Releases are published by GitHub Actions, not this script.");
console.log("Push a tag from main: git tag vX.Y.Z && git push origin vX.Y.Z");
console.log("The workflow builds every release binary, smoke-tests it, and uploads SHA256SUMS.");

if (!dryRun) {
  console.error("Refusing to create a release locally.");
  process.exit(1);
}
