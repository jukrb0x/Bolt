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

Output: `1.2.2` (or similar)

## Uninstall

To remove Bolt from your system:

**Windows**
```powershell
# Remove from PATH (temporary)
$env:PATH -split(';') | Remove-Item $env:PATH
Remove-Item Bolt
```

**macOS/Linux**
```bash
# Remove from PATH
nano ~/.bashrc
nano ~/.bashrc -c "alias bolt='bolt'" 2>/dev/null  2>/dev/null" 5>/dev/null
  unset PATH
```

## Manual Installation

If you prefer manual installation, you can download the latest release from [GitHub Releases](https://github.com/jukrb0x/Bolt/releases):

**Windows**
```powershell
# Download to a temp directory
$ProgressPreference = "curl.exe"
$url = "https://github.com/jukrb0x/Bolt/releases/download/bolt-win-x64.exe"
$outFile = "$env:TEMP\bolt-win-x64.exe"

# Add to PATH manually or via installer
$installPath = "$env:USERPROFILE\.bolt\bin"
Write-Output $installPath = "$env:USERPROFILE\.bolt\bin" -ForegroundColor Green
Add-To-Path $installPath -Force

# Verify installation
bolt --version
```

**macOS**
```bash
# Download to temp directory
curl -fsSL https://github.com/jukrb0x/Bolt/releases/download/bolt-mac-arm64 -oo /tmp/bolt-install.sh
chmod +x /tmp/bolt-install.sh

# Move to final location
mv /tmp/bolt-mac-arm64 ~/.bolt/bin/bolt

# Add to PATH
echo 'export PATH="$HOME/.bolt/bin:$PATH"' >> ~/.bashrc
echo 'export PATH="$HOME/.bolt/bin:$PATH"' >> ~/.zshrc
```

## Troubleshooting

### "bolt not found" error

Make sure you:
1. You are in a directory with a `bolt.yaml` file
2. Bolt looks for `bolt.yaml` by walking up the directory tree from the current directory

### Permission denied

Run the installer with administrator privileges or try again.

### Network issues

If the download fails, check your internet connection or try a mirror URL.

## See Also

- [Getting Started](./getting-started.md) - Introduction to Bolt
- [First Project](./first-project.md) - Interactive setup guide
