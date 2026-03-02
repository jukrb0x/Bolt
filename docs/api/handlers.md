# Handlers Reference

Complete reference for Bolt's built-in handlers.

## UE Handlers

### `ue/build`

Build editor or game target.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | string | Yes | Target name from `targets:` |
| `config` | string | No | Build config (development/debug/shipping/test) |
| `platform` | string | No | Platform (default: Win64) |

**Example:**
```yaml
ops:
  build:
    default:
      - uses: ue/build
        with:
          target: editor
          config: development
```

### `ue/build-engine`

Build the UE engine itself.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config` | string | No | Build config (default: development) |

**Example:**
```yaml
ops:
  build-engine:
    default:
      - uses: ue/build-engine
        with:
          config: development
```

### `ue/build-program`

Build a standalone program target.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | string | Yes | Program target name |
| `config` | string | No | Build config |
| `platform` | string | No | Platform (default: Win64) |

**Example:**
```yaml
ops:
  build-tool:
    default:
      - uses: ue/build-program
        with:
          target: MyTool
          config: development
```

### `ue/start`

Launch UE editor or binary.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | string | No | Target name (default: editor) |
| `config` | string | No | Build config |
| `platform` | string | No | Platform (default: Win64) |

**Example:**
```yaml
ops:
  start:
    editor:
      - uses: ue/start
        with:
          target: editor
    
    game:
      - uses: ue/start
        with:
          target: game-client
          config: shipping
```

### `ue/kill`

Kill all running UE processes.

**No parameters.**

**Example:**
```yaml
ops:
  kill:
    default:
      - uses: ue/kill
```

Kills:
- UE4Editor.exe
- UE4Editor-Win64-Debug.exe
- UE4Editor-Cmd.exe
- UnrealEditor.exe
- UnrealEditor-Cmd.exe
- CrashReportClient.exe

### `ue/update`

Update source control for engine and project.

**No parameters.**

Uses configured VCS:
- Engine: `project.engine_vcs` (git or svn)
- Project: `project.project_vcs` (git or svn)

**Example:**
```yaml
ops:
  update:
    default:
      - uses: ue/update
```

### `ue/update-git`

Git pull for engine.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | No | Path to git repo (default: engine_root) |

**Example:**
```yaml
ops:
  update-engine:
    default:
      - uses: ue/update-git
        with:
          path: C:/UnrealEngine
```

### `ue/update-svn`

SVN update for project.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | No | Path to SVN working copy (default: project_root) |

**Example:**
```yaml
ops:
  update-project:
    default:
      - uses: ue/update-svn
```

### `ue/svn-cleanup`

Run SVN cleanup.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | No | Path to clean (default: project_root) |

**Example:**
```yaml
ops:
  svn-cleanup:
    default:
      - uses: ue/svn-cleanup
```

### `ue/svn-revert`

Revert SVN changes.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | No | Path to revert (default: project_root) |

**Example:**
```yaml
ops:
  revert:
    default:
      - uses: ue/svn-revert
```

### `ue/generate-project`

Regenerate project files.

**No parameters.**

**Example:**
```yaml
ops:
  gen-project:
    default:
      - uses: ue/generate-project
```

### `ue/fillddc`

Fill Derived Data Cache.

**No parameters.**

**Example:**
```yaml
ops:
  fill-ddc:
    default:
      - uses: ue/fillddc
```

### `ue/fix-dll`

Remove zero-byte DLLs that cause linker errors.

**No parameters.**

Moves zero-byte DLLs to `.bolt/trash-dlls/`.

**Example:**
```yaml
ops:
  fix-dll:
    default:
      - uses: ue/fix-dll
```

### `ue/info`

Print project and VCS info.

**No parameters.**

**Example:**
```yaml
ops:
  info:
    default:
      - uses: ue/info
```

### `ue/ini-set`

Set INI file values.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | INI file path (relative to project_root) |
| `section` | string | Yes | INI section |
| `key` | string | Yes | Key name |
| `value` | string | Yes | Value to set |

**Example:**
```yaml
ops:
  set-config:
    default:
      - uses: ue/ini-set
        with:
          file: Config/DefaultEngine.ini
          section: /Script/EngineSettings.GameMapsSettings
          key: GameDefaultMap
          value: /Game/Maps/MainMenu
```

## File System Handlers

### `fs/copy`

Copy files.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `src` | string | Yes | Source path |
| `dst` | string | Yes | Destination path |

**Example:**
```yaml
ops:
  backup:
    default:
      - uses: fs/copy
        with:
          src: Config/DefaultEngine.ini
          dst: Config/DefaultEngine.ini.backup
```

### `fs/move`

Move files.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `src` | string | Yes | Source path |
| `dst` | string | Yes | Destination path |

**Example:**
```yaml
ops:
  archive:
    default:
      - uses: fs/move
        with:
          src: Build/old.exe
          dst: Archive/old.exe
```

### `fs/delete`

Delete files or directories.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to delete |

**Example:**
```yaml
ops:
  clean:
    default:
      - uses: fs/delete
        with:
          path: Binaries/Temp
```

### `fs/mkdir`

Create directories.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Directory path |

**Example:**
```yaml
ops:
  setup:
    default:
      - uses: fs/mkdir
        with:
          path: Saved/Logs
```

## JSON Handlers

### `json/set`

Set JSON file values.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | JSON file path |
| `path` | string | Yes | JSON path (dot notation) |
| `value` | any | Yes | Value to set |

**Example:**
```yaml
ops:
  set-version:
    default:
      - uses: json/set
        with:
          file: package.json
          path: version
          value: "1.2.3"
```

### `json/merge`

Merge JSON objects.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | JSON file path |
| `data` | object | Yes | Object to merge |

**Example:**
```yaml
ops:
  update-config:
    default:
      - uses: json/merge
        with:
          file: config.json
          data:
            debug: true
            logLevel: "verbose"
```

## Git Handlers

### `git/pull`

Git pull.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to git repo |

**Example:**
```yaml
ops:
  pull:
    default:
      - uses: git/pull
        with:
          path: C:/UnrealEngine
```

### `git/info`

Show git info.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to git repo |

**Example:**
```yaml
ops:
  info:
    default:
      - uses: git/info
        with:
          path: C:/UnrealEngine
```

## SVN Handlers

### `svn/update`

SVN update.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to SVN working copy |

**Example:**
```yaml
ops:
  update:
    default:
      - uses: svn/update
```

### `svn/cleanup`

SVN cleanup.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to clean |

**Example:**
```yaml
ops:
  cleanup:
    default:
      - uses: svn/cleanup
```

### `svn/revert`

SVN revert.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to revert |

**Example:**
```yaml
ops:
  revert:
    default:
      - uses: svn/revert
```

### `svn/info`

Show SVN info.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Path to SVN working copy |

**Example:**
```yaml
ops:
  info:
    default:
      - uses: svn/info
```

## Next Steps

- [Configuration Reference](/api/config)
- [Commands Reference](/api/commands)
- [Plugin API](/api/plugin-api)
