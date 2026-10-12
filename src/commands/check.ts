import { defineCommand } from "citty";
import { readFileSync } from "fs";
import { findConfig } from "../discover";
import { checkConfig } from "../config";
import { createRuntime } from "../runtime";
import { tasksReferenceUe, ueMetadataErrors } from "../plugins/ue";
import { svnMetadataErrors } from "../plugins/svn";
import pc from "picocolors";

export interface MetadataError {
  path: string;
  message: string;
}

/** Plugin metadata failures. Core schema errors stay in checkConfig. */
export function pluginMetadataErrors(parsed: unknown): MetadataError[] {
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as { plugins?: unknown; tasks?: unknown };
  const errors = [...ueMetadataErrors(record.plugins), ...svnMetadataErrors(record.plugins)];
  const hasUe = Array.isArray(record.plugins)
    ? record.plugins.some(
        (item) =>
          !!item &&
          typeof item === "object" &&
          (item as { namespace?: unknown }).namespace === "ue",
      )
    : false;
  if (tasksReferenceUe(record.tasks) && !hasUe) {
    errors.push({
      path: "plugins.ue",
      message:
        "ue metadata is required when a task uses a ue/ handler (plugins: namespace ue, with engine, project, uproject, targets)",
    });
  }
  return errors;
}

function readParsed(filepath: string): unknown | undefined {
  try {
    const raw = readFileSync(filepath, "utf8");
    return createRuntime().parseYaml(raw);
  } catch {
    return undefined;
  }
}

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
    const errors = [...result.errors, ...pluginMetadataErrors(readParsed(configPath) ?? {})];

    if (errors.length === 0) {
      console.log(pc.green("✓ bolt.yaml is valid"));
      return;
    }

    console.log(pc.red(`✗ bolt.yaml has ${errors.length} error(s):\n`));
    for (const err of errors) {
      console.log(`  ${pc.cyan(err.path.padEnd(36))}${pc.red(err.message)}`);
    }
    process.exit(1);
  },
});
