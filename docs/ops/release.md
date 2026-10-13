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

`.github/workflows/release.yml` builds on Ubuntu with Bun 1.4.3, smoke-tests every binary, then publishes the GitHub Release. A second run for the same tag waits. Publish creates a draft, uploads the assets, and publishes the draft only after that upload. A later run succeeds when the release records this commit and the asset names are present and uploaded. If `SHA256SUMS` differs, the run warns and keeps the first build's assets. The job fails and leaves the release untouched when the recorded commit is not this SHA, the pre-release flag is wrong, or a published release's assets do not match. A draft for this commit is completed and then published. Releases created before this change store `target_commitish=main`. That value is not a commit, so the job fails. The asset list lives in `scripts/release-targets.ts`:

- `bolt-win-x64.exe`
- `bolt-linux-x64`
- `bolt-mac-arm64`
- `bolt-mac-x64`
- `bolt.d.ts`
- `SHA256SUMS`

There is no `bolt-win-x64-baseline.exe`. In Bun 1.4.3, `bun-windows-x64-baseline` is an alias of `bun-windows-x64`, not a separate older-CPU build.

Smoke runs `bolt version` and `bolt --version`, then loads a TypeScript plugin. Build and smoke use `contents: read`. Only the publish job has `contents: write`.

`bun run release:dry` prints these steps and does not tag or upload.

## When a re-run fails

The publish job leaves a release untouched when it refuses it. `gh release delete` without `--cleanup-tag` removes the release and keeps the tag. Re-run the failed workflow with `gh run rerun <run-id>`.

**Tag moved during this run.** The log names both commits and says this run can be ignored. Confirm the workflow run for the new tag event.

**`target_commitish` is not a commit SHA.** Releases from the previous publisher store `main`. The job cannot tell which commit those assets belong to. If the release is known to be the right one, ignore the failure. If the tag was moved, delete the release and re-run:

```bash
gh release delete vX.Y.Z --yes
gh run rerun <run-id>
```

**Published release is short an asset, or an asset is not `uploaded`.** `releases/latest` may already point at it. The log includes the `gh release upload` and `gh release delete-asset` commands. A draft for this same commit is completed by the job: unfinished assets are deleted and uploaded, then the draft is published. A draft that targets a different commit stays a draft.

## bolt.d.ts

CI generates it from `src/plugin-api.ts` with `bun run build:types` before compiling the binaries, and attaches it to the GitHub Release. It is not published to npm. `bolt types` writes the copy embedded in the binary that is running, so plugin authors do not download this asset separately.
