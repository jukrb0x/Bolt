import { existsSync } from "fs";
import path from "path";
import { findConfig } from "./discover";
import { ConfigError, loadProjectConfig } from "./project-config";
import type { BoltConfig } from "./config";
import { VERSION } from "./version";

/** Frozen schema names for BOLT-M1 slice 1a. */
export const JSON_SCHEMA = {
  list: "bolt.list/v1",
  info: "bolt.info/v1",
  check: "bolt.check/v1",
  doctor: "bolt.doctor/v1",
  why: "bolt.why/v1",
  envProbe: "bolt.env.probe/v1",
  envEnsure: "bolt.env.ensure/v1",
  envManifest: "bolt.env.manifest/v1",
  inspect: "bolt.inspect/v1",
  status: "bolt.status/v1",
  sessionList: "bolt.session.list/v1",
  session: "bolt.session/v1",
  sessionClear: "bolt.session.clear/v1",
  run: "bolt.run/v1",
  catalog: "bolt.catalog/v1",
} as const;

export interface JsonIssue {
  code: string;
  message: string;
  hint?: string;
}

/** Present when bolt.yaml was found. `local` is null when bolt.local.yaml is absent. */
export interface JsonConfigRef {
  path: string;
  local: string | null;
}

export interface JsonEnvelope<T = unknown> {
  schema: string;
  bolt: string;
  ok: boolean;
  config: JsonConfigRef | null;
  data: T;
  warnings: JsonIssue[];
  errors: JsonIssue[];
}

export function issue(code: string, message: string, hint?: string): JsonIssue {
  const item: JsonIssue = { code, message };
  if (hint) item.hint = hint;
  return item;
}

/** First line is the message. Indented following lines become `hint`. */
export function issueFromCliMessage(code: string, text: string): JsonIssue {
  const [head, ...rest] = text.split("\n");
  const hint = rest
    .map((line) => line.replace(/^[ \t]+/, ""))
    .filter((line) => line.length > 0)
    .join("\n");
  return issue(code, head || text, hint || undefined);
}

/** `null` when no bolt.yaml was found. The field is always present on the envelope. */
export function configRef(configPath: string | null | undefined): JsonConfigRef | null {
  if (!configPath) return null;
  const localPath = path.join(path.dirname(configPath), "bolt.local.yaml");
  return { path: configPath, local: existsSync(localPath) ? localPath : null };
}

export function buildEnvelope<T>(opts: {
  schema: string;
  exitCode: number;
  config: JsonConfigRef | null;
  data: T;
  warnings?: JsonIssue[];
  errors?: JsonIssue[];
}): JsonEnvelope<T> {
  return {
    schema: opts.schema,
    bolt: VERSION,
    ok: opts.exitCode === 0,
    config: opts.config,
    data: opts.data,
    warnings: opts.warnings ?? [],
    errors: opts.errors ?? [],
  };
}

type StdoutWrite = typeof process.stdout.write;

let originalStdoutWrite: StdoutWrite | undefined;

/**
 * Process-level stdout purity for `--json` (ai-mcp §4.5).
 * `console.log` and `process.stdout.write` go to stderr. The JSON document is
 * written with the saved stdout writer. Idempotent.
 */
export function installJsonStdoutGuard(): void {
  if (originalStdoutWrite) return;
  originalStdoutWrite = process.stdout.write.bind(process.stdout) as StdoutWrite;
  process.stdout.write = ((
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ) => {
    if (typeof encoding === "function") return process.stderr.write(chunk, encoding);
    return process.stderr.write(chunk, encoding, cb);
  }) as StdoutWrite;
  const toStderr = (...args: unknown[]) => {
    console.error(...args);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
}

/** Write the JSON document to the real stdout, bypassing the guard. */
export function writeJsonStdout(text: string): void {
  const write = originalStdoutWrite ?? (process.stdout.write.bind(process.stdout) as StdoutWrite);
  write(text);
}

export function emitJsonAndExit<T>(opts: {
  schema: string;
  exitCode: number;
  config: JsonConfigRef | null;
  data: T;
  warnings?: JsonIssue[];
  errors?: JsonIssue[];
}): never {
  installJsonStdoutGuard();
  writeJsonStdout(`${JSON.stringify(buildEnvelope(opts), null, 2)}\n`);
  process.exit(opts.exitCode);
}

/**
 * Load bolt.yaml for a `--json` command. On failure, write the envelope and
 * exit. `config` is null only when no bolt.yaml exists.
 */
export async function loadConfigForJson(
  schema: string,
): Promise<{ configPath: string; cfg: BoltConfig }> {
  try {
    return await loadProjectConfig();
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    const found = e.code === "CONFIG_NOT_FOUND" ? null : await findConfig(process.cwd());
    emitJsonAndExit({
      schema,
      exitCode: e.exitCode,
      config: configRef(found),
      data: null,
      errors: [issueFromCliMessage(e.code, e.message)],
    });
  }
}
