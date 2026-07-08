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

- A **task** resolves to a single section of numbered steps.
- A **flow** resolves to one section **per task** in the flow, in listed order,
  each labeled with its task name.
- `uses: task/<name>` composition is expanded inline (cycle-detected).
- Trailing `--key=value` params shallow-override each step's `with:` values
  (params win), exactly as they would at run time.

## Options

| Flag | Description |
|------|-------------|
| `--<key>=<value>` | Params to apply during resolution (override `with:`) |

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<name...>` | Yes | One or more task or flow names |

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
```

## Output

For a task, a single numbered list of steps:

```
Config: /path/to/bolt.yaml

>> build
  1  uses: ue/build  target=editor
```

For a flow, one labeled section per task, numbered continuously:

```
Config: /path/to/bolt.yaml

>> daily
  [update]
  1  uses: ue/update_engine
  2  uses: ue/update_project
  [build]
  3  uses: ue/build  target=editor
  [start]
  4  uses: ue/start
```

## See Also

- [bolt run](./run.md) - Run tasks or a flow
- [bolt list](./list.md) - List available tasks and flows
