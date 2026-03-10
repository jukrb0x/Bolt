---
title: "Built-in Handlers"
---

Bolt includes built-in handlers for common Unreal Engine and file operations.

## ue/ — Unreal Engine

All `ue/` handlers read project paths from `ctx.cfg.project`. Path separators are normalized to backslashes before being passed to `cmd.exe`.

### ue/build
Build an editor, program, or game target.

| Param | Required | Description |
|------|----------|-------------|
| `target` | yes | Key from `bolt.yaml` `targets:` map |
| `config` | no | Override target's config (`development` \| `debug` \| `shipping` \| `test`) |

For `kind: editor`: invokes `Build.bat` with `-Target="<ProjectName>Editor Win64 <config>" -Target="ShaderCompileWorker Win64 Development -Quiet"`.

For all other kinds: invokes `Build.bat <name> Win64 <config> -project=... -WaitMutex -FromMsBuild`.

### ue/build_engine
Build the UE engine from source.

Runs in sequence: `Setup.bat --force` (if present), `GenerateProjectFiles.bat` (if present), then `Build.bat -Target="UE4Editor Win64 <config>"`.

| Param | Required | Description |
|------|----------|-------------|
| `config` | no | Build configuration (default: `development`) |

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

### ue/update
Chain `ue/update-git` then `ue/update-svn`.

### ue/update-git
Pull latest from git.

```bash
git -C <ue_path> pull origin <branch> --autostash --no-edit
```

Branch defaults to `cfg.project.git_branch ?? "main"`.

### ue/update-svn
Update SVN working copy.

```bash
svn update <svn_root> --non-interactive --trust-server-cert
```

Falls back to `project_path` if `svn_root` is not set.

### ue/svn_cleanup
Run SVN cleanup on the working copy. Uses TortoiseProc (full cleanup with all flags) if available/configured, otherwise falls back to `svn cleanup`.

TortoiseProc behaviour is controlled by `use_tortoise` in bolt.yaml:
- `true` — require TortoiseProc, throw if not found
- `false` — always use plain svn
- absent — auto-detect (TortoiseProc wins if found)

### ue/svn_revert
Revert all local SVN changes.

| Param | Required | Description |
|------|----------|-------------|
| `path` | no | Override path (defaults to `project_path`) |

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
| `file` | yes | Path relative to `project_path` (e.g. `Config/DefaultGame.ini`) |
| `section` | yes | INI section name (e.g. `[/Script/EngineSettings.GameMapsSettings]`) |
| `key` | yes | Key name |
| `value` | yes | New value |

Reads the file, finds the section, updates the key in-place. Appends a new section block if the section does not exist.

### ue/info
Print project and VCS status.

Runs `git log -1`, `git rev-parse --abbrev-ref HEAD` (in `ue_path`), and `svn info <svn_root>`. Logs URL, Revision, and Last Changed Rev.

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
