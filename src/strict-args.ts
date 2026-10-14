import type { CommandDef } from "citty";
import { closestFlagMatches, formatDidYouMean, shellQuote } from "./suggest";
import { USAGE_EXIT_CODE } from "./exit-codes";

/**
 * Print a usage error. `[ERROR]` prefixes only the actual error lines; indented
 * supplementary lines (Commands:/Tasks:/Flows:/Flags: …) are printed as-is.
 */
export function printUsageError(message: string): void {
  for (const line of message.split("\n")) {
    if (/^[ \t]/.test(line)) console.error(line);
    else console.error(`[ERROR] ${line}`);
  }
}

/** A command-line usage error. Callers print the message and exit with USAGE_EXIT_CODE. */
export class UsageError extends Error {
  readonly code = "USAGE";
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Flag names reserved by Bolt (design §3, 0.4). They are never accepted as user params,
 * neither as `--name[=v]` nor as `name=v` after `--`. A reserved name a command declares
 * is a normal flag for that command (e.g. `version --json`, `migrate --dry-run`).
 */
export const RESERVED_FLAGS = [
  "dry-run",
  "simulate",
  "json",
  "agent",
  "execute",
  "plan",
  "confirmed-by-user",
] as const;

/** Reserved names that some commands implement today. */
export const IMPLEMENTED_RESERVED = new Set<string>(["dry-run", "simulate"]);

function isReserved(name: string): boolean {
  return (RESERVED_FLAGS as readonly string[]).includes(name);
}

const INSPECT_PREVIEW = "bolt inspect never executes, it is already a side-effect-free preview";
const HELP_FLAGS = new Set(["--help", "-h"]);
const FALSY = new Set(["false", "0", "no", "off", ""]);

export function renamedParam(name: string): string {
  return `my_${name.replace(/-/g, "_")}`;
}

export interface StrictArgSpec {
  /** Command path after `bolt`, e.g. `run` or `plugin new`. */
  command: string;
  /** Declared boolean flag primary names (no leading dashes). */
  booleans: string[];
  /** Declared string flag primary names. */
  strings: string[];
  /** Alias or primary → primary name for booleans (includes primary→primary). */
  booleanLookup: Map<string, string>;
  /** Alias or primary → primary name for strings. */
  stringLookup: Map<string, string>;
  /** True for `run` and `inspect`: `--k=v` params and `--` passthrough. */
  allowParams: boolean;
}

export interface StrictParseResult {
  positionals: string[];
  params: Record<string, string>;
  booleans: Record<string, boolean>;
  strings: Record<string, string>;
}

type CittyArg = {
  type?: string;
  alias?: string | string[];
};

/** Build a StrictArgSpec from a citty `args` object. */
export function specFromCittyArgs(
  command: string,
  args: Record<string, CittyArg> | undefined,
  opts: { allowParams?: boolean } = {},
): StrictArgSpec {
  const booleans: string[] = [];
  const strings: string[] = [];
  const booleanLookup = new Map<string, string>();
  const stringLookup = new Map<string, string>();

  for (const [name, def] of Object.entries(args ?? {})) {
    if (!def || def.type === "positional") continue;
    const aliases = def.alias == null ? [] : Array.isArray(def.alias) ? def.alias : [def.alias];
    if (def.type === "string") {
      strings.push(name);
      stringLookup.set(name, name);
      for (const a of aliases) stringLookup.set(String(a).replace(/^-+/, ""), name);
    } else {
      // boolean (citty default) or explicit boolean
      booleans.push(name);
      booleanLookup.set(name, name);
      for (const a of aliases) booleanLookup.set(String(a).replace(/^-+/, ""), name);
    }
  }

  return {
    command,
    booleans,
    strings,
    booleanLookup,
    stringLookup,
    allowParams: opts.allowParams === true,
  };
}

/** Flag names used for did-you-mean (primaries + aliases + help). */
export function knownFlagNames(spec: StrictArgSpec): string[] {
  const names = new Set<string>(["help"]);
  for (const n of spec.booleans) names.add(n);
  for (const n of spec.strings) names.add(n);
  for (const n of spec.booleanLookup.keys()) names.add(n);
  for (const n of spec.stringLookup.keys()) names.add(n);
  return [...names];
}

/** Display list of supported flags for error hints. */
export function formatSupportedFlags(spec: StrictArgSpec): string {
  const parts: string[] = [];
  for (const name of spec.booleans) {
    parts.push(`--${name}`);
    for (const [alias, primary] of spec.booleanLookup) {
      if (primary === name && alias !== name && alias.length === 1) parts.push(`-${alias}`);
      else if (primary === name && alias !== name) parts.push(`--${alias}`);
    }
  }
  for (const name of spec.strings) {
    parts.push(`--${name}`);
    for (const [alias, primary] of spec.stringLookup) {
      if (primary === name && alias !== name && alias.length === 1) parts.push(`-${alias}`);
      else if (primary === name && alias !== name) parts.push(`--${alias}`);
    }
  }
  // de-dupe while preserving order
  const uniq: string[] = [];
  const shown = new Set<string>();
  for (const p of parts) {
    if (shown.has(p)) continue;
    shown.add(p);
    uniq.push(p);
  }
  if (uniq.length === 0) {
    return `  This command takes no flags. Run bolt ${spec.command} --help for details.`;
  }
  return `  Flags: ${uniq.join(", ")}. Run bolt ${spec.command} --help for details.`;
}

function suggest(name: string, known: string[]): string {
  const bare = name.replace(/^-+/, "");
  const matches = closestFlagMatches(bare, known).map((m) => (m.length === 1 ? `-${m}` : `--${m}`));
  return formatDidYouMean(matches);
}

function unknownFlagError(arg: string, nameForSuggest: string, spec: StrictArgSpec): UsageError {
  const known = knownFlagNames(spec);
  const hint = suggest(nameForSuggest, known);
  const paramsHint = spec.allowParams ? ` Params must be given as --key=value.` : "";
  return new UsageError(
    `Unknown flag "${arg}" for "bolt ${spec.command}".${hint}${paramsHint}\n` +
      formatSupportedFlags(spec),
  );
}

export interface ReservedParamContext {
  command: string;
  flags: string[];
  afterSeparator: boolean;
}

export function reservedParamError(
  name: string,
  value: string,
  ctx: ReservedParamContext,
): UsageError {
  const rename = renamedParam(name);
  const pass = `-- ${rename}=${shellQuote(value)}`;
  const renameHint = `rename it, e.g. in bolt.yaml use ${rename} and pass ${pass}.`;

  if (name === "help" && ctx.afterSeparator) {
    return new UsageError(
      `"help" cannot be used as a param name (it is a bolt flag). ` +
        `Rename the param, e.g. in bolt.yaml use ${rename} and pass ${pass}.`,
    );
  }
  if (name === "help") {
    return new UsageError(
      `--help takes no value. Use: bolt ${ctx.command} --help. ` +
        `If this is a task param, ${renameHint}`,
    );
  }

  if (
    IMPLEMENTED_RESERVED.has(name) &&
    ctx.flags.includes(name) &&
    FALSY.has(value.toLowerCase())
  ) {
    return new UsageError(
      `"${name}=${value}" is not a param: --${name} is a bolt flag and takes no value. ` +
        `To run for real, just remove --${name}. If this is a task param, ${renameHint}`,
    );
  }

  let flagHint = "";
  if (IMPLEMENTED_RESERVED.has(name)) {
    if (ctx.flags.includes(name)) {
      flagHint = ` To preview the run instead, pass --${name} without a value before "--".`;
    } else if (ctx.command === "inspect") {
      flagHint = ` No --${name} is needed: ${INSPECT_PREVIEW}.`;
    }
  }

  if (!ctx.afterSeparator && !IMPLEMENTED_RESERVED.has(name)) {
    return new UsageError(
      `--${name} is reserved by bolt and not supported yet. If this is a task param, ${renameHint}`,
    );
  }
  const reservation = IMPLEMENTED_RESERVED.has(name)
    ? `it is a bolt flag`
    : `--${name} is reserved by bolt and not supported yet`;
  return new UsageError(
    `"${name}" cannot be used as a param name (${reservation}). ` +
      `Rename the param, e.g. in bolt.yaml use ${rename} and pass ${pass}.${flagHint}`,
  );
}

function reservedError(name: string, spec: StrictArgSpec): UsageError {
  if (IMPLEMENTED_RESERVED.has(name)) {
    if (spec.command === "inspect") {
      return new UsageError(
        `Unknown flag "--${name}" for "bolt inspect": ${INSPECT_PREVIEW}. Remove --${name}.`,
      );
    }
    return unknownFlagError(`--${name}`, name, spec);
  }
  return new UsageError(
    `--${name} is reserved by bolt and not supported yet. Remove it from the command.`,
  );
}

function parseParam(text: string, origin: string): [string, string] {
  const eq = text.indexOf("=");
  const key = eq === -1 ? "" : text.slice(0, eq);
  if (eq === -1 || key === "" || key.startsWith("-")) {
    throw new UsageError(`Malformed param "${origin}". Params must look like key=value.`);
  }
  return [key, text.slice(eq + 1)];
}

function looksLikeFlag(token: string): boolean {
  return token.startsWith("-") && token.length > 1;
}

/**
 * Strict argv parse shared by every bolt command (BOLT-CLI-1).
 * Throws UsageError; never writes or runs handlers.
 */
export function parseStrictArgs(rawArgs: string[], spec: StrictArgSpec): StrictParseResult {
  const positionals: string[] = [];
  const params: Record<string, string> = {};
  const booleans: Record<string, boolean> = {};
  const strings: Record<string, string> = {};
  const paramFlags = spec.booleans;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg === "--") {
      if (!spec.allowParams) {
        const rest = rawArgs.slice(i + 1);
        const first = rest[0];
        let msg = `"bolt ${spec.command}" takes no arguments after "--".`;
        if (first && looksLikeFlag(first)) {
          const flag = first.includes("=") ? first.slice(0, first.indexOf("=")) : first;
          msg += `\n  Bolt flags go before "--", e.g. bolt ${spec.command} ${flag}.`;
        }
        throw new UsageError(msg);
      }
      for (const rest of rawArgs.slice(i + 1)) {
        const [k, v] = parseParam(rest, rest);
        if (isReserved(k) || k === "help") {
          throw reservedParamError(k, v, {
            command: spec.command,
            flags: paramFlags,
            afterSeparator: true,
          });
        }
        params[k] = v;
      }
      break;
    }

