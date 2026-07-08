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
  <Feature title="Tasks + Flows" icon="bolt">
    Define reusable tasks (named step lists) and compose them into ordered flows. Run tasks ad-hoc in the order you type, or run a flow to hit a goal.
  </Feature>
  <Feature title="One Verb" icon="terminal">
    Everything runs through `bolt run`. What you type is what runs - no hidden reordering. Pass `--key=value` params to steer any run.
  </Feature>
  <Feature title="Plugin System" icon="plug">
    Extend Bolt with custom handlers for deployment, notifications, or any workflow. Override built-ins with your own implementations.
  </Feature>
  <Feature title="Shared + Local Config" icon="file-code">
    Commit a shared `bolt.yaml` contract; keep machine paths in a gitignored `bolt.local.yaml`. No personal paths in version control.
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

Initialize your project. `bolt init` scaffolds a shared `bolt.yaml` and a per-machine `bolt.local.yaml` (edit the paths in the latter):

```bash
cd /path/to/your/ue/project
bolt init
```

Run your workflow. Pass tasks to run them in the order you type, or a flow name to hit a predefined goal:

```bash
bolt run update build start     # tasks, in the typed order
bolt run daily                  # a flow (update -> build -> start)
bolt run daily --dry-run        # preview without executing
```

## Why Bolt?

Stop running `Build.bat` by hand. Stop context-switching between TortoiseSVN, the editor, and a dozen batch scripts. Bolt turns repetitive UE tasks into single commands you can chain, script, and share with your team.

```yaml
# bolt.yaml - shared contract, committed (no machine paths)
project:
  name: MyGame
  engine: { vcs: git }
  project: { vcs: svn }

tasks:
  update: [{ uses: ue/update_engine }, { uses: ue/update_project }]
  build:  [{ uses: ue/build, with: { target: editor } }]
  start:  [{ uses: ue/start }]

flows:
  daily:
    description: Update, build, and launch the editor
    steps: [update, build, start]
    continue_on_fail: [start]   # update/build failures abort; start may fail
```

```yaml
# bolt.local.yaml - per-machine paths, gitignored
engine_path:  C:/UnrealEngine
project_path: C:/Projects/MyGame
uproject:     C:/Projects/MyGame/MyGame.uproject
```

```bash
bolt run update build start        # ad-hoc: tasks in the typed order
bolt run build                     # just rebuild the editor
bolt run build --config=debug      # params replace the old variants
bolt run daily                     # run the predefined flow
```
