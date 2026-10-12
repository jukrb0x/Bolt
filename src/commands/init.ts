import { defineCommand } from "citty";
import pc from "picocolors";
import path from "path";
import { existsSync, writeFileSync } from "fs";

// Mirrors bolt.template.yaml. Inlined so the published binary does not need the file.
const STARTER_YAML = `# bolt.yaml — pipeline contract (commit this)
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

export default defineCommand({
  meta: {
    description: "Scaffold a generic bolt.yaml",
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
    const force = args.force as boolean;
    const root = process.cwd();
    const wrote: string[] = [];
    const skipped: string[] = [];

    const yamlPath = path.join(root, "bolt.yaml");
    if (existsSync(yamlPath) && !force) {
      skipped.push("bolt.yaml");
    } else {
      writeFileSync(yamlPath, STARTER_YAML);
      wrote.push("bolt.yaml");
    }

    for (const f of wrote) console.log(pc.green(`✓ wrote ${f}`));
    for (const f of skipped) console.log(pc.yellow(`• skipped ${f} (exists; use --force)`));
    console.log(
      pc.dim("\nCommit bolt.yaml. Put machine-specific vars in bolt.local.yaml (gitignored)."),
    );
    console.log(pc.dim("Then run: bolt check"));
  },
});
