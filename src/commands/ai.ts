import { defineCommand } from "citty";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { catalogPlugins, generateAiContext } from "../ai-context";
import { findConfig } from "../discover";
import { CONFIG_EXIT_CODE, USAGE_EXIT_CODE } from "../exit-codes";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  issue,
  loadConfigForJson,
} from "../json-envelope";
import { loadProjectConfigOrExit } from "../project-config";
import { builtinPlugins } from "../plugins";
import { buildStaticAiRegistry, StaticManifestError } from "../static-plugin-manifest";

export default defineCommand({
  meta: { name: "ai", description: "Generate .bolt/ai-context.md for LLM tool integration" },
  args: {
    stdout: {
      type: "boolean",
      default: false,
      description: "Print to stdout instead of writing to file",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.catalog/v1 JSON document on stdout",
    },
  },
  async run({ args }) {
    if (args.json) {
      installJsonStdoutGuard();
      if (args.stdout) {
        emitJsonAndExit({
          schema: JSON_SCHEMA.catalog,
          exitCode: USAGE_EXIT_CODE,
          config: configRef(await findConfig(process.cwd())),
          data: null,
          errors: [issue("USAGE", "`--json` cannot be combined with `--stdout`.")],
        });
      }
      const { configPath, cfg } = await loadConfigForJson(JSON_SCHEMA.catalog);
      const configDir = path.dirname(path.resolve(configPath));
      let registry;
      try {
        registry = buildStaticAiRegistry(cfg, configDir, Object.values(builtinPlugins));
      } catch (e: unknown) {
        if (e instanceof StaticManifestError) {
          emitJsonAndExit({
            schema: JSON_SCHEMA.catalog,
            exitCode: CONFIG_EXIT_CODE,
            config: configRef(configPath),
            data: null,
            errors: [
              issue(
                "CONFIG_INVALID",
                e.message.split("\n")[0] ?? e.message,
                `bolt plugin build ${e.namespace}`,
              ),
            ],
          });
        }
        throw e;
      }
      emitJsonAndExit({
        schema: JSON_SCHEMA.catalog,
        exitCode: 0,
        config: configRef(configPath),
        data: { plugins: catalogPlugins(registry) },
      });
    }

    const { configPath, cfg } = await loadProjectConfigOrExit();
    const configDir = path.dirname(path.resolve(configPath));

    let registry;
    try {
      registry = buildStaticAiRegistry(cfg, configDir, Object.values(builtinPlugins));
    } catch (e: unknown) {
      if (e instanceof StaticManifestError) {
        console.error(e.message);
        process.exit(CONFIG_EXIT_CODE);
      }
      throw e;
    }

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
