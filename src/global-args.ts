import { closest } from "./suggest";

const HELP = new Set(["-h", "--help"]);

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
    return (
      `Unknown global flag "${arg}". Flags go after the command, e.g. bolt run <task> --dry-run. ` +
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

/**
 * Validate subcommand names before citty sees them. citty answers an unknown command
 * (`bolt rn mark`) with the full usage dump and exit 1; this returns a short
 * `Unknown command "rn". Did you mean "run"?` plus the list of commands instead.
 * Walks nested subcommands too (`bolt plugin nw`). Returns undefined when argv is fine.
 */
export function checkCommandName(argv: string[], root: CommandNode): string | undefined {
  if (argv.some((arg) => HELP.has(arg))) return undefined;
  let node: unknown = root;
  let rest = argv;
  const path = ["bolt"];
  for (;;) {
    const subs = subCommandsOf(node);
    if (!subs) return undefined;
    const index = rest.findIndex((arg) => !arg.startsWith("-"));
    if (index === -1) return undefined;
    const name = rest[index];
    if (Object.hasOwn(subs, name)) {
      node = subs[name];
      rest = rest.slice(index + 1);
      path.push(name);
      continue;
    }
    const names = Object.keys(subs);
    const best = closest(name, names);
    const prefix = path.join(" ");
    return (
      `Unknown command "${name}".${best ? ` Did you mean "${best}"?` : ""}\n` +
      `  Commands: ${names.join(", ")}\n` +
      `  Run ${prefix} --help for details.`
    );
  }
}
