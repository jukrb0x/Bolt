# Installation

Detailed installation instructions for Bolt.

## System Requirements

### Windows
- Windows 10 or later
- PowerShell 5.1 or later
- Git (optional, for Git-based workflows)
- TortoiseSVN (optional, for SVN workflows)

### macOS
- macOS 12 (Monterey) or later
- Apple Silicon (M1/M2/M3) or Intel (experimental)
- Git (optional)
- Command-line SVN (optional)

## Installation Methods

### Method 1: Automatic Installation (Recommended)

**Windows:**
```powershell
irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
```

**macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
```

This will:
1. Download the latest release
2. Install Bolt to `~/.bolt/bin/`
3. Add `~/.bolt/bin` to your PATH
4. Verify the installation

### Method 2: Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/jukrb0x/Bolt/releases)
2. Extract the archive
3. Move the binary to `~/.bolt/bin/bolt` (or `bolt.exe` on Windows)
4. Add `~/.bolt/bin` to your PATH

**Windows (PowerShell):**
```powershell
mkdir -p ~/.bolt/bin
Move-Item bolt-win-x64.exe ~/.bolt/bin/bolt.exe
$env:PATH += ";$env:USERPROFILE\.bolt\bin"
```

**macOS:**
```bash
mkdir -p ~/.bolt/bin
mv bolt-mac-arm64 ~/.bolt/bin/bolt
chmod +x ~/.bolt/bin/bolt
echo 'export PATH="$HOME/.bolt/bin:$PATH"' >> ~/.zshrc
```

### Method 3: Build from Source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/jukrb0x/Bolt.git
cd Bolt
bun install
bun run build:mac    # or build:win on Windows
```

The binary will be in `build/bolt-mac-arm64` or `build/bolt-win-x64.exe`.

## Updating Bolt

Update to the latest version:

```bash
bolt self-update
```

This downloads and installs the latest release.

## Verifying Installation

Check that Bolt is installed correctly:

```bash
bolt version
bolt --help
```

You should see the version number and a list of commands.

## Uninstallation

To remove Bolt:

1. Delete `~/.bolt/` directory
2. Remove `~/.bolt/bin` from your PATH

**Windows (PowerShell):**
```powershell
Remove-Item -Recurse -Force ~/.bolt
```

**macOS:**
```bash
rm -rf ~/.bolt
# Remove the PATH line from ~/.zshrc or ~/.bashrc
```

## Next Steps

- [Create your first workflow](/tutorial/first-workflow)
- [Configure your project](/api/config)
