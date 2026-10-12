---
title: "Getting Started"
---

Welcome to Bolt! This guide will help you understand what Bolt is, get up and running quickly.

## What is Bolt?

Bolt is a build and workflow automation tool for Unreal Engine projects. It provides a unified CLI for common development tasks like version control, building, cooking, and launching.

**Key features:**

- **Declarative configuration** - Define your workflow in `bolt.yaml`
- **Tasks and flows** - Compose reusable tasks and run them as ordered flows
- **Plugin system** - Extend with custom handlers
- **Built-in support** - UE5 workflows out of the box

## The Model

Bolt has two building blocks and one verb:

- **Task** — a named list of steps. `uses` invokes a plugin/local action, `call` reuses a task, and `run` executes a shell command.
- **Flow** — a named, ordered set of tasks with a `continue_on_fail` allowlist. Flows are fail-fast: the first failing task aborts the flow unless it is listed in `continue_on_fail`.
- **`bolt run`** — the single verb. Pass task names to run them in the order you type, or a single flow name to run a predefined goal.

## Quick Start

1. Install Bolt (see [Installation](./installation.md))
2. Initialize your project:

```bash
cd /path/to/your/ue/project
bolt init
```

`bolt init` scaffolds `bolt.yaml` (`version: 1`, a project name, and a sample task). Commit it. `bolt.local.yaml` is optional and only overrides `vars`.

3. Preview, then run your workflow:

```bash
bolt run daily --dry-run    # preview the steps without executing
bolt run daily              # run the flow for real
```

## Example bolt.yaml

```yaml
version: 1

project:
  name: MyGame

plugins:
  - namespace: ue
    config:
      engine:
        path: D:/UE
        vcs: git
        branch: main
      project:
        path: D:/Games/MyGame
        vcs: svn
      uproject: D:/Games/MyGame/MyGame.uproject
      targets:
        editor:
          kind: editor
          config: development
        client:
          kind: program
          name: MyClient
          config: shipping
  - namespace: svn
    config:
      use_tortoise: true

tasks:
  kill: [{ uses: ue/kill }]
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build: [{ uses: ue/build, with: { target: editor } }]
  start: [{ uses: ue/start }]

flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start] # update/build failures abort; start may fail
```

Relative `engine.path`, `project.path`, and `uproject` values resolve against the directory containing `bolt.yaml`. Optional `bolt.local.yaml` may only override `vars`.

Run `bolt run build` to compile the editor. Pass `bolt run build --target=client` to build a different target — params override the step's `with:` values.

For Unreal DebugGame, run `bolt run build --config=debuggame`; `dbggame` and `DebugGame` are accepted aliases.

## Why Bolt?

Stop running `Build.bat` by hand. Stop context-switching between TortoiseSVN, the editor, and a dozen batch scripts. Bolt turns repetitive UE tasks into single commands you can chain, script, and share with your team.

## Next Steps

- [Installation](./installation.md) - Install Bolt on various platforms
- [First Project](./first-project.md) - Walk through `bolt init` and your first flow
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Complete configuration schema
