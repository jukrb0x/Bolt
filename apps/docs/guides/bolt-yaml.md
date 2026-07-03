---
title: "Bolt YAML"
---

Complete configuration schema for Bolt projects.

## Full Schema

```yaml
# Optional: abort if the entire run exceeds this duration
timeout_hours: 6

project:
  name: MyGame                        # (required) display name
  engine_repo:                    # (required) engine configuration
    path: C:/UnrealEngine       # (required) path to UE
    vcs: git                      # (required) git | svn
    url: ""                      # (optional) remote URL
    branch: main                  # (optional) git branch
  project_repo:                   # (required) project configuration
    path: C:/Projects/MyGame   # (required) project root
    vcs: svn                      # (required) git | svn
    url: ""                      # (optional) remote URL
    branch: main                  # (optional) git branch
  uproject: C:/Projects/MyGame/MyGame.uproject  # (required) .uproject file

targets:
  <name>:
    kind: editor | program | game | client | server   # (required)
    name: string                                       # (optional, binary name for program/game)
    config: development | debug | shipping | test      # (default: development)

ops:
  <opName>:
    <variant>:                        # "default" is conventional for unqualified invocation
      - uses: ns/handler              # plugin handler reference
        with:
          key: value                  # params forwarded to handler (interpolated)
        continue-on-error: true       # (optional, default false)
      - run: shell command            # shell command (${{ }} interpolation applied)
        continue-on-error: false

go-pipeline:
  order:                              # op execution order for `bolt go`
    - kill
    - update
    - build
    - start
  fail_stops:                         # ops that abort the entire run on failure
    - build

actions:
  <name>:
    depends:                          # (optional, other action names to run first
      - other-action
    steps:
      - uses: ns/handler
        with:
          key: value
      - uses: ops/<opName>            # delegate to an op's default variant
      - uses: ops/<opName>:<variant>  # delegate to a specific variant
      - run: echo hello

plugins:                              # (optional) explicit project-scope plugins
  - namespace: myplugin
    path: ./bolt-plugins/myplugin/index.ts

notifications:
  on_start: true
  on_complete: true
  on_failure: true
  providers:
    - type: wecom
      webhook_url: https://qyapi.weixin.qq.com/...
      chat_id: optional-group-id
    - type: telegram
      bot_token: "123456:ABC-DEF"
      chat_id: "-1001234567890"
```

## Project Section

The Field | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Display name for the project |
| `engine_repo` | object | yes | Engine configuration |
| `engine_repo.path` | string | yes | Path to Unreal Engine installation |
| `engine_repo.vcs` | string | yes | Version control system (`git` or `svn`) |
| `engine_repo.url` | string | no | Remote repository URL |
| `engine_repo.branch` | string | no | Git branch (for git VCS) |
| `project_repo` | object | yes | Project configuration |
| `project_repo.path` | string | yes | Path to project directory |
| `project_repo.vcs` | string | yes | Version control system (`git` or `svn`) |
| `project_repo.url` | string | no | Remote repository URL |
| `project_repo.branch` | string | no | Git branch (for git VCS) |
| `uproject` | string | yes | Path to `.uproject` file |

## Targets Section

Define build targets for different configurations.

```yaml
targets:
  editor:
    kind: editor
    config: development

  game-dev:
    kind: game
    config: development
    name: MyGame

  game:
    kind: game
    config: shipping
    name: MyGame
```

### Target Properties
| Field | Type | Required | Description |
|------|------|----------|-------------|
| `kind` | string | yes | Target type: `editor`, `program`, `game`, `client`, `server` |
| `config` | string | no | Build configuration: `development`, `debug`, `shipping`, `test` |
| `name` | string | no | Binary name (for game/server/program targets) |

## Ops Section
Define composable operations with variants.

```yaml
ops:
  update:
    default: [update:svn]
    full: [update:svn, update:git]

  build:
    default: [generate-project-files, compile-editor]

  start:
    default: [run-editor]

  go-to:
    default: [update, build, start]
    dev: [update:full, build, start]
```

### Op Properties
| Field | Type | Description |
|------|------|-------------|
| `default` | Step[] | Default variant |
| `<variant>` | Step[] | Named variant (e.g., `ci`, `dev`, `release`) |

### Step Properties
| Field | Type | Description |
|------|------|-------------|
| `uses` | string | Handler reference (`namespace/handler`) |
| `run` | string | Shell command to execute |
| `with` | object | Parameters passed to handler |
| `continue-on-error` | boolean | Continue on failure (default: false) |

## go-pipeline Section
Controls execution order and failure behavior.

```yaml
go-pipeline:
  order:
    - kill
    - update
    - build
    - start
  fail_stops:
    - build
```

### Properties
| Field | Type | Description |
|------|------|-------------|
| `order` | string[] | Op execution order for `bolt go` |
| `fail_stops` | string[] | Ops that abort the entire run on failure |

## actions Section
Define single-purpose actions with dependencies.

```yaml
actions:
  package-game:
    - uses: ue/package-game
      target: game
      output: ./Builds

  deploy-server:
    depends:
      - package-game
    steps:
      - uses: fs/copy
        src: ./Builds
        dst: //server/builds
```

### Action Properties
| Field | Type | Description |
|------|------|-------------|
| `depends` | string[] | Other actions to run first |
| `steps` | Step[] | Steps to execute |

## plugins Section
Explicitly register project-scope plugins.

```yaml
plugins:
  - namespace: myplugin
    path: ./tools/myplugin/index.ts
```

### Plugin Properties
| Field | Type | Required | Description |
|------|------|----------|-------------|
| `namespace` | string | yes | Plugin namespace |
| `path` | string | yes | Path to plugin entry file |

## notifications Section
Configure notifications for build events.

```yaml
notifications:
  on_start: true
  on_complete: true
  on_failure: true
  providers:
    - type: wecom
      webhook_url: https://qyapi.weixin.qq.com/...
      chat_id: optional-group-id
    - type: telegram
      bot_token: "123456:ABC-DEF"
      chat_id: "-1001234567890"
```

### Properties
| Field | Type | Description |
|------|------|-------------|
| `on_start` | boolean | Notify when run starts |
| `on_complete` | boolean | Notify on successful completion |
| `on_failure` | boolean | Notify on failure |
| `providers` | array | Notification providers |

## See Also
- [Getting Started](/guides/getting-started.md) - Quick start guide
- [Config Schema](/api/config-schema.md) - Detailed configuration types
- [Interpolation](./interpolation.md) - Template syntax
