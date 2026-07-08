---
title: "bolt info"
---

Show a summary of the project configuration from `bolt.yaml` (merged with `bolt.local.yaml`).

## Usage

```bash
bolt info
```

## Description

Prints a summary of your project configuration. The values come from two files:
the shared, committed `bolt.yaml` (identity, targets, tasks, flows) merged with
the per-machine `bolt.local.yaml` (paths). The summary includes:

- **Project** — name and resolved `uproject` path
- **Engine repo** — resolved path plus VCS identity (vcs, url, branch)
- **Project repo** — resolved path plus VCS identity (vcs, url)
- **Targets** — configured build targets
- **Tasks** — every task name (`bolt run <task...>`)
- **Flows** — every flow name and its ordered steps (`bolt run <flow>`)

<Note>
Repo paths shown here come from `bolt.local.yaml`; the identity (vcs/url/branch)
comes from `bolt.yaml`. See the [config split](#config-split) below.
</Note>

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

  name         MyProject
  uproject     D:/Games/MyProject/MyProject.uproject

ENGINE REPO

  path         D:/UE
  vcs          git
  branch       main

PROJECT REPO

  path         D:/Games/MyProject
  vcs          svn

TARGETS

  editor      editor · development
  client      program · MyClient · shipping

TASKS

  kill
  update
  build
  start

FLOWS

  daily                   update → build → start
  reset                   kill → update → genproj → build
```

## Config split

`bolt info` reflects the two-file layout:

| File | Committed? | Holds |
|------|-----------|-------|
| `bolt.yaml` | Yes | Project identity, targets, tasks, flows |
| `bolt.local.yaml` | No (gitignored) | `engine_path`, `project_path`, `uproject` |

Relative paths in `bolt.local.yaml` resolve against the directory containing
`bolt.yaml`.

## See Also

- [bolt list](./list.md) - List tasks and flows
- [bolt check](./check.md) - Validate bolt.yaml and bolt.local.yaml
