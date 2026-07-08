---
title: "bolt init"
---

Scaffold `bolt.yaml` (shared) + `bolt.local.yaml` (per-machine) in the current directory.

## Usage

```bash
bolt init [--force]
```

## Description

`bolt init` writes two starter files into the current directory:

- **`bolt.yaml`** — the shared, committed contract (project identity, targets,
  tasks, flows). No machine paths.
- **`bolt.local.yaml`** — per-machine paths (`engine_path`, `project_path`,
  `uproject`), gitignored.

It is **non-interactive**: no question-and-answer wizard and no remote-template
fetching. Each file is written only if it does not already exist; existing files
are skipped unless you pass `--force`.

When writing `bolt.local.yaml`, `init` scans the current directory (and one level
down) for a single `.uproject`. If exactly one is found, its path is filled in
automatically; otherwise the path is left as a `CHANGE_ME` placeholder for you to edit.

## Options

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--force` | `-f` | `false` | Overwrite `bolt.yaml` / `bolt.local.yaml` if they already exist |

## Examples

```bash
# Scaffold both files (skips any that already exist)
bolt init

# Overwrite existing files
bolt init --force
bolt init -f
```

## Output

```
✓ wrote bolt.yaml
✓ wrote bolt.local.yaml (detected MyProject.uproject)

Edit bolt.local.yaml paths, then run: bolt check
```

If a file already exists and `--force` was not given:

```
• skipped bolt.yaml (exists; use --force)
```

## Next Steps

1. Edit the paths in `bolt.local.yaml` for your machine (the `engine_path` is
   always a placeholder you must set).
2. Run [`bolt check`](./check.md) to validate both files.

## See Also

- [Getting Started](/guides/getting-started) - Quick start guide
- [bolt check](./check.md) - Validate bolt.yaml and bolt.local.yaml
- [bolt.yaml Reference](/guides/bolt-yaml) - Configuration schema
