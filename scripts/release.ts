#!/usr/bin/env bun
/**
 * Release script for bolt.
 * Usage: bun run release [--dry-run]
 *
 * Prerequisites:
 *   - gh CLI installed and authenticated
 *   - bun installed
 *   - Git working tree clean
 *
 * Environment:
 *   - BOLT_INTERNAL_SHARE: if set, copies build artifacts to this path after release
 */

import pkg from "../package.json";
import { execSync } from "child_process";
import { writeFileSync, copyFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

const VERSION = pkg.version;
const TAG = `v${VERSION}`;
const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = path.join(import.meta.dir, "..");
const BUILD_DIR = path.join(ROOT, "build");

function run(cmd: string): string {
  if (DRY_RUN) {
    console.log(`  [dry-run] ${cmd}`);
    return "";
  }
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] }).trim();
}

function step(msg: string) {
  console.log(`\n→ ${msg}`);
}

// 1. Verify working tree is clean
step("Verifying git working tree");
const status = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim();
if (status && !DRY_RUN) {
  console.error("Working tree is not clean. Commit or stash changes first.");
  process.exit(1);
}
console.log("  clean");

// 2. Check gh CLI
step("Checking gh CLI");
try {
  execSync("gh --version", { stdio: "pipe" });
  console.log("  found");
} catch {
  console.error("  gh CLI not found. Install from https://cli.github.com/");
  if (!DRY_RUN) process.exit(1);
}

// 3. Write src/version.ts with release version (BEFORE compile)
step(`Writing src/version.ts with version ${VERSION}`);
const versionTs = `// This file is overwritten by scripts/release.ts before compilation.\n// The VERSION constant is embedded in the binary.\nexport const VERSION = "${VERSION}";\n`;
if (!DRY_RUN) {
  writeFileSync(path.join(ROOT, "src", "version.ts"), versionTs, "utf8");
} else {
  console.log(`  [dry-run] would write: export const VERSION = "${VERSION}";`);
}

// 4. Generate bolt.d.ts
step("Generating bolt.d.ts");
run("bun run build:types");

// 5. Build binaries
mkdirSync(BUILD_DIR, { recursive: true });

step("Building bolt-win-x64.exe");
run("bun build src/main.ts --compile --target=bun-windows-x64 --outfile=build/bolt-win-x64.exe");

step("Building bolt-mac-arm64");
run("bun build src/main.ts --compile --target=bun-darwin-arm64 --outfile=build/bolt-mac-arm64");

// 6. Copy bolt.d.ts to build/
step("Copying bolt.d.ts to build/");
if (!DRY_RUN) {
  copyFileSync(path.join(ROOT, "bolt.d.ts"), path.join(BUILD_DIR, "bolt.d.ts"));
} else {
  console.log("  [dry-run] cp bolt.d.ts build/bolt.d.ts");
}

// 7. Generate release notes from git log since last tag
step("Generating release notes");
let prevTag = "";
try {
  prevTag = execSync("git describe --tags --abbrev=0 HEAD^", { cwd: ROOT, encoding: "utf8", stdio: "pipe" }).trim();
} catch {
  // no previous tag
}
const logRange = prevTag ? `${prevTag}..HEAD` : "HEAD";
const gitLog = execSync(`git log ${logRange} --oneline`, { cwd: ROOT, encoding: "utf8" }).trim();
const releaseNotes = `## ${TAG}\n\n${gitLog || "Initial release"}\n`;
if (!DRY_RUN) {
  writeFileSync(path.join(BUILD_DIR, "release-notes.md"), releaseNotes, "utf8");
}
console.log(releaseNotes);

// 8. Git tag and push
step(`Tagging ${TAG}`);
run(`git tag ${TAG}`);
run(`git push origin ${TAG}`);

// 9. Create GitHub release
step("Creating GitHub release");
run(
  `gh release create ${TAG} build/bolt-win-x64.exe build/bolt-mac-arm64 build/bolt.d.ts ` +
  `--title "${TAG}" --notes-file build/release-notes.md`
);
console.log(`  Released ${TAG}`);

// 10. Internal share (optional)
const internalShare = process.env.BOLT_INTERNAL_SHARE;
if (internalShare) {
  step(`Copying to internal share: ${internalShare}`);
  if (!existsSync(internalShare)) {
    console.error(`  BOLT_INTERNAL_SHARE path does not exist: ${internalShare}`);
    if (!DRY_RUN) process.exit(1);
  }
  for (const file of ["bolt-win-x64.exe", "bolt-mac-arm64", "bolt.d.ts"]) {
    if (!DRY_RUN) {
      copyFileSync(path.join(BUILD_DIR, file), path.join(internalShare, file));
    } else {
      console.log(`  [dry-run] cp build/${file} ${internalShare}/${file}`);
    }
  }
  console.log("  Done");
}

// 11. Restore src/version.ts to dev marker
step("Restoring src/version.ts to dev marker");
const devVersionTs = `// This file is overwritten by scripts/release.ts before compilation.\n// The VERSION constant is embedded in the binary.\nexport const VERSION = "${VERSION}-dev";\n`;
if (!DRY_RUN) {
  writeFileSync(path.join(ROOT, "src", "version.ts"), devVersionTs, "utf8");
  run("git add src/version.ts");
  run(`git commit -m "chore: restore version.ts to dev after release ${TAG}"`);
  run("git push origin main");
} else {
  console.log(`  [dry-run] would write VERSION = "${VERSION}-dev"`);
}

console.log(`\n✓ Release ${TAG} complete`);
