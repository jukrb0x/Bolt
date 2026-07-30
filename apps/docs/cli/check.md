---
title: "bolt check"
---

Validate `bolt.yaml` and (if present) `bolt.local.yaml`.

## Usage

```bash
bolt check
```

## Description

Validates your configuration against Bolt's schema. It checks **both** files:

- **`bolt.yaml`** — file existence, YAML syntax, and full schema validation
  (project identity, targets, tasks, flows).
- **`bolt.local.yaml`** — if present, its YAML syntax and schema
  (`engine_path`, `project_path`, `uproject`). If it is **missing**, that is
  surfaced as an error with an actionable hint.

Every problem is reported as a `path → message` row. A missing or invalid
`bolt.local.yaml` does not stop the check — it is collected alongside any
`bolt.yaml` errors so you see everything at once.

## Options

None.

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Both files are valid |
| 1 | `bolt.yaml` not found, or one or more validation errors |

## Examples

```bash
# Validate configuration
bolt check

# Use in CI: only build if the config is valid
bolt check && bolt run build
```

Output when valid:
```
bolt.yaml: /path/to/bolt.yaml
✓ bolt.yaml is valid
```

Output when the per-machine file is missing:
```
bolt.yaml: /path/to/bolt.yaml
✗ bolt.yaml has 1 error(s):

  bolt.local.yaml                     missing — copy bolt.local.example.yaml or run bolt init
```

Legacy task composition is intentionally rejected in v2. Replace `uses: task/name` with `call: name`; `uses` is reserved for plugin/local actions.

Output on a schema error:
```
bolt.yaml: /path/to/bolt.yaml
✗ bolt.yaml has 2 error(s):

  project.name                        Required
  targets.editor.kind                 Invalid enum value
```

## See Also

- [bolt info](./info.md) - Show project configuration
- [bolt init](./init.md) - Scaffold bolt.yaml and bolt.local.yaml
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
