---
title: "bolt list"
---

List all tasks and flows defined in `bolt.yaml`.

## Usage

```bash
bolt list
```

## Description

Lists every **task** (`bolt run <task...>`) and every **flow** (`bolt run <flow>`)
defined in your project. Each flow also shows its ordered steps and description, so
you can see at a glance what a flow will run. Useful for discovering what workflows
are available in your project.

## Options

None.

## Examples

```bash
bolt list
```

Output example:
```
bolt.yaml: /path/to/bolt.yaml

TASKS (bolt run <task...>)

  kill
  update
  genproj
  build
  start

FLOWS (bolt run <flow>)

  daily  update → build → start
    Update, build, and launch the editor
  reset  kill → update → genproj → build
    Kill, update, regenerate, rebuild
```

## See Also

- [bolt run](./run.md) - Run tasks or a flow
- [bolt inspect](./inspect.md) - Preview resolved steps
- [bolt info](./info.md) - Show project configuration
