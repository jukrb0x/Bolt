import { defineCommand } from "citty";
import path from "path";
import pc from "picocolors";
import { loadProjectConfigOrExit } from "../project-config";
import {
  JSON_SCHEMA,
  configRef,
  emitJsonAndExit,
  installJsonStdoutGuard,
  issue,
  loadConfigForJson,
  type JsonIssue,
} from "../json-envelope";
import {
  checksFromHandler,
  doctorExit,
  fanOutCapabilityWarning,
  fanOutRefs,
  filterChecks,
  invokeFanOut,
  loadFanoutRegistry,
  noDoctorProviders,
  observeContext,
  summarizeChecks,
  type DoctorCheck,
} from "../doctor-why";

function printHuman(checks: DoctorCheck[], summary: ReturnType<typeof summarizeChecks>): void {
  const notable = checks.filter((check) => check.level === "error" || check.level === "warn");
  const rest = checks.filter((check) => check.level === "pass" || check.level === "info");
  for (const check of [...notable, ...rest]) {
    const color = check.level === "error" ? pc.red : check.level === "warn" ? pc.yellow : pc.green;
    console.log(`${color(check.level.padEnd(5))} ${check.id}  ${check.message}`);
    if (check.fix && (check.level === "error" || check.level === "warn")) {
      console.log(`  Fix: ${check.fix}`);
    }
  }
  console.log(
    `summary: pass ${summary.pass}, info ${summary.info}, warn ${summary.warn}, error ${summary.error}`,
  );
}

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Run every built doctor handler and print checks",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "Print one bolt.doctor/v1 JSON document on stdout",
    },
    fix: {
      type: "boolean",
      default: false,
      description: "Exit 1 when any check is level error. Does not edit files",
    },
    only: {
      type: "string",
      description: "Keep checks whose id equals this or starts with this and a dot",
    },
  },
  async run({ args }) {
    const json = Boolean(args?.json);
    if (json) installJsonStdoutGuard();
    const loaded = json
      ? await loadConfigForJson(JSON_SCHEMA.doctor)
      : await loadProjectConfigOrExit();
    const { configPath, cfg } = loaded;
    const configDir = path.dirname(configPath);
    const registry = await loadFanoutRegistry(cfg, configDir);
    const matches = fanOutRefs(registry, cfg, "doctor");
    const warnings: JsonIssue[] = [];
    const capability = fanOutCapabilityWarning(cfg.capabilities, "doctor");
    if (capability) warnings.push(capability);
    if (matches.length === 0) warnings.push(noDoctorProviders());

    const invoked = await invokeFanOut(registry, matches, observeContext(cfg, configDir), {});
    let checks: DoctorCheck[] = [];
    for (const call of invoked.calls) {
      warnings.push(...call.warnings);
      const mapped = checksFromHandler(call.ref, call.result);
      warnings.push(...mapped.warnings);
      checks.push(...mapped.checks);
    }
    const only = typeof args?.only === "string" ? args.only : undefined;
    const filtered = filterChecks(checks, only);
    checks = filtered.checks;
    if (filtered.unknown) {
      warnings.push(
        issue("DOCTOR_ONLY_UNKNOWN", `No check id matches --only=${only}.`, "bolt doctor --json"),
      );
    }
    const summary = summarizeChecks(checks);
    const outcome = doctorExit({ fix: Boolean(args?.fix), summary, failure: invoked.failure });
    if (json) {
      emitJsonAndExit({
        schema: JSON_SCHEMA.doctor,
        exitCode: outcome.exitCode,
        config: configRef(configPath),
        data: { checks, summary },
        warnings,
        errors: outcome.errors,
      });
    }
    console.log(pc.dim(`bolt.yaml: ${configPath}`));
    for (const item of warnings) {
      console.log(pc.yellow(`${item.code}: ${item.message}`));
    }
    for (const item of outcome.errors) console.log(pc.red(`${item.code}: ${item.message}`));
    printHuman(checks, summary);
    if (outcome.exitCode !== 0) process.exit(outcome.exitCode);
  },
});
