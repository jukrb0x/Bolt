---
title: "Bolt YAML"
---

How to author a Bolt project's configuration. `bolt.yaml` starts with `version: 1`. `project` is a name. Unreal metadata belongs to the `ue` plugin.

## The two files

| File              | Committed?    | Contains                                                | Why                                                                         |
| ----------------- | ------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `bolt.yaml`       | Yes (shared)  | `version: 1`, project name, plugins, tasks, flows, vars | The team's automation contract. Everyone runs the same tasks/flows.         |
| `bolt.local.yaml` | No (optional) | `vars` and `plugins` overrides                          | Per-machine vars and plugin config (machine paths). A missing file is fine. |

Relative paths inside plugin config resolve against the directory containing `bolt.yaml`. There is no root `targets` key.

## Model in one minute

- A **task** is a named list of steps — the only building block. Step keys are strict: `uses` invokes a plugin/local action, `call` reuses a task, and `run` executes a shell command.
- A **flow** is a named, ordered set of tasks. Fail-fast: the first failing task aborts the flow unless it's in `continue_on_fail`.
- One verb: `bolt run`. Multiple task names run in the order you type; a single flow name runs that flow. `--key=value` passes params (override `with:`); `--dry-run` previews.

## bolt.yaml — annotated walkthrough

```yaml
version: 1

# Optional: abort the whole run if it exceeds this duration
# timeout_hours: 6

project:
  name: MyProject

plugins:
  - namespace: ue
    config:
      engine:
        path: D:/UE # relative paths resolve against this file's directory
        vcs: git # git | svn
        # url: https://github.com/EpicGames/UnrealEngine.git
        branch: main
      project:
        path: D:/Games/MyProject
        vcs: svn
        # url: svn://svn.example.com/project/trunk
      uproject: D:/Games/MyProject/MyProject.uproject
      targets:
        editor:
          kind: editor # editor | program | game | client | server
          config: development # development | debug | debuggame | shipping | test
        client:
          kind: program
          name: MyClient
          config: shipping
  - namespace: svn
    config:
      use_tortoise: true

# tasks: the only building block — a task is a named list of steps.
# Steps: `uses` = plugin/local action, `call` = reusable task, `run` = shell command.
tasks:
  kill: [{ uses: ue/kill }]
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  genproj: [{ uses: ue/generate_project }]
  build: [{ uses: ue/build, with: { target: editor } }]
  build_editor: [{ call: build, with: { config: debuggame } }]
  start: [{ uses: ue/start }]

# flows: named, ordered goals. Fail-fast unless a task is in continue_on_fail.
flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start] # update/build failures abort; start may fail
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill] # kill may fail (nothing running) without aborting

# Optional: shared string variables, available as ${{ vars.<key> }}
# vars:
#   region: us-east-1

# A plugin with a path is loaded from that file. Builtins omit path.
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

Optional and gitignored. A missing file is fine. It may hold two keys:

- `vars` shallow-override the same keys in `bolt.yaml` `vars`.
- `plugins.<namespace>` is deep-merged over the `config` of the `bolt.yaml` plugin entry with that namespace, before validation. Objects merge key by key; arrays and scalars replace. The namespace must be declared under `plugins` in `bolt.yaml`.

Use `plugins` for per-machine paths so they stay out of the committed `bolt.yaml`:

```yaml
vars:
  region: eu
plugins:
  ue:
    engine: { path: D:/UE_5.4 }
    project: { path: D:/Work/MyGame }
    uproject: D:/Work/MyGame/MyGame.uproject
  svn:
    use_tortoise: true
```

`bolt.yaml` can then leave `path` out of `engine` and `project` and omit `uproject`; `bolt check` validates the merged result. See [Config Schema](/api/config-schema.md).

## Running

```bash
bolt run build start                 # ad-hoc: run tasks in the typed order
bolt run daily                       # goal: run a flow
bolt run build --target=client       # params override with:
bolt run build --config=debug        # build configuration param
bolt run build_editor --config=debuggame # aliases: dbggame, DebugGame
bolt run reset --dry-run             # preview without executing
```

## Migration from v1

`ops`, `variants`, `go-pipeline`, `actions`, and `depends` are removed. Model everything with `tasks` and `flows`; reuse tasks with `call: <name>`. The legacy `uses: task/name` form is rejected and must be changed to `call: name`. Replace `bolt go`/`bolt help` with `bolt run`. Engine, project, uproject, and target metadata now live on the `ue` plugin. `use_tortoise` lives on the `svn` plugin. `project` is only a name, and `bolt.yaml` requires `version: 1`.

### From bolt v2.0 config files

A v2.0 `bolt.yaml` had no `version`, kept `engine`/`project` repo identity under `project`, and put `targets` at the root. A v2.0 `bolt.local.yaml` held `engine_path`, `project_path`, `uproject`, and `use_tortoise`. `bolt check` lists each of these keys and prints the converted files. `bolt migrate` rewrites both files for you (see [bolt migrate](/cli/migrate.md)):

| v2.0                               | Now                                                   |
| ---------------------------------- | ----------------------------------------------------- |
| `bolt.yaml` `project.engine`       | `plugins[ue].config.engine`                           |
| `bolt.yaml` `project.project`      | `plugins[ue].config.project`                          |
| `bolt.yaml` `targets`              | `plugins[ue].config.targets`                          |
| other `bolt.yaml` `project.<key>`  | `vars.<key>` (use `${{ vars.<key> }}`)                |
| `bolt.local.yaml` `engine_path`    | `bolt.local.yaml` `plugins.ue.engine.path`            |
| `bolt.local.yaml` `project_path`   | `bolt.local.yaml` `plugins.ue.project.path`           |
| `bolt.local.yaml` `uproject`       | `bolt.local.yaml` `plugins.ue.uproject`               |
| `bolt.local.yaml` `use_tortoise`   | `bolt.local.yaml` `plugins.svn.use_tortoise`          |
| `${{ project.engine_repo.path }}`  | `${{ vars.engine_path }}` (set in `bolt.local.yaml`)  |
| `${{ project.project_repo.path }}` | `${{ vars.project_path }}` (set in `bolt.local.yaml`) |
| `${{ project.uproject }}`          | `${{ vars.uproject }}` (set in `bolt.local.yaml`)     |

Multi-task start notifications are sent once per invocation and show the top-level task list plus recursively owned actions.

## See Also

- [Config Schema](/api/config-schema.md) — full field reference and defaults
- [Interpolation](./interpolation.md) — template syntax and available context
