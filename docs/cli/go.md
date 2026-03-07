---
title: "bolt go"
---

Run one or more ops in pipeline order.

## Usage

```bash
bolt go <op...> [--dry-run] [--<op>=<variant>] [--key=val]
```

## Description

The `go` command is the primary way to execute workflows in Bolt. It runs one or more ops in sequence, respecting the order defined in `go-pipeline.order` in your `bolt.yaml`.

Op tokens can be bare words or `--` flags — these are equivalent:

```bash
bolt go update build start
bolt go --update --build --start
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | `false` | Print what would run without executing |

## Variant Selection

Each op can have named variants. Select one with `:` or `=`:

```bash
bolt go update:svn          # colon syntax
bolt go --update=svn        # flag syntax
```

If the variant name doesn't match any defined variant, the `default` variant is used with `with.target` overridden to that value:

```bash
bolt go --build=client      # no "client" variant → uses "default" with target=client
```

## Inline Params

Pass per-op params after the op token. These override `with:` values in YAML:

```bash
bolt go build --config=debug --platform=Win64
bolt go build start --config=shipping
```

**Shared params** (`config`, `platform`) propagate across all ops:

```bash
bolt go update build start --config=debug
# config=debug applies to update, build, and start
```

**Config shortcuts:** `dev` → `development`, `dbg` → `debug`

## Pipeline Order

`bolt go` always executes ops in the order defined in `go-pipeline.order`, regardless of argument order:

```bash
bolt go start build    # executes build first, then start
```

Ops not in the pipeline order run last, preserving their relative order.

## Failure Behaviour

- Ops in `go-pipeline.fail_stops` abort the entire run if they fail.
- All other ops log a warning and continue.

## Examples

```bash
# Run a single op
bolt go build

# Run multiple ops in pipeline order
bolt go update build start

# Use a specific variant
bolt go build:ci

# Pass inline parameters
bolt go build --config=shipping --platform=Win64

# Preview without executing
bolt go update build --dry-run

# Full reset workflow
bolt go kill update build start
```

## See Also

- [bolt run](./run.md) - Run a named action
- [bolt list](./list.md) - List available ops
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
