---
title: "bolt self-update"
---

Replace a script-installed `bolt` with a GitHub release.

## Usage

```bash
bolt self-update [<version>] [--force] [--version <version>]
```

## Description

`bolt self-update` talks to the GitHub release channel for [jukrb0x/Bolt](https://github.com/jukrb0x/Bolt/releases). It downloads the asset named in `~/.bolt/install.json` (on Windows, `%USERPROFILE%\.bolt\install.json`), checks `SHA256SUMS`, runs the new file's `version` command, and only then replaces the binary.

The receipt must say `"channel": "github"`, and its `path` must be the executable you are running. `install.ps1` and `install.sh` write that file. A binary you copied onto PATH yourself does not have it, and self-update refuses to replace it.

The recorded asset is kept. An Intel macOS install stays on `bolt-mac-x64`; it is not replaced with `bolt-mac-arm64`.

This command runs in the compiled binary. A dev process whose executable name starts with `bun` exits with an error.

### Where releases come from

Self-update does not need the GitHub API. It requests `https://github.com/jukrb0x/Bolt/releases/latest`, reads the tag from the redirect (`/releases/tag/vX.Y.Z`), and downloads `SHA256SUMS` and the asset from `https://github.com/jukrb0x/Bolt/releases/download/<tag>/<asset>`, the same URLs the install scripts use. An explicit version (`bolt self-update v2.1.0`) goes straight to that download URL.

If the redirect cannot be read, it falls back to `api.github.com`, authenticated with the first of `GH_TOKEN`, `GITHUB_TOKEN`, or `gh auth token` (when the GitHub CLI is installed and logged in), else anonymously. The token is only sent in the request header and is never printed. A `403` or `429` from GitHub prints a rate-limit message: set `GH_TOKEN`, or rerun the install one-liner.

Requests go through Bun's `fetch`, which honours `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY`.

For testing, `BOLT_RELEASES_URL` replaces `https://github.com/jukrb0x/Bolt/releases`, `BOLT_RELEASES_API` forces the API path at another base, and `BOLT_INSTALL_BASE` (a directory with `SHA256SUMS` and the assets, as `install.ps1` uses) skips version lookup; the downloaded file's `version` decides whether it is newer.

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
| `<version>` | Same as `--version`, for example `v2.1.0`                                |

Without `--force` or a version, a current version that is not older than the latest release prints `Already up to date (v2.1.1)` (the `v` plus the running version) and does not download.

## Examples

```bash
bolt self-update
bolt self-update --force
bolt self-update --version 2.1.1
bolt self-update v2.1.0
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
