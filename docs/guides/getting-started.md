---
title: "Getting Started"
---

Welcome to Bolt! This guide will help you understand what Bolt is, get up and running quickly.

## What is Bolt?

Bolt is a build and workflow automation tool for Unreal Engine projects. It provides a unified CLI for common development tasks like version control, building, cooking, and deployment.

**Key features:**
- **Declarative configuration** - Define your workflow in `bolt.yaml`
- **Composable operations** - Chain ops with variants for different scenarios
- **Plugin system** - Extend with custom handlers
- **Built-in support** - UE5 workflows out of the box

## Quick Start

1. Install Bolt (see [Installation](./installation.md))
2. Initialize your project:

```bash
cd /path/to/your/ue/project
bolt init
```

3. Run your workflow:

```bash
bolt go update build start
```

## Example bolt.yaml

```yaml
project:
  name: MyGame
  engine_repo:
    path: C:/UnrealEngine
    vcs: git
  project_repo:
    path: C:/Projects/MyGame
    vcs: svn
  uproject: C:/Projects/MyGame/MyGame.uproject

targets:
  editor:
    kind: editor
    config: Development
  game:
    kind: game
    config: Shipping

ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
```

Run `bolt go build` to compile the editor. Run `bolt go build:ci` to use the CI variant.

## Why Bolt?

Stop running `Build.bat` by hand. Stop context-switching between TortoiseSVN, the editor, and a dozen batch scripts. Bolt turns repetitive UE tasks into single commands you can chain, script, and share with your team.

## Next Steps

- [Installation](./installation.md) - Install Bolt on various platforms
- [First Project](./first-project.md) - Walk through the `bolt init` interactive setup
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Complete configuration schema
