---
title: "bolt help"
---

Interactive help system.

## Usage

```bash
bolt help [topic]
```

## Description

Bolt includes an interactive help system with detailed documentation on all features. Run without arguments to enter the interactive help browser, or specify a topic to jump directly.

## Options

None.

## Navigation

- Use **arrow keys** or **j/k** to navigate
- Press **Enter** to select
- Press **Escape** or **q** to go back
- Press **Ctrl+C** to exit

## Available Topics

| Topic | Description |
|-------|-------------|
| `overview` | What is Bolt, quick start |
| `go` | bolt go command details |
| `run` | bolt run command details |
| `ops` | Ops system and variants |
| `config` | bolt.yaml configuration |

## Examples

```bash
# Open interactive help
bolt help

# Jump to a specific topic
bolt help go
bolt help config
```

## See Also

- [CLI Reference](/cli/) - Full command documentation
- [Getting Started](/guides/getting-started.md) - Quick start guide
