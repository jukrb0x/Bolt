import { defineCommand } from "citty";
import pc from "picocolors";
import path from "path";
import { existsSync, readdirSync, writeFileSync, statSync } from "fs";

const STARTER_YAML = `# bolt.yaml - shared project contract (commit this; no machine paths here)
project:
  name: MyProject
  engine:
    vcs: git
    # url: https://github.com/EpicGames/UnrealEngine.git
    branch: main
  project:
    vcs: svn
    # url: svn://svn.example.com/project/trunk

targets:
  editor: { kind: editor, config: development }

# tasks: named step sequences (the only building block)
tasks:
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build:  [{ uses: ue/build, with: { target: editor } }]
  start:  [{ uses: ue/start }]

# flows: named, ordered goals (bolt run <flow>)
flows:
  daily:
    description: Update, build, launch editor
    steps: [update, build, start]
    continue_on_fail: [start]
`;

function starterLocal(uproject: string, projectPath: string): string {
  return `# bolt.local.yaml - per-machine paths (gitignored; do NOT commit)
engine_path:  CHANGE_ME/path/to/engine
project_path: ${projectPath}
uproject:     ${uproject}
use_tortoise: false
`;
}

/** Find a single *.uproject in cwd or one level down. Returns absolute path or null. */
function detectUproject(root: string): string | null {
  const matches: string[] = [];
  const scan = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.endsWith(".uproject")) matches.push(path.join(dir, e));
    }
  };
  scan(root);
  if (matches.length === 0) {
    for (const e of readdirSync(root)) {
      const full = path.join(root, e);
      try {
        if (statSync(full).isDirectory()) scan(full);
      } catch {
        /* skip unreadable entries */
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export default defineCommand({
  meta: {
    description: "Scaffold bolt.yaml (shared) + bolt.local.yaml (per-machine)",
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

    const localPath = path.join(root, "bolt.local.yaml");
    if (existsSync(localPath) && !force) {
      skipped.push("bolt.local.yaml");
    } else {
      const detected = detectUproject(root);
      const uproject = detected ? path.relative(root, detected).split(path.sep).join("/") : "CHANGE_ME/path/to/Project.uproject";
      const projectPath = detected
        ? path.relative(root, path.dirname(detected)).split(path.sep).join("/") || "."
        : "CHANGE_ME/path/to/project";
      writeFileSync(localPath, starterLocal(uproject, projectPath));
      wrote.push(detected ? `bolt.local.yaml (detected ${path.basename(detected)})` : "bolt.local.yaml");
    }

    for (const f of wrote) console.log(pc.green(`✓ wrote ${f}`));
    for (const f of skipped) console.log(pc.yellow(`• skipped ${f} (exists; use --force)`));
    console.log(pc.dim("\nEdit bolt.local.yaml paths, then run: bolt check"));
  },
});
