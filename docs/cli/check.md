---
title: "bolt check"
---

Validate bolt.yaml against the schema.

## Usage

```bash
bolt check
```

## Description

Validates your `bolt.yaml` configuration file against Bolt's schema. Reports each schema error as `path → message`. Checks file existence, YAML syntax, and full Zod schema validation.

## Options

None.

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Configuration is valid |
| 1 | Configuration has errors |

## Examples

```bash
# Check configuration
bolt check

# Use in CI scripts
bolt check && bolt go build:ci
```

Output on error:
```
[ERROR] Validation failed:
  project.name → Required
  targets.editor.kind → Expected 'editor' | 'program' | 'game' | 'client' | 'server'
```

## See Also

- [bolt info](./info.md) - Show project configuration
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
