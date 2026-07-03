---
title: "bolt config"
---

Manage Bolt configuration.

## Usage

```bash
bolt config [command]
```

## Subcommands

| Command | Description |
|---------|-------------|
| `list` | List current configuration values |
| `get <key>` | Get a specific configuration value |
| `set <key> <value>` | Set a configuration value |

## Examples

```bash
# List all configuration
bolt config list

# Get a specific value
bolt config get project.name

# Set a configuration value
bolt config set notifications.on_failure true
```

## See Also

- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
- [bolt check](./check.md) - Validate bolt.yaml
