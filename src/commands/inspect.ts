import { defineCommand } from "citty";
import { findConfig } from "../discover";
import { loadConfig } from "../config";
import { parseGoArgs, resolveOps } from "../go";
import { makeCtx, walkSteps, collectSections, type ActionSection } from "../inspect-utils";

export default defineCommand({
  meta: { description: "Inspect resolved steps for an op or action without executing" },
  args: {},
  async run() {
    const inspectIdx = process.argv.indexOf("inspect");
    const rawTokens = process.argv
      .slice(inspectIdx + 1)
      .filter((t) => !t.startsWith("-") || t.includes("="));

    const mode = rawTokens[0];
    if (mode !== "go" && mode !== "run") {
      console.error('[ERROR] Usage: bolt inspect go <op>[:<variant>] | bolt inspect run <action>');
      process.exit(1);
    }

    const configPath = await findConfig(process.cwd());
    if (!configPath) {
      console.error("[ERROR] bolt.yaml not found");
      process.exit(1);
    }

    const cfg = await loadConfig(configPath);
    console.log(`Config: ${configPath}`);
    console.log();

    const ctx = makeCtx(cfg);

    if (mode === "go") {
      const opTokens = rawTokens.slice(1);
      if (opTokens.length === 0) {
        console.error("[ERROR] No ops specified. Example: bolt inspect go update");
        process.exit(1);
      }

      let resolved;
      try {
        resolved = resolveOps(parseGoArgs(opTokens), cfg);
      } catch (e: any) {
        console.error(`[ERROR] ${e.message}`);
        process.exit(1);
      }

      for (const op of resolved) {
        console.log(`>> ${op.name}`);
        const counter = { n: 1 };
        for (const line of walkSteps(op.steps, cfg, ctx, op.params, counter)) {
          console.log(line);
        }
        console.log();
      }
    } else {
      // run mode
      const actionName = rawTokens[1];
      if (!actionName) {
        console.error("[ERROR] No action specified. Example: bolt inspect run deploy");
        process.exit(1);
      }

      let sections: ActionSection[];
      try {
        sections = collectSections(actionName, cfg);
      } catch (e: any) {
        console.error(`[ERROR] ${e.message}`);
        process.exit(1);
      }
      console.log(`>> ${actionName}`);
      const counter = { n: 1 };
      for (const section of sections) {
        if (sections.length > 1) {
          console.log(`  [${section.label}]`);
        }
        for (const line of walkSteps(section.steps, cfg, ctx, {}, counter)) {
          console.log(line);
        }
      }
      console.log();
    }
  },
});
