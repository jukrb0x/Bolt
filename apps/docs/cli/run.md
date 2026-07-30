---
title: "bolt run"
---

Run tasks (in the order you type) or a single flow defined in `bolt.yaml`.

## Usage

```bash
bolt run <name...> [--dry-run] [--key=value ...]
```

## Description

`bolt run` is the one verb for executing work. A **task** is a named list of
steps; a **flow** is a named, ordered set of tasks. You pass names positionally:

- **Multiple tasks** — `bolt run update build start` runs each named task in the
  **exact order you typed**. There is no hidden reordering.
- **A single flow** — `bolt run daily` runs the flow's steps in order. A single
  name is treated as a flow only if it matches a flow; otherwise it must be a task.

If any name is neither a task nor a flow, the run fails before executing anything
with `Unknown task or flow: "<name>"`, followed by the available tasks and flows.

Flows are **fail-fast**: the first failing task aborts the flow, unless that task
is listed in the flow's `continue_on_fail`.

## Parameters

Trailing `--key=value` flags are collected as params that apply to the **whole
run**. They shallow-override each step's `with:` values (params win), and are
available in interpolation as `${{ params.key }}`.

```bash
bolt run build --target=client      # override the build target
bolt run build --config=debug       # override the build configuration
```

**Config shorthand** for the `config` param: `dev` → `development`, `dbg` → `debug`, and `dbggame`/`DebugGame` → `debuggame`.

```bash
bolt run build --config=dev          # resolves to development
bolt run build_editor --config=debuggame # aliases: dbggame, DebugGame
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | `false` | Print the resolved steps without executing |
| `--<key>=<value>` | - | Pass a param to the whole run (overrides `with:`) |

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<name...>` | Yes | One or more task names, or a single flow name |

## Examples

```bash
# Run tasks in the typed order
bolt run update build start

# Run a predefined flow
bolt run daily

# Override a step's with: value for the whole run
bolt run build --target=client

# Build a specific configuration (shorthand)
bolt run build --config=dbg

# Preview the resolved steps without executing
bolt run update build --dry-run
```

## Defining Tasks and Flows

Tasks and flows live in `bolt.yaml`. The three execution keys are `uses` for a
plugin/local action, `call` for a reusable task (cycle-detected), and `run` for a
shell command.

```yaml
tasks:
  kill:    [{ uses: ue/kill }]
  update:  [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build:   [{ uses: ue/build, with: { target: editor } }]
  build_editor: [{ call: build, with: { config: debuggame } }]
  start:   [{ uses: ue/start }]

flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]   # update/build failures abort; start may fail
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]    # kill may fail (nothing running) without aborting
```

<Note>
**Migrating from v1?** `bolt go`, ops, and variants are gone. Replace
`bolt go update build` with `bolt run update build`, and replace op variants
(`build:client`) with params (`--target=client`). Legacy `uses: task/name` is
rejected; replace it with `call: name`.
</Note>

Multi-task start notifications are sent once per invocation. They show the
top-level task list and each recursively owned action.

## See Also

- [bolt list](./list.md) - List available tasks and flows
- [bolt inspect](./inspect.md) - Preview resolved steps
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
