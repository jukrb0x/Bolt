import { defineCommand } from "citty";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import pc from "picocolors";
import { pluginAuthorTsconfig } from "../plugin-tsconfig";
import { pluginTypesFile } from "../plugin-declaration";
import { VERSION } from "../version";

export interface ScaffoldResult {
  wrote: string[];
  skipped: string[];
}

/** Write the running bolt's plugin types and a tsconfig that points at them. */
export function writePluginTypes(dir: string, opts: { force: boolean }): ScaffoldResult {
  const wrote: string[] = [];
  const skipped: string[] = [];

  mkdirSync(path.join(dir, ".bolt", "types"), { recursive: true });
  writeFileSync(path.join(dir, ".bolt", "types", "boltstack.d.ts"), pluginTypesFile(VERSION));
  wrote.push(".bolt/types/boltstack.d.ts");

  const tsconfigPath = path.join(dir, "tsconfig.json");
  if (existsSync(tsconfigPath) && !opts.force) {
    skipped.push("tsconfig.json");
  } else {
    writeFileSync(tsconfigPath, pluginAuthorTsconfig());
    wrote.push("tsconfig.json");
  }

  return { wrote, skipped };
}

export default defineCommand({
  meta: {
    description: "Write TypeScript types and a tsconfig for plugin authors",
  },
  args: {
    force: {
      type: "boolean",
      alias: "f",
      description: "Overwrite tsconfig.json",
      default: false,
    },
  },
  run({ args }) {
    const { wrote, skipped } = writePluginTypes(process.cwd(), { force: Boolean(args.force) });
    for (const file of wrote) console.log(pc.green(`✓ wrote ${file}`));
    for (const file of skipped) console.log(pc.yellow(`• skipped ${file} (exists; use --force)`));
  },
});
