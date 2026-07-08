---
title: "Daily Workflow"
---

A real-world guide to driving daily UE development with `bolt run`.

## The One Verb: `bolt run`

Everything runs through `bolt run`. You give it either a list of task names or a single flow name.

- **Ad-hoc tasks** — `bolt run <task> <task> ...` runs the named tasks in the **exact order you type**. There is no hidden reordering.
- **Flows** — `bolt run <flow>` runs a predefined, ordered goal.

## Ad-hoc Ordered Tasks

Chain tasks for a quick morning sync-build-launch:

```bash
bolt run update build start
```

That runs the `update`, `build`, then `start` tasks, in that order. Each is a named list of steps in `bolt.yaml`:

```yaml
tasks:
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build:  [{ uses: ue/build, with: { target: editor } }]
  start:  [{ uses: ue/start }]
```

## Goal Flows

For a repeatable goal, define a flow and run it by name:

```bash
bolt run daily
```

```yaml
flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]
```

`bolt run daily` runs `update → build → start`. `bolt run reset` runs `kill → update → genproj → build`.

## Params

Pass `--key=value` to apply a parameter to the **whole run**. Params override the step's `with:` values and are available in interpolation as `${{ params.key }}`.

```bash
# Build a different target
bolt run build --target=client

# Choose a build configuration
bolt run build --config=debug

# Params apply to every matching step across the run
bolt run update build --target=client
```

## Preview with --dry-run

Always preview destructive or long runs first. `--dry-run` prints the resolved steps without executing them:

```bash
bolt run daily --dry-run
bolt run update build --dry-run
```

## Fail-Fast and `continue_on_fail`

Flows are **fail-fast**: the first failing task aborts the flow and nothing after it runs. To let a specific task fail without aborting, list it in the flow's `continue_on_fail` allowlist.

In the `daily` flow above:
- If `update` or `build` fails, the flow aborts immediately — `start` never runs.
- `start` is in `continue_on_fail`, so if launching the editor fails, Bolt logs a warning and the flow still completes.

In the `reset` flow:
- `kill` is in `continue_on_fail` because it may fail when nothing is running — that failure is expected and does not abort the flow.

> Note: `continue_on_fail` (per-flow, underscore) is an allowlist of *task names*. It is different from `continue-on-error` (per-step, hyphen), which lets a single step inside a task fail. See [Error Handling](./error-handling.md).

## Configuring Notifications

Notifications are configured in `bolt.yaml`:

```yaml
notifications:
  on_complete: true
  on_failure: true
  providers:
    - type: telegram
      bot_token: ${{ env.TELEGRAM_BOT_TOKEN }}
      chat_id: ${{ env.TELEGRAM_CHAT_ID }}
```

## Configuration Summary

```yaml
# bolt.yaml — shared, committed contract
project:
  name: MyGame
  engine:
    vcs: git
    branch: main
  project:
    vcs: svn

targets:
  editor:
    kind: editor
    config: development
  client:
    kind: program
    name: MyClient
    config: shipping

tasks:
  kill:    [{ uses: ue/kill }]
  update:  [{ uses: ue/update_engine }, { uses: ue/update_project }]
  genproj: [{ uses: ue/generate_project }]
  build:   [{ uses: ue/build, with: { target: editor } }]
  start:   [{ uses: ue/start }]

flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]
```

Machine paths live separately in `bolt.local.yaml` (gitignored) — see [Project Structure](/guides/project-structure.md).

## Tips

### Preview before you run

```bash
bolt run daily --dry-run
```

### Inspect what a name resolves to

```bash
bolt inspect daily        # show the resolved steps for a flow or task
bolt list                 # list all tasks and flows
```

### Use continue_on_fail for non-critical tasks

```yaml
flows:
  daily:
    steps: [update, build, start]
    continue_on_fail: [start]   # a failed launch won't abort the flow
```

## See Also
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
- [Error Handling](/guides/error-handling.md) - Fail-fast, continue_on_fail, continue-on-error
- [Project Structure](/guides/project-structure.md) - Config split and layout
