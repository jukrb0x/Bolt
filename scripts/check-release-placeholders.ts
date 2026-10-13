/**
 * Release gate: fail while an unreleased version placeholder is still present.
 *
 * MIN_BOLT_FOR_PLUGIN_API_2 (src/plugin-compat.ts) starts as "<X>" and must be
 * set to the release that first ships plugin API v2. Docs and schemas may say
 * "bolt <X>" until then. Tests are excluded because they assert on the placeholder.
 *
 * Usage: bun run scripts/check-release-placeholders.ts
 */
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const SCAN = ["src", "apps/docs", "schema"];
const SKIP_DIRS = new Set(["node_modules", "tests", ".mintlify"]);
const EXTENSIONS = new Set([".ts", ".md", ".mdx", ".json", ".txt", ".yaml", ".yml"]);
const PATTERNS = [
  /MIN_BOLT_FOR_PLUGIN_API_2(?:\s*:\s*string)?\s*=\s*"[^"\d]*"/,
  /\bbolt\s*(?:≥|>=)\s*<?X>?(?![\w.])/,
  /\bbolt <X>/,
];

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* files(full);
    } else if (EXTENSIONS.has(path.extname(entry))) {
      yield full;
    }
  }
}

const hits: string[] = [];
for (const top of SCAN) {
  for (const file of files(path.join(ROOT, top))) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (PATTERNS.some((re) => re.test(line))) {
          hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
  }
}

if (hits.length > 0) {
  console.error("Unreleased version placeholders found:");
  for (const hit of hits) console.error(`  ${hit}`);
  console.error(
    'Fix: set MIN_BOLT_FOR_PLUGIN_API_2 in src/plugin-compat.ts to this release (for example "2.1.0") and replace "<X>" in the files above with the same version.',
  );
  process.exit(1);
}
console.log("No release placeholders found.");
