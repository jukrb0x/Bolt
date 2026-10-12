---
title: "Project Structure"
---

How a Bolt project is laid out. `bolt.yaml` is the committed contract. `bolt.local.yaml` is an optional vars override.

## Directory Layout

```
project-root/
├── bolt.yaml                  # shared contract (version: 1) — COMMIT this
├── bolt.local.yaml            # optional vars overrides — GITIGNORED
├── bolt.local.example.yaml    # example vars file — commit this
├── .bolt/
│   ├── ai-context.md          # generated command reference (bolt ai)
│   ├── plugins/               # project-scope plugins (auto-discovered)
│   │   └── myplugin/
│   │       ├── index.ts
│   │       ├── package.json
│   │       └── tsconfig.json
│   └── logs/                  # execution logs
├── engine/                    # Unreal Engine source (path set on the ue plugin)
└── project/                   # UE project (path set on the ue plugin)
    ├── Config/
    ├── Source/
    ├── Content/
    └── MyGame.uproject
```

## The Config Split

`bolt.yaml` is the shared contract. `bolt.local.yaml`, when present, only overrides `vars`.

### `bolt.yaml` — shared, committed

Holds `version: 1`, the project name, plugin metadata, tasks, and flows. Unreal paths and targets live on the `ue` plugin. Relative paths resolve against this file's directory.

```yaml
# bolt.yaml — commit this
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
        # url: https://github.com/company/UnrealEngine.git
      project:
        path: D:/Games/MyGame
        vcs: svn
        # url: svn://svn.company.com/Projects
      uproject: D:/Games/MyGame/MyGame.uproject
      targets:
        editor:
          kind: editor
          config: development
        client:
          kind: program
          name: MyClient
          config: shipping
  - namespace: myplugin
    path: ./tools/myplugin/index.ts

tasks:
  kill: [{ uses: ue/kill }]
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  genproj: [{ uses: ue/generate_project }]
  build: [{ uses: ue/build, with: { target: editor } }]
  start: [{ uses: ue/start }]

flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]

notifications:
  on_complete: true
  on_failure: true
  providers:
    - type: telegram
      bot_token: ${{ env.TELEGRAM_BOT_TOKEN }}
      chat_id: ${{ env.TELEGRAM_CHAT_ID }}
```

### `bolt.local.yaml` — optional, gitignored

Only `vars` is read. A missing file is fine. Local keys shallow-override `bolt.yaml` `vars`.

```yaml
# bolt.local.yaml — gitignored, optional
vars:
  some_key: some_local_value
```

Commit `bolt.local.example.yaml` so teammates know the file is optional and only carries vars. `bolt init` writes `bolt.yaml` only.

### `.bolt/` — generated and local

| Path                  | Purpose                                                                            |
| --------------------- | ---------------------------------------------------------------------------------- |
| `.bolt/ai-context.md` | Generated command reference (via `bolt ai`), with a `bolt.yaml` hash for staleness |
| `.bolt/plugins/<ns>/` | Project-scope plugins, auto-discovered by namespace                                |
| `.bolt/logs/`         | Per-run execution logs                                                             |

## Side-by-Side Summary

| Concern              | `bolt.yaml`                         | `bolt.local.yaml`  | `.bolt/`                                          |
| -------------------- | ----------------------------------- | ------------------ | ------------------------------------------------- |
| Committed            | Yes                                 | No (gitignored)    | `ai-context.md` + `plugins/` optional; `logs/` no |
| Project name         | Yes (`project.name`)                | No                 | No                                                |
| UE paths and targets | Yes (ue plugin config)              | No                 | No                                                |
| Tasks / flows        | Yes                                 | No                 | Rendered into `ai-context.md`                     |
| Vars                 | Shared defaults                     | Optional overrides | No                                                |
| Plugins              | Entries, path optional for builtins | No                 | Auto-discovered under `plugins/`                  |

## Team Collaboration Tips

### 1. Put Unreal metadata on the ue plugin

Engine path, project path, uproject, and targets belong under `plugins` with `namespace: ue`. Relative paths resolve against the directory containing `bolt.yaml`.

### 2. Commit an example local config

Ship `bolt.local.example.yaml` so new teammates know `bolt.local.yaml` is optional and only overrides `vars`.

### 3. Compose tasks instead of duplicating

Use `call: <name>` to build larger tasks from smaller ones, and define goals as flows. `uses` is reserved for plugin/local actions; `run` is reserved for shell commands.

### 4. Use environment variables for secrets

Reference secrets via interpolation instead of hardcoding them.

```yaml
notifications:
  providers:
    - type: telegram
      bot_token: ${{ env.TELEGRAM_BOT_TOKEN }}
      chat_id: ${{ env.TELEGRAM_CHAT_ID }}
```

```bash
export TELEGRAM_BOT_TOKEN="123456:ABC"
export TELEGRAM_CHAT_ID="-1001234567890"
bolt run daily
```

## See Also

- [bolt.yaml Reference](/guides/bolt-yaml.md) - Complete configuration schema
- [Error Handling](./error-handling.md) - Fail-fast and config errors
