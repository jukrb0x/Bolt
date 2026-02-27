import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import path from "path";
import pc from "picocolors";

export interface ScaffoldOptions {
  name: string;
  baseDir: string;
  isUser: boolean;
}

export async function scaffoldPlugin({ name, baseDir, isUser }: ScaffoldOptions): Promise<string> {
  const pluginDir = isUser
    ? path.join(baseDir, "plugins", name)
    : path.join(baseDir, ".bolt", "plugins", name);

  if (existsSync(pluginDir)) {
    throw new Error(`Plugin directory already exists: ${pluginDir}`);
  }

  mkdirSync(pluginDir, { recursive: true });

  const indexTs = `import type { BoltPlugin } from "bolt";

const plugin: BoltPlugin = {
  namespace: "${name}",
  handlers: {
    run: async (params, ctx) => {
      ctx.logger.info("${name}/run called");
    },
  },
};

export default plugin;
`;

  const tsconfig = {
    $schema: "https://json.schemastore.org/tsconfig",
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      types: ["bun-types"],
    },
  };

  const packageJson = {
    name,
    type: "module",
    devDependencies: {
      "bun-types": "latest",
      // bolt-ue provides `declare module "bolt"` — after `bun install` the TS LSP
      // resolves `import type { BoltPlugin } from "bolt"` via node_modules/bolt-ue.
      "bolt-ue": "latest",
    },
  };

  writeFileSync(path.join(pluginDir, "index.ts"), indexTs, "utf8");
  writeFileSync(path.join(pluginDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n", "utf8");
  writeFileSync(path.join(pluginDir, "package.json"), JSON.stringify(packageJson, null, 2) + "\n", "utf8");
  return pluginDir;
}

export default defineCommand({
  meta: { description: "Scaffold a new bolt plugin" },
  args: {
    name: { type: "positional" as const, required: true, description: "Plugin name (lowercase alphanumeric, hyphens, underscores)" },
    user: { type: "boolean", default: false, description: "Create in user scope (~/.bolt/plugins/)" },
  },
  async run({ args }) {
    const name = args.name as string;
    if (!name) {
      console.error(pc.red("Usage: bolt plugin new <name> [--user]"));
      process.exit(1);
    }
    if (!/^[a-z0-9_-]+$/.test(name)) {
      console.error(pc.red("Plugin name must be lowercase alphanumeric with hyphens/underscores only"));
      process.exit(1);
    }

    let baseDir: string;
    if (args.user) {
      baseDir = path.join(homedir(), ".bolt");
    } else {
      const configPath = await findConfig(process.cwd());
      if (!configPath) {
        console.error(pc.red("bolt.yaml not found — run from a project directory, or use --user for user-scope"));
        process.exit(1);
      }
      baseDir = path.dirname(configPath);
    }

    let pluginDir: string;
    try {
      pluginDir = await scaffoldPlugin({ name, baseDir, isUser: args.user });
    } catch (e: any) {
      console.error(pc.red(e.message));
      process.exit(1);
    }

    console.log(pc.green(`✓ Created plugin "${name}"`));
    console.log(pc.dim(`  ${pluginDir}`));
    console.log("");
    console.log("Next steps:");
    console.log(`  ${pc.cyan(`cd ${pluginDir}`)}`);
    console.log(`  ${pc.cyan("bun install")}         # links bolt types + installs bun-types for IDE support`);
    if (!args.user) {
      console.log("");
      console.log(pc.dim("Ensure bolt.d.ts is at the project root (download from the bolt release page)."));
    }
  },
});
