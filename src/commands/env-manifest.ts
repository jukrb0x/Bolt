import { defineCommand } from "citty";
import pc from "picocolors";
import {
  ManifestError,
  resolveEnvManifest,
  toEnvManifestData,
  type EnvCheckDecl,
  type EnvManifestData,
} from "../env-manifest";
import { envNoManifestWarning, manifestErrorOutcome, projectRoot } from "../env-probe";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  loadConfigForJson,
  type JsonIssue,
} from "../json-envelope";
import { loadProjectConfigOrExit } from "../project-config";

function printCheck(check: EnvCheckDecl): void {
  const version = check.version ? `  version=${check.version}` : "";
  console.log(`${check.id}  require=${check.require ? "true" : "false"}${version}`);
}

function printHuman(
  configPath: string,
  data: EnvManifestData,
  warnings: JsonIssue[],
  errors: JsonIssue[],
): void {
  console.log(pc.dim(`bolt.yaml: ${configPath}`));
  console.log(`manifest: ${data.source}  checks_declared: ${data.checks_declared}`);
  for (const item of warnings) console.log(pc.yellow(`${item.code}: ${item.message}`));
  for (const item of errors) console.log(pc.red(`${item.code}: ${item.message}`));
  for (const check of data.checks) printCheck(check);
}

function finish(
  json: boolean,
  configPath: string,
  exitCode: number,
  data: EnvManifestData,
  warnings: JsonIssue[],
  errors: JsonIssue[],
): void {
  if (json) {
    emitJsonAndExit({
      schema: JSON_SCHEMA.envManifest,
      exitCode,
      config: configRef(configPath),
      data,
      warnings,
      errors,
    });
  }
  printHuman(configPath, data, warnings, errors);
  if (exitCode !== 0) process.exit(exitCode);
}

export default defineCommand({
  meta: {
    name: "manifest",
    description: "Print the effective environment manifest",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.env.manifest/v1 JSON document on stdout",
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
      ? await loadConfigForJson(JSON_SCHEMA.envManifest)
      : await loadProjectConfigOrExit();
    const { configPath, cfg } = loaded;
    const manifestFlag = typeof args?.manifest === "string" ? args.manifest : undefined;
    const source = manifestFlag ?? cfg.env?.manifest ?? "bolt.yaml#env";
    try {
      const resolved = resolveEnvManifest({
        env: cfg.env,
        configDir: projectRoot(configPath),
        manifestPath: manifestFlag,
      });
      const data = toEnvManifestData(resolved);
      finish(json, configPath, 0, data, resolved.empty ? [envNoManifestWarning()] : [], []);
    } catch (error) {
      if (!(error instanceof ManifestError)) throw error;
      const failed = manifestErrorOutcome(error, source);
      const data = toEnvManifestData({ source, checks: [], empty: true });
      finish(json, configPath, failed.exitCode, data, failed.warnings, failed.errors);
    }
  },
});
