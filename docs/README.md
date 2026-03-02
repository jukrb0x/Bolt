# Bolt Documentation

This directory contains the Bolt documentation website built with VitePress.

## Prerequisites

- **pnpm** (recommended) or npm/yarn

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run docs:dev

# Open http://localhost:5173 in your browser
```

## Available Scripts

```bash
# Development server with hot reload
pnpm run docs:dev

# Build for production
pnpm run docs:build

# Preview production build
pnpm run docs:preview
```

## Project Structure

```
docs/
├── .vitepress/
│   ├── config.ts          # Site configuration
│   └── theme/             # Custom theme wrapper
│       ├── index.ts       # Theme entry point
│       └── styles.css     # Custom styles
├── api/                   # API reference
│   ├── overview.md
│   ├── config.md
│   ├── commands.md
│   ├── handlers.md
│   └── plugin-api.md
├── tutorial/              # Tutorials
│   ├── getting-started.md
│   ├── installation.md
│   ├── first-workflow.md
│   ├── custom-ops.md
│   └── plugins.md
├── guides/                # Deep-dive guides
│   ├── architecture.md
│   ├── runner.md
│   └── release.md
└── index.md               # Home page
```

## Theme

Uses [@voidzero-dev/vitepress-theme](https://github.com/voidzero-dev/vitepress-theme) with the "vite" variant.

## Configuration

The site is configured in `.vitepress/config.ts`:

- **Variant**: `vite`
- **Branding**: Custom blue colors for Bolt
- **Navigation**: Tutorial, API Reference, Guides
- **Sidebar**: Context-aware sidebars for each section

## Deployment

Build the site:

```bash
pnpm run docs:build
```

The output will be in `.vitepress/dist/`, ready to deploy to:
- GitHub Pages
- Vercel
- Netlify
- Any static hosting service

## Troubleshooting

### Port already in use

If port 5173 is in use, VitePress will automatically use the next available port.

### Dependencies issues

If you encounter dependency issues:

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## Contributing

To add or modify documentation:

1. Edit the corresponding `.md` file
2. Preview changes with `pnpm run docs:dev`
3. Submit your changes

## License

MIT License - See root LICENSE file for details.
