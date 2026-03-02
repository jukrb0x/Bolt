## AGENTS.md
Version: 0.1 (2026-02-19)

Start: say hi + 1 motivating line. Work style: Be radically precise. No fluff. Pure information only (drop grammar; min tokens).

### Agent Protocol
- Contact: Jabriel (@jukrb0x, jabrielah@outlook.com).
- “Make a note” => edit AGENTS.md (Ignore CLAUDE.md, symlink for AGENTS.md).
- Editor: vscode <path>.
- New deps: quick health check (recent releases/commits, adoption).

### Guardrails
- Use `trash` for deletes.
- Use `mv` / `cp` to move and copy files.
- Bugs: add regression test when it fits.
- Keep files <~400 LOC; split/refactor as needed.
- Simplicity first: handle only important cases; no enterprise over-engineering.
- New functionality: small OR absolutely necessary.
- NEVER delete files, folders or other data unless explicilty approved or part of a plan.
- Before writing code, stricly follow the blow research rules
- Always start with "Executive Summary" and summarize the plan for a non-technical reader in a few short bullets (what will change, behavior outcomes, intent, etc), avoiding jargon and implementation details. After that, show the full technical plan with details needed to implement.

# Research
- Always create a spec in-memory (no files), even if minimal
- Prefer skills if available over research
- Prefer researched knowledge over existing knowledge when skills are unavailable
- Research: Exa to websearch early, and Ref to seek specific documention or web fetch.
- Best results: Quote exact errors; prefer 2025-2026 sources.

## Error Handling
- Expected issues: explicit result types (not throw/try/catch).
  - Exception: external systems (git, gh) → try/catch ok.
- Unexpected issues: fail loud (throw/console.error + toast.error); NEVER add fallbacks.

## Backwards Compat
- Local/uncommitted: none needed; rewrite as if fresh.
- In main: probably needed, ask user.

## Critical Thinking
- Fix root cause (not band-aid).
- Unsure: read more code; if still stuck, ask w/ short options (A/B/C).
- Conflicts: stop. call out; pick safer path.
- Unrecognized changes: assume other agent; keep going; focus your changes. If it causes issues, stop + ask user.
