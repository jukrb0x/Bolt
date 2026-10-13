---
title: "Config Schema"
---

Complete reference for Bolt's configuration. Field names and defaults below mirror the Zod schema in `src/config.ts`. Unreal metadata is validated by the `ue` plugin, not by the core schema.

- **`bolt.yaml`** — required. Starts with `version: 1`. `project` is a name. Tasks, flows, and plugin entries live here.
- **`bolt.local.yaml`** — optional. `vars` and per-namespace `plugins` overrides. A missing file is fine. JSON Schema: `schema/v1/bolt.local.schema.json`.

## bolt.yaml

Top-level keys:

| Key             | Type   | Required | Default | Description                                          |
| --------------- | ------ | -------- | ------- | ---------------------------------------------------- |
| `version`       | number | yes      | —       | Must be `1`                                          |
| `project`       | object | yes      | —       | Project name                                         |
| `tasks`         | map    | no       | `{}`    | Named lists of steps                                 |
| `flows`         | map    | no       | `{}`    | Named, ordered sets of tasks                         |
| `vars`          | map    | no       | `{}`    | Shared string variables                              |
| `plugins`       | array  | no       | `[]`    | Plugin entries, including builtin metadata           |
| `timeout_hours` | number | no       | —       | Abort the run if it exceeds this duration (positive) |
| `notifications` | object | no       | —       | Build-event notifications                            |

## project

```yaml
project:
  name: MyProject
```

| Field  | Type   | Required | Description          |
| ------ | ------ | -------- | -------------------- |
| `name` | string | yes      | Project display name |

`${{ project.name }}` resolves to this name. Engine and project paths are not fields of `project`.

## ue plugin metadata

`ue/build` and the other `ue/` handlers read this object from `plugins` where `namespace` is `ue`. Omit `path` for the builtin. Relative `engine.path`, `project.path`, and `uproject` values resolve against the directory containing `bolt.yaml`.

```yaml
plugins:
  - namespace: ue
    config:
      engine:
        path: D:/UE
        vcs: git
        branch: main
      project:
        path: D:/Games/MyProject
        vcs: svn
      uproject: D:/Games/MyProject/MyProject.uproject
      targets:
        editor:
          kind: editor
          config: development
        client:
          kind: program
          name: MyClient
          config: shipping
```

| Field      | Type   | Required | Description                                                               |
| ---------- | ------ | -------- | ------------------------------------------------------------------------- |
| `engine`   | object | yes      | `path` (required), `vcs` (`git` or `svn`, default `git`), `url`, `branch` |
| `project`  | object | yes      | Same shape as `engine`                                                    |
| `uproject` | string | yes      | Path to the `.uproject` file                                              |
| `targets`  | map    | no       | Build targets used by `ue/build` via `--target=`                          |

Each target:

| Field    | Type   | Required | Default       | Description                                                     |
| -------- | ------ | -------- | ------------- | --------------------------------------------------------------- |
| `kind`   | string | yes      | —             | `editor` \| `program` \| `game` \| `client` \| `server`         |
| `name`   | string | no       | —             | Binary name (for program/game/server)                           |
| `config` | string | no       | `development` | `development` \| `debug` \| `debuggame` \| `shipping` \| `test` |

## svn plugin metadata

```yaml
plugins:
  - namespace: svn
    config:
      use_tortoise: true
```

| Field          | Type    | Required | Description                                       |
| -------------- | ------- | -------- | ------------------------------------------------- |
| `use_tortoise` | boolean | no       | Require, disable, or auto-detect TortoiseSVN/Proc |

## tasks

A **task** is a named list of steps — the only building block. Each step is one of:

```yaml
tasks:
  kill: [{ uses: ue/kill }]
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build: [{ uses: ue/build, with: { target: editor } }]
  start: [{ uses: ue/start }]
  # reuse other tasks inline (cycle-detected):
  reset: [{ call: kill }, { call: update }, { call: build }]
  # run a shell command:
  clean: [{ run: "rm -rf ./Intermediate" }]
```

### Step Fields

| Field               | Type                | Required                   | Description                                                               |
| ------------------- | ------------------- | -------------------------- | ------------------------------------------------------------------------- |
| `uses`              | string              | one of `uses`/`call`/`run` | Plugin handler (`ns/handler`) or local action (`./path` or `../path`)     |
| `call`              | string              | one of `uses`/`call`/`run` | Reusable task name (resolved recursively; cycle-detected)                 |
| `run`               | string              | one of `uses`/`call`/`run` | Shell command (`${{ }}` interpolated)                                     |
| `with`              | map (string→string) | no                         | Params forwarded to the plugin/local action or called task (interpolated) |
| `continue-on-error` | boolean             | no                         | Continue if this step fails (default: `false`)                            |

