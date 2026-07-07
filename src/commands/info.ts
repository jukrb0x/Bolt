import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig } from "../config";
import pc from "picocolors";

function row(label: string, value: string) {
  console.log(`  ${pc.cyan(label.padEnd(13))}${value}`);
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
    row("uproject", cfg.project.uproject);

    console.log("");
    console.log(`${pc.underline(pc.bold("ENGINE REPO"))}`);
    console.log("");
    row("path", cfg.project.engine_repo.path);
    row("vcs", cfg.project.engine_repo.vcs ?? "git");
    if (cfg.project.engine_repo.url) row("url", cfg.project.engine_repo.url);
    if (cfg.project.engine_repo.branch) row("branch", cfg.project.engine_repo.branch);

    console.log("");
    console.log(`${pc.underline(pc.bold("PROJECT REPO"))}`);
    console.log("");
    row("path", cfg.project.project_repo.path);
    row("vcs", cfg.project.project_repo.vcs ?? "svn");
    if (cfg.project.project_repo.url) row("url", cfg.project.project_repo.url);

    console.log("");
    console.log(`${pc.underline(pc.bold("TARGETS"))}`);
    console.log("");
    if (Object.keys(cfg.targets).length === 0) {
      console.log(pc.dim("  (none)"));
    } else {
      for (const [name, t] of Object.entries(cfg.targets)) {
        const detail = t.name ? `${t.kind} · ${t.name} · ${t.config}` : `${t.kind} · ${t.config}`;
        console.log(`  ${pc.cyan(name.padEnd(12))}${detail}`);
      }
    }

    console.log("");
    console.log(`${pc.underline(pc.bold("TASKS"))}`);
    console.log("");
    if (Object.keys(cfg.tasks).length === 0) {
      console.log(pc.dim("  (none)"));
    } else {
      for (const name of Object.keys(cfg.tasks)) {
        console.log(`  ${pc.cyan(name)}`);
      }
    }

    console.log("");
    console.log(`${pc.underline(pc.bold("FLOWS"))}`);
    console.log("");
    if (Object.keys(cfg.flows).length === 0) {
      console.log(pc.dim("  (none)"));
    } else {
      for (const [name, flow] of Object.entries(cfg.flows)) {
        console.log(`  ${pc.cyan(name.padEnd(24))}${pc.dim(flow.steps.join(" → "))}`);
      }
    }

    console.log("");
  },
});
