import path from "path";
import { findConfig } from "./discover";
import { loadConfig, type BoltConfig } from "./config";
import { CONFIG_EXIT_CODE, PERMISSION_EXIT_CODE } from "./exit-codes";

/** A bolt.yaml problem. `exitCode` is CONFIG_EXIT_CODE or PERMISSION_EXIT_CODE. */
export class ConfigError extends Error {
  readonly code = "CONFIG";
  constructor(
    message: string,
    readonly exitCode: number = CONFIG_EXIT_CODE,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

const CHECK_HINT = "Fix bolt.yaml, then run `bolt check` to see every problem.";

/** The error shown when no bolt.yaml is found from `cwd` upwards. */
export function configNotFoundMessage(cwd: string): string {
  return (
    `bolt.yaml not found in ${cwd} or any parent directory.\n` +
    `  Run bolt from your project directory, or create one with \`bolt init\`.`
  );
}

/**
 * Find and load bolt.yaml from `cwd` upwards. Throws ConfigError (never exits) for a
 * missing file, unreadable file, YAML syntax error, or schema error.
 */
export async function loadProjectConfig(
  cwd: string = process.cwd(),
): Promise<{ configPath: string; cfg: BoltConfig }> {
  const configPath = await findConfig(cwd);
  if (!configPath) throw new ConfigError(configNotFoundMessage(cwd));
  try {
    return { configPath, cfg: await loadConfig(configPath) };
  } catch (e: any) {
    const code = e?.code;
    if (code === "EACCES" || code === "EPERM") {
      throw new ConfigError(
        `Permission denied reading ${e.path ?? configPath}.\n` +
          `  Check the file permissions (it must be readable by the current user).`,
        PERMISSION_EXIT_CODE,
      );
    }
    const message = String(e?.message ?? e);
    const file = path.basename(configPath);
    const known = /^(bolt\.yaml|bolt\.local\.yaml)\b/.test(message);
    const text = known ? message : `${file} could not be parsed (${configPath}): ${message}`;
    throw new ConfigError(`${text}\n  ${CHECK_HINT}`);
  }
}

/** Print a ConfigError as `[ERROR] …` (indented lines as-is) and exit with its code. */
export function exitWithConfigError(e: ConfigError): never {
  for (const line of e.message.split("\n")) {
    if (/^[ \t]/.test(line)) console.error(line);
    else console.error(`[ERROR] ${line}`);
  }
  process.exit(e.exitCode);
}

/** loadProjectConfig, but print the error and exit with code 3 (or 4) on failure. */
export async function loadProjectConfigOrExit(
  cwd: string = process.cwd(),
): Promise<{ configPath: string; cfg: BoltConfig }> {
  try {
    return await loadProjectConfig(cwd);
  } catch (e) {
    if (e instanceof ConfigError) exitWithConfigError(e);
    throw e;
  }
}
