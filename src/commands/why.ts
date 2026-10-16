import { defineCommand } from "citty";
import path from "path";
import pc from "picocolors";
import { loadProjectConfigOrExit } from "../project-config";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  loadConfigForJson,
  type JsonIssue,
} from "../json-envelope";
import {
  diagnoseParams,
  diagnosticsFromHandler,
  fanOutCapabilityWarning,
  fanOutRefs,
  invokeFanOut,
  loadFanoutRegistry,
  noDiagnoseProviders,
  observeContext,
  pickPrimary,
  resolveWhyLog,
  whyExit,
  whyNoSource,
  type WhyDiagnostic,
} from "../doctor-why";

function printHuman(
  log: { path: string; kind: string; run_id: string | null } | null,
  diagnostics: WhyDiagnostic[],
  primary: WhyDiagnostic | null,
): void {
  if (log) {
    console.log(`log: ${log.path} (${log.kind})`);
    console.log(`run: ${log.run_id ?? "(none)"}`);
  }
  if (!primary) {
    console.log("primary: (none)");
    return;
  }
  console.log(`primary: ${primary.code ?? primary.level}  ${primary.message}`);
  if (primary.fix) console.log(`  Fix: ${primary.fix}`);
  const rest = diagnostics.filter((item) => item !== primary);
  for (const item of rest) {
    console.log(`${item.level}  ${item.code ?? ""}  ${item.message}`.replace(/  +/g, "  "));
    if (item.fix) console.log(`  Fix: ${item.fix}`);
  }
}

export default defineCommand({
  meta: {
    name: "why",
    description: "Explain a failed run log with every built diagnose handler",
  },
  args: {
    runId: {
      type: "positional",
      required: false,
      description: "Run id under .bolt/logs. Default: the newest failed bolt_*.log",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.why/v1 JSON document on stdout",
    },
    log: {
      type: "string",
      description: "Read this log file instead of a run id or the newest failed run",
    },
    fail: {
      type: "boolean",
      default: false,
      description: "Exit 1 when any diagnostic is level error. Does not change the log",
    },
  },
  async run({ args }) {
    const json = Boolean(args?.json);
    if (json) installJsonStdoutGuard();
    const loaded = json
      ? await loadConfigForJson(JSON_SCHEMA.why)
      : await loadProjectConfigOrExit();
    const { configPath, cfg } = loaded;
    const configDir = path.dirname(configPath);
    const resolved = resolveWhyLog({
      configDir,
      logFlag: typeof args?.log === "string" ? args.log : undefined,
      runId: typeof args?.runId === "string" ? args.runId : undefined,
    });
    if (!resolved.ok) {
      const error = whyNoSource(resolved.message);
      const data = { run_id: null, log: null, diagnostics: [], primary: null };
      if (json) {
        emitJsonAndExit({
          schema: JSON_SCHEMA.why,
          exitCode: 1,
          config: configRef(configPath),
          data,
          errors: [error],
        });
      }
      console.log(pc.dim(`bolt.yaml: ${configPath}`));
      console.log(pc.red(`${error.code}: ${error.message}`));
      if (error.hint) console.log(`  ${error.hint}`);
      process.exit(1);
    }

    const registry = await loadFanoutRegistry(cfg, configDir);
    const matches = fanOutRefs(registry, cfg, "diagnose");
    const warnings: JsonIssue[] = [];
    const capability = fanOutCapabilityWarning(cfg.capabilities, "diagnose");
    if (capability) warnings.push(capability);
    if (matches.length === 0) warnings.push(noDiagnoseProviders());

    const invoked = await invokeFanOut(
      registry,
      matches,
      observeContext(cfg, configDir),
      diagnoseParams(resolved.log),
    );
    const diagnostics: WhyDiagnostic[] = [];
    for (const call of invoked.calls) {
      warnings.push(...call.warnings);
      diagnostics.push(...diagnosticsFromHandler(call.ref, call.result));
    }
    const primary = pickPrimary(diagnostics);
    const outcome = whyExit({
      fail: Boolean(args?.fail),
      diagnostics,
      failure: invoked.failure,
    });
    const data = {
      run_id: resolved.log.run_id,
      log: { path: resolved.log.path, kind: resolved.log.kind },
      diagnostics,
      primary,
    };
    if (json) {
      emitJsonAndExit({
        schema: JSON_SCHEMA.why,
        exitCode: outcome.exitCode,
        config: configRef(configPath),
        data,
        warnings,
        errors: outcome.errors,
      });
    }
    console.log(pc.dim(`bolt.yaml: ${configPath}`));
    for (const item of warnings) console.log(pc.yellow(`${item.code}: ${item.message}`));
    for (const item of outcome.errors) console.log(pc.red(`${item.code}: ${item.message}`));
    printHuman(resolved.log, diagnostics, primary);
    if (outcome.exitCode !== 0) process.exit(outcome.exitCode);
  },
});
