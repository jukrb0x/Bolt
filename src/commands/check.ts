import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { checkConfig } from "../config";
import pc from "picocolors";
import { planMigration } from "./migrate";
import { CONFIG_EXIT_CODE } from "../exit-codes";
import { configNotFoundMessage } from "../project-config";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  issue,
  issueFromCliMessage,
} from "../json-envelope";

export default defineCommand({
  meta: { name: "check", description: "Validate bolt.yaml against the current schema" },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.check/v1 JSON document on stdout",
    },
  },
  async run({ args }) {
    if (args?.json) {
      installJsonStdoutGuard();
      const configPath = await findConfig(process.cwd());
      if (!configPath) {
        emitJsonAndExit({
          schema: JSON_SCHEMA.check,
          exitCode: CONFIG_EXIT_CODE,
          config: null,
          data: { valid: false, legacy: [] },
          errors: [issueFromCliMessage("CONFIG_NOT_FOUND", configNotFoundMessage(process.cwd()))],
        });
      }
      const result = await checkConfig(configPath);
      emitJsonAndExit({
        schema: JSON_SCHEMA.check,
        exitCode: result.ok ? 0 : CONFIG_EXIT_CODE,
        config: configRef(configPath),
        data: {
          valid: result.ok,
          legacy: result.legacy.map((item) => ({
            file: item.file,
            path: item.path,
            message: item.message,
          })),
        },
        warnings: result.warnings.map((message) => issue("CONFIG_WARNING", message)),
        errors: result.errors.map((error) =>
          issue(
            error.code ?? "CONFIG_INVALID",
            error.path ? `${error.path}: ${error.message}` : error.message,
          ),
        ),
      });
    }

    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error(pc.red(`[ERROR] ${configNotFoundMessage(process.cwd())}`));
      process.exit(CONFIG_EXIT_CODE);
    }

    console.log(pc.dim(`bolt.yaml: ${configPath}`));

    const result = await checkConfig(configPath);

    for (const warning of result.warnings) console.log(pc.yellow(warning));

    if (result.ok) {
      console.log(pc.green("✓ bolt.yaml is valid"));
      return;
    }

    console.log(pc.red(`✗ bolt.yaml has ${result.errors.length} error(s):\n`));
    for (const err of result.errors) {
      console.log(`  ${pc.cyan(err.path.padEnd(36))}${pc.red(err.message)}`);
    }
    if (result.legacy.length > 0) {
      console.log(pc.yellow("\nThis looks like a bolt v2.0 config:\n"));
      for (const item of result.legacy) {
        console.log(`  ${pc.cyan(`${item.file}: ${item.path}`.padEnd(36))}${item.message}`);
      }
      try {
        const plan = planMigration(configPath);
        console.log(
          pc.yellow("\nRun `bolt migrate` to rewrite the files (it keeps backups), or use this:\n"),
        );
        console.log(pc.bold("# bolt.yaml"));
        console.log(plan.sharedText);
        if (plan.localText !== undefined) {
          console.log(pc.bold("# bolt.local.yaml"));
          console.log(plan.localText);
        }
        for (const note of plan.notes) console.log(pc.yellow(`note: ${note}`));
      } catch {
        console.log(pc.yellow("\nRun `bolt migrate --dry-run` to see the converted files."));
      }
    }
    process.exit(CONFIG_EXIT_CODE);
  },
});
