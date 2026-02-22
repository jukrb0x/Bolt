import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig } from "../config";
import { Runner } from "../runner";
import { Logger } from "../logger";
import path from "path";
import { mkdirSync } from "fs";
import pkg from "../../package.json";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

const CONFIG_SHORTCUTS: Record<string, string> = { dev: "development", dbg: "debug" };

/** Parse extra --key=value tokens into a params map (skips --dry-run). */
function parseRunParams(rawArgs: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const arg of rawArgs) {
    if (!arg.startsWith("--") || !arg.includes("=")) continue;
    const inner = arg.slice(2);
    const eq = inner.indexOf("=");
    const k = inner.slice(0, eq);
    const v = inner.slice(eq + 1);
    if (k === "dry-run") continue;
    params[k] = k === "config" ? (CONFIG_SHORTCUTS[v.toLowerCase()] ?? v) : v;
  }
  return params;
}

export default defineCommand({
  meta: { description: "Run a named action defined in bolt.yaml" },
  args: {
    action: {
      type: "positional",
      description: "Name of the action to run",
      required: true,
    },
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Print steps without executing",
    },
  },
  async run({ args, rawArgs }) {
    const action = args.action;
    const dryRun = args["dry-run"];
    const params = parseRunParams(rawArgs ?? []);

    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error("[ERROR] bolt.yaml not found (searched up from cwd)");
      process.exit(1);
    }

    const cfg = await loadConfig(configPath);
    const configDir = path.dirname(configPath);

    const logDir = path.join(path.dirname(configPath), ".bolt", "logs");
    mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `bolt_${timestamp()}.log`);
    const logger = new Logger({ logFile });

    logger.info(`bolt ${pkg.version}`);
    logger.info(`Config: ${configPath}`);
    logger.info(`Action: ${action}${dryRun ? " (dry-run)" : ""}`);

    const runner = new Runner(cfg, { dryRun, logger, configDir });

    const start = Date.now();
    try {
      await runner.run(action, params);
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      logger.info(`Done in ${dur}s`);
      logger.info(`Log: ${logFile}`);
      logger.close();
      process.exit(0);
    } catch (e: any) {
      logger.error(e.message);
      logger.info(`Log: ${logFile}`);
      logger.close();
      process.exit(1);
    }
  },
});
