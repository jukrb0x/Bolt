// Global test setup — preloaded before all test files via bunfig.toml [test].
import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Assign KEY=VALUE lines onto `env`. Existing keys are left alone.
 * ponytail: no $VAR expansion, escape sequences, or multiline values.
 * Upgrade path: `process.loadEnvFile` when the runtime provides it.
 */
export function applyDotenv(text: string, env: Record<string, string | undefined>): void {
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
        value = value.slice(1, -1);
      }
    }
    if (env[key] === undefined) env[key] = value;
  }
}

/** Load a dotenv file when it exists. Uses `loadEnvFile` when that function is actually present. */
export function loadDotenvFile(
  path: string,
  env: Record<string, string | undefined>,
  loadEnvFile: ((file: string) => void) | undefined,
): void {
  if (!existsSync(path)) return;
  if (loadEnvFile) {
    loadEnvFile(path);
    return;
  }
  applyDotenv(readFileSync(path, "utf8"), env);
}

function nativeLoadEnvFile(): ((file: string) => void) | undefined {
  const fn = (process as { loadEnvFile?: unknown }).loadEnvFile;
  if (typeof fn !== "function") return undefined;
  return (file) => (fn as (file: string) => void).call(process, file);
}

loadDotenvFile(".env.local", process.env, nativeLoadEnvFile());

/** Bun version pinned by `packageManager` in package.json (single source of truth). */
export function pinnedBunVersion(pkg: { packageManager?: string }): string | undefined {
  const m = /^bun@(.+)$/.exec(pkg.packageManager ?? "");
  return m?.[1];
}

/**
 * Error message when the running Bun differs from the pinned version, or null when it matches.
 * Tests fail on a mismatch, locally and in CI, so results never depend on an unpinned runtime.
 */
export function bunVersionError(actual: string, pinned: string | undefined): string | null {
  if (!pinned)
    return 'package.json has no packageManager "bun@<version>" pin; tests cannot check the Bun version.';
  if (actual === pinned) return null;
  return `Bolt tests: requires Bun ${pinned}, found ${actual}. package.json pins it in "packageManager"; run \`bun upgrade --version ${pinned}\` (or install that version) and retry.`;
}

/** Stop the test run before any test file loads when the Bun version is wrong. */
export function checkBunVersion(actual: string, pinned: string | undefined): void {
  const msg = bunVersionError(actual, pinned);
  if (msg) {
    console.error(`\n${msg}\n`);
    process.exit(1);
  }
}

checkBunVersion(
  Bun.version,
  pinnedBunVersion(JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8"))),
);