    if (HELP_FLAGS.has(arg)) continue;

    // Long flags: --name, --name=value, --no-name
    if (arg.startsWith("--")) {
      const inner = arg.slice(2);
      const eq = inner.indexOf("=");
      const rawName = eq === -1 ? inner : inner.slice(0, eq);
      const value = eq === -1 ? undefined : inner.slice(eq + 1);

      // --no-<boolean>
      if (rawName.startsWith("no-") && rawName.length > 3 && eq === -1) {
        const bare = rawName.slice(3);
        const primary = spec.booleanLookup.get(bare);
        if (primary) {
          booleans[primary] = false;
          continue;
        }
        // undeclared --no-x: if bare is reserved, reserved error; else unknown
        if (isReserved(bare)) throw reservedError(bare, spec);
        throw unknownFlagError(arg, rawName, spec);
      }

      const boolPrimary = spec.booleanLookup.get(rawName);
      if (boolPrimary) {
        if (value !== undefined) {
          const fix =
            IMPLEMENTED_RESERVED.has(boolPrimary) && FALSY.has(value.toLowerCase())
              ? ` To run for real, just remove --${boolPrimary}.`
              : ` Use --${boolPrimary} on its own.`;
          throw new UsageError(`Flag "--${boolPrimary}" does not take a value.${fix}`);
        }
        booleans[boolPrimary] = true;
        continue;
      }

      const strPrimary = spec.stringLookup.get(rawName);
      if (strPrimary) {
        if (value !== undefined) {
          strings[strPrimary] = value;
          continue;
        }
        const next = rawArgs[i + 1];
        if (next !== undefined && !looksLikeFlag(next) && next !== "--") {
          strings[strPrimary] = next;
          i++;
          continue;
        }
        throw new UsageError(`Flag "--${strPrimary}" needs a value, e.g. --${strPrimary}=value.`);
      }

      if (rawName === "help" && value !== undefined) {
        throw reservedParamError(rawName, value, {
          command: spec.command,
          flags: paramFlags,
          afterSeparator: false,
        });
      }

      if (isReserved(rawName)) {
        if (value !== undefined && !IMPLEMENTED_RESERVED.has(rawName) && spec.allowParams) {
          throw reservedParamError(rawName, value, {
            command: spec.command,
            flags: paramFlags,
            afterSeparator: false,
          });
        }
        throw reservedError(rawName, spec);
      }

      // allowParams: --key=value is a task param; --key alone is unknown
      if (spec.allowParams) {
        if (value === undefined) {
          throw unknownFlagError(arg, rawName, spec);
        }
        const [k, v] = parseParam(inner, arg);
        if (v.startsWith("--")) {
          throw new UsageError(
            `Param value for "--${k}" may not start with "--". ` +
              `Pass it after a "--" separator instead: bolt ${spec.command} ... -- ${k}=${shellQuote(v)}`,
          );
        }
        params[k] = v;
        continue;
      }

      throw unknownFlagError(arg, rawName, spec);
    }

