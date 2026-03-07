---
title: "Bolt"
description: "Your daily Unreal Engine workflow, automated. Build, update, and deploy with a single command."
---

Your daily Unreal Engine workflow, automated. Build, update, and deploy with a single command.

<ButtonGroup>
  <Button href="/guides/getting-started">Get Started</Button>
  <Button href="https://github.com/jukrb0x/Bolt" variant="secondary">View on GitHub</Button>
</ButtonGroup>

<Features>
  <Feature title="Pipeline Automation" icon="bolt">
    Chain operations like update, build, and start into single commands. Define your workflow once in bolt.yaml, run it anywhere.
  </Feature>
  <Feature title="Plugin System" icon="plug">
    Extend Bolt with custom handlers for deployment, notifications, or any workflow. Override built-ins with your own implementations.
  </Feature>
  <Feature title="Variant Support" icon="git-branch">
    Ops support multiple variants (dev, ci, release) selected at runtime. One config, many workflows.
  </Feature>
  <Feature title="Declarative Config" icon="file-code">
    YAML-based configuration with template interpolation, target definitions, and dependency management.
  </Feature>
  <Feature title="Notifications" icon="bell">
    Get notified on build start, completion, or failure via WeChat Work, Telegram, and more.
  </Feature>
  <Feature title="Library Mode" icon="box">
    Use Bolt programmatically from Node.js or Bun. Access built-in plugins directly or build your own automation.
  </Feature>
</Features>

## Quick Start

Install Bolt:

<Tabs>
  <Tab title="Windows (PowerShell)">
    ```powershell
    irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
    ```
  </Tab>
  <Tab title="macOS/Linux">
    ```bash
    curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
    ```
  </Tab>
</Tabs>

Initialize your project:

```bash
cd /path/to/your/ue/project
bolt init
```

Run your workflow:

```bash
bolt go update build start
```

## Why Bolt?

Stop running `Build.bat` by hand. Stop context-switching between TortoiseSVN, the editor, and a dozen batch scripts. Bolt turns repetitive UE tasks into single commands you can chain, script, and share with your team.

```yaml
# bolt.yaml - Define once, run anywhere
project:
  name: MyGame
  engine_repo:
    path: C:/UnrealEngine
    vcs: git
  project_repo:
    path: C:/Projects/MyGame
    vcs: svn
  uproject: C:/Projects/MyGame/MyGame.uproject

ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
```

```bash
bolt go update build start      # full reset and rebuild
bolt go build                   # just rebuild the editor
bolt go update:svn build --config=debug  # SVN update then debug build
```
