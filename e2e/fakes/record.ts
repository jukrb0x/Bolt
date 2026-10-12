/**
 * Recorder for the fake Unreal, svn, and Windows-tool shims.
 *
 *   bun record.ts <tool> [argv...]
 *
 * Appends one JSON line to BOLT_FAKE_LOG:
 * { tool, argv, cwd, env, exit }
 * `env` keeps BOLT_* variables only, so CI secrets are not written.
 * BOLT_FAKE_QUIET=1 records the call and prints nothing.
 * BOLT_FAKE_FAIL is a comma list of tool basenames (or "all") that fail.
 */
import { appendFileSync } from "fs";
import path from "path";

const tool = process.argv[2] ?? "unknown";
const argv = process.argv.slice(3);
const log = process.env.BOLT_FAKE_LOG;

if (!log) {
  console.error("BOLT_FAKE_LOG is not set");
  process.exit(2);
}

function base(name: string): string {
  return path.basename(name).replace(/\.(bat|cmd|exe|sh)$/i, "");
}

function shouldFail(name: string): boolean {
  const raw = process.env.BOLT_FAKE_FAIL ?? "";
  if (!raw.trim()) return false;
  const names = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (names.includes("all")) return true;
  return names.includes(base(name).toLowerCase()) || names.includes(name.toLowerCase());
}

const family = base(tool);
const fail = shouldFail(tool);
let exit = 0;
let stdout = "";
let stderr = "";

if (fail) {
  if (family === "Build" || family === "UnrealBuildTool") {
    exit = 6;
    stderr = "error: UnrealBuildTool failed.\nResult: Failed\n";
  } else if (family === "RunUAT") {
    exit = 1;
    stderr = "AutomationTool exiting with ExitCode=1\nBUILD FAILED\n";
  } else if (family === "UE4Editor-Cmd" || family === "UnrealEditor-Cmd") {
    exit = 1;
    stderr = "LogAutomationCommandLine: Error: Automation test failed\n";
  } else if (family === "svn") {
    exit = 1;
    stderr = "svn: E155004: Working copy locked\n";
  } else {
    exit = 1;
    stderr = `${family} failed\n`;
  }
} else if (family === "Build" || family === "UnrealBuildTool") {
  stdout = `Running UnrealBuildTool ${argv.join(" ")}\nResult: Succeeded\n`;
} else if (family === "RunUAT") {
  stdout = "Running AutomationTool...\nBUILD SUCCESSFUL\n";
} else if (family === "UE4Editor-Cmd" || family === "UnrealEditor-Cmd") {
  stdout =
    "LogInit: Display: Engine is initialized\n" +
    "LogAutomationCommandLine: Display: Found automation test FillDDCForPIETest\n" +
    "LogAutomationCommandLine: Display: Automation Test Queue Empty\n";
} else if (family === "Setup") {
  stdout = "Setup complete.\n";
} else if (family === "GenerateProjectFiles") {
  stdout = "Generating project files...\n";
} else if (family === "svn") {
  const sub = argv[0] ?? "";
  if (sub === "info") {
    stdout = `Path: ${argv[1] ?? "."}\nURL: file:///bolt-e2e/svn\nRevision: 1\nLast Changed Rev: 1\n`;
  } else if (sub === "update") {
    stdout = "Updating '.':\nAt revision 1.\n";
  } else if (sub === "commit") {
    stdout = "Committed revision 2.\n";
  } else if (sub === "status") {
    stdout = "";
  } else {
    stdout = `svn ${sub} ok\n`;
  }
} else if (family === "TortoiseProc") {
  stdout = "TortoiseProc finished\n";
}

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("BOLT_")) env[key] = value ?? "";
}

appendFileSync(log, `${JSON.stringify({ tool, argv, cwd: process.cwd(), env, exit })}\n`);

if (process.env.BOLT_FAKE_QUIET !== "1") {
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}
process.exit(exit);
