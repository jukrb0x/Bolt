import { defineCommand } from "citty";
import pc from "picocolors";
import { findConfig } from "../discover";
import { ManifestError } from "../env-manifest";
import {
  emptyEnsureData,
  ensureEnv,
  type EnvEnsureData,
  type EnvEnsureOutcome,
} from "../env-ensure";
import { projectRoot } from "../env-probe";
import { USAGE_EXIT_CODE } from "../exit-codes";
import { issue } from "../json-envelope";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  loadConfigForJson,
} from "../json-envelope";
import { loadProjectConfigOrExit } from "../project-config";
import { printUsageError } from "../strict-args";

function usageProblem(args: Record<string, unknown> | undefined): string | undefined {
  const dryRun = args?.["dry-run"] === true;
  const execute = args?.execute === true;
  const confirmed = args?.["confirmed-by-user"] === true;
  const plan = typeof args?.plan === "string" && args.plan.length > 0 ? args.plan : undefined;
  if (dryRun && execute) return "--dry-run and --execute cannot be combined.";
  if (!dryRun && !execute) return "bolt env ensure needs --dry-run or --execute.";
  if (dryRun && plan !== undefined) {
    return "--dry-run does not take --plan. Drop --plan, or pass --execute --plan=<plan_hash>.";
  }
  if (dryRun && confirmed) return "--confirmed-by-user is only valid with --execute.";
  if (execute && plan === undefined) {
    return "--execute requires --plan=<plan_hash> from bolt env ensure --dry-run.";
  }
  return undefined;
}

function printHuman(configPath: string, outcome: EnvEnsureOutcome): void {
  const data = outcome.data;
  console.log(pc.dim(`bolt.yaml: ${configPath}`));
  console.log(`policy: ${data.policy}`);
  console.log(`dry_run: ${data.dry_run ? "true" : "false"}`);
  console.log(`plan_hash: ${data.plan_hash}`);
  for (const item of outcome.warnings) console.log(pc.yellow(`${item.code}: ${item.message}`));
  for (const item of outcome.errors) console.log(pc.red(`${item.code}: ${item.message}`));
  for (const row of data.plan) {
    const reason = row.reason ? `  ${row.reason}` : "";
    console.log(`${row.action.padEnd(6)} ${row.id}${reason}`);
  }
  if (!data.dry_run) {
    console.log(`changed: ${data.changed.length === 0 ? "(none)" : data.changed.join(", ")}`);
    for (const row of data.noop) console.log(`noop ${row.id}  ${row.reason}`);
    for (const row of data.failed) console.log(pc.red(`failed ${row.id}  ${row.code}`));
  }
  const summary = data.summary;
  console.log(
    `summary: changed ${summary.changed}, noop ${summary.noop}, failed ${summary.failed}`,
  );
}

function finish(json: boolean, configPath: string, outcome: EnvEnsureOutcome): void {
  if (json) {
    emitJsonAndExit({
      schema: JSON_SCHEMA.envEnsure,
      exitCode: outcome.exitCode,
      config: configRef(configPath),
      data: outcome.data,
      warnings: outcome.warnings,
      errors: outcome.errors,
    });
  }
  printHuman(configPath, outcome);
  if (outcome.exitCode !== 0) process.exit(outcome.exitCode);
}

export default defineCommand({
  meta: {
    name: "ensure",
    description:
      "Fill required environment gaps. Dry-run prints a plan and plan_hash. Execute needs that hash and --confirmed-by-user",
  },
  args: {
    "dry-run": {
      type: "boolean",
      default: false,
      description: "Print the fill-gaps plan and plan_hash. Does not change this machine",
    },
    execute: {
      type: "boolean",
      default: false,
      description: "Apply a dry-run plan. Requires --plan and --confirmed-by-user",
    },
    plan: {
      type: "string",
      description: "plan_hash from bolt env ensure --dry-run",
    },
    "confirmed-by-user": {
      type: "boolean",
      default: false,
      description: "User approved this plan. Required with --execute",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.env.ensure/v1 JSON document on stdout",
    },
    manifest: {
      type: "string",
      description: "External manifest path relative to the project root",
    },
  },
  async run({ args }) {
    const json = args?.json === true;
    const problem = usageProblem(args as Record<string, unknown> | undefined);
    if (problem) {
      if (json) {
        installJsonStdoutGuard();
        const data: EnvEnsureData = emptyEnsureData(false);
        emitJsonAndExit({
          schema: JSON_SCHEMA.envEnsure,
          exitCode: USAGE_EXIT_CODE,
          config: configRef(await findConfig(process.cwd())),
          data,
          errors: [issue("USAGE", problem)],
        });
      }
      printUsageError(problem);
      process.exit(USAGE_EXIT_CODE);
    }
    if (json) installJsonStdoutGuard();
    const loaded = json
      ? await loadConfigForJson(JSON_SCHEMA.envEnsure)
      : await loadProjectConfigOrExit();
    const { configPath, cfg } = loaded;
    const manifestFlag = typeof args?.manifest === "string" ? args.manifest : undefined;
    const execute = args?.execute === true;
    let outcome: EnvEnsureOutcome;
    try {
      outcome = await ensureEnv({
        cfg,
        configDir: projectRoot(configPath),
        manifestPath: manifestFlag,
        execute,
        plan: typeof args?.plan === "string" ? args.plan : undefined,
        confirmedByUser: args?.["confirmed-by-user"] === true,
      });
    } catch (error) {
      if (!(error instanceof ManifestError)) throw error;
      outcome = {
        exitCode: error.exitCode,
        data: emptyEnsureData(!execute, manifestFlag ?? cfg.env?.manifest ?? "bolt.yaml#env"),
        warnings: [],
        errors: [issue(error.code, error.message, error.hint)],
      };
    }
    finish(json, configPath, outcome);
  },
});
