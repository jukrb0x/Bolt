/**
 * Workspace model and dry-run plan aggregation (BOLT-A1a).
 * Core stores the model and orders plan rows. A plugin tagged `vcs.revision`
 * supplies action, target_rev, and will_touch. This module does not sync.
 */
import { existsSync } from "fs";
import path from "path";
import { z } from "zod";
import { validateHandlerResult } from "./handler-result";
import type { BoltPluginContext } from "./plugin";
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

export interface WorkspaceSyncData {
  policy: SyncPolicy;
  plan: PlanRow[];
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

/** Revision resolve failed. Exit 1. Not a working-copy update. */
export class WorkspacePlanError extends Error {
  readonly exitCode = 1;
  readonly code = "VCS_REVISION";
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePlanError";
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

export function formatWorkspacePlan(data: WorkspaceSyncData): string {
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
  return [
    `policy: ${data.policy}`,
    line({
      root: "root",
      action: "action",
      target_rev: "target_rev",
      will_touch: "will_touch",
    }),
    ...rows.map((row) => line(row)),
  ].join("\n");
}

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

/**
 * Aggregate one dry-run row per root, in config order.
 * `pin-rev` omits a root whose pin is null. Plugins are not asked to touch the disk.
 */
export async function planWorkspaceSync(
  workspace: WorkspaceConfig,
  configDir: string,
  registry: PluginRegistry,
  ctx: BoltPluginContext,
): Promise<WorkspaceSyncData> {
  const plan: PlanRow[] = [];
  for (const root of workspace.roots) {
    const resolved = resolveRootPath(root.path, configDir);
    if (!existsSync(resolved)) {
      throw new WorkspaceConfigError(
        "ROOT_MISSING",
        missingRootMessage(root, resolved),
        `Fix workspace.roots path for "${root.id}". A path is relative to the bolt.yaml directory, or absolute. bolt.local.yaml does not change it.`,
      );
    }
    if (workspace.sync_policy === "pin-rev" && root.pin === null) continue;
    const match = registry
      .findByCapability("vcs.revision")
      .find((item) => item.namespace === root.vcs);
    const plugin = registry.get(root.vcs);
    const handler = match ? plugin?.handlers[match.handler] : undefined;
    if (!match || !plugin || !handler) {
      throw new WorkspacePlanError(
        `No vcs.revision handler for root "${root.id}" (vcs ${root.vcs}). This dry-run does not sync, and built-in git and svn do not supply a plan row.`,
      );
    }
    if (plugin.apiVersion !== 2) {
      throw new WorkspacePlanError(
        `${match.ref} must declare apiVersion 2 to return a workspace plan row.`,
      );
    }
    let returned: unknown;
    try {
      returned = await handler(
        {
          id: root.id,
          path: resolved,
          role: root.role,
          vcs: root.vcs,
          pin: root.pin ?? "",
          policy: workspace.sync_policy,
        },
        ctx,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkspacePlanError(
        `${match.ref} failed while planning root "${root.id}": ${message}`,
      );
    }
    let validated: ReturnType<typeof validateHandlerResult>;
    try {
      validated = validateHandlerResult(returned, match.ref);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkspacePlanError(message);
    }
    if (validated.result.status === "fail") {
      throw new WorkspacePlanError(
        validated.result.summary ?? `${match.ref} failed while planning root "${root.id}".`,
      );
    }
    plan.push(planRow(root.id, validated.result.data, match.ref));
  }
  return { policy: workspace.sync_policy, plan };
}
