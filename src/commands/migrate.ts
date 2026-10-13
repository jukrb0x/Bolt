import { defineCommand } from "citty";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import pc from "picocolors";
import { stringify } from "yaml";
import { findConfig } from "../discover";
import { checkConfig } from "../config";
import { migrateLegacyConfig, type MigrationResult } from "../legacy-config";
import { createRuntime } from "../runtime";

export interface MigrationPlan extends MigrationResult {
  sharedPath: string;
  localPath: string;
  sharedText: string;
  localText?: string;
}

/** Read bolt.yaml and bolt.local.yaml next to it and compute the version 1 text. */
export function planMigration(configPath: string): MigrationPlan {
  const rt = createRuntime();
  const sharedPath = path.resolve(configPath);
  const localPath = path.join(path.dirname(sharedPath), "bolt.local.yaml");
  const shared = rt.parseYaml(readFileSync(sharedPath, "utf8"));
  const local = existsSync(localPath)
    ? (rt.parseYaml(readFileSync(localPath, "utf8")) ?? {})
    : undefined;
  const result = migrateLegacyConfig(shared, local);
  return {
    ...result,
    sharedPath,
    localPath,
    sharedText: stringify(result.shared),
    localText: result.local ? stringify(result.local) : undefined,
  };
}

/** A backup path next to `file` that does not exist yet. */
function backupPath(file: string): string {
  let candidate = `${file}.v2.0.bak`;
  for (let i = 1; existsSync(candidate); i++) candidate = `${file}.v2.0.bak.${i}`;
  return candidate;
}

export default defineCommand({
  meta: {
    description: "Rewrite a v2.0 bolt.yaml and bolt.local.yaml to the current format",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Print the rewritten files without writing them",
      default: false,
    },
  },
  async run({ args }) {
    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error(pc.red("bolt.yaml not found"));
      process.exit(1);
    }
    const plan = planMigration(configPath);
    if (!plan.changed) {
      console.log(pc.green("Nothing to migrate: no v2.0 keys found."));
      return;
    }

    if (args["dry-run"]) {
      console.log(pc.bold(`# ${plan.sharedPath}`));
      console.log(plan.sharedText);
      if (plan.localText !== undefined) {
        console.log(pc.bold(`# ${plan.localPath}`));
        console.log(plan.localText);
      }
      for (const note of plan.notes) console.log(pc.yellow(`note: ${note}`));
      console.log(pc.dim("Dry run: no files written."));
      return;
    }

    const sharedBackup = backupPath(plan.sharedPath);
    copyFileSync(plan.sharedPath, sharedBackup);
    writeFileSync(plan.sharedPath, plan.sharedText);
    console.log(`Rewrote ${plan.sharedPath} (backup: ${sharedBackup})`);
    if (plan.localText !== undefined) {
      if (existsSync(plan.localPath)) {
        const localBackup = backupPath(plan.localPath);
        copyFileSync(plan.localPath, localBackup);
        console.log(`Rewrote ${plan.localPath} (backup: ${localBackup})`);
      } else {
        console.log(`Wrote ${plan.localPath}`);
      }
      writeFileSync(plan.localPath, plan.localText);
    }
    for (const note of plan.notes) console.log(pc.yellow(`note: ${note}`));
    console.log(pc.dim("YAML comments are not carried over. They are still in the backup."));

    const result = await checkConfig(plan.sharedPath);
    if (result.ok) {
      console.log(pc.green("✓ bolt.yaml is valid"));
      return;
    }
    console.log(
      pc.red(`✗ bolt.yaml still has ${result.errors.length} error(s) after migration:\n`),
    );
    for (const err of result.errors) {
      console.log(`  ${pc.cyan(err.path.padEnd(36))}${pc.red(err.message)}`);
    }
    process.exit(1);
  },
});
