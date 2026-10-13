---
title: "bolt migrate"
---

Rewrite a bolt v2.0 `bolt.yaml` and `bolt.local.yaml` to the current format.

## Usage

```bash
bolt migrate [--dry-run]
```

## Description

- Adds `version: 1`.
- Moves `project.engine`, `project.project`, and root `targets` to the `ue` plugin config in `bolt.yaml`. Adds a `ue` plugin entry if there is none.
- Moves other `project.<key>` strings to `vars.<key>`, and prints a note to replace `${{ project.<key> }}` with `${{ vars.<key> }}`.
- Moves `engine_path`, `project_path`, and `uproject` to `plugins.ue` in `bolt.local.yaml`, and `use_tortoise` to `plugins.svn` (adding an `svn` plugin entry to `bolt.yaml` if needed).
- Copies each original to `<file>.v2.0.bak` (or `.v2.0.bak.N` if that exists) before writing, then runs `bolt check`.

YAML comments are not carried over; they remain in the backups. A version 1 config is left alone.

## Options

| Option      | Description                                 |
| ----------- | ------------------------------------------- |
| `--dry-run` | Print the converted files and write nothing |

## Exit Codes

| Code | Description                                                       |
| ---- | ----------------------------------------------------------------- |
| 0    | Nothing to migrate, dry run printed, or files rewritten and valid |
| 1    | `bolt.yaml` not found, or the rewritten config still has errors   |

## See Also

- [bolt check](./check.md)
- [bolt.yaml Guide](/guides/bolt-yaml.md)
