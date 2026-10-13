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
