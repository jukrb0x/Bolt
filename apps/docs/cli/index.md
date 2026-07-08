---
title: "CLI Reference"
---

Bolt provides a comprehensive CLI for Unreal Engine workflow automation.

## Command Overview

| Command | Description |
|---------|-------------|
| [`bolt run`](./run.md) | Run tasks (in typed order) or a flow |
| [`bolt list`](./list.md) | List all tasks and flows |
| [`bolt info`](./info.md) | Show project and VCS configuration |
| [`bolt check`](./check.md) | Validate bolt.yaml and bolt.local.yaml |
| [`bolt init`](./init.md) | Scaffold bolt.yaml + bolt.local.yaml |
| [`bolt config`](./config.md) | Manage configuration |
| [`bolt plugin`](./plugin.md) | Manage plugins |
| [`bolt inspect`](./inspect.md) | Preview resolved steps for a task or flow |
| [`bolt version`](./version.md) | Print version |
| [`bolt self-update`](./self-update.md) | Update to latest release |
| `bolt ai` | Generate `.bolt/ai-context.md` for AI agents |

## Global Options

These options work with all commands:

| Flag | Description |
|------|-------------|
| `--help` | Show help for a command |
| `--version` | Print Bolt version |

## Common Patterns

### Run tasks in the typed order

```bash
# Run tasks in the exact order you type — no hidden reordering
bolt run update build start

# Preview without executing
bolt run update build --dry-run
```

### Run a flow

```bash
# Run a predefined, ordered goal
bolt run daily
```

### Pass parameters

```bash
# Params apply to the whole run and override with: values
bolt run build --target=client
bolt run build --config=debug
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (config not found, validation failed, execution error) |

## Configuration Discovery

Bolt searches for `bolt.yaml` by walking up the directory tree from the current
working directory. The first file found is used. Per-machine paths are read from
`bolt.local.yaml` next to it.

```
/current/working/dir/bolt.yaml     # Found first, used
/current/working/bolt.yaml         # Not checked
/current/bolt.yaml                 # Not checked
```

## See Also

- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
- [Getting Started](/guides/getting-started.md) - Quick start guide
