---
layout: home

hero:
  name: "Bolt"
  text: "Your daily Unreal Engine workflow, automated"
  tagline: "Stop running Build.bat by hand. Define your workflow once, run it anywhere."
  image:
    src: /logo.svg
    alt: Bolt
  actions:
    - theme: brand
      text: Get Started
      link: /tutorial/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/jukrb0x/Bolt

features:
  - icon: ⚡
    title: Lightning Fast
    details: Chain multiple UE operations in a single command. Update, build, and launch in one go.
  - icon: 🔧
    title: Fully Configurable
    details: Define your workflow once in bolt.yaml. Share configurations with your team.
  - icon: 🔌
    title: Plugin System
    details: Extend Bolt with custom handlers for anything - Slack notifications, deployment, custom tools.
  - icon: 📦
    title: Zero Dependencies
    details: Single binary installation on Windows and macOS. No Node.js or Python required.
---

## Quick Start

**Windows**
```powershell
irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
```

**macOS (Apple Silicon)**
```bash
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
```

## Example Workflow

```yaml
# bolt.yaml
project:
  name: MyGame
  ue_path: C:/UnrealEngine
  project_path: C:/Projects/MyGame
  project_name: MyGame

ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
```

```bash
bolt go update build start  # Full workflow in one command
```

## Why Bolt?

### Stop Context Switching

No more jumping between TortoiseSVN, the editor, and batch scripts. Define your workflow once, run it with a single command.

### Team Consistency

Share bolt.yaml with your team. Everyone uses the same build process, same configuration, same results.

### Extensible

Need to deploy builds? Send Slack notifications? Run custom tools? Write a plugin and use it like any built-in handler.

## Learn More

- [Getting Started Tutorial](/tutorial/getting-started)
- [API Reference](/api/overview)
- [Plugin Development](/tutorial/plugins)
