# Changelog

## Unreleased

### Added

- Plugin API v2 (BOLT-EXT-1). Plugins opt in with `definePlugin({ apiVersion: 2 })` or the class instance field `apiVersion = 2;`. A plugin without `apiVersion` is still v1 and behaves exactly as before. See the [migration guide](apps/docs/guides/migrating-to-plugin-api-2.mdx).
- Handler results: v2 handlers may return `ok()` / `warn()` / `fail()` / `skipped()` (or a `HandlerResult` literal). A returned `fail` fails the step like a throw (`HANDLER_FAILED`, after `onAfterStep`). An invalid result fails with `RESULT_INVALID`. Unknown result fields only warn (`RESULT_UNKNOWN_KEY`) and are dropped. Oversize values are truncated with `RESULT_TRUNCATED`. Return values of v1 plugins are still ignored.
- `ctx.emit(event)` for v1 and v2 plugins and lifecycle hooks. Events are printed on the run output and written to `.bolt/logs/bolt_<timestamp>.log`. `ctx.emit` is optional in `BoltPluginContext` until the next plugin API major; `BoltPluginContextV2` has it required. `createTestContext()` records events for unit tests.
- Capability tags: `defineHandler({ capability })` and `@handler({ capability })` (v2 only), with a core-owned vocabulary, `x-<vendor>.` and `<namespace>.` forms, and reserved core areas. Tags appear in the plugin manifest, the AI context, and the generated plugin reference. `PluginRegistry.findByCapability()` looks handlers up by tag.
- `bolt version --json` prints `version`, `plugin_api` (`[1, 2]`), `manifest_format`, and `capabilities` (`handler-results`, `capability-tags`, `plugin-api-2`).
- Release workflow check that fails while an unreleased version placeholder remains.

### Changed

- **Built-in git/svn AI permissions changed.** These handlers used to be `ai: false` for everything. Now: `git/info` and `svn/info` are `ai: true` (read-only; for AI invocations `path` must be inside the project directory); `git/status` and `svn/status` are `ai: "confirm"` (`git status` runs the repository's `core.fsmonitor` command); `git/pull`, `git/checkout`, `git/clone`, `svn/update`, `svn/cleanup`, `svn/revert`, `svn/commit`, and `svn/add` stay `ai: false`. This changes `.bolt/ai-context.md` and its context hash.
- Built-in git and svn are now plugin API v2 plugins tagged `vcs.sync` (`git/pull`, `svn/update`) and `vcs.info` (`git/info`, `svn/info`). `git/info`, `git/status`, `svn/info`, and `svn/status` declare a `path` param schema, so a missing `path` is reported as a param error.
- `git/info` and `svn/info` with a `path` outside the project directory: human runs behave as before and succeed, but now print a warning that AI invocations will reject the path, with the fix. `ue/info` is unchanged and still reads engine and project paths anywhere.
- **AI invocations of `git/info` and `svn/info` reject a `path` outside the project directory** with `AI_FORBIDDEN` (exit code `4`, permission denied) and a fix (use a path under the project, or a `run:` step for other repositories).
- **Migration: `git/info` and `svn/info` resolve a relative `path` against the `bolt.yaml` directory**, not the current working directory. Example: with `bolt.yaml` in `/proj` and running from `/proj/tools`, `path: ../Engine` used to resolve to `<cwd>/../Engine` (`/proj/Engine`); it now resolves to `<bolt.yaml dir>/../Engine` (`/Engine`). To keep the old target, use an absolute path or adjust the relative path so it is relative to the `bolt.yaml` directory (here `path: Engine`).
- Plugin API version errors now list the supported versions and, for a newer plugin, tell you to run `bolt self-update`. A class plugin with a `static apiVersion` that differs from its instance field is rejected; a matching one warns.
- Manifest format is now 2. After upgrading, run `bolt ai` to regenerate `.bolt/ai-context.md`; `bolt run` warns (`AI_CONTEXT_STALE`) until you do.

### Types

- `BoltPluginHandler`, `HandlerDef.fn`, and `defineHandler` now return `Promise<void | HandlerResult>`. `PLUGIN_API_VERSION` is `2`; use `SUPPORTED_PLUGIN_API_VERSIONS` for the accepted set.
