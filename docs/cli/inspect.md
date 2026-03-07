---
title: "bolt inspect"
---

Debug op steps and action dependencies.

## Usage

```bash
bolt inspect <op|action>
```

## Description

The `inspect` command shows the resolved steps for an op or action without executing them. Useful for:
- Understanding what steps will run
- Debugging op variants
- Checking action dependencies
- Verifying interpolation

## Options

None.

## Examples

```bash
# Inspect an op
bolt inspect build

# Inspect an op variant
bolt inspect build:ci

# Inspect an action
bolt inspect package-game

# Inspect with parameters
bolt inspect deploy --env=staging
```

## Output

Shows each step that would execute, including:
- Handler namespace and name
- Resolved parameters after interpolation
- Dependency order (for actions)

## See Also

- [bolt go](./go.md) - Run ops in pipeline order
- [bolt run](./run.md) - Run a named action
