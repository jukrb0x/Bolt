import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig } from "../config";
import pc from "picocolors";

function row(label: string, value: string) {
  console.log(`  ${pc.cyan(label.padEnd(12))}${value}`);
}

export default defineCommand({
  meta: { description: "Print project config summary from bolt.yaml" },
  async run() {
    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error("bolt.yaml not found");
      process.exit(1);
    }
    const cfg = await loadConfig(configPath);

    console.log(pc.dim(`bolt.yaml: ${configPath}`));
    console.log("");
    console.log(`${pc.underline(pc.bold("PROJECT"))}`);
    console.log("");
    row("name", cfg.project.name);
    row("ue_path", cfg.project.ue_path);
    row("path", cfg.project.project_path);
    if (cfg.project.svn_root) row("svn_root", cfg.project.svn_root);
    if (cfg.project.git_branch) row("git_branch", cfg.project.git_branch);

    console.log("");
    console.log(`${pc.underline(pc.bold("TARGETS"))}`);
    console.log("");
    for (const [name, t] of Object.entries(cfg.targets)) {
      const detail = t.name
        ? `${t.target} · ${t.name} · ${t.type}`
        : `${t.target} · ${t.type}`;
      console.log(`  ${pc.cyan(name.padEnd(12))}${detail}`);
    }

    console.log("");
    console.log(`${pc.underline(pc.bold("OPS"))}`);
    console.log("");
    if (Object.keys(cfg.ops).length === 0) {
      console.log(pc.dim("  (none)"));
    } else {
      for (const [name, op] of Object.entries(cfg.ops)) {
        const variants = Object.keys(op).filter((v) => v !== "default");
        const suffix = variants.length > 0 ? pc.dim(`  [${variants.join(", ")}]`) : "";
        console.log(`  ${pc.cyan(("--" + name).padEnd(24))}${suffix}`);
      }
    }

    console.log("");
    console.log(`${pc.underline(pc.bold("ACTIONS"))}`);
    console.log("");
    if (Object.keys(cfg.actions).length === 0) {
      console.log(pc.dim("  (none)"));
    } else {
      for (const name of Object.keys(cfg.actions)) {
        console.log(`  ${pc.cyan(name)}`);
      }
    }

    console.log("");
  },
});
