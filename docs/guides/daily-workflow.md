---
title: "Daily Workflow"
---

A real-world end-to-end example of using Bolt for daily UE development.

## The Scenario

You're starting your morning. You need to:
1. Update engine source (git)
2. Update project source (svn)
3. Build the editor
4. Start the editor
5. Run automation tests
6. Package the game
7. Deploy the build

```

## Step 1: Update Engine
```bash
bolt go update
```

Bolt runs the `update` op with both variants:
```yaml
ops:
  update:
    git:
      - uses: ue/update-git
    svn:
      - uses: ue/update-svn
```

## Step 2: Build
```bash
bolt go build
```

This runs:
1. `ue/build` handler with `target: editor`
2. Compiles editor C++ game binaries
3. Generates project files (if needed)
4. Runs UBT automation tests

5. Launch the editor

## Step 3: Run Automation Tests
```bash
bolt go build:ci
```

This runs:
1. Build the editor
2. Run automation tests
3. Package the game
4. Deploy

## Step 4: Package the Game
```bash
bolt run package-game
```

This runs the `ue/package-game` handler which:
- Copies the built game to the output directory
- Creates a zip archive for distribution

## Configuring Notifications

Notifications are configured in `bolt.yaml`:

```yaml
notifications:
  on_complete: true
  providers:
    - type: telegram
      bot_token: ${{env.TELEGRAM_BOT_TOKEN}}
      chat_id: ${{env.TELEGRAM_CHAT_ID}}
```

## Step 5: Deploy
```bash
bolt run deploy
```

This runs a `deploy` action which:
```yaml
actions:
  deploy:
    steps:
      - uses: ue/package-game
        with:
          target: game
          output: ./Builds
      - uses: fs/copy
        with:
          src: ./Builds
          dst: //artifacts/builds/v{{env.BUILD_NUMBER}}
      - run: |
        # Deploy script
        silent: false
      - uses: telegram/notify
        with:
          message: "Build deployed!"
```

## Configuration Summary

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
    config: development
  game:
    kind: game
    config: shipping
    name: MyGame

  client:
    kind: client
    config: shipping
    name: MyGame

  server:
    kind: server
    config: shipping
    name: MyGameServer

ops:
  update:
    git:
      - uses: ue/update-git
    svn:
      - uses: ue/update-svn
    full:
      - uses: ue/update-git
      - uses: ue/update-svn
  build:
    default:
      - uses: ue/build
        with:
          target: editor
    editor:
      - uses: ue/build
        with:
          target: editor
      - uses: ue/start
        with:
          target: editor
    game:
      - uses: ue/build
        with:
          target: game
      - uses: ue/package-game
        with:
          target: game
          output: ./Builds
  start:
    default:
      - uses: ue/start
        with:
          target: editor

  kill:
    default:
      - uses: ue/kill

  clean:
    default:
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
          path: ./Build

      - uses: fs/delete
        with:
          path: ./DerivedDataCache
      - uses: fs/delete
        with:
          path: ./.bolt/logs

go-pipeline:
  order:
    - kill
    - update
    - build
    - start
  fail_stops:
    - build
```

## Tips

### Use Variants for Different Scs

```bash
# Quick update and build
bolt go update build

# Use full variant for update
bolt go update:full build

# CI build with editor target
bolt go build:editor
# Clean build and start fresh
bolt go build kill start
```

### Use --dry-run to preview
```bash
bolt go update build --dry-run
```

### Use notifications for long-running ops
```yaml
notifications:
  on_complete: true
  on_failure: true
  providers:
    - type: telegram
      bot_token: "${TELEGRAM_BOT_TOKEN}"
      chat_id: "${TELEGRAM_CHAT_ID}"
```

### Configure fail_stops for critical ops
```yaml
go-pipeline:
  fail_stops:
    - build    # Stop everything if build fails
    - start     # Continue even if start fails
```

### Use continue-on-error for non-critical steps
```yaml
ops:
  clean:
    default:
      - uses: fs/delete
        with:
          path: ./Saved
        continue-on-error: true  # Don't fail if clean fails
      - uses: fs/delete
        with:
          path: ./Intermediate
```

## See Also
- [bolt.yaml Reference](/guides/bolt-yaml.md) - [Project Structure](/guides/project-structure.md) - Best practices for team collaboration
