---
title: "Troubleshooting"
---

Common issues and solutions for Bolt.

## Common Errors

### bolt.yaml not found

**Error**: `[ERROR] bolt.yaml not found`

**Cause**: Bolt couldn't find a `bolt.yaml` file in the directory tree.

**Solution**:
1. Create a `bolt.yaml` in your project root
2. Navigate to a directory containing `bolt.yaml`
3. Use `bolt init` to generate a config file

```bash
cd /path/to/project
bolt init
```

### Unknown target

**Error**: `Unknown target: foo`

**Cause**: Referenced target not defined in `targets:` section.

**Solution**: Add the target to your configuration

```yaml
targets:
  foo:
    kind: editor
    config: development
```

### Handler not found

**Error**: `Handler not found: myplugin/deploy`

**Cause**: Plugin not loaded or namespace/handler doesn't exist.

**Solution**:
1. Check plugin is installed: `bolt plugin list`
2. Verify namespace and handler name
3. Check plugin path in `plugins:` section

```bash
bolt plugin list
# Should show: myplugin/deploy
```

### Command failed

**Error**: `Command failed with exit code 1`

**Cause**: Shell command returned non-zero exit code.

**Solution**:
1. Run with `--dry-run` to preview
2. Check command output for errors
3. Use `continue-on-error: true` for non-critical commands

```bash
bolt go build --dry-run
# Check output for errors
```

### Timeout exceeded

**Error**: `Operation timed out after 6 hours`

**Cause**: Operation took longer than configured timeout.

**Solution**:
1. Increase `timeout_hours` in config
2. Optimize long-running operation
3. Split into smaller ops

```yaml
timeout_hours: 12  # Increase from 6 to 12
```

### SVN/Git Errors

**Error**: `svn: E155015: Conflict...` or `git: merge conflict`

**Cause**: Version control conflicts.

**Solution**:
1. Resolve conflicts manually
2. Use `ue/svn-cleanup` or `ue/svn-revert`
3. Reset working copy

```bash
# SVN cleanup
bolt run svn-cleanup

# SVN revert
bolt run svn-revert

# Git reset (manual)
cd engine
git reset --hard
```

### Zero-byte DLL Errors

**Error**: Linker errors due to zero-byte DLL files

**Cause**: Corrupted DLL files in Binaries directories.

**Solution**: Use `ue/fix-dll` handler to remove zero-byte DLLs

```bash
bolt run fix-dll
```

## Configuration Issues

### Invalid YAML Syntax

**Error**: `YAML syntax error at line 15`

**Cause**: Malformed YAML in bolt.yaml.

**Solution**:
1. Use `bolt check` to validate
2. Fix YAML syntax (indentation, quotes)
3. Use a YAML validator

```bash
bolt check
# Shows: bolt.yaml:15:5 → Expected mapping, got sequence
```

### Missing Required Fields

**Error**: `Missing required field: project.name`

**Cause**: Required field not specified.

**Solution**: Add missing field to configuration

```yaml
project:
  name: MyGame  # Add this
  # ... other fields
```

### Invalid Target Kind

**Error**: `Invalid target kind: foo`

**Cause**: Target kind must be one of: supported values.

**Solution**: Use valid target kind

```yaml
targets:
  mytarget:
    kind: editor  # editor | program | game | client | server
```

## Performance Issues

### Slow Execution

**Cause**: Large projects, slow networks, many steps.

**Solution**:
1. Use `--dry-run` to verify plan
2. Optimize long-running steps
3. Use `continue-on-error` for non-critical steps

```bash
bolt go build --dry-run
```

### Memory Issues

**Cause**: Large output from commands.

**Solution**:
1. Redirect output to file
2. Use `silent: true` for verbose commands
3. Process in smaller batches

## Getting Help

### Debug Mode
Run with additional logging:

```bash
bolt go build --dry-run
```

### Check Logs
Execution logs are stored in `.bolt/logs/`:

```bash
# View latest log
cat .bolt/logs/bolt_2024-01-15T10-30-00.log

# Or use tail -f
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
- [Error Handling](/guides/error-handling.md) - Best practices for errors
