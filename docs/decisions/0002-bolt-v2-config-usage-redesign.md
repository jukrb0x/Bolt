# 0002: Bolt v2 — config + usage model redesign

- Status: accepted
- Date: 2026-07-07

## Context

The v1 model imposed high cognitive load:

- **Four overlapping concepts** to run work: `ops` (with named `variants`),
  `go-pipeline` (global ordering + `fail_stops`), and `actions` (standalone
  step lists with `depends`). Two verbs (`bolt go` vs `bolt run`) with different
  semantics.
- **Hidden reordering**: `bolt go start build` silently ran in `go-pipeline`
  order, not the typed order — surprising and hard to reason about.
- **`bolt.yaml` conflated two things**: the team-shared automation contract and
  machine-specific paths (`engine_repo.path`, `project_repo.path`, `uproject`),
  so the file could not be committed/shared cleanly.
- **A large, fragile `bolt init`**: a bespoke `_init` question DSL
  (condition-eval, interpolation, generator) plus an Ink/React wizard, with
  known paste/validation bugs on Windows.
- **Dead weight**: an Ink/React `bolt help` man-page TUI duplicated by the docs
  site and citty's `--help`.

## Decision

Ship a clean, breaking **v2** (no migration shim):

1. **Two concepts.** `tasks` (a named list of steps — the only building block)
   and `flows` (an ordered set of tasks). Removes `ops`, `actions`,
   `go-pipeline`, and `variants`.
2. **One verb.** `bolt run <name...>`: multiple names run as tasks in the typed
   order; a single flow name runs that flow. **Typed order = execution order** —
   no global reordering. Removed `bolt go`.
   Both ad-hoc chains and flows are **fail-fast**: the first failing task aborts
   the run. A flow can list known-flaky tasks in `continue_on_fail` to let them
   fail without aborting (a step can also set `continue-on-error: true`).
3. **Params replace variants.** `bolt run build --target=program` (params apply
   to the whole run, win over step `with:`, and are available as `${{ params.x }}`).
4. **Config split.** `bolt.yaml` = committed shared contract (project identity,
   `tasks`, `flows`, `targets`, `plugins`). `bolt.local.yaml` = gitignored
   per-machine paths (`engine_path`, `project_path`, `uproject`, `use_tortoise`).
   `loadConfig` merges them, reconstructing the runtime
   `project.engine_repo`/`project_repo`/`uproject` shape so plugins are unaffected.
5. **Trim.** Delete the `bolt help` TUI + `src/help/**`; drop the Ink/React deps.
   Reduce `bolt init` to a minimal, non-interactive scaffolder (writes both files,
   auto-detects a single `*.uproject`); the full interactive/auto-detect wizard is
   deferred to its own module/spec.

Alternatives rejected:

- **Keep the model, just smarten `init`**: doesn't remove the core cognitive load
  (four concepts, hidden reordering, conflated config).
- **Backwards-compatible migration**: v1 configs are local/uncommitted here, so a
  clean break is cheaper than a compatibility layer.

## Consequences

- Fewer concepts and a predictable CLI (`bolt run` does exactly what you type);
  `bolt.yaml` is now safely committable.
- Breaking: existing v1 `bolt.yaml` files will not load; there is no auto-migration.
- Public API narrowed: `Op`/`Action`/`GoPipeline` types and `bolt go` removed;
  `Flow` + `tasks` added. `bolt inspect <name...>` replaces `bolt inspect <go|run>`.
- Ink/React fully removed from the dependency tree.
- Full suite green after the change (see the plan's verification task).
- Spec + plan (local, uncommitted): `docs/superpowers/specs/2026-07-07-bolt-v2-config-usage-redesign.md`
  and `docs/superpowers/plans/2026-07-07-bolt-v2-config-usage-redesign.md`.

See `architecture/overview.md` (execution flow) and `architecture/content-system.md`
(AI-context layers) for the updated model.
