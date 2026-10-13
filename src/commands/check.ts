import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { checkConfig } from "../config";
import pc from "picocolors";
import { planMigration } from "./migrate";
import { CONFIG_EXIT_CODE } from "../exit-codes";
import { configNotFoundMessage } from "../project-config";

export default defineCommand({
  meta: { name: "check", description: "Validate bolt.yaml against the current schema" },
  async run() {
    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error(pc.red(`[ERROR] ${configNotFoundMessage(process.cwd())}`));
      process.exit(CONFIG_EXIT_CODE);
    }

    console.log(pc.dim(`bolt.yaml: ${configPath}`));

    const result = await checkConfig(configPath);

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
