import { closestMatches, formatDidYouMean } from "./suggest";

const HELP = new Set(["-h", "--help"]);

/** Global flags allowed before the subcommand; used for "Did you mean" suggestions. */
const GLOBAL_FLAGS = ["-h", "--help", "--version"];

/** Top-level typos that map to a full suggested invocation (not a subcommand name). */
const COMMAND_ALIASES: Record<string, string> = {
  help: "bolt --help",
  update: "bolt self-update",
  upgrade: "bolt self-update",
};

/**
 * Validate argv before citty sees it. citty silently drops every argument that comes
 * before the subcommand name, so `bolt --dry-run run deploy` would execute for real.
 *
 * Before the subcommand only `-h`, `--help` and `--version` are allowed:
 * - any help flag wins: `bolt --help --version` shows help (citty handles it) and exits 0;
 * - `--version` without help must be the only argument (`bolt --version`).
 *
 * Returns an error message (what is wrong and how to fix it), or undefined when argv is fine.
 */
export function checkGlobalArgs(argv: string[]): string | undefined {
  const sub = argv.findIndex((arg) => !arg.startsWith("-"));
  const before = sub === -1 ? argv : argv.slice(0, sub);

  for (const arg of before) {
    if (HELP.has(arg) || arg === "--version") continue;
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (eq !== -1 && name === "--version") {
      return "--version takes no value. Use: bolt --version";
    }
    if (eq !== -1 && HELP.has(name)) {
      return `${name} takes no value. Use: bolt --help (or bolt <command> --help)`;
    }
    // `-v` / `-V` almost always mean the version, not `-h` (shared leading `-`).
    const hint =
      name === "-v" || name === "-V"
        ? ' Did you mean "--version"?'
        : formatDidYouMean(closestMatches(name, GLOBAL_FLAGS));
    return (
      `Unknown global flag "${arg}".${hint} ` +
      `Flags go after the command, e.g. bolt run <task> --dry-run. ` +
      `Only -h, --help and --version may come before it.`
    );
  }

  if (before.some((arg) => HELP.has(arg))) return undefined;
  if (before.includes("--version") && argv.length > 1) {
    return "--version must be used on its own. Use: bolt --version";
  }
  return undefined;
}

/** A command tree node: only the parts needed to resolve subcommand names. */
export interface CommandNode {
  subCommands?: unknown;
}

function subCommandsOf(node: unknown): Record<string, unknown> | undefined {
  const subs = (node as CommandNode | undefined)?.subCommands;
  if (!subs || typeof subs !== "object") return undefined;
  return Object.keys(subs).length > 0 ? (subs as Record<string, unknown>) : undefined;
}

function commandListMessage(prefix: string, names: string[]): string {
  return `  Commands: ${names.join(", ")}\n` + `  Run ${prefix} --help for details.`;
}

/**
 * Validate subcommand names before citty sees them. citty answers an unknown command
 * (`bolt rn mark`) with the full usage dump and exit 1; this returns a short
 * `Unknown command "rn". Did you mean "run"?` plus the list of commands instead.
 * Walks nested subcommands too (`bolt plugin nw`). A parent with no subcommand
 * (`bolt plugin`) is also a usage error. Optional `projectNames` are task/flow names
 * from the nearest bolt.yaml so `bolt build` can suggest `bolt run build`.
 * Returns undefined when argv is fine.
 */
export function checkCommandName(
  argv: string[],
  root: CommandNode,
  projectNames?: Iterable<string>,
): string | undefined {
  if (argv.some((arg) => HELP.has(arg))) return undefined;
  let node: unknown = root;
  let rest = argv;
  const path = ["bolt"];
  for (;;) {
    const subs = subCommandsOf(node);
    if (!subs) return undefined;
    const names = Object.keys(subs);
    const index = rest.findIndex((arg) => !arg.startsWith("-"));
    if (index === -1) {
      // Bare `bolt` still goes to citty. Nested parents need a subcommand (`bolt plugin`).
      if (path.length === 1) return undefined;
      return `No command specified.\n${commandListMessage(path.join(" "), names)}`;
    }
    const name = rest[index];
    if (Object.hasOwn(subs, name)) {
      node = subs[name];
      rest = rest.slice(index + 1);
      path.push(name);
      continue;
    }
    const prefix = path.join(" ");
    // Top-level aliases and "forgot run" only apply at the root.
    if (path.length === 1) {
      const alias = COMMAND_ALIASES[name];
      if (alias) {
        return `Unknown command "${name}". Did you mean "${alias}"?\n${commandListMessage(prefix, names)}`;
      }
      // An exact task/flow name beats a fuzzy command match (`bolt lint` → `bolt run lint`, not `list`).
      if (projectNames) {
        for (const projectName of projectNames) {
          if (projectName === name) {
            return (
              `Unknown command "${name}". Did you mean "bolt run ${name}"?\n` +
              commandListMessage(prefix, names)
            );
          }
        }
      }
      const matches = closestMatches(name, names);
      if (matches.length > 0) {
        return `Unknown command "${name}".${formatDidYouMean(matches)}\n${commandListMessage(prefix, names)}`;
      }
      return `Unknown command "${name}".\n${commandListMessage(prefix, names)}`;
    }
    const matches = closestMatches(name, names);
    return (
      `Unknown command "${name}".${formatDidYouMean(matches)}\n` + commandListMessage(prefix, names)
    );
  }
}
