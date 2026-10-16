import { INTERNAL_EXIT_CODE, INTERRUPTED_EXIT_CODE } from "./exit-codes";
import { buildEnvelope, installJsonStdoutGuard, writeJsonStdout } from "./json-envelope";

const KNOWN = new Set([
  "list",
  "info",
  "check",
  "doctor",
  "why",
  "inspect",
  "status",
  "run",
  "ai",
  "version",
]);

function commandSchema(): string {
  const cmd = process.argv.slice(2).find((arg) => arg !== "--" && !arg.startsWith("-"));
  if (cmd && KNOWN.has(cmd)) return `bolt.${cmd}/v1`;
  return "bolt.run/v1";
}

/** Crash and interrupt envelopes. Always exits. */
export function emitProcessEnvelope(
  code: "INTERNAL" | "INTERRUPTED",
  message: string,
  exitCode: number,
): never {
  try {
    installJsonStdoutGuard();
    const text = `${JSON.stringify(
      buildEnvelope({
        schema: commandSchema(),
        exitCode,
        config: null,
        data: null,
        errors: [{ code, message }],
      }),
      null,
      2,
    )}\n`;
    writeJsonStdout(text);
  } catch {
    // The envelope is best-effort. The exit code is the contract.
  }
  process.exit(exitCode);
}

let installed = false;

export function installProcessGuards(): void {
  if (installed) return;
  installed = true;
  process.on("uncaughtException", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    emitProcessEnvelope("INTERNAL", message, INTERNAL_EXIT_CODE);
  });
  process.on("unhandledRejection", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    emitProcessEnvelope("INTERNAL", message, INTERNAL_EXIT_CODE);
  });
  const stop = () => emitProcessEnvelope("INTERRUPTED", "interrupted", INTERRUPTED_EXIT_CODE);
  process.on("SIGINT", stop);
  if (process.platform === "win32") process.on("SIGBREAK", stop);
}
