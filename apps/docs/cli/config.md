---
title: "bolt config"
---

Open the project's `bolt.yaml` in an editor.

## Usage

```bash
bolt config [--editor <editor>]
```

## Description

`bolt config` locates the project's `bolt.yaml` (walking up from the current
directory) and opens it in an editor. If no `bolt.yaml` exists but a
`bolt.template.yaml` is present in the current directory, Bolt creates
`bolt.yaml` from that template first, then opens it.

The editor is resolved in this order:

1. The `--editor` / `-e` flag
2. The `$EDITOR` environment variable
3. The `$VISUAL` environment variable

If none is set, the command exits with an error.

## Options

| Flag | Alias | Description |
|------|-------|-------------|
| `--editor <editor>` | `-e` | Editor to use (overrides `$EDITOR` / `$VISUAL`) |

## Examples

```bash
# Open bolt.yaml in your default editor
bolt config

# Force a specific editor
bolt config --editor code
bolt config -e vim
```

## See Also

- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
- [bolt check](./check.md) - Validate bolt.yaml and bolt.local.yaml
