import { defineCommand } from "citty";
import path from "path";
import { startDashServer } from "../dash";
import { USAGE_EXIT_CODE } from "../exit-codes";
import { onProcessInterrupt } from "../process-guards";
import { loadProjectConfigOrExit } from "../project-config";
import { printUsageError } from "../strict-args";

function parsePort(value: unknown): number {
  if (value === undefined || value === "") return 0;
  const text = String(value);
  if (!/^\d+$/.test(text)) return Number.NaN;
  const port = Number(text);
  return port <= 65535 ? port : Number.NaN;
}

export default defineCommand({
  meta: {
    name: "dash",
    description: "Serve a localhost-only readonly page of this project's execute sessions",
  },
  args: {
    port: {
      type: "string",
      description: "Port on 127.0.0.1. Omit or pass 0 and the OS picks a free port",
    },
  },
  async run({ args }) {
    const port = parsePort(args?.port);
    if (!Number.isInteger(port)) {
      printUsageError("Invalid --port. Use 0 for a free port, or 1-65535.");
      process.exit(USAGE_EXIT_CODE);
    }
    const loaded = await loadProjectConfigOrExit();
    let server;
    try {
      server = startDashServer({
        configDir: path.dirname(loaded.configPath),
        configPath: loaded.configPath,
        port,
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        console.error(`127.0.0.1:${port} is already in use. Pass --port=0 to pick a free port.`);
        process.exit(1);
      }
      throw error;
    }
    const url = `http://127.0.0.1:${server.port}/`;
    console.log(url);
    console.log(
      "Readonly. Bound to 127.0.0.1. Local observer, not CI, Jenkins, or GitHub Actions. Ctrl+C to stop.",
    );
    onProcessInterrupt(() => {
      void server.stop(true);
    });
    await new Promise(() => {});
  },
});
