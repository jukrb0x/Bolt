import { defineCommand } from "citty";
import pc from "picocolors";
import { ManifestError } from "../env-manifest";
import {
  manifestErrorOutcome,
  probeEnv,
  projectRoot,
  type EnvProbeCheck,
  type EnvProbeOutcome,
} from "../env-probe";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  loadConfigForJson,
} from "../json-envelope";
import { loadProjectConfigOrExit } from "../project-config";

function printCheck(check: EnvProbeCheck): void {
  const color =
    check.status === "fail"
      ? pc.red
      : check.status === "warn"
        ? pc.yellow
        : check.status === "skip"
          ? pc.dim
          : pc.green;
  const current = check.current === null ? "null" : check.current;
  console.log(
    `${color(check.status.padEnd(4))} ${check.id}  current=${current}  expected=${check.expected}`,
  );
  if (check.fix && (check.status === "fail" || check.status === "warn")) {
    console.log(`  Fix: ${check.fix}`);
  }
}

function printHuman(configPath: string, outcome: EnvProbeOutcome): void {
  console.log(pc.dim(`bolt.yaml: ${configPath}`));
  console.log(
    pc.dim(
      `manifest: ${outcome.data.manifest.source}  checks_declared: ${outcome.data.manifest.checks_declared}`,
    ),
  );
  for (const item of outcome.warnings) console.log(pc.yellow(`${item.code}: ${item.message}`));
  for (const item of outcome.errors) console.log(pc.red(`${item.code}: ${item.message}`));
  for (const check of outcome.data.checks) printCheck(check);
  const summary = outcome.data.summary;
  console.log(
    `summary: pass ${summary.pass}, fail ${summary.fail}, warn ${summary.warn}, skip ${summary.skip}`,
  );
}

function finish(json: boolean, configPath: string, outcome: EnvProbeOutcome): void {
  if (json) {
    emitJsonAndExit({
      schema: JSON_SCHEMA.envProbe,
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
    name: "probe",
    description: "Compare declared environment checks with this machine and print gaps",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.env.probe/v1 JSON document on stdout",
    },
    manifest: {
      type: "string",
      description: "External manifest path relative to the project root",
    },
  },
  async run({ args }) {
    const json = Boolean(args?.json);
    if (json) installJsonStdoutGuard();
    const loaded = json
      ? await loadConfigForJson(JSON_SCHEMA.envProbe)
      : await loadProjectConfigOrExit();
    const { configPath, cfg } = loaded;
    const manifestFlag = typeof args?.manifest === "string" ? args.manifest : undefined;
    let outcome: EnvProbeOutcome;
    try {
      outcome = await probeEnv({
        cfg,
        configDir: projectRoot(configPath),
        manifestPath: manifestFlag,
      });
    } catch (error) {
      if (!(error instanceof ManifestError)) throw error;
      outcome = manifestErrorOutcome(error, manifestFlag ?? cfg.env?.manifest ?? "bolt.yaml#env");
    }
    finish(json, configPath, outcome);
  },
});
