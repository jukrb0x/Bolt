import { defineCommand } from "citty";
import path from "path";
import { loadProjectConfigOrExit } from "../project-config";
import { contextFileState, contextHashForProject } from "../ai-context";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  loadConfigForJson,
} from "../json-envelope";
import { statusPlugins } from "../plan-preview";

/** Commands that accept `--json` today. Add `run` only when `bolt run --json` exists. */
const SCHEMAS = {
  list: "v1",
  info: "v1",
  check: "v1",
  inspect: "v1",
  status: "v1",
} as const;

function statusData(cfg: Awaited<ReturnType<typeof loadConfigForJson>>["cfg"], configPath: string) {
  const configDir = path.dirname(configPath);
  const current = contextHashForProject(cfg, configPath, configDir);
  return {
    agent_mode: false,
    context: contextFileState(configDir, current),
    local: { present: configRef(configPath)?.local != null, valid: true },
    plugins: statusPlugins(cfg, configDir),
    policy: { ai_run: cfg.aiRun ?? "confirm" },
    schemas: SCHEMAS,
  };
}

export default defineCommand({
  meta: {
    name: "status",
    description: "Show agent setup: context freshness, built plugins, and local policy",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.status/v1 JSON document on stdout",
    },
  },
  async run({ args }) {
    if (args?.json) {
      installJsonStdoutGuard();
      const { configPath, cfg } = await loadConfigForJson(JSON_SCHEMA.status);
      emitJsonAndExit({
        schema: JSON_SCHEMA.status,
        exitCode: 0,
        config: configRef(configPath),
        data: statusData(cfg, configPath),
      });
    }

    const { configPath, cfg } = await loadProjectConfigOrExit();
    const data = statusData(cfg, configPath);
    const context = data.context.fresh ? "fresh" : data.context.file_hash ? "stale" : "missing";
    console.log(`agent_mode: ${data.agent_mode}`);
    console.log(`context: ${context} (${data.context.file})`);
    console.log(`local: ${data.local.present ? "present" : "absent"}`);
    console.log(`policy.ai_run: ${data.policy.ai_run}`);
    if (data.plugins.length === 0) {
      console.log("plugins: (none)");
    } else {
      console.log("plugins:");
      for (const plugin of data.plugins) {
        console.log(`  ${plugin.namespace}  ${plugin.built ? "built" : "not built"}`);
      }
    }
  },
});
