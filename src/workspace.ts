/**
 * Workspace roots inventory (BOLT-A1-LIST).
 * List and check read the declaration. This module does not sync.
 */
import { existsSync } from "fs";
import path from "path";
import { z } from "zod";

export const WORKSPACE_ROLES = ["engine", "project", "related"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface WorkspaceRoot {
  id: string;
  /** Path as written in bolt.yaml. Relative to the bolt.yaml directory, or absolute. */
  path: string;
  role: WorkspaceRole;
  /** Copied from bolt.yaml when set. List and check do not call a VCS. */
  vcs?: string;
}

export interface WorkspaceConfig {
  roots: WorkspaceRoot[];
}

export interface WorkspaceRootView {
  id: string;
  path: string;
  role: WorkspaceRole;
  exists: boolean;
  vcs?: string;
}

/** Shown when bolt.yaml still contains `sync_policy`. */
export const SYNC_POLICY_MIGRATION =
  "Remove sync_policy. Daily multi-repo update stays pipeline + vcs.sync.";

export type WorkspaceErrorCode = "WORKSPACE_INVALID";

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

const WorkspaceRootSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    role: z.enum(WORKSPACE_ROLES),
    vcs: z.string().min(1).optional(),
  })
  .strict();

export const WorkspaceSchema = z
  .object({
    roots: z.array(WorkspaceRootSchema).min(1),
    sync_policy: z.unknown().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.sync_policy !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sync_policy"],
        message: SYNC_POLICY_MIGRATION,
        params: { hint: SYNC_POLICY_MIGRATION },
      });
    }
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
  return {
    roots: value.roots.map((root) => {
      const item: WorkspaceRoot = { id: root.id, path: root.path, role: root.role };
      if (root.vcs !== undefined) item.vcs = root.vcs;
      return item;
    }),
  };
}

type ZodLikeIssue = {
  path: Array<PropertyKey>;
  code: string;
  params?: unknown;
};

/** Map a bolt.yaml Zod issue onto a workspace code, or undefined when it is not one. */
export function codeForZodIssue(issue: ZodLikeIssue): "WORKSPACE_INVALID" | undefined {
  if (issue.path[0] !== "workspace") return undefined;
  return "WORKSPACE_INVALID";
}

export function hintForZodIssue(issue: ZodLikeIssue): string | undefined {
  const params = issue.params;
  if (!params || typeof params !== "object") return undefined;
  const hint = (params as { hint?: unknown }).hint;
  return typeof hint === "string" ? hint : undefined;
}

export function formatZodConfigError(issues: readonly ZodLikeIssue[], message: string): Error {
  const codes = issues.map((issue) => codeForZodIssue(issue));
  if (codes.length > 0 && codes.every((code) => code === "WORKSPACE_INVALID")) {
    const hint = issues.map((issue) => hintForZodIssue(issue)).find((item) => item !== undefined);
    return new WorkspaceConfigError("WORKSPACE_INVALID", message, hint);
  }
  return new Error(message);
}

/** Absolute path for a root. Relative paths resolve from the bolt.yaml directory. */
export function resolveRootPath(rootPath: string, configDir: string): string {
  return path.resolve(configDir, rootPath);
}

/** Roots in declaration order. `exists` is a stat. This does not create directories or call a VCS. */
export function readWorkspaceInventory(
  workspace: WorkspaceConfig,
  configDir: string,
): { roots: WorkspaceRootView[] } {
  return {
    roots: workspace.roots.map((root) => {
      const view: WorkspaceRootView = {
        id: root.id,
        path: root.path,
        role: root.role,
        exists: existsSync(resolveRootPath(root.path, configDir)),
      };
      if (root.vcs !== undefined) view.vcs = root.vcs;
      return view;
    }),
  };
}

export function missingWorkspacePathWarnings(inventory: { roots: WorkspaceRootView[] }): string[] {
  return inventory.roots
    .filter((root) => !root.exists)
    .map((root) => `workspace.roots.${root.id}: path "${root.path}" does not exist`);
}
