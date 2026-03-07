---
title: "CLI Reference"
---

Bolt provides a comprehensive CLI for Unreal Engine workflow automation.

## Command Overview

| Command | Description |
|---------|-------------|
| [`bolt go`](./go.md) | Run one or more ops in pipeline order |
| [`bolt run`](./run.md) | Run a named action from bolt.yaml |
| [`bolt list`](./list.md) | List all available ops and actions |
| [`bolt info`](./info.md) | Show project and VCS status |
| [`bolt check`](./check.md) | Validate bolt.yaml |
| [`bolt init`](./init.md) | Initialize a new bolt.yaml |
| [`bolt config`](./config.md) | Manage configuration |
| [`bolt plugin`](./plugin.md) | Manage plugins |
| [`bolt inspect`](./inspect.md) | Debug op steps |
| [`bolt help`](./help.md) | Interactive help system |
| [`bolt version`](./version.md) | Print version |
| [`bolt self-update`](./self-update.md) | Update to latest release |

## Global Options

These options work with all commands:

| Flag | Description |
|------|-------------|
| `--help` | Show help for a command |
| `--version` | Print Bolt version |

## Common Patterns

### Pipeline Execution

```bash
# Run ops in pipeline order (respects go-pipeline.order)
bolt go update build start

# Preview without executing
bolt go update build --dry-run
```

### Variant Selection

```bash
# Use a specific op variant
bolt go build:ci

# Pass inline parameters
bolt go build --config=debug --platform=Win64
```

### Action Execution

```bash
# Run a named action
bolt run package-game

# With parameters
bolt run deploy --env=staging
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (config not found, validation failed, execution error) |

## Configuration Discovery

Bolt searches for `bolt.yaml` by walking up the directory tree from the current working directory. The first file found is used.

```
/current/working/dir/bolt.yaml     # Found first, used
/current/working/bolt.yaml         # Not checked
/current/bolt.yaml                 # Not checked
```

## See Also

- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
- [Getting Started](/guides/getting-started.md) - Quick start guide
