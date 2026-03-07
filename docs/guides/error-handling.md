---
title: "Error Handling"
---

Best practices for handling errors in Bolt workflows.

## continue-on-error

Use `continue-on-error: true` to allow a workflow to continue even if a step fails.

```yaml
ops:
  clean:
    default:
      - uses: fs/delete
        with:
          path: ./Saved
        continue-on-error: true    # Continue even if this fails
      - uses: fs/delete
        with:
          path: ./Intermediate
        continue-on-error: true
```

This is useful for:
- Cleaning directories that might not exist
- Non-critical cleanup steps
- Optional operations

## fail_stops

Configure which ops should abort the entire run if they fail.

```yaml
go-pipeline:
  order:
    - kill
    - update
    - build
    - start
  fail_stops:
    - build    # Stop everything if build fails
```

Behavior:
- If `build` fails, no subsequent ops run
- All execution stops
- Error is logged
- Process exits with error code

## Handling Timeouts

Set a global timeout to prevent runaway processes.

```yaml
timeout_hours: 6  # Abort entire run after 6 hours
```

## Shell Command Errors

Handle shell command failures with error checking.

```yaml
ops:
  deploy:
    default:
      - run: |
          # Check if command exists
          if command -v npm &> /dev/null; then
            echo "npm not found, skipping"
          else
            npm run deploy
          fi
        continue-on-error: true
```

Or use `continue-on-error` for non-critical commands failures.

```yaml
ops:
  deploy:
    default:
      - run: npm run deploy
        continue-on-error: true  # Continue if deploy fails
      - uses: myplugin/notify
        with:
          message: "Deployment attempted"
```

## Best Practices

### 1. Critical vs Non-Critical
Categorize steps by importance.

| Type | Behavior | Example |
|------|----------|---------|
| Critical | Stop on failure | `build`, `package` |
| Non-critical | Continue on failure | `clean`, `notify` |
| Optional | Skip if not applicable | `fillddc`, `fix-dll` |

### 2. Use Dry Run First
Always test with `--dry-run` before running actual workflows.

```bash
bolt go update build --dry-run
```

### 3. Check Exit Codes
Bolt exits with non-zero code on failure. Check exit codes in scripts.

```bash
bolt go build
if [ $? -ne 0 ]; then
  echo "Build failed"
  exit 1
fi
```

### 4. Use Notifications
Configure notifications for important workflows.

```yaml
notifications:
  on_complete: true
  on_failure: true
  providers:
    - type: telegram
      bot_token: ${env.TELEGRAM_BOT_TOKEN}
      chat_id: ${env.TELEGRAM_CHAT_ID}
```

## Error Messages
Bolt provides clear error messages with context.

 Common error types:

| Error | Cause | Solution |
|-------|------|----------|
| `bolt.yaml not found` | No config file in directory tree | Create `bolt.yaml` or navigate to project root |
| `Unknown target: foo` | Target not defined in config | Add target to `targets:` section |
| `Handler not found: ns/handler` | Plugin not loaded | Check plugin namespace and handler name |
| `Command failed` | Shell command returned non-zero | Check command output, fix command or add `continue-on-error` |
| `Timeout exceeded` | Operation took longer than limit | Increase `timeout_hours` or optimize operation |

## See Also
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
- [Troubleshooting](/guides/troubleshooting.md) - Common issues and solutions
