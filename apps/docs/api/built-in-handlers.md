---
title: "Built-in Handlers"
---

Bolt includes built-in handlers for common Unreal Engine and file operations.

## ue/ — Unreal Engine

All `ue/` handlers read paths from the merged `ctx.cfg.project` (`engine_repo.path`, `project_repo.path`, `uproject`) — identity comes from `bolt.yaml`, paths from `bolt.local.yaml`. Path separators are normalized to backslashes before being passed to `cmd.exe`.

### ue/build
Build a target from the `targets:` map (or a raw program target name).

| Param | Required | Description |
|------|----------|-------------|
| `target` | yes | Key from `bolt.yaml` `targets:` map, a raw program target name, or the reserved `engine` |
| `config` | no | Override target's config (`development` \| `debug` \| `shipping` \| `test`) |
| `platform` | no | Target platform (default: `Win64`) |

For `kind: editor`: invokes `Build.bat` with `-Target="<ProjectName>Editor <platform> <config>" -Target="ShaderCompileWorker <platform> Development -Quiet" -Project="<uproject>" -WaitMutex`.

For other known targets: `Build.bat <name> <platform> <config> -Project="<uproject>" -WaitMutex`.

For a raw (unlisted) target name: `Build.bat <target> <platform> <config> -project="<uproject>" -WaitMutex -FromMsBuild`.

`target: engine` is reserved and builds the engine from source (see `ue/build_engine`).

### ue/build_engine
Build the UE engine from source (equivalent to `ue/build` with `target: engine`).

Runs in sequence: `Setup.bat --force` (if present), `GenerateProjectFiles.bat` (if present), then `Build.bat -Target="UE4Editor <platform> <config>" -Target="ShaderCompileWorker <platform> Development -Quiet" -WaitMutex -FromMsBuild`.

| Param | Required | Description |
|------|----------|-------------|
| `config` | no | Build configuration (default: `development`) |
| `platform` | no | Target platform (default: `Win64`) |

### ue/build_program
Build an arbitrary standalone program target.

| Param | Required | Description |
|------|----------|-------------|
| `target` | yes | Program target name (e.g. `UnrealInsights`) |
| `config` | no | Build configuration (default: `development`) |
| `platform` | no | Target platform (default: `Win64`) |

### ue/start
Launch the UE editor or a built program binary.

| Param | Required | Description |
|------|----------|-------------|
| `target` | no | Key from `targets:` — launches that binary instead of the editor |
| `config` | no | Config suffix for binary lookup (`debug` \| `shipping` \| `test` \| `development`) |
| `platform` | no | Platform directory (default: `Win64`) |

Binary search order for a named target:
1. `<project>/Binaries/<platform>/<name><suffix>.exe`
2. `<ue>/Engine/Binaries/<platform>/<name><suffix>.exe`

Config → suffix map: `debug` → `-Win64-Debug`, `shipping` → `-Win64-Shipping`, `test` → `-Win64-Test`, `development` → `""`.

Launched detached via `cmd /c start "" <exe> <uproject>`.

### ue/kill
Kill all running UE processes. Never throws.

Targets: `UE4Editor.exe`, `UE4Editor-Win64-Debug.exe`, `UE4Editor-Cmd.exe`, `UnrealEditor.exe`, `UnrealEditor-Cmd.exe`, `CrashReportClient.exe`.

No params.

### ue/update_engine
Update the engine repo. Uses git or SVN based on `project.engine.vcs`:
- git → `git -C <engine_repo.path> pull origin <branch> --autostash --no-edit` (branch from `engine_repo.branch`, default `main`)
- svn → `svn update <engine_repo.path> --non-interactive --trust-server-cert`

### ue/update_project
Update the project repo. Uses git or SVN based on `project.project.vcs`, against `project_repo.path` (same commands as `ue/update_engine`).

### ue/setup
Run the engine `Setup.bat`. Skips (warns) if `Setup.bat` is not found.

| Param | Required | Description |
|------|----------|-------------|
| `force` | no | Pass `--force` (default: `true`) |

### ue/svn_cleanup
Run SVN cleanup on the project working copy (`project_repo.path`). Uses TortoiseProc (full cleanup with all flags) if available/configured, otherwise falls back to `svn cleanup`.

TortoiseProc behaviour is controlled by `use_tortoise` in `bolt.local.yaml`:
- `true` — require TortoiseProc, throw if not found
- `false` — always use plain svn
- absent — auto-detect (TortoiseProc wins if found)

### ue/svn_revert
Revert all local SVN changes.

