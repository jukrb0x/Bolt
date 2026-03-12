---
title: "Runtime"
---

Bolt supports both Bun and Node.js runtime environments.

## CLI Runtime

The Bolt CLI is built with and runs on **Bun only** for optimal performance. Bun provides:
- Fast startup time
- Native TypeScript support
- Built-in YAML parsing
- Efficient subprocess spawning

## Library Runtime

When used as a library, Bolt supports both **Bun** and **Node.js** through a runtime abstraction layer.

### Bun Runtime
Uses native Bun APIs:
- `Bun.spawn()` for process execution
- `Bun.YAML` for YAML parsing
- Native TypeScript transpilation

### Node.js Runtime
Uses Node.js equivalents:
- `child_process.spawn()` for process execution
- `yaml` package for YAML parsing
- `ts-node` or compiled JavaScript

## Runtime Detection

The runtime is auto-detected based on the environment:

```typescript
import { createRuntime } from "boltstack/core";

const runtime = createRuntime(); // Auto-detects Bun vs Node.js
```

## Using the Runtime Abstraction

When writing plugins or using the library, you typically don't need to interact with the runtime directly. However, if you need to spawn processes:

```typescript
import { createRuntime } from "boltstack/core";

const runtime = createRuntime();

// Spawn a process (works in both Bun and Node.js)
const result = await runtime.spawn("git", ["status"], {
  cwd: "/path/to/repo",
});

console.log(result.stdout);
```

## Why Bun for CLI?

Bun was chosen for the CLI for several reasons:

1. **Performance**: Bun's startup time is significantly faster than Node.js
2. **TypeScript Native**: No build step required during development
3. **Modern APIs**: Built-in support for YAML, TOML, and other formats
4. **Binary Compilation**: Can compile to standalone executables

## Library Compatibility

The library maintains Node.js compatibility for:
- Integration into existing Node.js projects
- CI/CD pipelines using Node.js
- Server-side applications

## Subpath Exports

| Export | Bun | Node.js | Description |
|--------|-----|--------|-------------|
| `boltstack` | ✓ | ✓ | High-level API |
| `boltstack/plugins` | ✓ | ✓ | Built-in plugins |
| `boltstack/core` | ✓ | ✓ | Core internals |

## Development

When developing Bolt itself, you must use Bun:

```bash
bun install
bun run dev          # Run from source
bun test             # Run tests
```

## See Also
- [Library Usage](/api/library-usage.md) - Using Bolt as a library
- [Architecture](./architecture.md) - Overall architecture
