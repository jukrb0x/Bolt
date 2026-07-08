---
title: "Installation"
---

Install Bolt to get started with Unreal Engine workflow automation.

## Windows

```powershell
irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
```

Installs `bolt` to `~/.bolt/bin/` and adds it to your PATH.

## macOS (Apple Silicon)

```bash
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
```

## Update

To update Bolt to the latest version:

```bash
bolt self-update
```

## Verify Installation

Check that Bolt is installed correctly:

```bash
bolt --version
```

Output: `2.0.0` (or similar)

## After Installing

`bolt` is not interactive. To set up a project, run `bolt init` from your UE project directory. It scaffolds **two** files:

- `bolt.yaml` — shared, committed contract (project identity, targets, tasks, flows)
- `bolt.local.yaml` — per-machine paths (engine/project/uproject), gitignored

Then preview and run a flow:

```bash
bolt init                   # scaffold bolt.yaml + bolt.local.yaml
bolt run daily --dry-run    # preview the steps
bolt run daily              # run the flow
```

See [First Project](./first-project.md) for the full walkthrough.

## Uninstall

To remove Bolt from your system, delete the install directory and remove it from your PATH.

**Windows**

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.bolt\bin"
# Then remove "%USERPROFILE%\.bolt\bin" from your PATH via System Settings
```

**macOS/Linux**

```bash
rm -rf ~/.bolt/bin
# Remove the "export PATH=..." line for ~/.bolt/bin from ~/.bashrc or ~/.zshrc
```

## Manual Installation

If you prefer manual installation, download the latest release from [GitHub Releases](https://github.com/jukrb0x/Bolt/releases) and place the binary on your PATH.

**Windows**

```powershell
$installPath = "$env:USERPROFILE\.bolt\bin"
New-Item -ItemType Directory -Force -Path $installPath | Out-Null
Move-Item .\bolt-win-x64.exe "$installPath\bolt.exe"
# Add $installPath to your PATH, then verify:
bolt --version
```

**macOS**

```bash
mkdir -p ~/.bolt/bin
mv ./bolt-mac-arm64 ~/.bolt/bin/bolt
chmod +x ~/.bolt/bin/bolt
echo 'export PATH="$HOME/.bolt/bin:$PATH"' >> ~/.zshrc
bolt --version
```

## Troubleshooting

### "bolt.yaml not found" error

Make sure you:
1. Are in a directory with a `bolt.yaml` file (or a subdirectory of one)
2. Bolt looks for `bolt.yaml` by walking up the directory tree from the current directory

### Permission denied

Run the installer with administrator privileges or try again.

### Network issues

If the download fails, check your internet connection or try a mirror URL.

## See Also

- [Getting Started](./getting-started.md) - Introduction to Bolt
- [First Project](./first-project.md) - Setup guide with `bolt init`
