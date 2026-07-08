---
title: "First Project"
---

This guide walks through setting up a new Bolt project using `bolt init`.

## Prerequisites

Before starting, make sure you have:
- A Unreal Engine project directory
- Git or SVN repository (for version control)
- Basic familiarity with command line

## Step 1: Run bolt init

Navigate to your UE project directory and run:

```bash
cd /path/to/your/ue/project
bolt init
```

`bolt init` is non-interactive. It scaffolds **two** files and auto-detects a single `.uproject` in the directory. Pass `--force` to overwrite existing files.

| File | Committed? | Contents |
|------|-----------|----------|
| `bolt.yaml` | Yes (shared contract) | Project identity, targets, tasks, flows |
| `bolt.local.yaml` | No (gitignored) | Per-machine paths: engine/project/uproject |

## Step 2: Review bolt.yaml

`bolt.yaml` is the team-shared contract. It holds project identity and the tasks/flows everyone runs — but **no machine paths**.

```yaml
project:
  name: MyGame
  engine:                    # repo identity only — no path here
    vcs: git
    branch: main
  project:
    vcs: svn

targets:
  editor:
    kind: editor
    config: development

tasks:
  update:  [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build:   [{ uses: ue/build, with: { target: editor } }]
  start:   [{ uses: ue/start }]

flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]
```

## Step 3: Edit bolt.local.yaml paths

`bolt.local.yaml` holds the paths that differ per machine. It is gitignored, so each teammate sets their own. Relative paths resolve against the directory containing `bolt.yaml`.

```yaml
engine_path:  D:/UE                                  # local Unreal Engine root
project_path: D:/Games/MyGame                        # local project working copy
uproject:     D:/Games/MyGame/MyGame.uproject        # path to the .uproject file
use_tortoise: true                                   # use TortoiseSVN for SVN ops
```

If `bolt.local.yaml` is missing or invalid, Bolt fails loudly and tells you to copy `bolt.local.example.yaml` or run `bolt init`.

## Step 4: Customize the contract

Edit `bolt.yaml` to add targets, tasks, and flows:

```yaml
# Add a new target
targets:
  client:
    kind: program
    name: MyClient
    config: shipping

# Add a task that composes others and appends a shell step
tasks:
  build:      [{ uses: ue/build, with: { target: editor } }]
  build-both: [{ uses: task/build }, { uses: ue/build, with: { target: client } }]

# Add a flow (fail-fast; list tasks that may fail in continue_on_fail)
flows:
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]    # kill may fail (nothing running) without aborting
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
```

## What's Next?

- [Daily Workflow](/guides/daily-workflow.md) - Real-world tasks, flows, and params
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
- [CLI Reference](/cli/) - Complete command documentation
