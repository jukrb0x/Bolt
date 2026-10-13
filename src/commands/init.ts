import { defineCommand } from "citty";
import pc from "picocolors";
import path from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { boltConfigJsonSchema } from "../config-schema";
import { writePluginTypes, type ScaffoldResult } from "./types";

const GITIGNORE_LINES = [".bolt/.cache", "bolt.local.yaml"];

// Mirrors bolt.template.yaml. Inlined so the published binary does not need the file.
const STARTER_YAML = `# yaml-language-server: $schema=./.bolt/bolt.schema.json
# bolt.yaml — pipeline contract (commit this)
#
# Generic metadata only. Unreal Engine settings belong to the ue plugin.
# See the ue plugin example (src/plugins/ue.example.yaml in the bolt repo).

version: 1

project:
  name: MyProject

tasks:
  hello:
    - run: echo "hello from \${{ project.name }}"

flows:
  demo:
    description: Say hello
    steps: [hello]
`;

const YAML_EXTENSIONS = {
  recommendations: ["redhat.vscode-yaml"],
};

function ensureGitignore(dir: string): "wrote" | "skipped" {
  const file = path.join(dir, ".gitignore");
  if (!existsSync(file)) {
    writeFileSync(file, `# bolt\n${GITIGNORE_LINES.join("\n")}\n`);
    return "wrote";
  }
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const missing = GITIGNORE_LINES.filter((line) => !lines.includes(line));
  if (missing.length === 0) return "skipped";
  const base = text.endsWith("\n") ? text : `${text}\n`;
  writeFileSync(file, `${base}${missing.join("\n")}\n`);
  return "wrote";
}

export function scaffoldProject(dir: string, opts: { force: boolean }): ScaffoldResult {
  const wrote: string[] = [];
  const skipped: string[] = [];

  const yamlPath = path.join(dir, "bolt.yaml");
  if (existsSync(yamlPath) && !opts.force) {
    skipped.push("bolt.yaml");
  } else {
    writeFileSync(yamlPath, STARTER_YAML);
    wrote.push("bolt.yaml");
  }

  mkdirSync(path.join(dir, ".bolt"), { recursive: true });
  writeFileSync(
    path.join(dir, ".bolt", "bolt.schema.json"),
    JSON.stringify(boltConfigJsonSchema(), null, 2) + "\n",
  );
  wrote.push(".bolt/bolt.schema.json");

  const types = writePluginTypes(dir, opts);
  wrote.push(...types.wrote);
  skipped.push(...types.skipped);

  const extensionsPath = path.join(dir, ".vscode", "extensions.json");
  if (existsSync(extensionsPath) && !opts.force) {
    skipped.push(".vscode/extensions.json");
  } else {
    mkdirSync(path.dirname(extensionsPath), { recursive: true });
    writeFileSync(extensionsPath, JSON.stringify(YAML_EXTENSIONS, null, 2) + "\n");
    wrote.push(".vscode/extensions.json");
  }

  if (ensureGitignore(dir) === "skipped") skipped.push(".gitignore");
  else wrote.push(".gitignore");

  return { wrote, skipped };
}

export default defineCommand({
  meta: {
    name: "init",
    description: "Scaffold a bolt project (bolt.yaml, JSON Schema, plugin types)",
  },
  args: {
    force: {
      type: "boolean",
      alias: "f",
      description: "Overwrite existing files",
      default: false,
    },
  },
  async run({ args }) {
    const { wrote, skipped } = scaffoldProject(process.cwd(), { force: Boolean(args.force) });
    for (const file of wrote) console.log(pc.green(`✓ wrote ${file}`));
    for (const file of skipped) console.log(pc.yellow(`• skipped ${file} (exists; use --force)`));
    console.log(
      pc.dim("\nCommit bolt.yaml. Put machine-specific vars in bolt.local.yaml (gitignored)."),
    );
    console.log(pc.dim("Plugin types match this bolt. Run bolt types again after upgrading."));
    console.log(pc.dim("Then run: bolt check"));
  },
});
