---
title: "Runner Internals"
description: "The `Runner` class in `src/runner.ts` is the execution engine for both `bolt run` and `bolt go`."
---

The `Runner` class in `src/runner.ts` is the execution engine for both `bolt run` and `bolt go`.

## Construction

```typescript
new Runner(cfg: BoltConfig, opts: RunnerOptions)
```

```typescript
interface RunnerOptions {
  dryRun?: boolean;
  logger?: Logger;
  configDir?: string;          // bolt.yaml directory (for resolving relative paths)
  notifier?: Notifier;
  onStep?: (cmd: string) => void;  // test injection hook
}
```

The plugin registry is initialized lazily on first `uses:` dispatch.

## `run(actionName, params)` — Named Actions

1. Looks up `cfg.actions[actionName]`. Throws `Unknown action` if missing.
2. Runs each `depends` entry recursively (depth-first) before own steps. Cycle detection via a `visited: Set<string>` passed through the call chain — throws `"Dependency cycle detected at: <name>"` on re-entry.
3. Iterates `action.steps`, calling `execStep(step, params)` for each.
4. `params` from the call site flows through the entire dependency chain.

## `runOps(ops, pipeline)` — Go Pipeline

1. Sorts ops by `pipeline.order` via `sortByPipeline`.
2. Fires `notifier "start"` event.
3. For each op:
   - Checks timeout: if `cfg.timeout_hours` is set and elapsed time exceeds it, throws `"Build timed out after Xh"`.
   - Executes each step via `execStep(step, op.params)`.
   - On success: logs `SUCCESS`, records result.
   - On failure: logs `FAILED`, fires `notifier "failure"` event.
     - If op is in `pipeline.fail_stops`: fires `"complete"` then **re-throws** (halts run).
     - Otherwise: logs warning and continues to next op.
4. Fires `notifier "complete"` event with full results.

## `execStep(step, opParams)` — Step Dispatch

Two mutually exclusive step types:

**`step.run`** (shell):
1. Interpolates `${{ }}` expressions against `{ project, env }`.
2. Calls `shell(cmd, step["continue-on-error"])`.

**`step.uses`** (handler reference):
1. Delegates to `dispatch(step, ctx, opParams)`.

## `dispatch(step, ctx, opParams)` — Uses Resolution

Three routing cases, checked in order:

**Relative path** (`./` or `../`):
- Runs `runLocalAction(uses, interpolatedParams)`.
- Expects an `action.yaml` in the target directory.
- Tries `run.ts`, `run.js`, `run.py`, `run.sh`, `run.bat` as the runner script.
- Params become `BOLT_INPUT_<KEY>` environment variables.

**`ops/<opName>` or `ops/<opName>:<variant>`**:
- Looks up `cfg.ops[opName][variant]`.
- Merges: `{ ...yamlParams, ...opParams }` — CLI params win.
- Recursively calls `execStep` for each step in the variant's steps.

**`<ns>/<handler>`**:
- Resolves namespace and handler from the plugin registry.
- Merges: `{ ...yamlParams, ...opParams }` — CLI params win.
- Calls `handler(mergedParams, pluginContext)`.

## `shell(cmd, continueOnError)` — Shell Execution

Spawns `["cmd", "/c", cmd]` via `Bun.spawn` with inherited stdio. Awaits exit. Throws `"Command failed (exit N): <cmd>"` if exit code is non-zero and `continueOnError` is false.

## Params Precedence

```
bolt.yaml with: values
      ↓
${{ }} interpolation applied
      ↓
CLI --key=val params merged on top  ← always wins
      ↓
handler / shell receives final params
```
