/**
 * Workspace model, plan aggregation, and sync policy (BOLT-A1a / A1b).
 * Core stores the model and orders roots. A plugin tagged `vcs.revision`
 * supplies the plan row and, on execute, performs the work-tree update.
 */
import { existsSync } from "fs";
import path from "path";
import { z } from "zod";
import { validateHandlerResult, type HandlerResult } from "./handler-result";
import type { BoltPluginContext, BoltPluginHandler } from "./plugin";
import type { PluginRegistry } from "./plugin-registry";

export const SYNC_POLICIES = ["one-side-safe", "together", "pin-rev"] as const;
export type SyncPolicy = (typeof SYNC_POLICIES)[number];

export const WORKSPACE_ROLES = ["engine", "project", "related"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface WorkspaceRoot {
  id: string;
  /** Path as written in bolt.yaml. Relative to the bolt.yaml directory, or absolute. */
  path: string;
  role: WorkspaceRole;
  vcs: string;
  pin: string | null;
}

export interface WorkspaceConfig {
  roots: WorkspaceRoot[];
  sync_policy: SyncPolicy;
}

export interface PlanRow {
  root: string;
  action: string;
  target_rev: string;
  will_touch: boolean;
}

export interface FailedRoot {
  root: string;
  code: string;
}

export interface WorkspaceSyncData {
  policy: SyncPolicy;
  plan: PlanRow[];
}

/** Execute payload. `plan` is the same row shape dry-run returns. */
export interface WorkspaceSyncResult extends WorkspaceSyncData {
  touched: string[];
  frozen: string[];
  failed: FailedRoot[];
}

export type WorkspaceErrorCode = "WORKSPACE_INVALID" | "ROOT_MISSING" | "POLICY_UNKNOWN";

export class WorkspaceConfigError extends Error {
  readonly exitCode = 3;
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "WorkspaceConfigError";
  }
}

/** Revision resolve failed. Exit 1. The work tree was not updated. */
export class WorkspacePlanError extends Error {
  readonly exitCode = 1;
  constructor(
    message: string,
    readonly code = "VCS_REVISION",
  ) {
    super(message);
    this.name = "WorkspacePlanError";
  }
}

/** A real sync reached the work tree and then failed. Exit 1. `data` keeps this run's plan. */
export class WorkspaceSyncError extends Error {
  readonly exitCode = 1;
  readonly code: string;
  constructor(
    readonly data: WorkspaceSyncResult,
    readonly issues: Array<{ code: string; message: string }>,
  ) {
    super(issues[0]?.message ?? "workspace sync failed");
    this.name = "WorkspaceSyncError";
    this.code = issues[0]?.code ?? "VCS_SYNC";
  }
}

export function isSyncPolicy(value: string): value is SyncPolicy {
  return (SYNC_POLICIES as readonly string[]).includes(value);
}

const WorkspaceRootSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    role: z.enum(WORKSPACE_ROLES),
    vcs: z.string().min(1),
    pin: z.string().min(1).nullable().optional(),
  })
  .strict();

