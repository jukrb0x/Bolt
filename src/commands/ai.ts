import { defineCommand } from "citty";
import { loadProjectConfigOrExit } from "../project-config";
import { generateAiContext } from "../ai-context";
import { buildRegistry } from "../plugin-registry";
import { builtinPlugins } from "../plugins";
import path from "path";
import { mkdirSync, writeFileSync } from "fs";

export default defineCommand({
  meta: { name: "ai", description: "Generate .bolt/ai-context.md for LLM tool integration" },
  args: {
    stdout: {
      type: "boolean",
      default: false,
      description: "Print to stdout instead of writing to file",
    },
  },
  async run({ args }) {
    const { configPath, cfg } = await loadProjectConfigOrExit();
    const configDir = path.dirname(path.resolve(configPath));
    const registry = await buildRegistry(cfg, configDir, Object.values(builtinPlugins));
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
