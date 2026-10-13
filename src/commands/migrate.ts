import { defineCommand } from "citty";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
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

/** Run bolt check on the planned text in a scratch directory. Nothing is written next to bolt.yaml. */
export async function validatePlan(plan: MigrationPlan) {
  const dir = mkdtempSync(path.join(tmpdir(), "bolt-migrate-"));
  try {
    writeFileSync(path.join(dir, "bolt.yaml"), plan.sharedText);
    if (plan.localText !== undefined)
      writeFileSync(path.join(dir, "bolt.local.yaml"), plan.localText);
    return await checkConfig(path.join(dir, "bolt.yaml"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write via a temp file in the same directory, then rename over the target. */
function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.migrate-${process.pid}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** A backup path next to `file` that does not exist yet. */
export function backupPath(file: string): string {
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
    force: {
      type: "boolean",
      description: "Write the files even if the converted config does not pass bolt check",
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

    const printErrors = (errors: Array<{ path: string; message: string }>) => {
      for (const err of errors)
        console.log(`  ${pc.cyan(err.path.padEnd(36))}${pc.red(err.message)}`);
    };
    const checked = await validatePlan(plan);

    if (args["dry-run"]) {
      console.log(pc.bold(`# ${plan.sharedPath}`));
      console.log(plan.sharedText);
      if (plan.localText !== undefined) {
        console.log(pc.bold(`# ${plan.localPath}`));
        console.log(plan.localText);
      }
      for (const note of plan.notes) console.log(pc.yellow(`note: ${note}`));
      if (!checked.ok) {
        console.log(
          pc.red(`\nThe converted config would still have ${checked.errors.length} error(s):\n`),
        );
        printErrors(checked.errors);
      }
      console.log(pc.dim("Dry run: no files written."));
      return;
    }

    if (!checked.ok && !args.force) {
      console.log(
        pc.red(
          `✗ The converted config would have ${checked.errors.length} error(s). No files were written:\n`,
        ),
      );
      printErrors(checked.errors);
      for (const note of plan.notes) console.log(pc.yellow(`note: ${note}`));
      console.log(
        pc.dim(
          "\nFix bolt.yaml or bolt.local.yaml and run bolt migrate again, or pass --force to write anyway.",
        ),
      );
      process.exit(1);
    }

    // Back up both files first, then replace each one with a rename.
    const sharedBackup = backupPath(plan.sharedPath);
    copyFileSync(plan.sharedPath, sharedBackup);
    let localBackup: string | undefined;
    if (plan.localText !== undefined && existsSync(plan.localPath)) {
      localBackup = backupPath(plan.localPath);
      copyFileSync(plan.localPath, localBackup);
    }
    writeAtomic(plan.sharedPath, plan.sharedText);
    console.log(`Rewrote ${plan.sharedPath} (backup: ${sharedBackup})`);
    if (plan.localText !== undefined) {
      writeAtomic(plan.localPath, plan.localText);
      console.log(
        localBackup
          ? `Rewrote ${plan.localPath} (backup: ${localBackup})`
          : `Wrote ${plan.localPath}`,
      );
    }
    for (const note of plan.notes) console.log(pc.yellow(`note: ${note}`));
    console.log(pc.dim("YAML comments are not carried over. They are still in the backup."));

    if (checked.ok) {
      console.log(pc.green("✓ bolt.yaml is valid"));
      return;
    }
    console.log(
      pc.red(
        `✗ bolt.yaml still has ${checked.errors.length} error(s) (written because of --force):\n`,
      ),
    );
    printErrors(checked.errors);
    process.exit(1);
  },
});
