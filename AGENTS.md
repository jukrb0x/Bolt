## AGENTS.md

### Toolchain

- Bun only (no npm/yarn/pnpm). Required version: the `packageManager` field in `package.json` (currently `bun@1.4.3`) — the single source of truth used by CI (`setup-bun`). Install with `bun upgrade --version <x.y.z>`.
- `bun test` preloads `src/tests/setup.ts`, which warns on a mismatched Bun and fails when `CI` is set.

### Context Map

- Shared knowledge (committed) → `docs/`: `ROADMAP.md`, `RFCs/`, `architecture/`, `ops/`, `decisions/`.
- Working memory (local, gitignored) → `docs/superpowers/`: `specs/`, `plans/`, `brainstorms/`, `scratch/`.
- Runtime project context (generated) → `.bolt/ai-context.md` (via `bolt ai`).
- Docs website (product) → `apps/docs` (Mintlify). Not agent context.
