// Global test setup — preloaded before all test files via bunfig.toml [test].
import { existsSync } from "fs";

// `--env-file .env.local` errors on some Bun versions when the file is missing.
// Load it only when a developer has one, so `bun test` works on a fresh checkout.
if (existsSync(".env.local")) {
  (process as unknown as { loadEnvFile(path: string): void }).loadEnvFile(".env.local");
}
