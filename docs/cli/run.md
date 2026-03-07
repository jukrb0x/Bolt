---
title: "bolt run"
---

Run a named action from bolt.yaml.

## Usage

```bash
bolt run <action> [--dry-run] [--key=val]
```

## Description

The `run` command executes a named action defined in your `bolt.yaml`. Actions are single-purpose, composable profiles with optional dependencies.

Extra `--key=val` flags are forwarded as params to every step in the action (and its dependencies). CLI params win over `with:` values in YAML.

Action dependencies (declared under `depends:`) run first, depth-first, with cycle detection.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | `false` | Print what would run without executing |
| `--<key>=<val>` | - | Pass parameters to all steps |

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<action>` | Yes | Name of the action to run |

## Examples

```bash
# Run a simple action
bolt run package-game

# Run with parameters
bolt run deploy --env=staging --region=us-east

# Preview without executing
bolt run package-game --dry-run

# Run an action with dependencies
bolt run daily_check    # runs full_reset first, then continues
```

## Defining Actions

Actions are defined in `bolt.yaml` under the `actions` key:

```yaml
actions:
  package-game:
    steps:
      - uses: ue/build
        with:
          target: game
          config: shipping
      - uses: fs/copy
        with:
          src: ./Saved/StagedBuilds
          dst: ./Builds

  deploy:
    depends:
      - package-game
    steps:
      - uses: myplugin/deploy
        with:
          env: ${{ params.env }}

  full_reset:
    steps:
      - uses: ue/kill
        continue-on-error: true
      - uses: ops/update
      - uses: ops/build

  daily_check:
    depends:
      - full_reset
    steps:
      - uses: ops/start
```

## See Also

- [bolt go](./go.md) - Run ops in pipeline order
- [bolt list](./list.md) - List available actions
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
