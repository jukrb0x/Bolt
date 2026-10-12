---
title: "bolt check"
---

Validate `bolt.yaml`. When `bolt.local.yaml` is present, validate that too.

## Usage

```bash
bolt check
```

## Description

Validates your configuration against Bolt's schema:

- **`bolt.yaml`** — file existence, YAML syntax, `version: 1`, and the core schema
  (project name, tasks, flows, plugins). `ue` and `svn` plugin metadata is checked
  when those entries are present.
- **`bolt.local.yaml`** — only if the file exists. It may contain `vars` only.
  A missing file is not an error.

Every problem is reported as a `path → message` row.

## Options

None.

## Exit Codes

| Code | Description                                             |
| ---- | ------------------------------------------------------- |
| 0    | The config is valid                                     |
| 1    | `bolt.yaml` not found, or one or more validation errors |

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

Legacy task composition is intentionally rejected. Replace `uses: task/name` with `call: name`; `uses` is reserved for plugin/local actions.

Output on a schema error:

```
bolt.yaml: /path/to/bolt.yaml
✗ bolt.yaml has 2 error(s):

  version                             config version is required (expected 1)
  project.name                        Required
```

## See Also

- [bolt info](./info.md) - Show project configuration
- [bolt init](./init.md) - Scaffold bolt.yaml
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
