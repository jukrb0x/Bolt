---
title: "End-to-end fakes"
---

The `e2e` job runs the bolt CLI (`bun --tsconfig-override tsconfig.json src/main.ts`) against a temporary project. The override matters because the process cwd is the fixture, and class `@handler` methods are only registered when Bun loads this repo's `experimentalDecorators` tsconfig. External tools are fakes on `PATH` or under the engine directory in config. Nothing in the suite calls a real Unreal install, a real `svn`, or a hosted webhook.

## What a fake records

`e2e/fakes/record.ts` appends one JSON line per invocation to `BOLT_FAKE_LOG`:

```json
{
  "tool": "/abs/Build.sh",
  "argv": ["-Target=SampleEditor Win64 Development"],
  "cwd": "/tmp/proj",
  "env": { "BOLT_E2E_UE_SHELL": "posix" },
  "exit": 0
}
```

`tool` is the script path, `argv` is the arguments the handler passed, `cwd` is the project directory, and `env` is only `BOLT_*` variables. Set `BOLT_FAKE_FAIL` to a comma-separated list of tool basenames (`Build`, `svn`, `all`) to make that fake exit non-zero and print a failure line.

POSIX shims are `#!/bin/sh` scripts. Windows shims are `.bat` or `.cmd`. Both call the same recorder.

## Engine scripts

`e2e/fakes/engine` is a tiny Unreal tree: `Setup`, `GenerateProjectFiles`, `Build`, `RunUAT`, `UnrealBuildTool`, `UE4Editor-Cmd`, and `UnrealEditor-Cmd`, each as `.sh` and `.bat`/`.cmd`. `Build` records itself and then runs `UnrealBuildTool` with the same arguments, which is what a real `Build.bat` does. Handlers still invoke `Build`, not `UnrealBuildTool` directly.

Production commands are Windows `.bat` / `.exe` paths. Tests set `BOLT_E2E_UE_SHELL` so the same handler can execute a script:

- `posix` (Linux CI): forward slashes and `.sh`
- `cmd` (Windows CI): `.bat` unchanged, `.exe` rewritten to `.cmd`

Leave the variable unset for real runs. The engine directory itself comes from the ue plugin config (`plugins[].config.engine.path`), not from a core `targets` map.

`e2e/fakes/bin` is prepended to `PATH`. It provides `svn`, `where`, `TortoiseProc`, `cmd`, and `taskkill`. `git` is the real git, pointed at a local bare repository.

## Add a fake and a case

1. Add the script pair under `e2e/fakes/engine` or `e2e/fakes/bin` (`tool.sh` and `tool.bat` or `tool.cmd`). Copy an existing shim: it should `exec` the recorder with `"$0"` (POSIX) or `%~f0` (Windows) and then the arguments.
2. If the handler shells a new engine-relative path, teach it to go through `ueScript()` in `src/plugins/ue.ts` when `BOLT_E2E_UE_SHELL` is set. Do not change the command string when the variable is unset.
3. Point the fixture's ue config at the fake engine (`e2e/harness.ts`) or prepend the bin directory. Do not stub the handler.
4. Add a `bun:test` case in `e2e/cli.test.ts` that runs `bolt run <task>`, then asserts the log line's tool path, argv (target, config, project), cwd, and exit code. Cover one failure with `BOLT_FAKE_FAIL`.
5. Run `bun run test:e2e`. The GitHub Actions `e2e` job already does this on Ubuntu and Windows.
