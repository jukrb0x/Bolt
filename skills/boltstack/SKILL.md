---
name: boltstack
description: Use when the user asks to build, update, launch, or automate Unreal Engine workflows using Bolt. Triggers include mentioning bolt, UE builds, editor builds, SVN/git updates, daily workflows, pipeline ops, or any task defined in bolt.yaml.
---

# Bolt — UE Workflow Automation

Bolt is a CLI tool for automating Unreal Engine workflows. Each project has its own `bolt.yaml` defining available commands. **You must never assume commands — always discover them from this project.**

## Capability gate

Run `bolt version --json` first. Branch on capabilities, never on the version number. If stdout is not JSON, this binary has no capabilities: do not run `bolt run` in any form. Hand the user the command.

- `agent` and `execute`: you may execute a plan whose effective `ai` is `true`, with `--execute --plan=<plan_hash>`. Do not pass `--confirmed-by-user` for a `true` plan.
- `agent`, `execute`, and `confirm`: you may also execute a plan whose effective `ai` is `"confirm"`, and only after the user approves that exact plan. Then pass `--confirmed-by-user`. Do not skip confirmation.
- Without `confirm`, do not execute a `"confirm"` plan. Show the plan and hand the user the human `bolt run` command.
- Effective `ai` `false` (including `ue/kill`, `ue/svn_revert`, `ue/svn_cleanup`, `ue/fix_dll`, and `fs/delete`): do not execute. Hand the user the command.
- An exit 2 whose stdout is not JSON means drop back to handing the user commands.

## Loop

Do not skip confirmation. Discover, preview, confirm, then execute. A fresh preview before every execution.

1. **Discover.** `bolt list --json`, `bolt info --json`, `bolt status --json`, and `bolt inspect <names> --json` (`bolt.list/v1`, `bolt.info/v1`, `bolt.status/v1`, `bolt.inspect/v1`). `bolt doctor --json` is `bolt.doctor/v1`. `bolt why --json` is `bolt.why/v1`. Error checks and diagnostics stay in `data`; the exit stays 0 unless `--fix` or `--fail` is set. `bolt ai --json` prints `bolt.catalog/v1` (plugins and handlers; `ai: false` handlers are omitted) and writes nothing. `bolt ai --stdout` prints `.bolt/ai-context.md` and writes nothing. Use only names from this output. Do not guess a task.
2. **Preview.** `bolt run --dry-run <names…> [--key=value] --json`. Read `data.ai`, `data.ai_reasons`, and `data.plan_hash`. This is a static preview: no plugins, hooks, handlers, or file writes.
3. **Confirm.** If `data.ai` is `"confirm"`, show the plan and ask the user. Wait for a yes to that plan. Do not skip confirmation. If `data.ai` is `false`, stop and hand the user the command. If `data.ai` is `true`, no extra yes is required for Bolt, but still show the plan.
4. **Execute.** Only after that preview:
   - `true`, and capabilities include `agent` and `execute`: `bolt run <same names and params> --execute --plan=<plan_hash> --json`
   - `"confirm"`, and capabilities also include `confirm`, and the user said yes: the same command plus `--confirmed-by-user`
   - Missing `--confirmed-by-user` on a confirm plan is `CONFIRM_REQUIRED` (exit 4). Re-run with the flag only after the user approves.
   - `ai.run: never` is `AGENT_EXECUTION_DISABLED` (exit 4) for every agent execute.

`--execute`, `--plan`, and `--confirmed-by-user` imply agent mode. Do not set `BOLT_AGENT` yourself. Do not combine `--execute` with `--dry-run` or `--simulate`.

## Client allowlist

The client allowlist is the real boundary. Bolt cannot tell a false `--confirmed-by-user` from a real yes.

- Auto-allow `bolt version`, `bolt list`, `bolt info`, `bolt check`, `bolt inspect`, `bolt status`, `bolt doctor`, `bolt why`, `bolt ai --stdout`, `bolt ai --json`, and only the prefix `bolt run --dry-run`. `bolt doctor` and `bolt why` only read. Pass `--fix` or `--fail` only when the user wants a non-zero exit for an error check or diagnostic. Those flags do not edit files.
- Never auto-allow any other `bolt run` (`--execute`, `--simulate`, `--confirmed-by-user`, or a run without the leading `--dry-run`), `bolt plugin build`, `bolt self-update`, `bolt init`, `bolt migrate`, or default `bolt ai` (it writes `.bolt/ai-context.md`).
- On Windows, write rules with the absolute path `%USERPROFILE%\.bolt\bin\bolt.exe` so a `bolt.cmd` or `bolt.exe` in the repository cannot take its place.

## Model

- A **task** is a named list of steps (the only building block).
- A **flow** is an ordered set of tasks. Fail-fast: the first failing task aborts the flow, unless it is listed in `continue_on_fail`.
- One verb, `bolt run`: pass task names to run them in the order you type, or a single flow name to run a predefined flow. What you type is what runs — there is no hidden reordering.
- Step keys are strict: `uses` invokes a plugin/local action, `call` reuses a task, and `run` executes a shell command.
- One start notification per invocation shows top-level tasks and their recursively owned actions.

## Config split

