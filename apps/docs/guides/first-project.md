---
title: "First Project"
---

This guide walks through a first `bolt.yaml` and a first `bolt run`.

## Prerequisites

Before starting, make sure you have:

- A Unreal Engine project directory
- Git or SVN repository (for version control)
- Basic familiarity with command line

## Step 1: Add bolt.yaml

In the project root, create `bolt.yaml` and commit it. `version` must be `1`. Do not put engine paths or `targets` at the root of the file.

| File              | Committed?            | Contents                                                  |
| ----------------- | --------------------- | --------------------------------------------------------- |
| `bolt.yaml`       | Yes (shared contract) | `version: 1`, project name, plugin metadata, tasks, flows |
| `bolt.local.yaml` | No (optional)         | `vars` overrides only                                     |

## Step 2: Review bolt.yaml

`bolt.yaml` starts with `version: 1`. `project` is a name. Unreal engine, project, uproject, and target metadata belong to the `ue` plugin.

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

tasks:
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build: [{ uses: ue/build, with: { target: editor } }]
  start: [{ uses: ue/start }]

flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]
```

Relative paths in that plugin config resolve against the directory containing `bolt.yaml`.

## Step 3: Optional bolt.local.yaml

`bolt.local.yaml` is optional. A missing file is fine. It may only override `vars`:

```yaml
vars:
  region: eu
```

## Step 4: Customize the contract

Add targets under the `ue` plugin, and add tasks and flows next to them:

```yaml
plugins:
  - namespace: ue
    config:
      targets:
        editor:
          kind: editor
          config: development
        client:
          kind: program
          name: MyClient
          config: shipping

tasks:
  build: [{ uses: ue/build, with: { target: editor } }]
  build-both: [{ call: build }, { uses: ue/build, with: { target: client } }]

flows:
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill] # kill may fail (nothing running) without aborting
```

## Step 5: Run Your Workflow

Preview first, then run for real:

```bash
bolt run daily --dry-run    # preview the flow's steps
bolt run daily              # run the flow
```

Common variations:

```bash
# Run tasks ad-hoc, in the exact order you type
bolt run update build start

# Pass a param to the whole run (overrides the step's with:)
bolt run build --target=client

# Pass a build configuration
bolt run build --config=debug
bolt run build --config=debuggame   # aliases: dbggame, DebugGame
```

## What's Next?

- [Daily Workflow](/guides/daily-workflow.md) - Real-world tasks, flows, and params
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
- [CLI Reference](/cli/) - Complete command documentation
