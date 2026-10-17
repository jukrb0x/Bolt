import { defineCommand } from "citty";
import os from "os";
import path from "path";
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
  WorkspaceSyncError,
  formatWorkspacePlan,
  executeWorkspaceSync,
  planWorkspaceSync,
} from "../workspace";

function userHome(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

const syncCmd = defineCommand({
  meta: {
    name: "sync",
    description: "Update workspace.roots, or print the plan with --dry-run",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Print the plan and do not update a working copy",
    },
    json: {
      type: "boolean",
      description: "Print one bolt.workspace.sync/v1 JSON document on stdout",
    },
  },
  async run({ args }) {
    const json = Boolean(args?.json);
    const dryRun = args?.["dry-run"] === true;
    if (json) installJsonStdoutGuard();

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
      const ctx = {
        cfg,
        configDir,
        dryRun,
        logger: new Logger({ sink: (line) => process.stderr.write(`${line}\n`) }),
        runtime: createRuntime(),
        emit: () => {},
      };
      data = dryRun
        ? await planWorkspaceSync(workspace, configDir, registry, ctx)
        : await executeWorkspaceSync(workspace, configDir, registry, ctx);
    } catch (error) {
      if (error instanceof WorkspaceSyncError) {
        if (json) {
          emitJsonAndExit({
            schema: JSON_SCHEMA.workspaceSync,
            exitCode: error.exitCode,
            config: configRef(configPath),
            data: error.data,
            errors: error.issues.map((item) => issue(item.code, item.message)),
          });
        }
        console.log(formatWorkspacePlan(error.data));
        for (const item of error.issues) console.error(`[ERROR] ${item.code}: ${item.message}`);
        process.exit(error.exitCode);
      }
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
    description: "Sync or plan workspace roots declared in bolt.yaml",
  },
  subCommands: {
    sync: syncCmd,
  },
});
