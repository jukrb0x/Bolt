---
title: "bolt plugin"
---

Manage Bolt plugins.

## Usage

```bash
bolt plugin <command>
```

## Subcommands

| Command | Description |
|---------|-------------|
| `list` | List all active plugins and their handlers |
| `new <name>` | Scaffold a new plugin |

## bolt plugin list

List all active plugins and their handlers.

```bash
bolt plugin list
```

Shows namespace and handler names for all discovered plugins:
- Built-in plugins (ue, fs, json)
- User-scope plugins (`~/.bolt/plugins/`)
- Project-scope plugins (`.bolt/plugins/` or declared in `bolt.yaml`)

## bolt plugin new

Scaffold a new plugin.

```bash
bolt plugin new <name> [--user]
```

| Flag | Description |
|------|-------------|
| `--user` | Create in user scope (`~/.bolt/plugins/`) instead of project scope |

Name must match `/^[a-z0-9_-]+$/`.

Creates `index.ts`, `tsconfig.json`, and `package.json` in the plugin directory. Run `bun install` in the created directory to set up IDE type support.

## Examples

```bash
# Create a project-scope plugin
bolt plugin new myplugin

# Create a user-scope plugin
bolt plugin new myplugin --user

# After creating, install dependencies
cd .bolt/plugins/myplugin
bun install
```

## See Also

- [Plugin System](/guides/plugin-system.md) - How plugins work
- [Plugin API](/api/plugin-api.md) - Plugin API reference
- [Plugin Development](/guides/plugin-development.md) - Tutorial
