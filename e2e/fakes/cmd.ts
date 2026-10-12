/**
 * Shim for `cmd /c start "" <program> [args...]`.
 *
 * Records the invocation, runs the program, and returns its exit code.
 * This does not call the Windows `start` builtin. That builtin needs a
 * window station and does not return on a headless runner.
 */
import { appendFileSync } from "fs";

const tool = process.argv[2] ?? "cmd";
const argv = process.argv.slice(3);
const log = process.env.BOLT_FAKE_LOG;

if (!log) {
  console.error("BOLT_FAKE_LOG is not set");
  process.exit(2);
}

function launch(): number {
  if (argv[0] !== "/c" || argv[1] !== "start") return 0;
  const rest = argv.slice(2);
  if (rest.length === 0) return 0;
  // Production passes an empty window title. Some shells drop that empty arg.
  const programAt = rest[0] === "" ? 1 : 0;
  const program = rest[programAt];
  if (!program) return 0;
  const child = Bun.spawnSync([program, ...rest.slice(programAt + 1)], {
    cwd: process.cwd(),
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  return child.exitCode ?? 1;
}

const exit = launch();
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("BOLT_")) env[key] = value ?? "";
}
appendFileSync(log, `${JSON.stringify({ tool, argv, cwd: process.cwd(), env, exit })}\n`);
process.exit(exit);
