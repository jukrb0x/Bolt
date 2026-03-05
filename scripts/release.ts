#!/usr/bin/env bun
/**
 * Release script for bolt.
 * Usage: bun run release [--dry-run] [--pre-release]
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
import { execSync, spawnSync } from "child_process";
import { writeFileSync, readFileSync, copyFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import pc from "picocolors";

const VERSION = pkg.version;
const TAG = `v${VERSION}`;
const DRY_RUN = process.argv.includes("--dry-run");
const PRE_RELEASE = process.argv.includes("--pre-release");
const ROOT = path.join(import.meta.dir, "..");
const BUILD_DIR = path.join(ROOT, "build");

function run(cmd: string): string {
  if (DRY_RUN) {
    console.log(`  [dry-run] ${cmd}`);
    return "";
  }
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  return "";
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

// 2. Verify branch is main
step("Verifying branch is main");
const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
if (currentBranch !== "main" && !DRY_RUN) {
  console.error(`Must release from main branch (currently on: ${currentBranch})`);
  process.exit(1);
}
console.log(`  ${currentBranch}`);

// 3. Check gh CLI
step("Checking gh CLI");
try {
  execSync("gh --version", { stdio: "pipe" });
  console.log("  found");
} catch {
  console.error("  gh CLI not found. Install from https://cli.github.com/");
  if (!DRY_RUN) process.exit(1);
}

// 4. Write src/version.ts with release version (BEFORE compile)
step(`Writing src/version.ts with version ${VERSION}`);
const versionTs = `// This file is overwritten by scripts/release.ts before compilation.\n// The VERSION constant is embedded in the binary.\nexport const VERSION = "${VERSION}";\n`;
if (!DRY_RUN) {
  writeFileSync(path.join(ROOT, "src", "version.ts"), versionTs, "utf8");
} else {
  console.log(`  [dry-run] would write: export const VERSION = "${VERSION}";`);
}

// 5. Generate bolt.d.ts
step("Generating bolt.d.ts");
run("bun run build:types");

// 6. Build native binary only (bun cannot cross-compile)
mkdirSync(BUILD_DIR, { recursive: true });

const isWindows = process.platform === "win32";
const nativeBinary = isWindows ? "bolt-win-x64.exe" : "bolt-mac-arm64";
const nativeBuildCmd = isWindows
  ? "bun build src/main.ts --compile --target=bun-windows-x64 --outfile=build/bolt-win-x64.exe"
  : "bun build src/main.ts --compile --target=bun-darwin-arm64 --outfile=build/bolt-mac-arm64";

step(`Building ${nativeBinary}`);
run(nativeBuildCmd);

// 7. Copy bolt.d.ts to build/
step("Copying bolt.d.ts to build/");
if (!DRY_RUN) {
  copyFileSync(path.join(ROOT, "bolt.d.ts"), path.join(BUILD_DIR, "bolt.d.ts"));
} else {
  console.log("  [dry-run] cp bolt.d.ts build/bolt.d.ts");
}

// 8. Generate release notes from git log since last tag
step("Generating release notes");
let prevTag = "";
try {
  prevTag = execSync("git describe --tags --abbrev=0 HEAD^", { cwd: ROOT, encoding: "utf8", stdio: "pipe" }).trim();
} catch {
  // no previous tag
}
const logRange = prevTag ? `${prevTag}..HEAD` : "HEAD";
const gitLog = execSync(`git log ${logRange} --oneline`, { cwd: ROOT, encoding: "utf8" }).trim();

// Open editor for custom preamble (prepended before the git log)
const notesPath = path.join(BUILD_DIR, "release-notes.md");
const placeholder = `# Write your release notes above this line (lines starting with # are removed)\n# Leave empty to use only the auto-generated changelog\n`;
const autoChangelog = `## Changes\n\n${gitLog || "Initial release"}\n`;

let preamble = "";
if (!DRY_RUN) {
  const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === "win32" ? "notepad" : "vi");
  const tmpEditorPath = path.join(BUILD_DIR, "release-notes-edit.md");
  writeFileSync(tmpEditorPath, `\n${placeholder}\n${autoChangelog}`, "utf8");
  const result = spawnSync(editor, [tmpEditorPath], { stdio: "inherit" });
  if (result.error) {
    console.error(`  Could not open editor "${editor}": ${result.error.message}`);
    console.error("  Set EDITOR env var to your preferred editor.");
    console.error("  Proceeding with auto-generated changelog only.");
  } else {
    const edited = readFileSync(tmpEditorPath, "utf8");
    preamble = edited
      .split("\n")
      .filter((line) => !line.startsWith("#"))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}

const releaseNotes = `## ${TAG}\n\n${preamble ? preamble + "\n\n" : ""}${autoChangelog}`;
if (!DRY_RUN) {
  writeFileSync(notesPath, releaseNotes, "utf8");
} else {
  console.log("  [dry-run] would open $EDITOR for release notes preamble");
}
console.log(releaseNotes);

// 9. Git tag and push
step(`Tagging ${TAG}`);
run(`git tag ${TAG}`);
run(`git push origin ${TAG}`);

// 10. Create GitHub release with native binary + bolt.d.ts
// The CI workflow (release.yml) will upload the other platform's binary
// to this same release via `gh release upload` when the tag is pushed.
step("Creating GitHub release");
const preReleaseFlag = PRE_RELEASE ? " --prerelease" : "";
run(
  `gh release create ${TAG} build/${nativeBinary} build/bolt.d.ts ` +
  `--title "${TAG}" --notes-file build/release-notes.md${preReleaseFlag}`
);
console.log(`  Released ${TAG} (${nativeBinary} + bolt.d.ts)${PRE_RELEASE ? pc.yellow(" [pre-release]") : ""}`);
console.log(pc.dim(`  Push the tag to trigger CI for the other platform binary.`));

// 11. Publish bolt-ue to npm
step("Publishing bolt-ue to npm");
const npmTag = PRE_RELEASE ? " --tag next" : "";
run(`bun publish --access public${npmTag}`);

// 12. Internal share (optional)
const internalShare = process.env.BOLT_INTERNAL_SHARE;
if (internalShare) {
  step(`Copying to internal share: ${internalShare}`);
  if (!existsSync(internalShare)) {
    console.error(`  BOLT_INTERNAL_SHARE path does not exist: ${internalShare}`);
    if (!DRY_RUN) process.exit(1);
  }
  for (const file of [nativeBinary, "bolt.d.ts"]) {
    if (!DRY_RUN) {
      copyFileSync(path.join(BUILD_DIR, file), path.join(internalShare, file));
    } else {
      console.log(`  [dry-run] cp build/${file} ${internalShare}/${file}`);
    }
  }
  console.log("  Done");
}

// 13. Restore src/version.ts to dev marker
step("Restoring src/version.ts to dev marker");
const devVersionTs = `// This file is overwritten by scripts/release.ts before compilation.\n// The VERSION constant is embedded in the binary.\nexport const VERSION = "${VERSION}-dev";\n`;
if (!DRY_RUN) {
  writeFileSync(path.join(ROOT, "src", "version.ts"), devVersionTs, "utf8");
  const dirty = execSync("git status --porcelain src/version.ts", { cwd: ROOT, encoding: "utf8" }).trim();
  if (dirty) {
    run("git add src/version.ts");
    run(`git commit -m "chore: restore version.ts to dev after release ${TAG}"`);
    run("git push origin main");
  } else {
    console.log("  version.ts already at dev marker, nothing to commit");
  }
} else {
  console.log(`  [dry-run] would write VERSION = "${VERSION}-dev"`);
}

console.log(`\n✓ Release ${TAG} complete`);
