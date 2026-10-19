/**
 * bolt env ensure: fill required gaps from an env.check probe.
 * Dry-run only builds a plan. Execute applies that plan after the hash matches
 * and the user confirms. This plan is not a workspace sync plan.
 *
 * An ensure handler marked studio_setup_shell, or one that does not report
 * gap fields on probe and data.changed on apply, is EMPTY_SHELL (exit 2).
 * A handler that calls an installer and returns data.changed true or false is kept.
 */
import type { BoltConfig } from "./config";
import type { EnvCheckDecl } from "./env-manifest";
import { resolveEnvManifest } from "./env-manifest";
import { callEnvHandler, indexEnvChecks, probeEnv, type EnvProbeCheck } from "./env-probe";
import { loadFanoutRegistry, observeContext } from "./doctor-why";
import type { HandlerResult } from "./handler-result";
import { issue, type JsonIssue } from "./json-envelope";
import { canonicalJson, sha256 } from "./plugin-cache";

export interface EnvPlanRow {
  id: string;
  action: "ensure" | "noop";
  will_change: boolean;
  reason?: string;
}

export interface EnvEnsureData {
  policy: "fill-gaps";
  dry_run: boolean;
  plan_hash: string;
  plan: EnvPlanRow[];
  changed: string[];
  noop: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; code: string }>;
  summary: { changed: number; noop: number; failed: number };
}

