## Docs
- current docs are worse, written in AI, no taste and ugly, overwheamling
- update `bolt help`

## Basic

- [x] [DX] oxc
- [x] [FEAT] chatbot webhook
- [ ] [FEAT] common tools
  - [x] ue ini tool
  - [ ] ? setup tools
- [x] [ecosystem] universal VCS - currently engine (git), project (svn), make this configurable
- [x] [ecosystem] plugins - write plugins (modules) to use like "ue/build" in project scope (or user scope)
- [x] [ecosystem] shell command runs (with:run)
- [x] [config] `bolt check` - check bolt.yaml validation
- [ ] [config] `bolt apply` - apply templated profile bolt.yaml from built-in OR gh repo (or any git repo.. specify domain)
- [x] [config] `bolt config` - open $editor for current bolt yaml
- [x] `bolt help` - TUI quick help docs
- [x] [FEAT] VCS providers
- [ ] [FEAT] parallel steps
- [ ] [FEAT] action step hooks
- [x] add a dimmed logger type for commands, commands should be logged explicitly for the execution
- [x] parse relative path to absolute path in yaml

## Dist

- [ ] config version management, bolt.yaml should be compatibility versioned

## Setup && Pull
Let people start and setup their working environment easily.
- [x] `bolt init` will initialize a bolt.yaml to the current folder with Q&A and the provided template yaml OR the remote repo.
- [ ] `bolt init` input box cannot paste..
- [ ] `bolt init` template options are not unversal, make the code platform-agnostic
- write a universal plugin for these two, programatically
    - [-] `bolt setup` a workflow to set up the working environment (like install VS, Python, JVM set env vars, etc.) from bolt.yaml -- with Q&A
    - [-] `bolt pull` pull engine and project from bolt.yaml, and set up for it with the desired directory structure, and start to build the editor -- opt in with Q&A --- make this to be go-ops and actions to be clear.

## Ecosystem

- [ ] project shared bolt.yaml -- merge bolt.yaml with prject defiend settings - no personal info like local project paths
- [x] npm package - make the library useful, let other code can call

## Advanced

- [ ] `bolt mcp` - to be brainstroming

## cross-platform

> Win is first-class supported

- [x] bolt itself
- [ ] ue/build

## Agentic
- [ ] Generate SKILL.md
- [ ] MCP

## Project scope 
- [ ] support community svn - project scope todo
- [ ] move fillddc to project plugin

## Security
- [ ] security checks, high level and unsafe rm

## Misc
- [ ] broken yaml check, check before runs when command depends on yaml
- [ ] better installer script


## VCS
- [ ] IMPORTANT - current the template or ue/update plugin still assume the git+svn for engine+project, we need to separate them into ue/update-engine and ue/update-project
