/**
 * bolt env probe: resolve declared checks through capability `env.check`.
 * A gap is data, not a failed command. This module does not install tools.
 */
import path from "path";
import { ENV_CHECK_CAPABILITY } from "./capabilities";
import type { BoltConfig } from "./config";
import { fanOutCapabilityWarning, loadFanoutRegistry, observeContext } from "./doctor-why";
import {
  resolveEnvManifest,
  ManifestError,
  type EnvCheckDecl,
  type ResolvedEnvManifest,
} from "./env-manifest";
import { validateHandlerResult, type HandlerResult, type HandlerStatus } from "./handler-result";
import { issue, type JsonIssue } from "./json-envelope";
import type { BoltPluginContext, EnvCheckContext } from "./plugin";
import { PluginRegistry, type CapabilityMatch } from "./plugin-registry";

export type EnvStatus = "pass" | "fail" | "warn" | "skip";

export interface EnvProbeCheck {
  id: string;
  status: EnvStatus;
  current: string | null;
  expected: string;
  fix: string | null;
  source: string;
}

export interface EnvGap {
  id: string;
  status: "fail" | "warn";
  current: string | null;
  expected: string;
  fix: string | null;
}

export interface EnvSummary {
  pass: number;
  fail: number;
  warn: number;
  skip: number;
}

export interface EnvProbeData {
  manifest: { source: string; checks_declared: number };
  checks: EnvProbeCheck[];
  gaps: EnvGap[];
  summary: EnvSummary;
}

export interface EnvProbeOutcome {
  exitCode: number;
  data: EnvProbeData;
  warnings: JsonIssue[];
  errors: JsonIssue[];
  /** Raw handler results in declaration order. Set only when every check was called. */
  handlerResults?: HandlerResult[];
}

export interface EnvProvider {
  ref: string;
  namespace: string;
  handler: string;
}

export function emptyProbeData(source: string, checksDeclared = 0): EnvProbeData {
  return {
    manifest: { source, checks_declared: checksDeclared },
    checks: [],
    gaps: [],
    summary: { pass: 0, fail: 0, warn: 0, skip: 0 },
  };
}

export function summarizeEnv(checks: readonly EnvProbeCheck[]): EnvSummary {
  const summary: EnvSummary = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const check of checks) summary[check.status] += 1;
  return summary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function probeStatus(status: HandlerStatus, require: boolean): EnvStatus {
  if (status === "ok") return "pass";
  if (status === "skipped") return "skip";
  if (status === "warn") return "warn";
  return require ? "fail" : "warn";
}

/** Map one handler result onto a probe row. `require: false` turns fail into warn. */
export function checkFromHandler(
  decl: EnvCheckDecl,
  namespace: string,
  result: HandlerResult,
): EnvProbeCheck {
  const status = probeStatus(result.status, decl.require);
  const data = isRecord(result.data) ? result.data : undefined;
  const current =
    data && "current" in data
      ? data.current === null
        ? null
        : (readText(data.current) ?? null)
      : null;
  const expected = (data && readText(data.expected)) || decl.version || "present";
  let fix: string | null = null;
  if (data && "fix" in data) {
    fix = data.fix === null ? null : (readText(data.fix) ?? null);
  } else if (status === "fail" || status === "warn") {
    fix = result.summary ?? null;
  }
  return {
    id: decl.id,
    status,
    current,
    expected,
    fix,
    source: `plugin:${namespace}`,
  };
}

function toGap(check: EnvProbeCheck): EnvGap {
  return {
    id: check.id,
    status: check.status === "warn" ? "warn" : "fail",
    current: check.current,
    expected: check.expected,
    fix: check.fix,
  };
}

export function probeData(
  source: string,
  checksDeclared: number,
  checks: EnvProbeCheck[],
): EnvProbeData {
  return {
    manifest: { source, checks_declared: checksDeclared },
    checks,
    gaps: checks.filter((check) => check.status === "fail" || check.status === "warn").map(toGap),
    summary: summarizeEnv(checks),
  };
}

/** Handlers tagged `env.check`, keyed by the stable id on the manifest. */
export function indexEnvChecks(registry: PluginRegistry): Map<string, EnvProvider> {
  const matches: CapabilityMatch[] = registry.findByCapability(ENV_CHECK_CAPABILITY);
  const index = new Map<string, EnvProvider>();
  for (const match of matches) {
    const checkId = registry.get(match.namespace)?.manifest?.handlers[match.handler]?.checkId;
    if (!checkId) continue;
    const prev = index.get(checkId);
    if (prev) {
      throw new ManifestError(`check id "${checkId}" is provided by ${prev.ref} and ${match.ref}`);
    }
    index.set(checkId, { ref: match.ref, namespace: match.namespace, handler: match.handler });
  }
  return index;
}

