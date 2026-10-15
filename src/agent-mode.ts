/** `BOLT_AGENT` trimmed. `1` and `true` (any case) turn agent mode on. */
export function envAgentOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.BOLT_AGENT;
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true";
}

export interface AgentFlags {
  agent?: boolean;
  execute?: boolean;
  /** Present when `--plan` was passed, including an empty value. */
  plan?: string;
  confirmedByUser?: boolean;
}

/**
 * `--execute`, `--plan`, or `--confirmed-by-user` imply agent mode, so those
 * flags always take the full checks. There is no execute-without-hash path.
 */
export function isAgentMode(flags: AgentFlags, env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    flags.agent === true ||
    flags.execute === true ||
    flags.plan !== undefined ||
    flags.confirmedByUser === true ||
    envAgentOn(env)
  );
}
