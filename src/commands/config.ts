import { defineCommand } from "citty";
import { CONFIG_EXIT_CODE } from "../exit-codes";
import { configNotFoundMessage } from "../project-config";
import { existsSync, copyFileSync } from "fs";
import path from "path";
import { findConfig } from "../discover";

export default defineCommand({
  meta: { name: "config", description: "Open the bolt.yaml config file in an editor" },
  args: {
    editor: {
      type: "string",
      alias: "e",
      description: "Editor to use (overrides $EDITOR env var)",
    },
  },
  async run({ args }) {
    let configPath = await findConfig(process.cwd());

    if (!configPath) {
      const templatePath = path.join(process.cwd(), "bolt.template.yaml");
      if (existsSync(templatePath)) {
        configPath = path.join(process.cwd(), "bolt.yaml");
        copyFileSync(templatePath, configPath);
        console.log(`Created bolt.yaml from template.`);
      } else {
        console.error(`[ERROR] ${configNotFoundMessage(process.cwd())}`);
        process.exit(CONFIG_EXIT_CODE);
      }
    }

    const editor = (args.editor as string) || process.env.EDITOR || process.env.VISUAL;

    if (!editor) {
      console.error(
        "No editor configured. Set $EDITOR or $VISUAL environment variable, or use --editor flag.",
      );
      process.exit(1);
    }

    const { spawnSync } = await import("child_process");
    const result = spawnSync(editor, [configPath], { stdio: "inherit" });

    if (result.error) {
      console.error(`Failed to open editor: ${result.error.message}`);
      process.exit(1);
    }

    process.exit(result.status ?? 0);
  },
});