> Note the hyphen: steps use **`continue-on-error`**; flows use **`continue_on_fail`** (underscore).

## flows

A **flow** is a named, ordered set of tasks. **Fail-fast**: the first failing task aborts the flow unless it is listed in `continue_on_fail`.

```yaml
flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start] # update/build failures abort; start may fail
  reset:
    description: Kill, update, regenerate, rebuild
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]
```

| Field              | Type     | Required | Default | Description                                     |
| ------------------ | -------- | -------- | ------- | ----------------------------------------------- |
| `description`      | string   | no       | —       | Human-readable summary                          |
| `steps`            | string[] | yes      | —       | Task names, run in listed order                 |
| `continue_on_fail` | string[] | no       | `[]`    | Tasks allowed to fail without aborting the flow |

## vars

Shared string variables, available as `${{ vars.<key> }}`. Per-machine `vars` in `bolt.local.yaml` shallow-override these.

```yaml
vars:
  region: us-east-1
```

## plugins

Explicitly register project-scope plugins by path. (Plugins are also auto-discovered from `.bolt/plugins/<namespace>/index.ts`.)

```yaml
plugins:
  - namespace: myplugin
    path: ./bolt-plugins/myplugin/index.ts
    config: { key: value } # optional
```

| Field       | Type   | Required | Description                                      |
| ----------- | ------ | -------- | ------------------------------------------------ |
| `namespace` | string | yes      | Plugin namespace used in `uses:`                 |
| `path`      | string | no       | Path to the plugin entry file. Omit for builtins |
| `config`    | object | no       | Plugin metadata. Shape depends on the plugin     |

## timeout_hours

```yaml
timeout_hours: 6
```

Optional positive number. When set, a flow aborts if elapsed time reaches this many hours before the next task starts.

## notifications

```yaml
notifications:
  on_start: true
  on_op_complete: true
  on_failure: true
  on_complete: true
  providers:
    - type: wecom
      webhook_url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY
      chat_id: optional-group-id
    - type: telegram
      bot_token: "123456:ABC-DEF"
      chat_id: "-1001234567890"
```

| Field            | Type    | Default | Description                         |
| ---------------- | ------- | ------- | ----------------------------------- |
| `on_start`       | boolean | `true`  | Notify when a run starts            |
| `on_op_complete` | boolean | `true`  | Notify when each task completes     |
| `on_failure`     | boolean | `true`  | Notify on task failure              |
| `on_complete`    | boolean | `true`  | Notify when the whole run completes |
| `providers`      | array   | `[]`    | Notification providers              |

A run emits one start notification. Multi-task runs show the top-level task list and the recursively owned `call`, plugin/local action, and shell nodes.

### Provider Types

| Type       | Required Fields        | Optional  |
| ---------- | ---------------------- | --------- |
| `wecom`    | `webhook_url`          | `chat_id` |
| `telegram` | `bot_token`, `chat_id` | —         |

## bolt.local.yaml (optional)

A missing file is fine. Invalid YAML or any key other than `vars` and `plugins` is an error. Local vars shallow-override the same keys in `bolt.yaml`. `plugins.<namespace>` is deep-merged over the `config` of the `bolt.yaml` plugin entry with that namespace before validation (objects merge, arrays and scalars replace). A namespace that `bolt.yaml` does not declare is an error. A target override may set only some fields (for example just `config`); the merged target is validated.

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

| Field     | Type                       | Required | Description                                         |
| --------- | -------------------------- | -------- | --------------------------------------------------- |
| `vars`    | map (string→string)        | no       | Per-machine variable overrides                      |
| `plugins` | map (namespace→config map) | no       | Per-machine plugin config, deep-merged by namespace |

v2.0 keys (`engine_path`, `project_path`, `uproject`, `use_tortoise`) are rejected. Run `bolt migrate` to convert them.

## Migration from v1

`ops`, `variants`, `go-pipeline`, `actions`, and `depends` are removed. Model everything with `tasks` and `flows`; reuse a task with `call: <name>`. The legacy `uses: task/name` form is rejected; replace it with `call: name`. `bolt go`/`bolt help` are gone — use `bolt run`.

## See Also

- [bolt.yaml Guide](/guides/bolt-yaml.md) — annotated walkthrough and the config split
- [Interpolation](/guides/interpolation.md) — template syntax and context
