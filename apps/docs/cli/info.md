---
title: "bolt info"
---

Show a summary of the project configuration from `bolt.yaml`.

## Usage

```bash
bolt info
```

## Description

Prints a summary loaded from `bolt.yaml`:

- **Project** — config version and `project.name`
- **Tasks** — every task name (`bolt run <task...>`)
- **Flows** — every flow name and its ordered steps (`bolt run <flow>`)

## Options

None.

## Examples

```bash
bolt info
```

Output example:

```
bolt.yaml: /path/to/bolt.yaml

PROJECT

  version      1
  name         MyProject

TASKS

  kill
  update
  build
  start

FLOWS

  daily                   update → build → start
  reset                   kill → update → genproj → build
```

## See Also

- [bolt list](./list.md) - List tasks and flows
- [bolt check](./check.md) - Validate bolt.yaml
