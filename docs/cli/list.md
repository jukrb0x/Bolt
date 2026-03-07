---
title: "bolt list"
---

List all available ops and actions.

## Usage

```bash
bolt list
```

## Description

Lists all ops defined in `bolt.yaml` with their non-default variants, and all action names. Useful for discovering what workflows are available in your project.

## Options

None.

## Examples

```bash
bolt list
```

Output example:
```
Ops:
  update (default, full, git, svn)
  build (default, ci, editor)
  start (default)

Actions:
  package-game
  deploy
  clean
```

## See Also

- [bolt go](./go.md) - Run ops in pipeline order
- [bolt run](./run.md) - Run a named action
- [bolt info](./info.md) - Show project configuration
