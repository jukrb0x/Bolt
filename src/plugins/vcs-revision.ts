/**
 * Shared failure shape for built-in `vcs.revision` handlers.
 * Core reads `diagnostics[].code` when it starts with `VCS_`.
 */
import type { HandlerResult } from "../handler-result";

const AUTH =
  /authenticat|authorization failed|permission denied|could not read username|terminal prompts disabled|E170001|E215004|forbidden/i;

export function vcsFailureCode(text: string, fallback: string): string {
  return AUTH.test(text) ? "VCS_AUTH" : fallback;
}

export function vcsFail(code: string, message: string): HandlerResult {
  const summary = message.replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    status: "fail",
    summary,
    diagnostics: [{ level: "error", code, message: summary }],
  };
}
