---
title: "bolt init"
---

Scaffold `bolt.yaml` in the current directory.

## Usage

```bash
bolt init [--force]
```

## Description

`bolt init` writes `bolt.yaml` into the current directory:

- **`bolt.yaml`** — `version: 1`, a project name, and a sample task and flow.

It is **non-interactive**: no question-and-answer wizard and no remote-template
fetching. The file is written only if it does not already exist, unless you pass
`--force`. Unreal metadata is not generated; add a `ue` plugin entry yourself.

## Options

| Flag      | Alias | Default | Description                                |
| --------- | ----- | ------- | ------------------------------------------ |
| `--force` | `-f`  | `false` | Overwrite `bolt.yaml` if it already exists |

## Examples

```bash
# Scaffold bolt.yaml (skips it if it already exists)
bolt init

# Overwrite an existing bolt.yaml
bolt init --force
bolt init -f
```

## Output

```
✓ wrote bolt.yaml

Commit bolt.yaml. Put machine-specific vars in bolt.local.yaml (gitignored).
Then run: bolt check
```

If a file already exists and `--force` was not given:

```
• skipped bolt.yaml (exists; use --force)
```

## Next Steps

1. Add a `ue` plugin entry when the project uses Unreal handlers.
2. Run [`bolt check`](./check.md) to validate `bolt.yaml`.

## See Also

- [Getting Started](/guides/getting-started) - Quick start guide
- [bolt check](./check.md) - Validate bolt.yaml
- [bolt.yaml Reference](/guides/bolt-yaml) - Configuration schema
