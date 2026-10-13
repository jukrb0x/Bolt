import { defineCommand } from "citty";
import { loadProjectConfigOrExit } from "../project-config";
import pc from "picocolors";

function row(label: string, value: string) {
  console.log(`  ${pc.cyan(label.padEnd(13))}${value}`);
}

export default defineCommand({
  meta: { name: "info", description: "Print project config summary from bolt.yaml" },
  async run() {
    const { configPath, cfg } = await loadProjectConfigOrExit();

    console.log(pc.dim(`bolt.yaml: ${configPath}`));
    console.log("");
    console.log(`${pc.underline(pc.bold("PROJECT"))}`);
    console.log("");
    row("version", String(cfg.version));
    row("name", cfg.project.name);

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
