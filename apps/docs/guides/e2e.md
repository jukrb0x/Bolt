---
title: "End-to-end fakes"
---

The `e2e` job runs the bolt CLI (`bun --tsconfig-override tsconfig.json src/main.ts`) against a temporary project on Ubuntu and on Windows. The override matters because the process cwd is the fixture, and class `@handler` methods are only registered when Bun loads this repo's `experimentalDecorators` tsconfig. External tools are fakes on `PATH` or files installed under the engine directory in config. Nothing in the suite calls a real Unreal install, a real `svn`, or a hosted webhook.

The workflow runs that job on both runners. A red Windows job is a failed suite, not a skipped platform.

## What a fake records

`e2e/fakes/record.ts` appends one JSON line per invocation to `BOLT_FAKE_LOG`:

```json
{
  "tool": "/abs/Build.bat",
  "argv": ["-Target=SampleEditor Win64 Development"],
  "cwd": "/tmp/proj",
  "env": { "BOLT_FAKE_LOG": "/tmp/proj/fake-calls.log" },
  "exit": 0
}
```

`tool` is the script path, `argv` is the arguments the handler passed, `cwd` is the project directory, and `env` is only `BOLT_*` variables. Set `BOLT_FAKE_FAIL` to a comma-separated list of tool basenames (`Build`, `svn`, `all`) to make that fake exit non-zero and print a failure line.

POSIX shims are `#!/bin/sh` scripts and must stay mode `0755`. Windows shims are `.bat` or `.cmd` and must stay CRLF. `where.cmd` has an `if (` block that breaks if Git rewrites it to LF. `core.autocrlf false` in CI only preserves the bytes that were committed.

## Engine scripts

`e2e/fakes/engine` is a tiny Unreal tree. The handler always names the Windows files (`Build.bat`, `Setup.bat`, `UE4Editor-Cmd.exe`). It does not switch extensions.

`installEngine` copies those names into the fixture. On Linux it writes the `.sh` body onto the Windows filename and chmods the tree to `0755`. On Windows, `.bat` files stay the committed CRLF scripts, and the `.exe` names are copies of `e2e/fakes/win/record.exe` (built from `record.c`). cmd.exe will not run a script that is named `.exe`.

`Build.sh` records itself and then execs `UnrealBuildTool.sh`. If that file is missing the executable bit, `Build.sh` exits 1. A dropped mode bit must not look like a successful build that never called UBT.

## `cmd` and `taskkill`

Windows finds `System32\cmd.exe` and `taskkill.exe` before `PATH`, so a PATH shim never sees them. `ue/start` runs `cmd /c start`. On a headless runner that builtin does not return. The harness sets `BOLT_E2E_BIN` to `e2e/fakes/bin/<platform>`. The handler uses that directory only for the `cmd` and `taskkill` executables. Unset, those strings are exactly `cmd` and `taskkill`.

`e2e/fakes/cmd.ts` is the `cmd` shim. It records `cmd /c start "" <program> [args]`, runs the program, and returns the program's exit code. It does not call the Windows `start` builtin. `svn`, `where`, and `TortoiseProc` are not in System32 ahead of PATH, so those shims are ordinary PATH entries. `git` is the real git, pointed at a local bare repository.

A Windows engine path such as `D:/UE` still produces `D:\UE/Engine/Build/BatchFiles/Build.bat` and `UE4Editor-Cmd.exe` while `BOLT_E2E_BIN` is set. The variable cannot select a `.sh` or `.cmd` engine file.

## Add a fake and a case

1. Add the script pair under `e2e/fakes/engine` or `e2e/fakes/bin`. POSIX: `tool.sh`, mode `0755`, LF, `exec` the recorder with `"$0"` and `"$@"`. Windows: `tool.bat` or `tool.cmd`, CRLF, call the recorder with `%~f0` and `%*`. If the handler already executes a Windows filename, teach `installEngine` to place the shell body at that filename on Linux, or the `record.exe` stub at an `.exe` name on Windows. Do not add an environment switch that rewrites the filename.
2. Point the fixture's ue config at the fake engine (`e2e/harness.ts`) or prepend the bin directory. Do not stub the handler.
3. Add a `bun:test` case in `e2e/cli.test.ts` that runs `bolt run <task>`, then asserts the log line's tool path, each argv element (not a space-joined string), cwd equal to the project directory, and exit code. Cover one failure with `BOLT_FAKE_FAIL`.
4. Run `bun run test:e2e`.