function envCheckContext(decl: EnvCheckDecl, action?: "ensure"): EnvCheckContext {
  const ctx: EnvCheckContext = { id: decl.id, require: decl.require };
  if (decl.version !== undefined) ctx.version = decl.version;
  if (decl.params !== undefined) ctx.params = decl.params;
  if (action === "ensure") ctx.action = "ensure";
  return ctx;
}

/** Run one `env.check` handler. `action: "ensure"` is set only for a real ensure apply. */
export async function callEnvHandler(
  registry: PluginRegistry,
  provider: EnvProvider,
  decl: EnvCheckDecl,
  base: BoltPluginContext,
  action?: "ensure",
): Promise<
  { ok: true; result: HandlerResult; warnings: string[] } | { ok: false; message: string }
> {
  const plugin = registry.get(provider.namespace);
  const handler = plugin?.handlers[provider.handler];
  if (!plugin || !handler) return { ok: false, message: `Unknown handler "${provider.ref}".` };
  let returned: unknown;
  try {
    returned = await handler({}, { ...base, envCheck: envCheckContext(decl, action) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
  try {
    const validated = validateHandlerResult(returned, provider.ref);
    return { ok: true, result: validated.result, warnings: validated.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
}

export function envNoManifestWarning(): JsonIssue {
  return issue(
    "ENV_NO_MANIFEST",
    "No environment checks are declared.",
    "Add env.checks to bolt.yaml, or pass --manifest with a path relative to the project root.",
  );
}

export function checkUnknown(id: string): JsonIssue {
  return issue(
    "CHECK_UNKNOWN",
    `No env.check handler provides "${id}".`,
    `Add a plugin handler with capability "${ENV_CHECK_CAPABILITY}" and checkId "${id}".`,
  );
}

export async function probeEnv(input: {
  cfg: BoltConfig;
  configDir: string;
  manifestPath?: string;
}): Promise<EnvProbeOutcome> {
  const resolved: ResolvedEnvManifest = resolveEnvManifest({
    env: input.cfg.env,
    configDir: input.configDir,
    manifestPath: input.manifestPath,
  });
  const warnings: JsonIssue[] = [];
  const capability = fanOutCapabilityWarning(input.cfg.capabilities, ENV_CHECK_CAPABILITY);
  if (capability) warnings.push(capability);
  if (resolved.empty) {
    return {
      exitCode: 0,
      data: emptyProbeData(resolved.source),
      warnings: [...warnings, envNoManifestWarning()],
      errors: [],
    };
  }

  const registry = await loadFanoutRegistry(input.cfg, input.configDir);
  const providers = indexEnvChecks(registry);
  const missing = resolved.checks.filter((check) => !providers.has(check.id));
  if (missing.length > 0) {
    return {
      exitCode: 3,
      data: emptyProbeData(resolved.source, resolved.checks.length),
      warnings,
      errors: missing.map((check) => checkUnknown(check.id)),
    };
  }

  const base = observeContext(input.cfg, input.configDir);
  const checks: EnvProbeCheck[] = [];
  const handlerResults: HandlerResult[] = [];
  for (const decl of resolved.checks) {
    const provider = providers.get(decl.id)!;
    const called = await callEnvHandler(registry, provider, decl, base);
    if (!called.ok) {
      return {
        exitCode: 1,
        data: probeData(resolved.source, resolved.checks.length, checks),
        warnings,
        errors: [issue("RUN_FAILED", called.message)],
      };
    }
    for (const warning of called.warnings) warnings.push(issue("RESULT_WARNING", warning));
    handlerResults.push(called.result);
    checks.push(checkFromHandler(decl, provider.namespace, called.result));
  }

  return {
    exitCode: 0,
    data: probeData(resolved.source, resolved.checks.length, checks),
    warnings,
    errors: [],
    handlerResults,
  };
}

export function manifestErrorOutcome(
  error: ManifestError,
  source = "bolt.yaml#env",
): EnvProbeOutcome {
  return {
    exitCode: error.exitCode,
    data: emptyProbeData(source),
    warnings: [],
    errors: [issue(error.code, error.message, error.hint)],
  };
}

/** Project root is the directory that contains bolt.yaml. */
export function projectRoot(configPath: string): string {
  return path.dirname(configPath);
}