| Param | Required | Description |
|------|----------|-------------|
| `path` | no | Override path (defaults to `project_repo.path`) |

Uses TortoiseProc cleanup-with-revert if available, otherwise `svn revert -R`.

### ue/generate_project
Regenerate UE project files.

```bash
Engine/Build/BatchFiles/GenerateProjectFiles.bat "<project>.uproject" -Game
```

No params.

### ue/fillddc
Fill the Derived Data Cache.

Runs `UE4Editor-Cmd.exe -run=Automation RunTests FillDDCForPIETest -unattended -buildmachine -nullrhi`.

No params.

### ue/ini_set
Set a value in a UE INI file.

| Param | Required | Description |
|------|----------|-------------|
| `file` | yes | Path relative to `project_repo.path` (e.g. `Config/DefaultGame.ini`) |
| `section` | yes | INI section name (e.g. `[/Script/EngineSettings.GameMapsSettings]`) |
| `key` | yes | Key name |
| `value` | one of value/value-list | New scalar value |
| `value-list` | one of value/value-list | Semicolon-separated list, written as repeated `+key=` entries |
| `insert-front` | no | Insert a new section at the top of the file (`true`/`false`) |

Reads the file, finds the section, updates the key in-place. Appends a new section block if the section does not exist.

### ue/ini_get
Read a value from a UE INI file and log it.

| Param | Required | Description |
|------|----------|-------------|
| `file` | yes | Path relative to `project_repo.path` |
| `section` | yes | INI section name |
| `key` | yes | Key name |
| `type` | no | Coerce value (`string` \| `number` \| `boolean`) |

### ue/ini_remove
Remove a key from a section in a UE INI file. Warns if the key is not found.

| Param | Required | Description |
|------|----------|-------------|
| `file` | yes | Path relative to `project_repo.path` |
| `section` | yes | INI section name |
| `key` | yes | Key name |

### ue/ini_override
Apply an override INI file over a target INI file.

| Param | Required | Description |
|------|----------|-------------|
| `file` | yes | Target INI, relative to `project_repo.path` |
| `override-file` | yes | Override INI, relative to `project_repo.path` |

### ue/ini_read_all
Log every section and key of a UE INI file.

| Param | Required | Description |
|------|----------|-------------|
| `file` | yes | Path relative to `project_repo.path` |

### ue/info
Print VCS status for both repos. For each of `engine_repo.path` and `project_repo.path` it runs git info (`git log -1`, branch) or `svn info` depending on the repo's `vcs`. Logs URL, Revision, and Last Changed Rev.

No params.

### ue/fix_dll
Fix zero-byte DLL files that can cause linker errors.

Recursively scans:
- `<ue>/Engine/Binaries`
- `<project>/Binaries`
- `<project>/Plugins`

Moves zero-byte `.dll` files to `<project>/.bolt/trash-dlls/`.

No params.

---

## fs/ — File System
`fs/` handlers are simple file operations. They do not check `ctx.dryRun` — suppress via `continue-on-error` or op-level dry-run logic.

### fs/copy

| Param | Required | Description |
|------|----------|-------------|
| `src` | yes | Source path |
| `dst` | yes | Destination path |

Creates destination parent directories if needed.

### fs/move

| Param | Required | Description |
|------|----------|-------------|
| `src` | yes | Source path |
| `dst` | yes | Destination path |

Creates destination parent directories if needed.

### fs/delete

| Param | Required | Description |
|------|----------|-------------|
| `path` | yes | Path to delete (file or directory) |

Recursive, force (equivalent to `rm -rf`).

### fs/mkdir

| Param | Required | Description |
|------|----------|-------------|
| `path` | yes | Directory path to create |

Recursive (equivalent to `mkdir -p`).

---

## json/ — JSON Files
### json/set

Set a value at a dot-path in a JSON file.

| Param | Required | Description |
|------|----------|-------------|
| `file` | yes | Path to JSON file |
| `key` | yes | Dot-separated path (e.g. `plugins.myplugin.enabled`) |
| `value` | yes | String value to set |

Intermediate path components must already exist. Writes back with 2-space indent.

### json/merge

Shallow-merge a patch JSON file over a target JSON file.

| Param | Required | Description |
|------|----------|-------------|
| `file` | yes | Path to target JSON file |
| `patch` | yes | Path to patch JSON file |

Top-level keys from `patch` overwrite keys in `file`. Writes result back to `file`.

## See Also
- [Plugin API](./plugin-api.md) - Creating custom handlers
- [Plugin Development Tutorial](/guides/plugin-development.md) - Step-by-step guide
