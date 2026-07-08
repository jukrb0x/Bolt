---
title: "Troubleshooting"
---

Common issues and solutions for Bolt.

## Common Errors

### bolt.yaml not found

**Error**: `[ERROR] bolt.yaml not found`

**Cause**: Bolt couldn't find a `bolt.yaml` file in the directory tree.

**Solution**:
1. `cd` into your project root (or any subdirectory of it)
2. Bolt walks *up* from the current directory looking for `bolt.yaml`
3. If the project isn't set up yet, run `bolt init`

```bash
cd /path/to/project
bolt init
```

### bolt.local.yaml missing or invalid

**Error**: `bolt.local.yaml missing or invalid — copy bolt.local.example.yaml or run bolt init`

**Cause**: `bolt.local.yaml` holds your per-machine paths and is gitignored, so a fresh clone won't have one. Bolt fails loudly rather than guessing paths.

**Solution**: Create it and set your paths.

```bash
cp bolt.local.example.yaml bolt.local.yaml   # then edit engine_path/project_path/uproject
# or
bolt init                                     # scaffolds it for you
```

```yaml
# bolt.local.yaml
engine_path:  D:/UE
project_path: D:/Games/MyGame
uproject:     D:/Games/MyGame/MyGame.uproject
use_tortoise: true
```

### Unknown task or flow

**Error**: `Unknown task: foo` or `Unknown flow: foo`

**Cause**: The name you passed to `bolt run` isn't defined in this project's `bolt.yaml`.

**Solution**: List what's available.

```bash
bolt list                 # all tasks and flows
bolt inspect <name...>    # show the resolved steps for a task or flow
```

### Handler not found

**Error**: `Unknown op "deploy" in plugin "myplugin"` or `Unknown plugin namespace: "myplugin"`

**Cause**: Plugin not loaded, or the namespace/handler name is wrong.

**Solution**:
1. Check the plugin is active: `bolt plugin list`
2. Verify the `ns/handler` name in your step's `uses:`
3. For explicit plugins, check the path in the `plugins:` section

```bash
bolt plugin list
# Should show: myplugin → deploy
```

### Command failed

**Error**: `Command failed (exit 1): <cmd>`

**Cause**: A `run:` shell step returned a non-zero exit code.

**Solution**:
1. Preview with `--dry-run` to see the exact command
2. Check the command output for errors
3. Add `continue-on-error: true` to the step if the failure is acceptable

```bash
bolt run daily --dry-run
```

### Build timed out

**Error**: `Build timed out after 6h`

**Cause**: The run exceeded the configured `timeout_hours`.

**Solution**:
1. Increase `timeout_hours` in `bolt.yaml`
2. Optimize the long-running task

```yaml
timeout_hours: 12  # Increase from 6 to 12
```

### SVN/Git Errors

**Error**: `svn: E155015: Conflict...` or `git: merge conflict`

**Cause**: Version control conflicts in the engine or project working copy.

**Solution**: Resolve them, then re-run. Bolt ships handlers for the common SVN
cases (both honor `use_tortoise` from `bolt.local.yaml`):

```yaml
tasks:
  svn-fix: [{ uses: ue/svn_cleanup }, { uses: ue/svn_revert }]
```

```bash
bolt run svn-fix     # ue/svn_cleanup then ue/svn_revert
```

For git conflicts in the engine working copy, resolve with your git tooling
(e.g. `git reset --hard` in the engine repo), then re-run.

### Zero-byte DLL / Linker Errors

**Error**: Linker errors caused by zero-byte DLL files in `Binaries/`

**Cause**: Corrupted zero-byte DLL files, often from an interrupted build.

**Solution**: The `ue/fix_dll` handler removes zero-byte DLLs; then rebuild.

```yaml
tasks:
  fix-dll: [{ uses: ue/fix_dll }]
```

```bash
bolt run fix-dll build     # clean the bad DLLs, then rebuild
```

## Configuration Issues

### Invalid YAML Syntax

**Error**: `YAML syntax error at line 15`

**Cause**: Malformed YAML in `bolt.yaml` or `bolt.local.yaml`.

**Solution**:
1. Run `bolt check` to validate
2. Fix indentation and quoting

```bash
bolt check
```

### Missing Required Fields

**Error**: `Missing required field: project.name`

**Cause**: A required field is absent.

**Solution**: Add the missing field.

```yaml
project:
  name: MyGame  # Add this
```

### Invalid Target Kind

**Error**: `Invalid target kind: foo`

**Cause**: The target `kind` is not a supported value.

**Solution**: Use a valid kind.

```yaml
targets:
  mytarget:
    kind: editor   # e.g. editor | program
```

## Performance Issues

### Slow Execution

**Cause**: Large projects, slow networks, many steps.

**Solution**:
1. Use `--dry-run` to verify the plan first
2. Split large tasks into smaller composable tasks
3. Add `continue-on-error` to non-critical `run:` steps

```bash
bolt run daily --dry-run
```

## Getting Help

### Preview a run

```bash
bolt run daily --dry-run
```

### Check Logs
Execution logs are stored in `.bolt/logs/`:

```bash
# View the latest log
cat .bolt/logs/bolt_2024-01-15T10-30-00.log

# Or follow it live
tail -f .bolt/logs/bolt_*.log
```

### Report Issues
If you encounter a bug:
1. Check existing issues: [GitHub Issues](https://github.com/jukrb0x/Bolt/issues)
2. Include in your report:
   - Bolt version (`bolt --version`)
   - Full error message
   - Minimal reproduction steps
   - Your configuration (omit sensitive data)

## See Also
- [bolt check](/cli/check.md) - Validate bolt.yaml
- [Error Handling](/guides/error-handling.md) - Fail-fast, continue_on_fail, continue-on-error
