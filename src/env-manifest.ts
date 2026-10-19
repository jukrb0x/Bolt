/**
 * Environment manifest: declared checks in bolt.yaml `env` or a relative file.
 * Paths stay inside the project root. Drive letters are rejected.
 */
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { z } from "zod";
import { CAPABILITY_PATTERN } from "./capabilities";
import { safePath } from "./plugins/path-guard";
import { createRuntime } from "./runtime";

export class ManifestError extends Error {
  readonly exitCode = 3;
  readonly code = "MANIFEST_INVALID" as const;
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ManifestError";
  }
}

export interface EnvCheckDecl {
  id: string;
  require: boolean;
  version?: string;
  params?: Record<string, unknown>;
}

export interface ResolvedEnvManifest {
  source: string;
  checks: EnvCheckDecl[];
  /** No `env` block, or an explicit empty check list. */
  empty: boolean;
}

/** Effective manifest printed by `bolt env manifest`. Declarations, not probe results. */
export interface EnvManifestData {
  source: string;
  checks_declared: number;
  checks: EnvCheckDecl[];
}

export function toEnvManifestData(resolved: ResolvedEnvManifest): EnvManifestData {
  return {
    source: resolved.source,
    checks_declared: resolved.checks.length,
    checks: resolved.checks,
  };
}

const SETUP_SCRIPT = /(?:^|[\s"'`\\/])[\w.-]*setup[\w.-]*\.(?:ps1|bat|cmd|sh)\b/i;

/**
 * E1: a project with no `env` block and a one-step setup script is not environment-ready.
 * Warning only. `bolt check` still exits 0.
 *
 * ponytail: only a single `run` step whose command names a setup script. Multi-step
 * tasks and `uses:` steps (including `ue/setup`) are ignored. Upgrade path: an
 * explicit task flag if a real one-shot setup does not match this shape.
 */
export function envSetupShellWarnings(
  tasks: Record<string, ReadonlyArray<{ run?: unknown }>> | undefined,
  hasEnv: boolean,
): string[] {
  if (hasEnv || !tasks) return [];
  const warnings: string[] = [];
  for (const [name, steps] of Object.entries(tasks)) {
    if (steps.length !== 1) continue;
    const run = steps[0]?.run;
    if (typeof run !== "string" || !SETUP_SCRIPT.test(run)) continue;
    warnings.push(
      `ENV_SETUP_SHELL: task "${name}" is a one-shot setup script and this project has no env block. That task is not environment readiness. Declare env.checks, or keep the task as an ordinary step.`,
    );
  }
  return warnings;
}

const DRIVE = /^[A-Za-z]:(?:[\\/]|$)/;

const CHECK_ID_MESSAGE = 'check id must be lowercase dot-separated words such as "fixture.tool.a"';

export const EnvCheckSchema = z
  .object({
    id: z.string().regex(CAPABILITY_PATTERN, CHECK_ID_MESSAGE),
    require: z.boolean().optional(),
    version: z.string().min(1).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const EnvSchema = z
  .object({
    checks: z.array(EnvCheckSchema).optional(),
    manifest: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.manifest !== undefined && value.checks !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manifest"],
        message: "set checks or manifest, not both",
      });
    }
    const pathProblem = value.manifest ? manifestPathProblem(value.manifest) : undefined;
    if (pathProblem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manifest"],
        message: pathProblem,
      });
    }
    const seen = new Set<string>();
    value.checks?.forEach((check, index) => {
      if (seen.has(check.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checks", index, "id"],
          message: `duplicate check id "${check.id}"`,
        });
      }
      seen.add(check.id);
      const drive = findDrive(check);
      if (drive) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checks", index],
          message: `drive-letter path is not allowed (${drive})`,
        });
      }
    });
  });

export type EnvBlock = z.infer<typeof EnvSchema>;

const ExternalManifestSchema = z
  .object({
    checks: z.array(EnvCheckSchema).default([]),
  })
  .strict();

/** Why a manifest path cannot be used, or undefined when the spelling is relative and in-bounds. */
export function manifestPathProblem(raw: string): string | undefined {
  if (
    DRIVE.test(raw) ||
    path.win32.isAbsolute(raw) ||
    path.posix.isAbsolute(raw) ||
    path.isAbsolute(raw)
  ) {
    return `manifest path "${raw}" must be relative to the project root`;
  }
  if (raw.split(/[\\/]/).includes("..")) {
    return `manifest path "${raw}" escapes the project root`;
  }
  return undefined;
}

function findDrive(value: unknown): string | undefined {
  if (typeof value === "string") return DRIVE.test(value) ? value : undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findDrive(item);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const hit = findDrive(item);
      if (hit) return hit;
    }
  }
  return undefined;
}

function normalizeCheck(raw: z.infer<typeof EnvCheckSchema>): EnvCheckDecl {
  const decl: EnvCheckDecl = { id: raw.id, require: raw.require ?? true };
  if (raw.version !== undefined) decl.version = raw.version;
  if (raw.params !== undefined) decl.params = raw.params;
  return decl;
}

function parseExternal(text: string, label: string): EnvCheckDecl[] {
  let parsed: unknown;
  try {
    parsed = createRuntime().parseYaml(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ManifestError(`${label} could not be parsed (${message})`);
  }
  const result = ExternalManifestSchema.safeParse(parsed ?? {});
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new ManifestError(`${label} is invalid (${detail})`);
  }
  const drive = findDrive(result.data.checks);
  if (drive) throw new ManifestError(`${label} contains a drive-letter path (${drive})`);
  const seen = new Set<string>();
  for (const check of result.data.checks) {
    if (seen.has(check.id)) {
      throw new ManifestError(`${label} repeats check id "${check.id}"`);
    }
    seen.add(check.id);
  }
  return result.data.checks.map(normalizeCheck);
}

/** Resolve `raw` against the project root. Absolute paths and `..` escapes throw. */
export function resolveManifestFile(raw: string, configDir: string): string {
  const problem = manifestPathProblem(raw);
  if (problem) throw new ManifestError(problem);
  try {
    const resolved = safePath(raw, configDir);
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      throw new ManifestError(`manifest file "${raw}" was not found`);
    }
    return resolved;
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ManifestError(message);
  }
}

function loadManifestFile(raw: string, configDir: string): EnvCheckDecl[] {
  const resolved = resolveManifestFile(raw, configDir);
  let text: string;
  try {
    text = readFileSync(resolved, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ManifestError(`manifest file "${raw}" could not be read (${message})`);
  }
  return parseExternal(text, `manifest file "${raw}"`);
}

/**
 * Effective check list for one probe.
 * `--manifest` wins over `bolt.yaml`. An absent block and an empty list are both empty.
 */
export function resolveEnvManifest(input: {
  env: EnvBlock | undefined;
  configDir: string;
  manifestPath?: string;
}): ResolvedEnvManifest {
  if (input.manifestPath !== undefined) {
    const checks = loadManifestFile(input.manifestPath, input.configDir);
    return { source: input.manifestPath, checks, empty: checks.length === 0 };
  }
  const env = input.env;
  if (!env || (env.checks === undefined && env.manifest === undefined)) {
    return { source: "bolt.yaml#env", checks: [], empty: true };
  }
  if (env.manifest !== undefined) {
    const checks = loadManifestFile(env.manifest, input.configDir);
    return { source: env.manifest, checks, empty: checks.length === 0 };
  }
  const checks = (env.checks ?? []).map(normalizeCheck);
  return { source: "bolt.yaml#env", checks, empty: checks.length === 0 };
}