- `bolt.yaml` — shared, committed contract (project identity, tasks, flows, targets). No machine paths.
- `bolt.local.yaml` — per-machine paths (engine/project/uproject) and `ai.run` (`never` or `confirm`, default `confirm`). Gitignored. `bolt init` scaffolds both. `ai.run: never` refuses agent execute. A human `bolt run` without agent flags ignores it.

## Command syntax

```bash
bolt run --dry-run update build --json
bolt run update build start --execute --plan=<plan_hash> --confirmed-by-user --json
bolt run build --target=client
bolt run build --config=debuggame   # aliases: dbggame, DebugGame
```

| Flag                  | Effect                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--dry-run`           | Pure preview: prints each step as `would run …`; no commands, plugins, hooks, handlers, or file writes      |
| `--simulate`          | Loads plugins and runs hooks and handlers with `ctx.dryRun = true`; may have side effects. Ask first.       |
| `--json`              | On `run`, one `bolt.run/v1` document. On `ai`, one `bolt.catalog/v1` document.                              |
| `--execute`           | Execute the previewed plan. Requires `--plan=<plan_hash>`. Implies agent mode.                              |
| `--plan=<plan_hash>`  | Drift token from the preview. Not proof a human saw the plan.                                               |
| `--confirmed-by-user` | Required for effective `ai: "confirm"`. Pass it only after the user approves that plan. Implies agent mode. |
| `--key=value`         | Pass a parameter to the whole run (e.g. `--target=client`)                                                  |
| `-- key=value`        | Params after a bare `--`; use when the value starts with `--` (e.g. `-- extra=--verbose`)                   |

Flags go after the command (`bolt run --dry-run build`, never `bolt --dry-run run build`). **Every** `bolt` command rejects unknown flags and undeclared reserved names with exit code 2. On `bolt run` / `bolt inspect`, `--dry-run=<value>`, param values starting with `--`, and reserved names (`dry-run`, `simulate`, `json`, `agent`, `execute`, `plan`, `confirmed-by-user`; plus `help`) used as params also fail with exit code 2. `bolt list --json`, `bolt info --json`, `bolt check --json`, `bolt inspect --json`, and `bolt status --json` each print one JSON document. `bolt inspect --json` includes `plan_hash` and masks env and local values. `bolt status` is read-only and does not accept `--agent`. Unknown commands and task names exit 2 with `Did you mean "<name>"?`. If a run param clashes with a reserved name, rename it to `my_<name>`. Reserved names are case-sensitive.

A human `bolt run` with none of `--json`, `--agent`, `--execute`, `--plan`, or `--confirmed-by-user` stays the text path, including a text `--dry-run`.

## Safety rules

1. **Preview, then confirm, then execute.** `bolt run --dry-run` is safe to run without asking. `--simulate` runs plugin code, so get the user's consent before running it. Do not skip confirmation for a `"confirm"` plan. Never auto-allow `--execute`.
2. **Never execute a `kill` task.** `ue/kill` is `ai: false`. It terminates UE processes. Hand that command to the user.
3. **Respect fail-fast** — flows abort on the first failing task by default; do not work around an aborted flow unless the user explicitly asks.
4. **Do not modify bolt.yaml / bolt.local.yaml** unless the user explicitly asks. Configuration changes can break workflows.

## Common patterns

Check discovered task names. They vary per project. Typical:

- `bolt run --dry-run build --json`, then execute with the returned `plan_hash` after confirmation when the plan is `"confirm"`
- `bolt run build --target=editor`
- `bolt run update build start`
- `bolt run daily` (if a flow is defined)
- `bolt run build --config=debug` or `--config=debuggame` (`dbggame` and `DebugGame` are aliases)

## Errors

Branch on `errors[].code` and the exit code, not on message text.

| Exit | Code                                      | What to do                                                                                                                                   |
| ---- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | `USAGE` / `UNKNOWN_FLAG` / `UNKNOWN_NAME` | Fix the command. Do not invent a task name.                                                                                                  |
| 3    | `CONFIG_INVALID` and other `CONFIG_*`     | `bolt ai --json` uses this when `bolt.plugin.json` is missing or stale. Ask the user to run `bolt plugin build <ns>`. Never auto-allow that. |
| 4    | `CONFIRM_REQUIRED`                        | Ask the user. Re-run with `--confirmed-by-user` only after they approve.                                                                     |
| 4    | `AI_FORBIDDEN`                            | Hand the user the human `bolt run` command.                                                                                                  |
| 4    | `AGENT_EXECUTION_DISABLED`                | `bolt.local.yaml` has `ai.run: never`. Tell the user. Do not try to override it.                                                             |
| 4    | `PLAN_MISMATCH` / `PLUGIN_NOT_BUILT`      | Preview again, or ask the user to build the plugin.                                                                                          |
| 1    | `RUN_FAILED`                              | The step failed. Read stderr and the log path.                                                                                               |

| Symptom                                          | Cause                                        | Fix                                                                                   |
| ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| "bolt.yaml not found"                            | Not in a Bolt project directory              | `cd` to the project root                                                              |
| "bolt.local.yaml missing or invalid"             | Per-machine config absent                    | Copy `bolt.local.example.yaml` → `bolt.local.yaml` (or run `bolt init`) and set paths |
| `Unknown task "…"` / `Unknown flow "…"` (exit 2) | Name not defined in this project's bolt.yaml | Use the "Did you mean" hint, or run `bolt list`                                       |
| Build fails mid-flow                             | Build error in UE                            | Check the log file path printed in output                                             |
