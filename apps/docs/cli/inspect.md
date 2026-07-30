---
title: "bolt inspect"
---

Preview the resolved steps for a task or flow without executing them.

## Usage

```bash
bolt inspect <name...> [--key=value ...]
```

## Description

`bolt inspect` expands one or more names into their resolved steps, so you can see
exactly what `bolt run` would execute. It never runs anything. Useful for:

- Understanding what steps will run and in what order
- Verifying `${{ }}` interpolation
- Checking how params override `with:` values

Resolution mirrors `bolt run`:

- A **task** resolves to one top-level task tree.
- A **flow** resolves to one top-level task tree per flow task, in listed order.
- `call: <name>` keeps the reusable task visible and nests its owned nodes
  (cycle-detected).
- Trailing `--key=value` params shallow-override each step's `with:` values
  (params win), exactly as they would at run time.

## Options

| Flag | Description |
|------|-------------|
| `--<key>=<value>` | Params to apply during resolution (override `with:`) |

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<name...>` | Yes | One or more task names, or one flow name |

## Examples

```bash
# Inspect a task
bolt inspect build

# Inspect a flow (expands to per-task sections)
bolt inspect daily

# Inspect multiple names
bolt inspect update build

# See how a param changes the resolved steps
bolt inspect build --target=client

# Keep reusable-task ownership visible
bolt inspect build_editor --config=debuggame
```

## Output

For a task, a single task tree:

```
Config: /path/to/bolt.yaml

>> build
  uses: ue/build  target=editor
```

A task call remains visible as an ownership boundary:

```
>> build_editor
  call: build
    uses: ue/build  target=editor  config=debuggame
```

For a flow, one tree per top-level task:

```
Config: /path/to/bolt.yaml

>> update
  uses: ue/update_engine
  uses: ue/update_project

>> build
  uses: ue/build  target=editor

>> start
  uses: ue/start
```

## See Also

- [bolt run](./run.md) - Run tasks or a flow
- [bolt list](./list.md) - List available tasks and flows
