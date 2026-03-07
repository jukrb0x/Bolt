---
title: "bolt self-update"
---

Update Bolt to the latest release.

## Usage

```bash
bolt self-update [--force]
```

## Description

Downloads and replaces the Bolt binary with the latest GitHub release. Only works in the compiled binary (not `bun run src/main.ts`).

The binary is replaced in-place via atomic rename. The temp file is written to the same directory as the binary to avoid cross-device rename errors.

## Options

| Flag | Description |
|------|-------------|
| `--force` | Re-download even if already up to date |

## Examples

```bash
# Update to latest version
bolt self-update

# Force re-download
bolt self-update --force
```

## Installation Methods

If you installed via the install scripts:

::: code-group
```powershell [Windows]
irm https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.ps1 | iex
```

```bash [macOS]
curl -fsSL https://raw.githubusercontent.com/jukrb0x/Bolt/main/install.sh | bash
```
:::

Updates are installed to `~/.bolt/bin/` and added to your PATH.

## See Also

- [bolt version](./version.md) - Print current version
- [Installation](/guides/installation.md) - Install Bolt
