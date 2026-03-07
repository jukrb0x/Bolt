---
title: "Project Structure"
---

Best practices for organizing bolt.yaml for team collaboration.

## Directory Structure
```
project-root/
├── bolt.yaml                    # Bolt configuration
├── .bolt/
│   ├── plugins/               # Project-scope plugins
│   │   └── myplugin/
│   │       ├── index.ts
│   │       ├── package.json
│   │       └── tsconfig.json
│   └── logs/                  # Execution logs
├── engine/                    # Unreal Engine source
│   └── ...
└── project/                  # UE project
    ├── Config/
    ├── Source/
    ├── Content/
    └── MyGame.uproject
```

## Config Organization

### Minimal Configuration
For small teams or simple workflows:

```yaml
# bolt.yaml
project:
  name: MyGame
  engine_repo:
    path: ./engine
    vcs: git
  project_repo:
    path: ./project
    vcs: svn
  uproject: ./project/MyGame.uproject

targets:
  editor:
    kind: editor

ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor

go-pipeline:
  order:
    - update
    - build
    - start
```

### Full Configuration
For larger teams with multiple targets, environments, and workflows.

```yaml
# bolt.yaml
project:
  name: MyGame
  engine_repo:
    path: ./engine
    vcs: git
    branch: main
    url: https://github.com/company/UnrealEngine.git
  project_repo:
    path: ./project
    vcs: svn
    url: svn://svn.company.com/Projects
  uproject: ./project/MyGame.uproject
  use_tortoise: true

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
  server:
    kind: server
    config: shipping
    name: MyGameServer

ops:
  update:
    default:
      - uses: ue/update-svn
    full:
      - uses: ue/update-git
      - uses: ue/update-svn
    git:
      - uses: ue/update-git
  build:
    default:
      - uses: ue/build
        with:
          target: editor
    ci:
      - uses: ue/build
        with:
          target: editor
      - run: npm run test
    game:
      - uses: ue/build
        with:
          target: game
  start:
    default:
      - uses: ue/start
        with:
          target: editor
    game:
      - uses: ue/start
        with:
          target: game
  deploy:
    staging:
      - uses: fs/copy
        with:
          src: ./Builds/MyGame
          dst: //server/builds/v1.0
      - uses: myplugin/notify
        with:
          message: "Deployed to staging"
    production:
      - uses: fs/copy
        with:
          src: ./Builds/MyGame
          dst: //server/builds/v1.0
      - uses: myplugin/notify
        with:
          message: "Deployed to production"

go-pipeline:
  order:
    - kill
    - update
    - build
    - start
  fail_stops:
    - build

actions:
  package:
    steps:
      - uses: ue/package-game
        with:
          target: game
          output: ./Builds
  clean:
    steps:
      - uses: fs/delete
        with:
          path: ./Saved
      - uses: fs/delete
        with:
          path: ./Intermediate
      - uses: fs/delete
        with:
          path: ./Binaries

      - uses: fs/delete
        with:
          path: ./.bolt/logs

plugins:
  - namespace: myplugin
    path: ./tools/myplugin/index.ts

notifications:
  on_complete: true
  on_failure: true
  providers:
    - type: telegram
      bot_token: ${env.TELEGRAM_BOT_TOKEN}
      chat_id: ${env.TELEGRAM_CHAT_ID}
```

## Variant Strategy
Use variants to handle different scenarios:

```yaml
ops:
  build:
    # Default: quick local build
    default:
      - uses: ue/build
        with:
          target: editor
    # Development: with hot reload
    dev:
      - uses: ue/build
        with:
          target: editor
      - uses: ue/start
        with:
          target: editor
    # CI: full build with tests
    ci:
      - uses: ue/build
        with:
          target: editor
      - run: npm run lint
      - run: npm run test
    # Release: full packaging
    release:
      - uses: ue/build
        with:
          target: game
          config: shipping
      - uses: ue/package-game
        with:
          target: game
          output: ./Builds
```

Select variants at runtime:
```bash
bolt go build           # default
bolt go build:dev       # dev variant
bolt go build:ci        # ci variant
bolt go build:release  # release variant
```

## Team Collaboration Tips

### 1. Use Relative Paths
Always use relative paths from the config root for portability.

```yaml
# Good - portable
project:
  engine_repo:
    path: ./engine      # Relative to config file
  project_repo:
    path: ./project    # Relative to config file
```

```yaml
# Bad - hard to maintain
project:
  engine_repo:
    path: C:/UnrealEngine    # Absolute path
  project_repo:
    path: C:/Projects/MyGame  # Absolute path
```

### 2. Document Variants
Comment your variants in the op definition.

```yaml
ops:
  build:
    default: &default-build    # CI/CD
    dev: &dev-build            # Development with hot reload
    ci: &ci-build             # Full CI pipeline
    release: &release-build    # Production release
```

### 3. Use Go Pipeline
Define execution order explicitly to avoid confusion.

```yaml
go-pipeline:
  order:
    - kill
    - update
    - build
    - start
  fail_stops:
    - build    # Stop everything if build fails
```

### 4. Environment Variables
Use environment variables for sensitive data.

```yaml
notifications:
  providers:
    - type: telegram
      bot_token: ${env.TELEGRAM_BOT_TOKEN}  # From environment
      chat_id: ${env.TELEGRAM_CHAT_ID}
```

```bash
# Set environment variables
export TELEGRAM_BOT_TOKEN="123456:ABC"
export TELEGRAM_CHAT_ID="-1001234567890"
bolt go build
```

## See Also
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Complete configuration schema
- [Error Handling](./error-handling.md) - Handling failures gracefully
