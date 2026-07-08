---
title: "Project Structure"
---

How a Bolt project is laid out, and how configuration is split between a committed contract and per-machine paths.

## Directory Layout

```
project-root/
├── bolt.yaml                  # shared contract — COMMIT this
├── bolt.local.yaml            # per-machine paths — GITIGNORED
├── bolt.local.example.yaml    # example of bolt.local.yaml — commit this
├── .bolt/
│   ├── ai-context.md          # generated command reference (bolt ai)
│   ├── plugins/               # project-scope plugins (auto-discovered)
│   │   └── myplugin/
│   │       ├── index.ts
│   │       ├── package.json
│   │       └── tsconfig.json
│   └── logs/                  # execution logs
├── engine/                    # Unreal Engine source (path set in bolt.local.yaml)
└── project/                   # UE project (path set in bolt.local.yaml)
    ├── Config/
    ├── Source/
    ├── Content/
    └── MyGame.uproject
```

## The Config Split

Configuration lives in two files so a team can share one contract while each machine keeps its own paths.

### `bolt.yaml` — shared, committed

Holds project identity, targets, tasks, and flows. It must **not** contain machine paths.

```yaml
# bolt.yaml — commit this
project:
  name: MyGame
  engine:                    # repo identity only — no path here
    vcs: git
    branch: main
    # url: https://github.com/company/UnrealEngine.git
  project:
    vcs: svn
    # url: svn://svn.company.com/Projects

targets:
  editor:
    kind: editor
    config: development
  client:
    kind: program
    name: MyClient
    config: shipping

tasks:
  kill:    [{ uses: ue/kill }]
  update:  [{ uses: ue/update_engine }, { uses: ue/update_project }]
  genproj: [{ uses: ue/generate_project }]
  build:   [{ uses: ue/build, with: { target: editor } }]
  start:   [{ uses: ue/start }]

flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]

plugins:
  - namespace: myplugin
    path: ./tools/myplugin/index.ts

notifications:
  on_complete: true
  on_failure: true
  providers:
    - type: telegram
      bot_token: ${{ env.TELEGRAM_BOT_TOKEN }}
      chat_id: ${{ env.TELEGRAM_CHAT_ID }}
```

### `bolt.local.yaml` — per-machine, gitignored

Holds only the paths that differ between machines. Relative paths resolve against the directory containing `bolt.yaml`.

```yaml
# bolt.local.yaml — gitignored, one per machine
engine_path:  D:/UE
project_path: D:/Games/MyGame
uproject:     D:/Games/MyGame/MyGame.uproject
use_tortoise: true

# Optional per-machine variable overrides (shallow-merged over bolt.yaml vars)
# vars:
#   some_key: some_local_value
```

Commit `bolt.local.example.yaml` (a template) so teammates know what to fill in. `bolt init` scaffolds both `bolt.yaml` and `bolt.local.yaml`; a missing or invalid `bolt.local.yaml` is a loud error.

### `.bolt/` — generated and local

| Path | Purpose |
|------|---------|
| `.bolt/ai-context.md` | Generated command reference (via `bolt ai`), with a `bolt.yaml` hash for staleness |
| `.bolt/plugins/<ns>/` | Project-scope plugins, auto-discovered by namespace |
| `.bolt/logs/` | Per-run execution logs |

## Side-by-Side Summary

| Concern | `bolt.yaml` | `bolt.local.yaml` | `.bolt/` |
|---------|-------------|-------------------|----------|
| Committed | Yes | No (gitignored) | `ai-context.md` + `plugins/` optional; `logs/` no |
| Project identity | Yes (`project`, `vcs`, `url`) | No | No |
| Machine paths | No | Yes (`engine_path`, etc.) | No |
| Tasks / flows / targets | Yes | No | Rendered into `ai-context.md` |
| Plugins | Explicit paths (`plugins:`) | No | Auto-discovered under `plugins/` |

## Team Collaboration Tips

### 1. Keep paths out of `bolt.yaml`
Machine paths belong in `bolt.local.yaml`. This keeps the committed contract portable across every teammate's machine.

### 2. Commit an example local config
Ship `bolt.local.example.yaml` so new teammates can copy it to `bolt.local.yaml` and fill in their paths (or just run `bolt init`).

### 3. Compose tasks instead of duplicating
Use `uses: task/<name>` to build larger tasks from smaller ones, and define goals as flows.

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
- [Error Handling](./error-handling.md) - Fail-fast and the missing-local-config error
