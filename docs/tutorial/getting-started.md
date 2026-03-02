# Getting Started

Welcome to Bolt! This tutorial will walk you through setting up Bolt and creating your first automated workflow.

## What is Bolt?

Bolt is a CLI tool that automates repetitive Unreal Engine tasks:

- **Update source control** (Git/SVN)
- **Build the editor** and game targets
- **Launch the editor** or standalone binaries
- **Fill Derived Data Cache** (DDC)
- **Any custom workflow** via plugins

Instead of manually running Build.bat, updating SVN, and launching the editor, you define these steps in a `bolt.yaml` file and run them with a single command.

## Who is this for?

Bolt is designed for:

- **UE developers** who rebuild the editor frequently
- **Build engineers** managing CI/CD pipelines
- **Teams** who want consistent build processes
- **Anyone** tired of context-switching between tools

## Prerequisites

Before starting, ensure you have:

- **Unreal Engine** installed (source build or prebuilt)
- **A UE project** (C++ or Blueprint)
- **Windows** (primary platform) or **macOS** (Apple Silicon)
- **Source control** set up (Git or SVN)

## Installation

### Windows

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
```

This installs Bolt to `~/.bolt/bin/` and adds it to your PATH.

### macOS (Apple Silicon)

Open Terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
```

### Verify Installation

```bash
bolt version
```

You should see the Bolt version number.

## Next Steps

- [Create your first workflow](/tutorial/first-workflow)
- [Learn about ops and actions](/tutorial/custom-ops)
- [Explore the configuration reference](/api/config)

## Getting Help

- **Documentation**: You're reading it!
- **GitHub Issues**: [Report bugs or request features](https://github.com/jukrb0x/Bolt/issues)
- **Community**: Join discussions on GitHub
