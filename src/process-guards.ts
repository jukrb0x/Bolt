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
  "session",
  "run",
  "ai",
  "version",
]);

function commandSchema(): string {
  const args = process.argv.slice(2).filter((arg) => arg !== "--" && !arg.startsWith("-"));
  const cmd = args[0];
  if (cmd === "session") {
    if (args[1] === "list") return "bolt.session.list/v1";
    if (args[1] === "clear") return "bolt.session.clear/v1";
    return "bolt.session/v1";
  }
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
const onInterrupt: Array<() => void> = [];
let interruptEnvelopeEmitted = false;

function flushInterruptHooks(): void {
  for (const fn of [...onInterrupt]) {
    try {
      fn();
    } catch {
      // The exit code is the contract. Session write is best-effort.
    }
  }
}

/** Best-effort work before a catchable SIGINT / SIGBREAK exit. Returns an unsubscribe. */
export function onProcessInterrupt(fn: () => void): () => void {
  onInterrupt.push(fn);
  return () => {
    const index = onInterrupt.indexOf(fn);
    if (index >= 0) onInterrupt.splice(index, 1);
  };
}

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
  const stop = () => {
    if (interruptEnvelopeEmitted) return;
    interruptEnvelopeEmitted = true;
    flushInterruptHooks();
    emitProcessEnvelope("INTERRUPTED", "interrupted", INTERRUPTED_EXIT_CODE);
  };
  // Windows often exits without running SIGINT listeners; flush session hooks synchronously on exit.
  process.on("exit", flushInterruptHooks);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  if (process.platform === "win32") process.on("SIGBREAK", stop);
}
