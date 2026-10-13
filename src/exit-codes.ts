/**
 * Process exit codes for the bolt CLI. Scripts can rely on these values.
 *
 * - 0 success
 * - 1 task failure (a step failed while running)
 * - 2 usage error (unknown flag/command/task, malformed param)
 * - 3 config error (bolt.yaml missing, unreadable YAML, schema errors, invalid task graph)
 * - 4 permission denied (bolt.yaml exists but cannot be read)
 */
export const EXIT_SUCCESS = 0;
export const TASK_FAILURE_EXIT_CODE = 1;
export const USAGE_EXIT_CODE = 2;
export const CONFIG_EXIT_CODE = 3;
export const PERMISSION_EXIT_CODE = 4;
