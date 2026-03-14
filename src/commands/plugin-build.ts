import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import path from "path";
import pc from "picocolors";
import { spawnSync } from "child_process";

export default defineCommand({
  meta: { description: "Build/compile a TypeScript plugin to JavaScript" },
  args: {
    name: { type: "positional" as const, required: false, description: "Plugin name (defaults to current directory plugin)" },
    user: { type: "boolean", default: false, description: "Build user-scope plugin" },
  },
  async run({ args }) {
    const name = args.name as string | undefined;
    const isUser = args.user as boolean;

    // Determine plugin directory
    let pluginDir: string | null = null;

    if (name) {
      // Explicit name provided
      if (isUser) {
        pluginDir = path.join(homedir(), ".bolt", "plugins", name);
      } else {
        const configPath = await findConfig(process.cwd());
        if (!configPath) {
          console.error(pc.red("bolt.yaml not found — run from a project directory, or use --user"));
          process.exit(1);
        }
        const baseDir = path.dirname(configPath);
        pluginDir = path.join(baseDir, ".bolt", "plugins", name);
      }
    } else {
      // Try to detect plugin from current directory
      const cwd = process.cwd();
      const indexTs = path.join(cwd, "index.ts");
      const packageJson = path.join(cwd, "package.json");

      if (existsSync(indexTs) && existsSync(packageJson)) {
        pluginDir = cwd;
      } else {
        console.error(pc.red("Cannot determine plugin directory. Usage: bolt plugin build <name>"));
        process.exit(1);
      }
    }

    if (!pluginDir || !existsSync(pluginDir)) {
      console.error(pc.red(`Plugin directory not found: ${pluginDir}`));
      process.exit(1);
    }

    const indexTs = path.join(pluginDir, "index.ts");
    if (!existsSync(indexTs)) {
      console.error(pc.red(`No index.ts found in ${pluginDir}`));
      process.exit(1);
    }

    console.log(pc.dim(`Building plugin: ${pluginDir}`));

    // Use Bun to compile TypeScript to JavaScript
    const result = spawnSync("bun", ["build", indexTs, "--outfile", path.join(pluginDir, "index.js"), "--target=bun"], {
      cwd: pluginDir,
      stdio: "inherit",
    });

    if (result.status !== 0) {
      console.error(pc.red("Build failed"));
      process.exit(1);
    }

    console.log(pc.green(`✓ Built plugin successfully`));
    console.log(pc.dim(`  ${path.join(pluginDir, "index.js")}`));
  },
});