export const WorkspaceSchema = z
  .object({
    roots: z.array(WorkspaceRootSchema).min(1),
    sync_policy: z.string().superRefine((value, ctx) => {
      if (isSyncPolicy(value)) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unknown sync_policy "${value}". Expected one-side-safe, together, or pin-rev.`,
        params: { boltCode: "POLICY_UNKNOWN" },
      });
    }),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.roots.forEach((root, index) => {
      if (seen.has(root.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roots", index, "id"],
          message: `duplicate root id "${root.id}"`,
        });
      }
      seen.add(root.id);
    });
  });

export function workspaceFromParsed(value: z.infer<typeof WorkspaceSchema>): WorkspaceConfig {
  if (!isSyncPolicy(value.sync_policy)) {
    throw new WorkspaceConfigError(
      "POLICY_UNKNOWN",
      `unknown sync_policy "${value.sync_policy}". Expected one-side-safe, together, or pin-rev.`,
    );
  }
  return {
    sync_policy: value.sync_policy,
    roots: value.roots.map((root) => ({
      id: root.id,
      path: root.path,
      role: root.role,
      vcs: root.vcs,
      pin: root.pin ?? null,
    })),
  };
}

type ZodLikeIssue = {
  path: Array<PropertyKey>;
  code: string;
  params?: unknown;
};

/** Map a bolt.yaml Zod issue onto a workspace code, or undefined when it is not one. */
export function codeForZodIssue(
  issue: ZodLikeIssue,
): "WORKSPACE_INVALID" | "POLICY_UNKNOWN" | undefined {
  if (issue.path[0] !== "workspace") return undefined;
  const params = issue.params;
  if (
    params &&
    typeof params === "object" &&
    (params as { boltCode?: unknown }).boltCode === "POLICY_UNKNOWN"
  ) {
    return "POLICY_UNKNOWN";
  }
  return "WORKSPACE_INVALID";
}

export function formatZodConfigError(issues: readonly ZodLikeIssue[], message: string): Error {
  const codes = issues.map((issue) => codeForZodIssue(issue));
  if (
    codes.length > 0 &&
    codes.every((code) => code === "WORKSPACE_INVALID" || code === "POLICY_UNKNOWN")
  ) {
    return new WorkspaceConfigError(codes[0] ?? "WORKSPACE_INVALID", message);
  }
  return new Error(message);
}

/** Absolute path for a root. Relative paths resolve from the bolt.yaml directory. */
export function resolveRootPath(rootPath: string, configDir: string): string {
  return path.resolve(configDir, rootPath);
}

function missingRootMessage(root: WorkspaceRoot, resolved: string): string {
  return `Root "${root.id}" path "${root.path}" does not exist (${resolved}).`;
}

const PLAN_KEYS = ["root", "action", "target_rev", "will_touch"] as const;

export function formatWorkspacePlan(
  data: WorkspaceSyncData & Partial<Pick<WorkspaceSyncResult, "touched" | "frozen" | "failed">>,
): string {
  const rows = data.plan.map((row) => ({
    root: row.root,
    action: row.action,
    target_rev: row.target_rev,
    will_touch: row.will_touch ? "true" : "false",
  }));
  const widths = Object.fromEntries(
    PLAN_KEYS.map((key) => [key, Math.max(key.length, ...rows.map((row) => row[key].length))]),
  ) as Record<(typeof PLAN_KEYS)[number], number>;
  const line = (row: Record<(typeof PLAN_KEYS)[number], string>) =>
    PLAN_KEYS.map((key) => row[key].padEnd(widths[key]))
      .join("  ")
      .trimEnd();
  const lines = [
    `policy: ${data.policy}`,
    line({
      root: "root",
      action: "action",
      target_rev: "target_rev",
      will_touch: "will_touch",
    }),
    ...rows.map((row) => line(row)),
  ];
  if (data.touched) {
    lines.push(labeled("touched", data.touched));
    lines.push(labeled("frozen", data.frozen ?? []));
    lines.push(
      labeled(
        "failed",
        (data.failed ?? []).map((item) => `${item.root} ${item.code}`),
      ),
    );
  }
  return lines.join("\n");
}

function labeled(name: string, values: readonly string[]): string {
  return values.length === 0 ? `${name}:` : `${name}: ${values.join(", ")}`;
}

const VCS_CODE = /^VCS_[A-Z0-9_]*$/;

function planRow(rootId: string, data: unknown, ref: string): PlanRow {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new WorkspacePlanError(`${ref} returned no plan data for root "${rootId}".`);
  }
  const record = data as Record<string, unknown>;
  const { action, target_rev, will_touch } = record;
  if (typeof action !== "string" || action === "") {
    throw new WorkspacePlanError(`${ref} plan data for root "${rootId}" needs action.`);
  }
  if (typeof target_rev !== "string" || target_rev === "") {
    throw new WorkspacePlanError(`${ref} plan data for root "${rootId}" needs target_rev.`);
  }
  if (typeof will_touch !== "boolean") {
    throw new WorkspacePlanError(`${ref} plan data for root "${rootId}" needs will_touch.`);
  }
  return { root: rootId, action, target_rev, will_touch };
}

function failureCode(result: HandlerResult, fallback: string): string {
  for (const item of result.diagnostics ?? []) {
    if (item.code && VCS_CODE.test(item.code)) return item.code;
  }
  return fallback;
}

function failureMessage(result: HandlerResult, ref: string, rootId: string): string {
  return (
    result.summary ||
    result.diagnostics?.find((item) => item.message)?.message ||
    `${ref} failed for root "${rootId}".`
  );
}

interface RevisionBinding {
  ref: string;
  handler: BoltPluginHandler;
}

function revisionBinding(root: WorkspaceRoot, registry: PluginRegistry): RevisionBinding {
  const match = registry
    .findByCapability("vcs.revision")
    .find((item) => item.namespace === root.vcs);
  const plugin = registry.get(root.vcs);
  const handler = match ? plugin?.handlers[match.handler] : undefined;
  if (!match || !plugin || !handler) {
    throw new WorkspacePlanError(
      `No vcs.revision handler for root "${root.id}" (vcs ${root.vcs}).`,
    );
  }
  if (plugin.apiVersion !== 2) {
    throw new WorkspacePlanError(
      `${match.ref} must declare apiVersion 2 to return a workspace plan row.`,
    );
  }
  return { ref: match.ref, handler };
}

type RevisionPhase = "plan" | "precheck" | "sync";

interface RevisionOk {
  ok: true;
  result: HandlerResult;
}

interface RevisionFail {
  ok: false;
  code: string;
  message: string;
}

function revisionParams(
  root: WorkspaceRoot,
  resolved: string,
  policy: SyncPolicy,
  phase: RevisionPhase,
  row?: PlanRow,
): Record<string, string> {
  const params: Record<string, string> = {
    id: root.id,
    path: resolved,
    role: root.role,
    vcs: root.vcs,
    pin: root.pin ?? "",
    policy,
    phase,
  };
  if (row) {
    params.action = row.action;
    params.target_rev = row.target_rev;
    params.will_touch = row.will_touch ? "true" : "false";
  }
  return params;
}

async function callRevision(
  root: WorkspaceRoot,
  resolved: string,
  policy: SyncPolicy,
  phase: RevisionPhase,
  binding: RevisionBinding,
  ctx: BoltPluginContext,
  row?: PlanRow,
): Promise<RevisionOk | RevisionFail> {
  const fallback = phase === "plan" ? "VCS_REVISION" : "VCS_SYNC";
  let returned: unknown;
  try {
    returned = await binding.handler(revisionParams(root, resolved, policy, phase, row), ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: fallback,
      message: `${binding.ref} failed for root "${root.id}": ${message}`,
    };
  }
  let validated: ReturnType<typeof validateHandlerResult>;
  try {
    validated = validateHandlerResult(returned, binding.ref);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, code: fallback, message };
  }
  const result = validated.result;
  if (result.status !== "ok" && result.status !== "warn") {
    return {
      ok: false,
      code: failureCode(result, fallback),
      message: failureMessage(result, binding.ref, root.id),
    };
  }
  return { ok: true, result };
}

function requireRoot(root: WorkspaceRoot, configDir: string): string {
  const resolved = resolveRootPath(root.path, configDir);
  if (!existsSync(resolved)) {
    throw new WorkspaceConfigError(
      "ROOT_MISSING",
      missingRootMessage(root, resolved),
      `Fix workspace.roots path for "${root.id}". A path is relative to the bolt.yaml directory, or absolute. bolt.local.yaml does not change it.`,
    );
  }
  return resolved;
}

/**
 * Aggregate one plan row per root, in config order.
 * `pin-rev` omits a root whose pin is null. `phase=plan` does not update a work tree.
 */
export async function planWorkspaceSync(
  workspace: WorkspaceConfig,
  configDir: string,
  registry: PluginRegistry,
  ctx: BoltPluginContext,
): Promise<WorkspaceSyncData> {
  const plan: PlanRow[] = [];
  for (const root of workspace.roots) {
    const resolved = requireRoot(root, configDir);
    if (workspace.sync_policy === "pin-rev" && root.pin === null) continue;
    const binding = revisionBinding(root, registry);
    const outcome = await callRevision(root, resolved, workspace.sync_policy, "plan", binding, ctx);
    if (!outcome.ok) throw new WorkspacePlanError(outcome.message, outcome.code);
    plan.push(planRow(root.id, outcome.result.data, binding.ref));
  }
  return { policy: workspace.sync_policy, plan };
}

/**
 * Plan every included root, then update work trees in config order.
 * `together` runs every precheck before any update. `one-side-safe` and `pin-rev`
 * update serially and stop at the first sync failure. Already updated roots stay
 * in `touched`. The failed root and every later root are `frozen`. There is no rollback.
 */
export async function executeWorkspaceSync(
  workspace: WorkspaceConfig,
  configDir: string,
  registry: PluginRegistry,
  ctx: BoltPluginContext,
): Promise<WorkspaceSyncResult> {
  const planned = await planWorkspaceSync(workspace, configDir, registry, ctx);
  const plan = planned.plan.map((row) => ({ ...row }));
  const roots = new Map(workspace.roots.map((root) => [root.id, root]));
  const syncCtx = { ...ctx, dryRun: false };

  const call = async (row: PlanRow, phase: RevisionPhase) => {
    const root = roots.get(row.root);
    if (!root) throw new WorkspacePlanError(`Plan row "${row.root}" is not a workspace root.`);
    const resolved = resolveRootPath(root.path, configDir);
    return callRevision(
      root,
      resolved,
      workspace.sync_policy,
      phase,
      revisionBinding(root, registry),
      phase === "sync" ? syncCtx : ctx,
      row,
    );
  };

  if (workspace.sync_policy === "together") {
    const issues: Array<{ root: string; code: string; message: string }> = [];
    for (const row of plan) {
      const outcome = await call(row, "precheck");
      if (!outcome.ok)
        issues.push({ root: row.root, code: outcome.code, message: outcome.message });
    }
    if (issues.length > 0) {
      for (const row of plan) row.will_touch = false;
      throw new WorkspaceSyncError(
        {
          policy: workspace.sync_policy,
          plan,
          touched: [],
          frozen: plan.map((row) => row.root),
          failed: issues.map((item) => ({ root: item.root, code: item.code })),
        },
        issues.map((item) => ({ code: item.code, message: item.message })),
      );
    }
  }

  const touched: string[] = [];
  const frozen: string[] = [];
  for (let index = 0; index < plan.length; index++) {
    const row = plan[index];
    if (!row.will_touch) {
      frozen.push(row.root);
      continue;
    }
    const outcome = await call(row, "sync");
    if (!outcome.ok) {
      throw new WorkspaceSyncError(
        {
          policy: workspace.sync_policy,
          plan,
          touched,
          frozen: [...frozen, ...plan.slice(index).map((item) => item.root)],
          failed: [{ root: row.root, code: outcome.code }],
        },
        [{ code: outcome.code, message: outcome.message }],
      );
    }
    touched.push(row.root);
  }
  return { policy: workspace.sync_policy, plan, touched, frozen, failed: [] };
}