export interface EnvEnsureOutcome {
  exitCode: number;
  data: EnvEnsureData;
  warnings: JsonIssue[];
  errors: JsonIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Fill-gaps plan. Optional gaps and passes are noop. Required gaps will change. */
export function planFromProbe(
  checks: readonly EnvProbeCheck[],
  decls: readonly EnvCheckDecl[],
): EnvPlanRow[] {
  const required = new Map(decls.map((decl) => [decl.id, decl.require]));
  return checks.map((check) => {
    if (check.status === "pass") {
      return { id: check.id, action: "noop", will_change: false, reason: "already_satisfied" };
    }
    if (check.status === "skip") {
      return { id: check.id, action: "noop", will_change: false, reason: "skipped" };
    }
    if (required.get(check.id) === false) {
      return { id: check.id, action: "noop", will_change: false, reason: "not_required" };
    }
    return { id: check.id, action: "ensure", will_change: true };
  });
}

/** `sha256:` plus the hex digest of the canonical plan. */
export function hashEnvPlan(source: string, plan: readonly EnvPlanRow[]): string {
  const payload = {
    policy: "fill-gaps",
    source,
    plan: plan.map((row) => {
      const item: { id: string; action: string; will_change: boolean; reason?: string } = {
        id: row.id,
        action: row.action,
        will_change: row.will_change,
      };
      if (row.reason !== undefined) item.reason = row.reason;
      return item;
    }),
  };
  return `sha256:${sha256(canonicalJson(payload))}`;
}

export function emptyEnsureData(dryRun: boolean, source = "bolt.yaml#env"): EnvEnsureData {
  return {
    policy: "fill-gaps",
    dry_run: dryRun,
    plan_hash: hashEnvPlan(source, []),
    plan: [],
    changed: [],
    noop: [],
    failed: [],
    summary: { changed: 0, noop: 0, failed: 0 },
  };
}

export function settleEnsure(
  result: HandlerResult,
):
  | { kind: "changed" }
  | { kind: "noop"; reason: string }
  | { kind: "failed"; code: string; message: string } {
  const data = isRecord(result.data) ? result.data : undefined;
  if (result.status === "ok") {
    if (data?.changed === false) {
      const reason =
        typeof data.reason === "string" && data.reason.length > 0
          ? data.reason
          : "already_satisfied";
      return { kind: "noop", reason };
    }
    return { kind: "changed" };
  }
  if (result.status === "skipped") return { kind: "noop", reason: "skipped" };
  const code = result.diagnostics?.find((item) => item.code)?.code ?? "ENSURE_FAILED";
  return { kind: "failed", code, message: result.summary ?? code };
}

function counted(data: EnvEnsureData): EnvEnsureData {
  return {
    ...data,
    summary: { changed: data.changed.length, noop: data.noop.length, failed: data.failed.length },
  };
}

function emptyShellIssue(ref: string, marked: boolean): JsonIssue {
  if (marked) {
    return issue(
      "EMPTY_SHELL",
      `env.check handler "${ref}" is marked studio_setup_shell.`,
      "A one-shot setup script cannot fill environment gaps. Use a handler that reports current, expected, and data.changed.",
    );
  }
  return issue(
    "EMPTY_SHELL",
    `env.check "${ref}" has no gap or noop result.`,
    "Return current and expected from probe, and data.changed true or false from ensure.",
  );
}

/** Probe result carries structured gap fields. A skipped check counts as structured. */
export function probeResultHasGapSemantics(result: HandlerResult): boolean {
  const data = isRecord(result.data) ? result.data : undefined;
  if (data?.studio_setup_shell === true) return false;
  if (result.status === "skipped") return true;
  if (!data) return false;
  return "current" in data && "expected" in data;
}

/**
 * Ensure result can tell a change from a noop.
 * `data.changed` must be boolean. A skipped check counts. An explicit
 * `studio_setup_shell` flag does not, even when `changed` is set.
 */
export function ensureResultHasNoopSemantics(result: HandlerResult): boolean {
  const data = isRecord(result.data) ? result.data : undefined;
  if (data?.studio_setup_shell === true) return false;
  if (result.status === "skipped") return true;
  return typeof data?.changed === "boolean";
}

function firstUnstructured(
  checks: readonly { id: string }[],
  results: readonly HandlerResult[] | undefined,
): string | undefined {
  if (!results || results.length !== checks.length) return checks[0]?.id ?? "env.check";
  for (let i = 0; i < checks.length; i++) {
    if (!probeResultHasGapSemantics(results[i]!)) return checks[i]!.id;
  }
  return undefined;
}

/** Handler refs marked studio_setup_shell. Does not call the handlers. */
async function markedStudioShells(
  cfg: BoltConfig,
  configDir: string,
  checks: readonly EnvCheckDecl[],
): Promise<string[]> {
  if (checks.length === 0) return [];
  const registry = await loadFanoutRegistry(cfg, configDir);
  const providers = indexEnvChecks(registry);
  const refs: string[] = [];
  for (const decl of checks) {
    const provider = providers.get(decl.id);
    if (!provider) continue;
    const handler = registry.get(provider.namespace)?.manifest?.handlers[provider.handler];
    if (handler?.studio_setup_shell === true) refs.push(provider.ref);
  }
  return refs;
}

export async function ensureEnv(input: {
  cfg: BoltConfig;
  configDir: string;
  manifestPath?: string;
  execute: boolean;
  plan?: string;
  confirmedByUser: boolean;
}): Promise<EnvEnsureOutcome> {
  const resolved = resolveEnvManifest({
    env: input.cfg.env,
    configDir: input.configDir,
    manifestPath: input.manifestPath,
  });
  const marked = await markedStudioShells(input.cfg, input.configDir, resolved.checks);
  if (marked.length > 0) {
    return {
      exitCode: 2,
      data: emptyEnsureData(!input.execute, resolved.source),
      warnings: [],
      errors: marked.map((ref) => emptyShellIssue(ref, true)),
    };
  }

  const probe = await probeEnv({
    cfg: input.cfg,
    configDir: input.configDir,
    manifestPath: input.manifestPath,
  });
  const source = probe.data.manifest.source;
  if (probe.exitCode !== 0) {
    return {
      exitCode: probe.exitCode,
      data: emptyEnsureData(!input.execute, source),
      warnings: probe.warnings,
      errors: probe.errors,
    };
  }

  if (!resolved.empty) {
    const unstructured = firstUnstructured(probe.data.checks, probe.handlerResults);
    if (unstructured) {
      return {
        exitCode: 2,
        data: emptyEnsureData(!input.execute, source),
        warnings: probe.warnings,
        errors: [emptyShellIssue(unstructured, false)],
      };
    }
  }

  const plan = planFromProbe(probe.data.checks, resolved.checks);
  const planHash = hashEnvPlan(source, plan);
  const baseData = (): EnvEnsureData => ({
    policy: "fill-gaps",
    dry_run: !input.execute,
    plan_hash: planHash,
    plan,
    changed: [],
    noop: [],
    failed: [],
    summary: { changed: 0, noop: 0, failed: 0 },
  });

  if (!input.execute) {
    return { exitCode: 0, data: baseData(), warnings: probe.warnings, errors: [] };
  }
  if (input.plan !== planHash) {
    return {
      exitCode: 4,
      data: { ...baseData(), dry_run: false },
      warnings: probe.warnings,
      errors: [
        issue(
          "PLAN_MISMATCH",
          "The plan does not match --plan.",
          "Preview again with --dry-run and pass the new plan_hash.",
        ),
      ],
    };
  }
  if (!input.confirmedByUser) {
    return {
      exitCode: 4,
      data: { ...baseData(), dry_run: false },
      warnings: probe.warnings,
      errors: [
        issue(
          "CONFIRM_REQUIRED",
          "env ensure --execute needs --confirmed-by-user.",
          "Re-run with --confirmed-by-user after the user approves.",
        ),
      ],
    };
  }

  const registry = await loadFanoutRegistry(input.cfg, input.configDir);
  const providers = indexEnvChecks(registry);
  const context = observeContext(input.cfg, input.configDir);
  const data = baseData();
  data.dry_run = false;
  const warnings = [...probe.warnings];
  const errors: JsonIssue[] = [];
  for (const row of plan) {
    if (!row.will_change) {
      data.noop.push({ id: row.id, reason: row.reason ?? "already_satisfied" });
      continue;
    }
    const decl = resolved.checks.find((item) => item.id === row.id);
    const provider = providers.get(row.id);
    if (!decl || !provider) {
      data.failed.push({ id: row.id, code: "CHECK_UNKNOWN" });
      errors.push(issue("CHECK_UNKNOWN", `No env.check handler provides "${row.id}".`));
      continue;
    }
    const called = await callEnvHandler(registry, provider, decl, context, "ensure");
    if (!called.ok) {
      data.failed.push({ id: row.id, code: "ENSURE_FAILED" });
      errors.push(issue("ENSURE_FAILED", called.message));
      continue;
    }
    for (const warning of called.warnings) warnings.push(issue("RESULT_WARNING", warning));
    if (!ensureResultHasNoopSemantics(called.result)) {
      return {
        exitCode: 2,
        data: counted(data),
        warnings,
        errors: [...errors, emptyShellIssue(provider.ref, false)],
      };
    }
    const settled = settleEnsure(called.result);
    if (settled.kind === "changed") data.changed.push(row.id);
    else if (settled.kind === "noop") data.noop.push({ id: row.id, reason: settled.reason });
    else {
      data.failed.push({ id: row.id, code: settled.code });
      errors.push(issue(settled.code, settled.message));
    }
  }
  return {
    exitCode: data.failed.length > 0 ? 1 : 0,
    data: counted(data),
    warnings,
    errors,
  };
}
