// Global test setup — preloaded before all test files via bunfig.toml [test].
import { existsSync, readFileSync } from "fs";

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
