---
title: "Release Process"
---

## Prerequisites

- The commit is already on `origin/main`.
- You can push a tag to `jukrb0x/Bolt`.

GitHub Actions uses `GITHUB_TOKEN`. This pipeline does not publish the `boltstack` package and does not need an npm token.

## Cut a release

`package.json` `version` is repository metadata. The binaries embed `src/version.ts`, which the workflow stamps from the tag. `bolt version` and `bolt --version` both print that stamped value.

From `main`:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

A tag that contains a hyphen, such as `vX.Y.Z-rc.1`, is marked as a GitHub pre-release. `bun run release` and `--pre-release` do not publish.

The workflow refuses the release when the tagged commit is not an ancestor of `origin/main`.

## What CI uploads

`.github/workflows/release.yml` builds on Ubuntu with Bun 1.4.3, smoke-tests every binary, then creates the GitHub Release. The asset list lives in `scripts/release-targets.ts`:

- `bolt-win-x64.exe`
- `bolt-linux-x64`
- `bolt-mac-arm64`
- `bolt-mac-x64`
- `bolt.d.ts`
- `SHA256SUMS`

There is no `bolt-win-x64-baseline.exe`. In Bun 1.4.3, `bun-windows-x64-baseline` is an alias of `bun-windows-x64`, not a separate older-CPU build.

Smoke runs `bolt version` and `bolt --version`, then loads a TypeScript plugin. Build and smoke use `contents: read`. Only the publish job has `contents: write`.

`bun run release:dry` prints these steps and does not tag or upload.

## bolt.d.ts

CI generates it from `src/plugin-api.ts` with `bun run build:types` before compiling the binaries, and attaches it to the GitHub Release. It is not published to npm. `bolt types` writes the copy embedded in the binary that is running, so plugin authors do not download this asset separately.
