# API Overview

Complete reference for Bolt's configuration and commands.

## Configuration

The main configuration file is `bolt.yaml` in your project root.

### Structure

```yaml
project:
  name: MyGame
  engine_root: C:/UnrealEngine
  project_root: C:/Projects/MyGame
  project_name: MyGame
  engine_vcs: git
  project_vcs: svn

targets:
  editor:
    kind: editor
    config: development

ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor

go-pipeline:
  order: [kill, update, build, start]
  fail_stops: [build]

actions:
  daily:
    steps:
      - uses: ops/kill
      - uses: ops/update
      - uses: ops/build

plugins:
  - namespace: custom
    path: ./custom-plugin

timeout_hours: 6

notifications:
  on_start: true
  on_complete: true
  on_failure: true
  providers:
    - type: telegram
      bot_token: "123:ABC"
      chat_id: "-100..."
```

## Commands

| Command | Description |
|---------|-------------|
| `bolt go <ops...>` | Run operations in pipeline order |
| `bolt run <action>` | Run a named action |
| `bolt list` | List available ops and actions |
| `bolt info` | Show project and VCS status |
| `bolt check` | Validate bolt.yaml |
| `bolt version` | Print version |
| `bolt self-update` | Update to latest release |
| `bolt plugin list` | List active plugins |
| `bolt plugin new <name>` | Create a new plugin |
| `bolt config` | Open bolt.yaml in editor |

## Global Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Show commands without executing |
| `--help` | Show help |
| `--version` | Show version |

## Go Command

The `bolt go` command runs operations in pipeline order:

```bash
bolt go update build start
bolt go build:client --config=shipping
bolt go kill update build start --dry-run
```

### Op Variants

Select variants with `:`:

```bash
bolt go build:debug
bolt go build:shipping
```

### Inline Parameters

Pass parameters with `--`:

```bash
bolt go build --config=debug
bolt go start --target=game-client
```

### Shared Parameters

Some parameters automatically propagate:

```bash
# Both build and start get config=shipping
bolt go build start --config=shipping
```

Shareable parameters: `config`, `platform`

## Run Command

Execute named actions:

```bash
bolt run daily
bolt run full-reset
```

Actions can have dependencies:

```yaml
actions:
  full-reset:
    steps:
      - uses: ops/kill
      - uses: ops/update
      - uses: ops/build
  
  daily:
    depends: [full-reset]
    steps:
      - uses: ops/start
```

## Next Steps

- [Configuration Reference](/api/config)
- [Commands Reference](/api/commands)
- [Handlers Reference](/api/handlers)
- [Plugin API](/api/plugin-api)
