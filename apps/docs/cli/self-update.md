---
title: "bolt self-update"
---

Replace a script-installed `bolt` with a GitHub release.

## Usage

```bash
bolt self-update [--force] [--version <version>]
```

## Description

`bolt self-update` talks to the GitHub release channel for [jukrb0x/Bolt](https://github.com/jukrb0x/Bolt/releases). It downloads the asset named in `~/.bolt/install.json` (on Windows, `%USERPROFILE%\.bolt\install.json`), checks `SHA256SUMS`, runs the new file's `version` command, and only then replaces the binary.

The receipt must say `"channel": "github"`, and its `path` must be the executable you are running. `install.ps1` and `install.sh` write that file. A binary you copied onto PATH yourself does not have it, and self-update refuses to replace it.

The recorded asset is kept. An Intel macOS install stays on `bolt-mac-x64`; it is not replaced with `bolt-mac-arm64`.

This command runs in the compiled binary. A dev process whose executable name starts with `bun` exits with an error.

### Checksum

The release must contain both the platform asset and `SHA256SUMS`. The downloaded bytes are hashed before the installed file is touched. A missing line or a mismatch leaves the installed `bolt` in place.

### Windows

Windows cannot overwrite the running exe. Self-update renames it to `bolt.exe.old` in the same directory, then moves the new file to `bolt.exe`. A later launch of that `bolt.exe` deletes `bolt.exe.old`. If the old file is still locked, the next launch tries again.

### Other install locations

When the executable path is under `node_modules`, WinGet, Scoop, or Homebrew, self-update does not overwrite it. It names that manager and exits. An npm path is told to run `npm install -g boltstack@latest`. WinGet, Scoop, and Homebrew have no published package id yet, so the hint says to upgrade the package that installed this `bolt`. A receipt whose `channel` is not `github` is handled the same way.

## Options

| Flag        | Description                                                              |
| ----------- | ------------------------------------------------------------------------ |
| `--force`   | Download and replace even when the current version is already the latest |
| `--version` | Install this version instead of the latest, for example `2.1.0`          |

Without `--force` or `--version`, a current version that is not older than the latest release prints `Already up to date (v2.1.1)` (the `v` plus the running version) and does not download.

## Examples

```bash
bolt self-update
bolt self-update --force
bolt self-update --version 2.1.1
```

## Install scripts

::: code-group
```powershell [Windows]
irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
```

```bash [macOS and Linux]
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | sh
```
:::

Windows installs `%USERPROFILE%\.bolt\bin\bolt.exe`. macOS and Linux install `~/.bolt/bin/bolt`. If a bolt is already on your PATH, the script updates that copy in place. Both write the receipt under `~/.bolt/install.json`.

`bolt self-update` only replaces the running executable, at the path recorded in the receipt. It writes the download next to that file and never installs to another directory. Open a new terminal after the first install so `PATH` includes the binary.

## See Also

- [Installation](/guides/installation) - Install scripts, assets, and checksums
- [bolt version](./version.md) - Print the current version
