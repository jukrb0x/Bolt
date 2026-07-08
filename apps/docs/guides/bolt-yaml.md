---
title: "Bolt YAML"
---

How to author a Bolt project's configuration. Bolt v2 splits config across two files — a shared committed contract and a per-machine local file — that Bolt merges at load.

## The two files

| File | Committed? | Contains | Why |
|------|-----------|----------|-----|
| `bolt.yaml` | Yes (shared) | Project identity, targets, tasks, flows, vars, plugins, notifications | The team's automation contract. Everyone runs the same tasks/flows. |
| `bolt.local.yaml` | No (**gitignored**) | Machine paths: `engine_path`, `project_path`, `uproject`, `use_tortoise` | Paths differ per developer/machine, so they must never be committed. |

Run `bolt init` to scaffold both (it also tries to auto-detect the `.uproject`). If `bolt.local.yaml` is missing or invalid, Bolt fails loudly — copy `bolt.local.example.yaml` to `bolt.local.yaml` and set the paths.

Why split? The shared contract stays identical for the whole team, while each machine keeps its own engine/project locations. This keeps `bolt.yaml` clean of secrets and machine specifics, and makes the same tasks/flows reproducible everywhere.

## Model in one minute

- A **task** is a named list of steps — the only building block. A step is a plugin call (`uses: ns/handler`), a composed task (`uses: task/<name>`), or a shell command (`run: ...`).
- A **flow** is a named, ordered set of tasks. Fail-fast: the first failing task aborts the flow unless it's in `continue_on_fail`.
- One verb: `bolt run`. Multiple task names run in the order you type; a single flow name runs that flow. `--key=value` passes params (override `with:`); `--dry-run` previews.

## bolt.yaml — annotated walkthrough

```yaml
# Optional: abort the whole run if it exceeds this duration
# timeout_hours: 6

# Project identity only — NO machine paths (those live in bolt.local.yaml)
project:
  name: MyProject
  engine:                    # repo identity for the engine
    vcs: git                 # git | svn (default: git)
    # url: https://github.com/EpicGames/UnrealEngine.git
    branch: main
  project:                   # repo identity for the game project
    vcs: svn
    # url: svn://svn.example.com/project/trunk

# Build targets referenced by ue/build via --target=<name>
targets:
  editor:
    kind: editor             # editor | program | game | client | server
    config: development      # development | debug | shipping | test
  client:
    kind: program
    name: MyClient
    config: shipping

# tasks: the only building block — a task is a named list of steps.
# Steps: `uses: ns/handler` (plugin), `uses: task/<name>` (compose), or `run: <shell>`.
tasks:
  kill:    [{ uses: ue/kill }]
  update:  [{ uses: ue/update_engine }, { uses: ue/update_project }]
  genproj: [{ uses: ue/generate_project }]
  build:   [{ uses: ue/build, with: { target: editor } }]
  start:   [{ uses: ue/start }]

# flows: named, ordered goals. Fail-fast unless a task is in continue_on_fail.
flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]   # update/build failures abort; start may fail
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]    # kill may fail (nothing running) without aborting

# Optional: shared string variables, available as ${{ vars.<key> }}
# vars:
#   region: us-east-1

# Optional: explicit project-scope plugins (also auto-discovered from .bolt/plugins/)
# plugins:
#   - namespace: myplugin
#     path: ./bolt-plugins/myplugin/index.ts

# Optional: notify on build events via WeCom or Telegram
# notifications:
#   on_start: true
#   on_op_complete: true
#   on_failure: true
#   on_complete: true
#   providers:
#     - type: wecom
#       webhook_url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY"
#     - type: telegram
#       bot_token: "123456:ABC-DEF"
#       chat_id: "-1001234567890"
```

## bolt.local.yaml — annotated walkthrough

Gitignored. Relative paths resolve against the directory containing `bolt.yaml`.

```yaml
engine_path:  D:/UE                                  # local Unreal Engine root
project_path: D:/Games/MyProject                     # local project working copy
uproject:     D:/Games/MyProject/MyProject.uproject  # path to the .uproject file
use_tortoise: true                                   # use TortoiseSVN/Proc for SVN ops

# Optional per-machine variable overrides (shallow-merged over bolt.yaml vars)
# vars:
#   some_key: some_local_value
```

## How the two files merge

At load Bolt combines identity (`bolt.yaml`) with paths (`bolt.local.yaml`) into a single runtime `project` that handlers and interpolation read:

- `engine_repo` = `project.engine` identity + `engine_path` → `{ path, vcs, url?, branch? }`
- `project_repo` = `project.project` identity + `project_path` → `{ path, vcs, url?, branch? }`
- `uproject`, `use_tortoise` come from `bolt.local.yaml`
- `vars` = `bolt.yaml` vars shallow-merged with `bolt.local.yaml` vars (local wins)

So a handler reads `ctx.cfg.project.engine_repo.path`, and interpolation can use `${{ project.engine_repo.path }}` — even though the path was authored in a different file. See [Config Schema](/api/config-schema.md#merged-runtime-shape).

## Running

```bash
bolt run build start                 # ad-hoc: run tasks in the typed order
bolt run daily                       # goal: run a flow
bolt run build --target=client       # params override with:
bolt run build --config=debug        # build configuration param
bolt run reset --dry-run             # preview without executing
```

## Migration from v1

`ops`, `variants`, `go-pipeline`, `actions`, and `depends` are removed. Model everything with `tasks` (compose via `uses: task/<name>`) and `flows`; replace `bolt go`/`bolt help` with `bolt run`. Machine paths that used to sit under `project` (e.g. `engine_repo.path`) now live in `bolt.local.yaml`.

## See Also
- [Config Schema](/api/config-schema.md) — full field reference and defaults
- [Interpolation](./interpolation.md) — template syntax and available context
