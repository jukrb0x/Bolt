import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig, type BoltConfig } from "../config";
import { makeCtx, walkSteps, collectSections, type PlanSection } from "../inspect-utils";
import { parseRunArgs } from "./run";

export default defineCommand({
  meta: { description: "Inspect resolved steps for a task or flow without executing" },
  args: {},
  async run({ rawArgs }) {
    const { names, params } = parseRunArgs(rawArgs ?? []);
    if (names.length === 0) {
      console.error("[ERROR] Usage: bolt inspect <task|flow> [--k=v ...]");
      process.exit(1);
    }

    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error("[ERROR] bolt.yaml not found");
      process.exit(1);
    }

    let cfg: BoltConfig;
    try {
      cfg = await loadConfig(configPath);
    } catch (e: any) {
      console.error(`[ERROR] ${e.message}`);
      process.exit(1);
    }

    console.log(`Config: ${configPath}`);
    console.log();
    const ctx = makeCtx(cfg);

    for (const name of names) {
      let sections: PlanSection[];
      try {
        sections = collectSections(name, cfg);
      } catch (e: any) {
        console.error(`[ERROR] ${e.message}`);
        process.exit(1);
      }

      console.log(`>> ${name}`);
      const counter = { n: 1 };
      for (const section of sections) {
        if (sections.length > 1) console.log(`  [${section.label}]`);
        for (const line of walkSteps(section.steps, cfg, ctx, params, counter)) {
          console.log(line);
        }
      }
      console.log();
    }
  },
});
