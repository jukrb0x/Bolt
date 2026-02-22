import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { checkConfig } from "../config";
import pc from "picocolors";

export default defineCommand({
  meta: { description: "Validate bolt.yaml against the current schema" },
  async run() {
    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error(pc.red("bolt.yaml not found"));
      process.exit(1);
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
    process.exit(1);
  },
});
