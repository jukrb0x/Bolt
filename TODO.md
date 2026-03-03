## Basic

- [x] [DX] oxc
- [ ] [FEAT] chatbot webhook, wecom support
- [ ] [FEAT] common tools
  - [x] ue ini tool
  - [ ] ?
- [x] [ecosystem] universal VCS - currently engine (git), project (svn), make this configurable
- [x] [ecosystem] plugins - write plugins (modules) to use like "ue/build" in project scope (or user scope)
- [x] [ecosystem] shell command runs (with:run)
- [x] [config] `bolt check` - check bolt.yaml validation
- [ ] [config] `bolt apply` - apply templated profile bolt.yaml from built-in OR gh repo (or any git repo.. specify domain)
- [x] [config] `bolt config` - open $editor for current bolt yaml
- [x] `bolt help` - TUI quick help docs
- [x] [FEAT] VCS providers
- [ ] [FEAT] parallel setups
- [ ] add a dimmed logger type for commands, commands should be logged explicity for the execution

## Dist

- [ ] distribution and version management, bolt.yaml should be compatibility versioned

## Setup && Pull
Let people start and setup their working environment easily.
- [ ] `bolt init` will initialize a bolt.yaml to the current folder with Q&A and the provided template yaml OR the remote repo.
- [ ] `bolt setup` a workflow to set up the working environment (like install VS, Python, JVM set env vars, etc.) from bolt.yaml -- with Q&A
- [ ] `bolt pull` pull engine and project from bolt.yaml, and set up for it with the desired directory structure, and start to build the editor -- opt in with Q&A

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

## Fixes

- [x] remove this variant: bolt go --build=program, becuase hypen parameters are consumned by ops in bolt go, like: bolt go build:program --config=debug
