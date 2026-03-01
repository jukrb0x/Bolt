# Release Process

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth login`)
- `npm` logged in (`npm login`) for `bolt-ue` type package
- Clean `main` branch with no uncommitted changes

## Bump the version

Edit `package.json`:

```json
{ "version": "0.2.0" }
```

Commit and push. That's the only file to change.

## Run the release script

```
bun run release           # full release
bun run release:pre       # pre-release (tagged "next" on npm, marked pre-release on GitHub)
bun run release:dry       # dry-run — shows every step without executing
```

### What the script does

1. Verify git working tree is clean
2. Verify current branch is `main`
3. Check `gh` CLI is available
4. Write `src/version.ts` with the release version (before compile)
5. Generate `bolt.d.ts` via `bun run build:types`
6. Build the native binary (`bolt-win-x64.exe` on Windows, `bolt-mac-arm64` on macOS)
7. Copy `bolt.d.ts` to `build/`
8. Open `$EDITOR` for a custom release notes preamble (prepended before auto-generated git log)
9. Tag `v<version>` and push to origin
10. Create GitHub release with native binary + `bolt.d.ts` attached
11. Publish `bolt-ue` to npm (`--tag next` for pre-releases)
12. Restore `src/version.ts` to `<version>-dev` and push

After the tag is pushed, the CI workflow (`.github/workflows/release.yml`) automatically builds the other platform's binary and uploads it to the same GitHub release.

## CI Workflow

Triggers on `v*` tag push. Two parallel jobs:

- **build-windows** (windows-latest): stamps version, builds `bolt-win-x64.exe`, uploads to the release via `gh release upload --clobber`
- **build-macos** (macos-latest): stamps version, builds `bolt-mac-arm64`, uploads to the release

Both jobs upload directly to the release created by the local script. No separate release job.

## bolt.d.ts

`bolt.d.ts` is generated from `src/plugin-api.ts` via:

```
bunx tsc --project tsconfig.types.json   # emits to dist-types/
bun run scripts/gen-types.ts             # wraps into declare module "bolt" { }
```

The output is a single flat file — no imports, no runtime code. Published to npm as the `bolt-ue` package.

## Environment Variables

| Variable | Description |
|---|---|
| `BOLT_INTERNAL_SHARE` | If set, copies build artifacts to this path after release |
| `EDITOR` / `VISUAL` | Editor for release notes (defaults to `notepad` on Windows, `vi` elsewhere) |