    // Short flags: -f, -e value, -x
    if (arg.startsWith("-") && arg.length > 1) {
      const body = arg.slice(1);
      // Single-letter alias only (no bundling)
      if (body.length === 1) {
        const boolPrimary = spec.booleanLookup.get(body);
        if (boolPrimary) {
          booleans[boolPrimary] = true;
          continue;
        }
        const strPrimary = spec.stringLookup.get(body);
        if (strPrimary) {
          const next = rawArgs[i + 1];
          if (next !== undefined && !looksLikeFlag(next) && next !== "--") {
            strings[strPrimary] = next;
            i++;
            continue;
          }
          throw new UsageError(
            `Flag "-${body}" needs a value, e.g. -${body} value or --${strPrimary}=value.`,
          );
        }
      }
      throw unknownFlagError(arg, body, spec);
    }

    positionals.push(arg);
  }

  if (booleans["dry-run"] && booleans.simulate) {
    throw new UsageError(
      `--dry-run and --simulate cannot be combined. Use --dry-run for a static preview ` +
        `(nothing runs), or --simulate to run plugins in dry-run mode.`,
    );
  }

  return { positionals, params, booleans, strings };
}

export function parseStrictArgsOrExit(rawArgs: string[], spec: StrictArgSpec): StrictParseResult {
  try {
    return parseStrictArgs(rawArgs, spec);
  } catch (e) {
    if (e instanceof UsageError) {
      printUsageError(e.message);
      process.exit(USAGE_EXIT_CODE);
    }
    throw e;
  }
}

export interface LeafCommand {
  path: string[];
  def: CommandDef<any>;
  rest: string[];
}

/**
 * Resolve the leaf command and the argv that follow it.
 * Returns undefined when there is no leaf yet (bare `bolt`, globals only).
 */
export function resolveLeafCommand(argv: string[], root: CommandDef<any>): LeafCommand | undefined {
  let node: CommandDef<any> = root;
  let rest = argv;
  const path: string[] = [];

  for (;;) {
    const subs = (node.subCommands ?? {}) as Record<string, CommandDef<any>>;
    const names = Object.keys(subs);
    if (names.length === 0) {
      // leaf
      return path.length === 0 ? undefined : { path, def: node, rest };
    }
    const index = rest.findIndex((arg) => !arg.startsWith("-"));
    if (index === -1) return undefined;
    const name = rest[index];
    if (!Object.hasOwn(subs, name)) return undefined;
    path.push(name);
    node = subs[name];
    rest = rest.slice(index + 1);
  }
}

/** True when this leaf keeps run/inspect-style `--k=v` params. */
export function leafAllowsParams(path: string[]): boolean {
  return path.length === 1 && (path[0] === "run" || path[0] === "inspect");
}

export { USAGE_EXIT_CODE };
