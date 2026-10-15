import type { BoltConfig } from "./config";

type Context = Record<string, Record<string, string>>;

/** One piece of an interpolated string, with where the value came from. */
export type InterpSegment =
  | { kind: "literal"; text: string }
  | { kind: "env"; name: string; value: string }
  | { kind: "var"; name: string; value: string; local: boolean }
  | { kind: "param"; name: string; value: string }
  | { kind: "project"; name: string; value: string };

export interface InterpContext {
  project?: Record<string, string>;
  vars?: Record<string, string>;
  env?: Record<string, string | undefined>;
  params?: Record<string, string>;
  /** Var names defined or overridden in bolt.local.yaml. */
  localVars?: ReadonlySet<string>;
  /**
   * Provenance of params already interpolated (a `with:` value or a nested call).
   * `${{ params.NAME }}` splices these segments so env/local masking survives `call:`.
   */
  paramProvenance?: Record<string, InterpSegment[]>;
}

const TOKEN = /\$\{\{\s*([\w.]+)\s*\}\}/g;

function lookup(ctx: InterpContext, key: string): unknown {
  const parts = key.split(".");
  let value: unknown = ctx;
  for (const part of parts) {
    if (value == null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function segmentFor(key: string, ctx: InterpContext, raw: string): InterpSegment[] {
  const dot = key.indexOf(".");
  const head = dot === -1 ? key : key.slice(0, dot);
  const name = dot === -1 ? "" : key.slice(dot + 1);
  if (head === "params" && name && ctx.paramProvenance?.[name]) {
    return ctx.paramProvenance[name].map((segment) => ({ ...segment }));
  }
  const value = lookup(ctx, key);
  if (value == null || typeof value === "object") return [{ kind: "literal", text: raw }];
  const text = String(value);
  if (!name || name.includes(".")) {
    return [{ kind: "literal", text }];
  }
  if (head === "env") return [{ kind: "env", name, value: text }];
  if (head === "vars") {
    return [{ kind: "var", name, value: text, local: ctx.localVars?.has(name) ?? false }];
  }
  if (head === "params") return [{ kind: "param", name, value: text }];
  if (head === "project") return [{ kind: "project", name, value: text }];
  return [{ kind: "literal", text }];
}

function mergeLiterals(segments: InterpSegment[]): InterpSegment[] {
  const out: InterpSegment[] = [];
  for (const segment of segments) {
    const prev = out[out.length - 1];
    if (segment.kind === "literal" && prev?.kind === "literal") {
      prev.text += segment.text;
    } else if (!(segment.kind === "literal" && segment.text === "")) {
      out.push(segment);
    }
  }
  return out.length > 0 ? out : [{ kind: "literal", text: "" }];
}

/** Split a template into provenance segments. Execution joins them; JSON masks them. */
export function interpolateSegments(template: string, ctx: InterpContext): InterpSegment[] {
  const segments: InterpSegment[] = [];
  let last = 0;
  for (const match of template.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: "literal", text: template.slice(last, index) });
    segments.push(...segmentFor(match[1], ctx, match[0]));
    last = index + match[0].length;
  }
  if (last < template.length) segments.push({ kind: "literal", text: template.slice(last) });
  return mergeLiterals(segments);
}

/** Real values, in order. This is what execution runs. */
export function joinSegments(segments: readonly InterpSegment[]): string {
  return segments
    .map((segment) => (segment.kind === "literal" ? segment.text : segment.value))
    .join("");
}

/** JSON display. Env and bolt.local.yaml values are masked; committed values are not. */
export function maskSegments(segments: readonly InterpSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.kind === "env") return `«env:${segment.name}»`;
      if (segment.kind === "var" && segment.local) return `«local:${segment.name}»`;
      if (segment.kind === "literal") return segment.text;
      return segment.value;
    })
    .join("");
}

/**
 * plan_hash text. Masked segments contribute sha256(value) only, never the plaintext
 * and never the display token (so the hash still changes when the secret changes).
 */
export function hashSegments(
  segments: readonly InterpSegment[],
  digest: (value: string) => string,
): string {
  return segments
    .map((segment) => {
      if (segment.kind === "env") return digest(segment.value);
      if (segment.kind === "var" && segment.local) return digest(segment.value);
      if (segment.kind === "literal") return segment.text;
      return segment.value;
    })
    .join("");
}

export function maskLocalLabel(path: string): string {
  return `«local:${path}»`;
}

/** Replace bolt.local.yaml leaves with `«local:dotted.path»`. Other values pass through. */
export function maskLocalTree(value: unknown, localPaths: ReadonlySet<string>, at = ""): unknown {
  if (at && localPaths.has(at)) return maskLocalLabel(at);
  if (Array.isArray(value)) {
    return value.map((item, index) => maskLocalTree(item, localPaths, `${at}.${index}`));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const next = at ? `${at}.${key}` : key;
      out[key] = maskLocalTree((value as Record<string, unknown>)[key], localPaths, next);
    }
    return out;
  }
  return value;
}

function maskTreeContext(cfg: BoltConfig): InterpContext {
  return {
    project: cfg.project as unknown as Record<string, string>,
    vars: cfg.vars,
    env: process.env as Record<string, string>,
    params: {},
    localVars: new Set(cfg.localVarKeys ?? []),
  };
}

/** Mask local-origin leaves and env interpolations. Object keys are sorted. */
export function maskedTree(value: unknown, cfg: BoltConfig, at: string): unknown {
  const local = new Set(cfg.localPluginPaths ?? []);
  const walk = (current: unknown, pathName: string): unknown => {
    if (pathName && local.has(pathName)) return `«local:${pathName}»`;
    if (typeof current === "string" && current.includes("${{")) {
      return maskSegments(interpolateSegments(current, maskTreeContext(cfg)));
    }
    if (Array.isArray(current))
      return current.map((item, index) => walk(item, `${pathName}.${index}`));
    if (current && typeof current === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(current as Record<string, unknown>).sort()) {
        const next = pathName ? `${pathName}.${key}` : key;
        out[key] = walk((current as Record<string, unknown>)[key], next);
      }
      return out;
    }
    return current;
  };
  return walk(value, at);
}

/** Same walk as maskLocalTree, but local leaves become sha256 of their canonical JSON. */
export function hashLocalTree(
  value: unknown,
  localPaths: ReadonlySet<string>,
  digest: (value: string) => string,
  canonical: (value: unknown) => string,
  at = "",
): unknown {
  if (at && localPaths.has(at)) return digest(canonical(value));
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      hashLocalTree(item, localPaths, digest, canonical, `${at}.${index}`),
    );
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const next = at ? `${at}.${key}` : key;
      out[key] = hashLocalTree(
        (value as Record<string, unknown>)[key],
        localPaths,
        digest,
        canonical,
        next,
      );
    }
    return out;
  }
  return value;
}

export function interpolate(template: string, ctx: Context): string {
  return joinSegments(interpolateSegments(template, ctx));
}
