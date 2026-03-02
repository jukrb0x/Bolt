# Commands Reference

Complete reference for Bolt CLI commands.

## Global Commands

### `bolt go <ops...>`

Run one or more operations in pipeline order.

```bash
bolt go update build start
bolt go build:client --config=shipping
bolt go kill update build start --dry-run
```

**Options:**
- `--dry-run` - Show commands without executing
- `--config=<value>` - Build configuration
- `--target=<name>` - Target name
- `--platform=<value>` - Platform (e.g., Win64)

**Op Variants:**
```bash
bolt go build:editor
bolt go build:client
bolt go update:svn-only
```

**Inline Parameters:**
```bash
bolt go build --config=debug --target=game-client
```

### `bolt run <action>`

Run a named action.

```bash
bolt run daily
bolt run full-reset
```

Actions are defined in `bolt.yaml`:

```yaml
actions:
  daily:
    steps:
      - uses: ops/kill
      - uses: ops/update
      - uses: ops/build
      - uses: ops/start
```

### `bolt list`

List all available ops and actions.

```bash
bolt list
```

Output:
```
Ops:
  update
  build:editor
  build:client
  start:editor
  start:game

Actions:
  daily
  full-reset
```

### `bolt info`

Show project and VCS status.

```bash
bolt info
```

Output:
```
Project: MyGame
Engine: C:/UnrealEngine (git: main)
Project: C:/Projects/MyGame (svn: r1234)

Engine VCS:
  Branch: main
  Commit: abc123def

Project VCS:
  Revision: 1234
  URL: https://svn.example.com/repo
```

### `bolt check`

Validate `bolt.yaml`.

```bash
bolt check
```

Checks:
- Required fields present
- Valid target kinds
- Valid build configurations
- Handler references exist

### `bolt version`

Print Bolt version.

```bash
bolt version
```

### `bolt self-update`

Update Bolt to the latest release.

```bash
bolt self-update
```

Downloads and installs the latest version from GitHub Releases.

### `bolt config`

Open `bolt.yaml` in your editor.

```bash
bolt config
```

Uses the `$EDITOR` environment variable.

## Plugin Commands

### `bolt plugin list`

List active plugins and their handlers.

```bash
bolt plugin list
```

Output:
```
Built-in:
  ue:
    - build
    - start
    - kill
    - update
    - ...

User (~/.bolt/plugins/):
  custom:
    - deploy
    - notify

Project (.bolt/plugins/):
  - (none)
```

### `bolt plugin new <name>`

Create a new plugin.

```bash
# Project-scope plugin
bolt plugin new myplugin

# User-scope plugin
bolt plugin new myplugin --user
```

Creates:
- `.bolt/plugins/myplugin/` (project-scope)
- `~/.bolt/plugins/myplugin/` (user-scope)

With files:
```
myplugin/
├── index.ts
├── package.json
└── tsconfig.json
```

## Global Flags

Available for all commands:

| Flag | Description |
|------|-------------|
| `--help` | Show help |
| `--version` | Show version |
| `--dry-run` | Show commands without executing |

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Operation failed |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EDITOR` | Editor for `bolt config` |
| `BOLT_CONFIG` | Custom path to bolt.yaml |

## Examples

### Daily Development

```bash
bolt go update build start
```

### Clean Rebuild

```bash
bolt go kill update build start
```

### Shipping Build

```bash
bolt go build:client --config=shipping
bolt run ship
```

### Debug Build

```bash
bolt go build --config=debug
```

### Dry Run

```bash
bolt go build start --dry-run
```

### Check Configuration

```bash
bolt check
```

### View Status

```bash
bolt info
bolt list
```

### Create Plugin

```bash
bolt plugin new slack-notifier
cd .bolt/plugins/slack-notifier
bun install
# Edit index.ts
```

## Next Steps

- [Configuration Reference](/api/config)
- [Handlers Reference](/api/handlers)
- [Plugin API](/api/plugin-api)
