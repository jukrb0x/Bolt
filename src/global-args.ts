/**
 * Validate argv before citty sees it. citty silently drops every argument that comes
 * before the subcommand name, so `bolt --dry-run run deploy` would execute for real.
 * Before the subcommand only `-h`, `--help` and a lone `--version` are allowed.
 *
 * Returns an error message, or undefined when argv is acceptable.
 */
export function checkGlobalArgs(argv: string[]): string | undefined {
  const sub = argv.findIndex((arg) => !arg.startsWith("-"));
  const before = sub === -1 ? argv : argv.slice(0, sub);
  for (const arg of before) {
    if (arg === "-h" || arg === "--help") continue;
    if (arg === "--version" && argv.length === 1) continue;
    return (
      `Unknown global flag "${arg}". Flags go after the command: ` +
      `bolt run <task> --dry-run (only -h, --help and a lone --version are allowed before it).`
    );
  }
  return undefined;
}
