# Configuration Reference

Complete reference for `bolt.yaml` configuration.

## Project

Required. Defines your UE project.

```yaml
project:
  name: MyGame                        # Display name
  engine_root: C:/UnrealEngine        # Path to UE engine
  project_root: C:/Projects/MyGame    # Path to project
  project_name: MyGame                # .uproject name (without extension)
  
  # Optional
  engine_vcs: git                     # Engine version control: git | svn
  project_vcs: svn                    # Project version control: git | svn
  git_branch: main                    # Git branch for engine
  use_tortoise: true                  # Use TortoiseSVN: true | false | auto
```

### Legacy Aliases

These are accepted but deprecated:

```yaml
project:
  ue_path: C:/UnrealEngine        # → engine_root
  project_path: C:/Projects/MyGame # → project_root
  svn_root: C:/Projects/MyGame    # → project_root
```

## Targets

Define build targets.

```yaml
targets:
  editor:
    kind: editor                   # editor | program | game | client | server
    config: development            # development | debug | shipping | test
  
  game-client:
    kind: client
    name: MyGameClient             # Required for program/game/client/server
    config: shipping
  
  dedicated-server:
    kind: server
    name: MyGameServer
    config: development
```

### Target Kinds

| Kind | Description | Requires `name` |
|------|-------------|-----------------|
| `editor` | UE Editor | No |
| `program` | Standalone program | Yes |
| `game` | Game build | Yes |
| `client` | Game client | Yes |
| `server` | Dedicated server | Yes |

### Build Configurations

| Config | Description |
|--------|-------------|
| `development` | Default, with debugging |
| `debug` | Full debug symbols |
| `shipping` | Optimized release |
| `test` | For automated testing |

## Ops

Define reusable operations.

```yaml
ops:
  update:
    default:
      - uses: ue/update
  
  build:
    default:
      - uses: ue/build
        with:
          target: editor
    
    client:
      - uses: ue/build
        with:
          target: game-client
          config: shipping
  
  deploy:
    production:
      - uses: custom/deploy
        with:
          env: production
```

### Step Properties

| Property | Type | Description |
|----------|------|-------------|
| `uses` | string | Handler to use (e.g., `ue/build`) |
| `with` | object | Parameters for the handler |
| `run` | string | Shell command to run (alternative to `uses`) |
| `continue-on-error` | boolean | Continue if step fails |

### Op Variants

Create multiple variants:

```yaml
ops:
  build:
    editor:
      - uses: ue/build
        with:
          target: editor
    
    client:
      - uses: ue/build
        with:
          target: game-client
```

Select with `:`:

```bash
bolt go build:editor
bolt go build:client
```

## Go Pipeline

Control execution order and failure behavior.

```yaml
go-pipeline:
  order:
    - kill
    - update
    - build
    - start
  
  fail_stops:
    - build     # Stop pipeline if build fails
```

Bolt always executes ops in `order`, regardless of command-line order:

```bash
bolt go start build    # Executes build first, then start
```

## Actions

Named workflows for `bolt run`.

```yaml
actions:
  daily:
    steps:
      - uses: ops/kill
        continue-on-error: true
      - uses: ops/update
      - uses: ops/build
      - uses: ops/start
  
  full-reset:
    depends:
      - daily
    steps:
      - uses: ops/deploy
```

Run with:

```bash
bolt run daily
bolt run full-reset    # Runs daily first, then deploy
```

### Action Properties

| Property | Type | Description |
|----------|------|-------------|
| `depends` | string[] | Actions to run first |
| `steps` | Step[] | Steps to execute |

## Plugins

Load custom plugins.

```yaml
plugins:
  - namespace: custom
    path: ./plugins/custom-plugin
  
  - namespace: deploy
    path: ~/.bolt/plugins/deploy-plugin
```

### Plugin Scopes

| Scope | Location | Priority |
|-------|----------|----------|
| Built-in | Compiled into bolt | Lowest |
| User | `~/.bolt/plugins/<name>/` | ↑ |
| Project auto | `.bolt/plugins/<name>/` | ↑ |
| Project explicit | `plugins:` in bolt.yaml | Highest |

## Timeout

Global timeout for operations.

```yaml
timeout_hours: 6
```

## Notifications

Configure build notifications.

```yaml
notifications:
  on_start: true
  on_complete: true
  on_failure: true
  
  providers:
    - type: wecom
      webhook_url: https://qyapi.weixin.qq.com/...
      chat_id: chat_id_here
    
    - type: telegram
      bot_token: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
      chat_id: "-1001234567890"
```

### Provider Types

**WeChat Work (Wecom)**
```yaml
- type: wecom
  webhook_url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...
  chat_id: optional_chat_id
```

**Telegram**
```yaml
- type: telegram
  bot_token: "BOT_TOKEN"
  chat_id: "CHAT_ID"
```

## Complete Example

```yaml
project:
  name: MyGame
  engine_root: C:/UnrealEngine
  project_root: C:/Projects/MyGame
  project_name: MyGame
  engine_vcs: git
  project_vcs: svn
  git_branch: main
  use_tortoise: true

targets:
  editor:
    kind: editor
    config: development
  
  game-client:
    kind: client
    name: MyGameClient
    config: shipping
  
  dedicated-server:
    kind: server
    name: MyGameServer
    config: development

ops:
  update:
    default:
      - uses: ue/update
  
  build:
    editor:
      - uses: ue/build
        with:
          target: editor
    
    client:
      - uses: ue/build
        with:
          target: game-client
    
    server:
      - uses: ue/build
        with:
          target: dedicated-server
  
  start:
    editor:
      - uses: ue/start
        with:
          target: editor
    
    game:
      - uses: ue/start
        with:
          target: game-client

go-pipeline:
  order: [kill, update, build, start]
  fail_stops: [build]

actions:
  daily:
    steps:
      - uses: ops/kill
        continue-on-error: true
      - uses: ops/update
      - uses: ops/build
        with:
          target: editor
      - uses: ops/start
        with:
          target: editor
  
  ship:
    depends: [daily]
    steps:
      - uses: ops/build
        with:
          target: game-client
          config: shipping

plugins:
  - namespace: custom
    path: ./plugins/custom

timeout_hours: 6

notifications:
  on_complete: true
  on_failure: true
  providers:
    - type: telegram
      bot_token: "123:ABC"
      chat_id: "-100..."
```
