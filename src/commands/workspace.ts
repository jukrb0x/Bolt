import { defineCommand } from "citty";
import os from "os";
import path from "path";
import { findConfig } from "../discover";
import { USAGE_EXIT_CODE } from "../exit-codes";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  issue,
  issueFromCliMessage,
  loadConfigForJson,
} from "../json-envelope";
import { Logger } from "../logger";
import { ConfigError, exitWithConfigError, loadProjectConfigOrExit } from "../project-config";
import { buildRegistry } from "../plugin-registry";
import { builtinPlugins } from "../plugins";
import { createRuntime } from "../runtime";
import {
  WorkspaceConfigError,
  WorkspacePlanError,
  formatWorkspacePlan,
  planWorkspaceSync,
} from "../workspace";

const DRY_RUN_REQUIRED =
  "bolt workspace sync does not sync in this build. Re-run with --dry-run to print the plan.";

function userHome(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

const syncCmd = defineCommand({
  meta: {
    name: "sync",
    description: "Print a dry-run plan for workspace.roots. Does not update a working copy",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Print the plan. Required; this build does not sync",
    },
    json: {
      type: "boolean",
      description: "Print one bolt.workspace.sync/v1 JSON document on stdout",
    },
  },
  async run({ args }) {
    const json = Boolean(args?.json);
    if (json) installJsonStdoutGuard();
    if (args?.["dry-run"] !== true) {
      if (json) {
        emitJsonAndExit({
          schema: JSON_SCHEMA.workspaceSync,
          exitCode: USAGE_EXIT_CODE,
          config: configRef(await findConfig(process.cwd())),
          data: null,
          errors: [issue("USAGE", DRY_RUN_REQUIRED)],
        });
      }
      console.error(`[ERROR] ${DRY_RUN_REQUIRED}`);
      process.exit(USAGE_EXIT_CODE);
    }

    const loaded = json
      ? await loadConfigForJson(JSON_SCHEMA.workspaceSync)
      : await loadProjectConfigOrExit();
    const { configPath, cfg } = loaded;
    const configDir = path.dirname(configPath);
    const fail = (error: WorkspaceConfigError | WorkspacePlanError): never => {
      const hint = error instanceof WorkspaceConfigError ? error.hint : undefined;
      if (json) {
        emitJsonAndExit({
          schema: JSON_SCHEMA.workspaceSync,
          exitCode: error.exitCode,
          config: configRef(configPath),
          data: null,
          errors: [issue(error.code, error.message, hint)],
        });
      }
      console.error(`[ERROR] ${error.code}: ${error.message}`);
      if (hint) console.error(`  ${hint}`);
      process.exit(error.exitCode);
    };

    const workspace =
      cfg.workspace ??
      fail(
        new WorkspaceConfigError(
          "WORKSPACE_INVALID",
          "bolt.yaml has no workspace block. Add workspace.roots and sync_policy.",
        ),
      );

    let data;
    try {
      const registry = await buildRegistry(cfg, configDir, [...builtinPlugins], {
        home: userHome(),
      });
      data = await planWorkspaceSync(workspace, configDir, registry, {
        cfg,
        configDir,
        dryRun: true,
        logger: new Logger({ sink: (line) => process.stderr.write(`${line}\n`) }),
        runtime: createRuntime(),
        emit: () => {},
      });
    } catch (error) {
      if (error instanceof WorkspaceConfigError || error instanceof WorkspacePlanError) fail(error);
      if (error instanceof ConfigError) {
        if (json) {
          emitJsonAndExit({
            schema: JSON_SCHEMA.workspaceSync,
            exitCode: error.exitCode,
            config: configRef(configPath),
            data: null,
            errors: [issueFromCliMessage(error.code, error.message)],
          });
        }
        exitWithConfigError(error);
      }
      throw error;
    }

    if (json) {
      emitJsonAndExit({
        schema: JSON_SCHEMA.workspaceSync,
        exitCode: 0,
        config: configRef(configPath),
        data,
      });
    }
    console.log(formatWorkspacePlan(data));
  },
});

export default defineCommand({
  meta: {
    name: "workspace",
    description: "Plan workspace roots declared in bolt.yaml",
  },
  subCommands: {
    sync: syncCmd,
  },
});
