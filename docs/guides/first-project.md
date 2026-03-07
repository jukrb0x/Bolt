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

## Step 2: Answer Questions

Bolt will ask a series of questions about your setup:

| Question | Description |
|----------|-------------|
| Project name | The name for your project |
| Engine repository path | Path to Unreal Engine source |
| Engine VCS | `git` or `svn` |
| Engine branch | Git branch (if using git) |
| Project repository path | Path to your project |
| Project VCS | `git` or `svn` |
| UProject file | Path to `.uproject` file |
| Use TortoiseSVN | Whether to use TortoiseSVN for SVN operations |

## Step 3: Review Configuration

After answering questions, Bolt generates a `bolt.yaml` file. Review the generated configuration:

```yaml
project:
  name: MyGame
  engine_repo:
    path: C:/UnrealEngine
    vcs: git
    branch: main
  project_repo:
    path: C:/Projects/MyGame
    vcs: svn
  uproject: C:/Projects/MyGame/MyGame.uproject

targets:
  editor:
    kind: editor
    config: development

ops:
  update:
    default:
      - uses: ue/update-git
    - uses: ue/update-svn
  build:
    default:
      - uses: ue/build
        with:
          target: editor
  start:
    default:
      - uses: ue/start
        with:
          target: editor

go-pipeline:
  order:
    - kill
    - update
    - build
    - start
```

## Step 4: Customize

Edit `bolt.yaml` to customize for your workflow:

```yaml
# Add a new target
targets:
  client:
    kind: program
    name: MyClient
    config: shipping

# Add a variant to the build op
ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
    ci:
      - uses: ue/build
        with:
          target: editor
      - uses: ue/build
        with:
          target: client

# Add an action
actions:
  package-game:
    - uses: ue/package-game
      with:
        target: game
        output: ./Builds
```

## Step 5: Run Your Workflow

Now you can run your entire workflow with a single command

```bash
bolt go update build start
```

Common variations:
```bash
# Use a specific variant
bolt go update:git build start

# Pass inline parameters
bolt go build --config=debug

# Preview without executing
bolt go update build --dry-run
```

## What's Next?

- [CLI Reference](/cli/) - Complete command documentation
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
- [Daily Workflow Tutorial](/guides/daily-workflow.md) - Real-world example
