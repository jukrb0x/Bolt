# Bolt Documentation

This directory contains the Bolt documentation website built with VitePress.

## Development

Install dependencies:

```bash
bun install
```

Start development server:

```bash
bun run docs:dev
```

Build for production:

```bash
bun run docs:build
```

Preview production build:

```bash
bun run docs:preview
```

## Structure

```
docs/
├── .vitepress/       # VitePress config
│   └── config.ts     # Site configuration
├── api/              # API reference
├── tutorial/         # Tutorials
├── guides/           # Deep-dive guides
└── index.md          # Home page
```

## Theme

Uses [voidzero-dev/vitepress-theme](https://github.com/voidzero-dev/vitepress-theme) for styling.

## Deployment

The built output is in `.vitepress/dist/` and can be deployed to any static hosting service.
