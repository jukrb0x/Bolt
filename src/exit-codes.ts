/**
 * Process exit codes for the bolt CLI. Scripts can rely on these values.
 *
 * - 0 success
 * - 1 task failure (a step failed while running)
 * - 2 usage error (unknown flag/command/task, malformed param) or EMPTY_SHELL
 * - 3 config error (bolt.yaml missing, unreadable, unparseable, schema errors, invalid
 *   task graph, a config problem found by --dry-run, a missing/stale/invalid
 *   bolt.plugin.json on the bolt ai path, MANIFEST_INVALID, or CHECK_UNKNOWN)
 * - 4 denied: AI_FORBIDDEN, CONFIRM_REQUIRED, PLAN_MISMATCH, AGENT_EXECUTION_DISABLED,
 *   and PLUGIN_NOT_BUILT at agent execute time
 * - 70 INTERNAL (crash; a JSON envelope is still emitted)
 * - 130 INTERRUPTED (SIGINT / Ctrl+Break)
 */
export const EXIT_SUCCESS = 0;
export const TASK_FAILURE_EXIT_CODE = 1;
export const USAGE_EXIT_CODE = 2;
export const CONFIG_EXIT_CODE = 3;
/** Policy refusals. Same value as AI_FORBIDDEN_EXIT_CODE. */
export const DENIED_EXIT_CODE = 4;
export const INTERNAL_EXIT_CODE = 70;
export const INTERRUPTED_EXIT_CODE = 130;
