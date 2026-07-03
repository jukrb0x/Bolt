# Roadmap

Direction and priorities. Working memory (specs/plans/brainstorms) lives in
`docs/superpowers/` (local, gitignored). Legend: `[ ]` open · `[x]` done · `[-]` in progress/partial.

## Now — make bolt smarter / more automatic

Reduce cognitive load: bolt should be more automatic and more intelligent so users
lean less on manual steps. This is the next major effort — it gets its own
brainstorm → spec → plan cycle. Candidate directions (to be refined):

- [ ] Reduce mental overhead in daily workflows (fewer manual, error-prone steps)
- [ ] Smarter defaults / inference so `bolt` "just works" per project
- [ ] Tighter agentic loop around `bolt ai` context

## Backlog (ported from TODO.md)

### Docs
- [ ] current docs are worse, written in AI, no taste and ugly, overwhelming
- [ ] update `bolt help`

### Basic
- [x] [DX] oxc
- [x] [FEAT] chatbot webhook
- [ ] [FEAT] common tools
  - [x] ue ini tool
  - [ ] ? setup tools
- [x] [ecosystem] universal VCS — currently engine (git), project (svn), make this configurable
- [x] [ecosystem] plugins — write plugins (modules) to use like "ue/build" in project scope (or user scope)
- [x] [ecosystem] shell command runs (with:run)
- [x] [config] `bolt check` — check bolt.yaml validation
- [ ] [config] `bolt apply` — apply templated profile bolt.yaml from built-in OR gh repo (or any git repo.. specify domain)
- [x] [config] `bolt config` — open $editor for current bolt yaml
- [x] `bolt help` — TUI quick help docs
- [x] [FEAT] VCS providers
- [ ] [FEAT] parallel steps
- [ ] [FEAT] action step hooks
- [x] add a dimmed logger type for commands; commands should be logged explicitly for the execution
- [x] parse relative path to absolute path in yaml

### Dist
- [ ] config version management, bolt.yaml should be compatibility versioned

### Setup && Pull
Let people start and set up their working environment easily.
- [x] `bolt init` will initialize a bolt.yaml to the current folder with Q&A and the provided template yaml OR the remote repo.
- [ ] `bolt init` input box cannot paste..
- [ ] `bolt init` template options are not universal, make the code platform-agnostic
- write a universal plugin for these two, programmatically:
  - [-] `bolt setup` — a workflow to set up the working environment (install VS, Python, JVM, set env vars, etc.) from bolt.yaml — with Q&A
  - [-] `bolt pull` — pull engine and project from bolt.yaml, set up desired directory structure, and start building the editor — opt in with Q&A — make this go-ops + actions to be clear

### Ecosystem
- [ ] project-shared bolt.yaml — merge bolt.yaml with project-defined settings; no personal info like local project paths
- [x] npm package — make the library useful, let other code call it
- [ ] Python SDK for Bolt plugin

### Cross-platform
> Win is first-class supported
- [x] bolt itself
- [ ] ue/build

### Agentic
- [x] `bolt ai` — generate a dynamic and maintainable SKILL.md for LLMs to use bolt

### Project scope
- [ ] support community svn — project scope todo
- [ ] move fillddc to project plugin

### Security
- [ ] security checks, high level and unsafe rm

### Misc
- [ ] broken yaml check — check before runs when command depends on yaml
- [ ] better installer script

### VCS
- [ ] IMPORTANT — the template or ue/update plugin still assumes git+svn for engine+project; separate into `ue/update_engine` and `ue/update_project`
