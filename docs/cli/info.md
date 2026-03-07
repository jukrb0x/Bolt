---
title: "bolt info"
---

Show project and VCS configuration summary.

## Usage

```bash
bolt info
```

## Description

Prints a summary of your project configuration including:
- Project fields (name, paths, uproject)
- Configured targets
- Available ops with their variants
- Defined actions

## Options

None.

## Examples

```bash
bolt info
```

Output example:
```
Project: MyGame
  Engine: C:/UnrealEngine (git, main)
  Project: C:/Projects/MyGame (svn)
  UProject: C:/Projects/MyGame/MyGame.uproject

Targets:
  editor: editor/Development
  game: game/Shipping
  client: program/Shipping

Ops:
  update: default, full, git, svn
  build: default, ci
  start: default

Actions:
  package-game
  deploy
```

## See Also

- [bolt list](./list.md) - List ops and actions
- [bolt check](./check.md) - Validate bolt.yaml
