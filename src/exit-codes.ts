/**
 * Process exit codes for the bolt CLI. Scripts can rely on these values.
 *
 * - 0 success
 * - 1 task failure (a step failed while running)
 * - 2 usage error (unknown flag/command/task, malformed param)
 * - 3 config error (bolt.yaml missing, unreadable, unparseable, schema errors, invalid
 *   task graph, a config problem found by --dry-run, or a missing/stale/invalid
 *   bolt.plugin.json on the bolt ai path)
 * - 4 denied: reserved for AI_FORBIDDEN (see AI_FORBIDDEN_EXIT_CODE in handler-result.ts)
 */
export const EXIT_SUCCESS = 0;
export const TASK_FAILURE_EXIT_CODE = 1;
export const USAGE_EXIT_CODE = 2;
export const CONFIG_EXIT_CODE = 3;
