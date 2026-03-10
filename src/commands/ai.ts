import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig } from "../config";
import { generateAiContext } from "../ai-context";
import { buildRegistry } from "../plugin-registry";
import uePlugin from "../plugins/ue";
import fsPlugin from "../plugins/fs";
import jsonPlugin from "../plugins/json";
import gitPlugin from "../plugins/git";
import svnPlugin from "../plugins/svn";
import path from "path";
import { mkdirSync, writeFileSync } from "fs";

export default defineCommand({
  meta: { description: "Generate .bolt/ai-context.md for LLM tool integration" },
  args: {
    stdout: {
      type: "boolean",
      default: false,
      description: "Print to stdout instead of writing to file",
    },
  },
  async run({ args }) {
    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error("[ERROR] bolt.yaml not found");
      process.exit(1);
    }

    const cfg = await loadConfig(configPath);
    const configDir = path.dirname(path.resolve(configPath));
    const registry = await buildRegistry(cfg, configDir, [
      uePlugin,
      fsPlugin,
      jsonPlugin,
      gitPlugin,
      svnPlugin,
    ]);
    const content = generateAiContext(cfg, configPath, registry);

    if (args.stdout) {
      console.log(content);
      return;
    }

    const outDir = path.join(path.dirname(configPath), ".bolt");
    mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "ai-context.md");
    writeFileSync(outFile, content, "utf8");
    console.log(`Written: ${outFile}`);
  },
});
