---
title: "Config Schema"
---

Complete reference for the `bolt.yaml` configuration schema.

## Top-Level Fields

```yaml
timeout_hours: 6                    # Optional: Global timeout for entire run

```

## project
```yaml
project:
  name: MyGame                        # required: Display name
  engine_repo:                      # required: Engine configuration
    path: C:/UnrealEngine       # required: Path to UE
    vcs: git                      # required: git | svn
    url: ""                      # optional: Remote URL
    branch: main                  # optional: Git branch
  project_repo:                     # required: Project configuration
    path: C:/Projects/MyGame      # required: Project path
    vcs: svn                      # required: git | svn
    url: ""                      # optional: Remote URL
    branch: main                  # optional: Git branch
  uproject: C:/Projects/MyGame/MyGame.uproject  # required: .uproject path
  use_tortoise: true               # optional: true | false | auto-detect
```

### engine_repo
| Field | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Path to Unreal Engine |
| `vcs` | string | yes | Version control system (`git` or `svn`) |
| `url` | string | no | Remote repository URL |
| `branch` | string | no | Git branch (for git VCS) |

### project_repo
| Field | Type | Required | Description |
|------|------|----------|-------------|
| `path` | string | yes | Path to project |
| `vcs` | string | yes | Version control system (`git` or `svn`) |
| `url` | string | no | Remote repository URL |
| `branch` | string | no | Git branch (for git VCS) |

## targets
```yaml
targets:
  editor:
    kind: editor               # required: editor | program | game | client | server
    config: development           # default: development
    name: MyGame                # optional: Target name (for game/server)

  game:
    kind: game
    config: shipping
    name: MyGame
```

### Target Fields
| Field | Type | Required | Description |
|------|------|----------|-------------|
| `kind` | string | yes | Target type: `editor`, `program`, `game`, `client`, `server` |
| `config` | string | no | Build configuration: `development`, `debug`, `shipping`, `test` |
| `name` | string | no | Binary name (for game/server/program targets) |

## ops
```yaml
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
      - run: npm test
```

### Op Fields
| Field | Type | Description |
|------|------|-------------|
| `default` | Step[] | Default variant |
| `ci`, `dev`, etc. | Step[] | Named variants |

### Step Fields
| Field | Type | Description |
|------|------|-------------|
| `uses` | string | Handler reference (`namespace/handler`) |
| `run` | string | Shell command to execute |
| `with` | object | Parameters passed to handler |
| `continue-on-error` | boolean | Continue on error (default: false) |

## go-pipeline
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

### Fields
| Field | Type | Description |
|------|------|-------------|
| `order` | string[] | Op execution order for `bolt go` |
| `fail_stops` | string[] | Ops that abort the run on failure |

## actions
```yaml
actions:
  package-game:
    depends:
      - build
    steps:
      - uses: ue/package-game
        with:
          target: game
          output: ./Builds
```

### Action Fields
| Field | Type | Description |
|------|------|-------------|
| `depends` | string[] | Other actions to run first |
| `steps` | Step[] | Steps to execute |

## plugins
```yaml
plugins:
  - namespace: myplugin
    path: ./bolt-plugins/myplugin/index.ts
```

### Plugin Fields
| Field | Type | Description |
|------|------|-------------|
| `namespace` | string | Plugin namespace |
| `path` | string | Path to plugin entry file |

## notifications
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

### Notification Fields
| Field | Type | Description |
|------|------|-------------|
| `on_start` | boolean | Notify when run starts |
| `on_complete` | boolean | Notify on successful completion |
| `on_failure` | boolean | Notify on failure |
| `providers` | array | Notification providers |

### Provider Types
| Type | Required Fields |
|------|----------------|
| `wecom` | `webhook_url`, `chat_id` (optional) |
| `telegram` | `bot_token`, `chat_id` |

## See Also
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Full configuration examples
- [Interpolation](/guides/interpolation.md) - Template syntax
