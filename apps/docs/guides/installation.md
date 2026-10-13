---
title: "Installation"
---

Install the `bolt` executable. You do not need Node.js or Bun on your PATH.

The installers download the latest [GitHub release](https://github.com/jukrb0x/Bolt/releases/latest). They write a receipt at `~/.bolt/install.json` (`%USERPROFILE%\.bolt\install.json` on Windows) with `"channel": "github"`. [`bolt self-update`](/cli/self-update) only replaces a binary recorded in that receipt.

## Windows

Windows x64 only. A native Windows ARM64 build is not published; the script stops if `PROCESSOR_ARCHITECTURE` is `ARM64`.

```powershell
irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
```

The script needs PowerShell FullLanguage mode. In Constrained Language Mode it stops with a message; download `bolt-win-x64.exe` from the release page instead.

Open a new terminal. The script adds `%USERPROFILE%\.bolt\bin` to the front of your user Path, and the terminal you already have open does not see that change. It edits the raw registry value, so entries such as `%USERPROFILE%\tools` keep their `%VAR%` text and the value stays `REG_EXPAND_SZ`. Other entries are left as written. If the directory is already first, the Path is not rewritten.

|               |                                    |
| ------------- | ---------------------------------- |
| Binary        | `%USERPROFILE%\.bolt\bin\bolt.exe` |
| Receipt       | `%USERPROFILE%\.bolt\install.json` |
| Release asset | `bolt-win-x64.exe`                 |

Re-running the script renames a running `bolt.exe` to `bolt.exe.old` before writing the new file.

To detect an existing install, the script runs the `bolt.exe` it finds on your PATH as `bolt version` (with a 15 second timeout). If that prints a bolt version, the script updates that file in place and does not touch your user Path. Copies that are symlinks or junctions, or sit under a symlinked or junctioned directory, copies in a directory you cannot write, and copies under npm, winget, scoop, or chocolatey are skipped, and the script installs to `%USERPROFILE%\.bolt\bin`. Update package-manager copies with their manager.

Windows puts the system Path before the user Path. If a `bolt` in a system Path directory (or earlier in your user Path) would still run in a new terminal, the script prints a warning naming it. Remove that copy or move `%USERPROFILE%\.bolt\bin` ahead of it.

Bolt v2.1.0 to v2.1.2 installed to `%LOCALAPPDATA%\bolt\bin`. If that directory exists, the script installs to `%USERPROFILE%\.bolt\bin`, moves that entry to the front of your user Path, and prints a note. It does not delete the old directory. You can remove it and its user Path entry yourself.

## macOS and Linux

```bash
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | sh
```

Open a new shell, then run `bolt version`. The script appends `export PATH="$HOME/.bolt/bin:$PATH"` to `~/.zshrc` (zsh), `~/.bashrc` (bash on Linux), or the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile` (bash on macOS, where Terminal starts login shells; `~/.bash_profile` is created if none exist). Other shells get `~/.zshrc`, `~/.bashrc`, or `~/.profile`, whichever exists first. The line is added only if the file has neither that exact line nor another uncommented line that mentions `.bolt/bin`.

To detect an existing install, the script runs the `bolt` it finds on your PATH as `bolt version` (with a 15 second timeout, using `timeout`, `gtimeout`, or a background job). If that prints a bolt version, the script updates that file in place and leaves your shell profile alone. Symlinks, unwritable directories, and npm, Homebrew, or chocolatey copies are skipped, and the script installs to `~/.bolt/bin` instead.

If another `bolt` would still run first (in a new shell when the script wrote or found the PATH line, otherwise on your current PATH), the script prints a warning naming it. Remove it or put the install directory ahead of it.

| Machine                 | Release asset    | Installed path     |
| ----------------------- | ---------------- | ------------------ |
| Intel macOS (`x86_64`)  | `bolt-mac-x64`   | `~/.bolt/bin/bolt` |
| Apple Silicon (`arm64`) | `bolt-mac-arm64` | `~/.bolt/bin/bolt` |
| Linux x64 (`x86_64`)    | `bolt-linux-x64` | `~/.bolt/bin/bolt` |

Linux ARM is not published. On Windows this script prints the PowerShell command and exits.

The receipt is `~/.bolt/install.json`.

## Checksums

Each release includes `SHA256SUMS` (GNU format: 64 hex digits, two spaces, file name) next to the binaries and `bolt.d.ts`.

`install.ps1` and `install.sh` download `SHA256SUMS` with the one asset for this machine. Each script hashes that file and compares the digest to the asset's line. A missing line or a mismatch leaves any existing `bolt` in place. They then run the downloaded file's `version` command and install only when that print is a version token.

`install.sh` runs `sha256sum` on that asset when the command exists, and `shasum -a 256` on that asset otherwise. `install.ps1` hashes `bolt-win-x64.exe` with `Get-FileHash`. Neither script passes `-c`.

The sums file lists the four binaries and `bolt.d.ts`. To check one downloaded file, hash it and compare the digest to that file's line:

```bash
sha256sum bolt-linux-x64
```

On macOS, if `sha256sum` is not installed:

```bash
shasum -a 256 bolt-mac-arm64
```

`sha256sum -c SHA256SUMS` checks every line in the file. Use it only when the directory contains every name those sums list. The same full set works with `shasum -a 256 -c SHA256SUMS`.

## Release assets

[GitHub Releases](https://github.com/jukrb0x/Bolt/releases) publishes:

| File               | Platform                                      |
| ------------------ | --------------------------------------------- |
| `bolt-win-x64.exe` | Windows x64                                   |
| `bolt-linux-x64`   | Linux x64                                     |
| `bolt-mac-arm64`   | Apple Silicon                                 |
| `bolt-mac-x64`     | Intel macOS                                   |
| `bolt.d.ts`        | Plugin typings (`declare module "boltstack"`) |
| `SHA256SUMS`       | Checksums for the files above                 |

## Update

From a script-installed binary:

```bash
bolt self-update
```

See [bolt self-update](/cli/self-update). A copy you placed on PATH yourself has no receipt, so self-update will not replace it. Run the installer again, or replace the file yourself.

## Verify

```bash
bolt version
bolt --version
```

Both print the same version string, such as `2.1.1`.

## After installing

Add a `bolt.yaml` in the project root and commit it. The core file is generic: `version` must be `1`, and `project` is only a name. There is no root `targets` key. Unreal engine, project, uproject, and target metadata live on the `ue` plugin entry. `bolt.local.yaml` is optional and only overrides `vars`.

```yaml
version: 1

project:
  name: MyProject

plugins:
  - namespace: ue
    config:
      engine:
        path: D:/UE
        vcs: git
      project:
        path: D:/Games/MyProject
        vcs: svn
      uproject: D:/Games/MyProject/MyProject.uproject
      targets:
        editor:
          kind: editor
          config: development

tasks:
  hello:
    - run: echo "hello from ${{ project.name }}"

flows:
  demo:
    description: Say hello
    steps: [hello]
```

```bash
bolt check
bolt run demo --dry-run
bolt run demo
```

See [bolt.yaml](./bolt-yaml.md) and [First Project](./first-project.md).

## Manual installation

Download the asset for your machine from [GitHub Releases](https://github.com/jukrb0x/Bolt/releases), hash that one file, and compare the digest to its line in `SHA256SUMS`. Then put the binary on your PATH. This does not write `install.json`. `bolt self-update` will refuse to replace that file until you install with `install.ps1` or `install.sh`.

**Windows**

```powershell
$installPath = Join-Path $env:USERPROFILE ".bolt\bin"
New-Item -ItemType Directory -Force -Path $installPath | Out-Null
Copy-Item .\bolt-win-x64.exe "$installPath\bolt.exe"
# Add $installPath to your user Path, open a new terminal, then:
bolt version
```

**Intel macOS**

```bash
mkdir -p ~/.bolt/bin
mv ./bolt-mac-x64 ~/.bolt/bin/bolt
chmod +x ~/.bolt/bin/bolt
echo 'export PATH="$HOME/.bolt/bin:$PATH"' >> ~/.zshrc
```

**Apple Silicon**

```bash
mkdir -p ~/.bolt/bin
mv ./bolt-mac-arm64 ~/.bolt/bin/bolt
chmod +x ~/.bolt/bin/bolt
echo 'export PATH="$HOME/.bolt/bin:$PATH"' >> ~/.zshrc
```

**Linux x64**

```bash
mkdir -p ~/.bolt/bin
mv ./bolt-linux-x64 ~/.bolt/bin/bolt
chmod +x ~/.bolt/bin/bolt
echo 'export PATH="$HOME/.bolt/bin:$PATH"' >> ~/.bashrc
```

`bolt.d.ts` from the same release is the plugin typing file. Put it where your editor can see `declare module "boltstack"`. See [Plugin Development](./plugin-development.md).

## Uninstall

Deleting the binary does not delete `~/.bolt/plugins`. Remove the Path entry in the same place the installer wrote it.

**Windows**

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.bolt\bin"
# Remove "%USERPROFILE%\.bolt\bin" from your user Path.
# If you used v2.1.0 to v2.1.2, also remove "$env:LOCALAPPDATA\bolt" and its Path entry.
# The receipt, if you want it gone too:
Remove-Item -Force "$env:USERPROFILE\.bolt\install.json"
```

**macOS and Linux**

```bash
rm -rf ~/.bolt/bin
# Remove the export PATH=... line for ~/.bolt/bin from your shell profile.
rm -f ~/.bolt/install.json
```

## Troubleshooting

### `bolt` is not recognized

On Windows, open a new terminal after the installer edits your user Path. Confirm the file exists at `%USERPROFILE%\.bolt\bin\bolt.exe`.

On macOS and Linux, open a new shell so the `PATH` line is loaded.

### "bolt.yaml not found"

Bolt walks up from the current directory looking for `bolt.yaml`. `cd` to the project that contains that file, or create one. The file must set `version: 1`.

### Unsupported architecture

The published binaries are Windows x64, Linux x64, Apple Silicon, and Intel macOS. Other machines are rejected by the install script.

### Download or checksum failure

The installer stops before it replaces an existing binary when `SHA256SUMS` has no line for the asset, the hash differs, or the downloaded file does not print a version. Check the network and the [latest release](https://github.com/jukrb0x/Bolt/releases/latest), then run the installer again.

## See Also

- [bolt self-update](/cli/self-update) - Replace a script-installed binary
- [Getting Started](./getting-started.md) - Tasks, flows, and `bolt run`
- [bolt.yaml](./bolt-yaml.md) - Configuration
- [Plugin Development](./plugin-development.md) - Author a plugin
