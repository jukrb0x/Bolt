---
title: "Error Handling"
---

Bolt has two independent failure controls. Keep them straight:

| Control | Scope | Key | Where |
|---------|-------|-----|-------|
| `continue-on-error` | A single **step** inside a task | hyphen | task step |
| `continue_on_fail` | A **task** inside a flow | underscore | flow definition |

Flows are otherwise **fail-fast**.

## Per-step: `continue-on-error`

`continue-on-error: true` lets one step fail without failing the task it belongs to. It is honored for `run:` shell steps — a non-zero exit is swallowed instead of aborting.

```yaml
tasks:
  clean:
    - run: "rm -rf ./Saved"
      continue-on-error: true      # keep going even if this fails
    - run: "rm -rf ./Intermediate"
      continue-on-error: true
```

Use it for:
- Cleaning directories that might not exist
- Non-critical cleanup steps
- Optional operations

Without `continue-on-error`, a failed step throws and its task fails.

## Per-flow: fail-fast + `continue_on_fail`

A flow runs its tasks in listed order and is **fail-fast**: the first failing task aborts the flow, and nothing after it runs. To let a specific task fail without aborting the flow, add its name to the flow's `continue_on_fail` allowlist.

```yaml
flows:
  daily:
    steps: [update, build, start]
    continue_on_fail: [start]    # update/build failures abort; start may fail
  reset:
    steps: [kill, update, genproj, build]
    continue_on_fail: [kill]     # kill may fail (nothing running) without aborting
```

Behavior (`runFlow`):
- If a task fails and is **not** in `continue_on_fail`, the flow stops immediately and Bolt exits with an error code.
- If a task fails and **is** in `continue_on_fail`, Bolt logs a warning (`"<task>" failed but is in continue_on_fail — continuing`) and moves on to the next task.

> `continue-on-error` (per-step) and `continue_on_fail` (per-flow) are unrelated. A step swallowed by `continue-on-error` never fails its task in the first place; `continue_on_fail` decides what happens when a whole *task* fails inside a *flow*.

## Missing bolt.local.yaml

`bolt.local.yaml` holds your per-machine paths and is gitignored, so a fresh clone won't have one. If it is missing or invalid, Bolt fails **loudly** at load time and tells you how to fix it:

```
bolt.local.yaml missing or invalid — copy bolt.local.example.yaml or run bolt init
```

Fix it by either:

```bash
cp bolt.local.example.yaml bolt.local.yaml   # then edit the paths
# or
bolt init                                     # scaffolds it for you
```

This is intentional — Bolt does not silently fall back to defaults for machine paths.

## Handling Timeouts

Set a global timeout to prevent runaway runs. Checked between tasks in a flow:

```yaml
timeout_hours: 6  # abort the run once it exceeds 6 hours
```

## Best Practices

### 1. Critical vs Non-Critical
Categorize tasks by importance.

| Type | Behavior | Example |
|------|----------|---------|
| Critical | Abort the flow on failure | `update`, `build` |
| Non-critical | Add to `continue_on_fail` | `start`, `kill` |
| Optional step | `continue-on-error` on the step | cleanup `run:` steps |

### 2. Preview with --dry-run
Always test with `--dry-run` before running for real.

```bash
bolt run daily --dry-run
```

### 3. Check Exit Codes
Bolt exits non-zero when a run fails. Check it in scripts.

```bash
bolt run daily
if [ $? -ne 0 ]; then
  echo "Daily flow failed"
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
      bot_token: ${{ env.TELEGRAM_BOT_TOKEN }}
      chat_id: ${{ env.TELEGRAM_CHAT_ID }}
```

## Error Messages
Bolt provides clear error messages with context.

| Error | Cause | Solution |
|-------|------|----------|
| `bolt.yaml not found` | No config file in directory tree | Run `bolt init` or navigate to project root |
| `bolt.local.yaml missing or invalid` | Per-machine config absent | Copy `bolt.local.example.yaml` or run `bolt init`, then set paths |
| `Unknown task: foo` | Task name not defined | Run `bolt list` to see available tasks/flows |
| `Unknown flow: foo` | Flow name not defined | Run `bolt list` to see available flows |
| `Command failed (exit N)` | Shell command returned non-zero | Check output; fix, or add `continue-on-error` |
| `Build timed out after Nh` | Run exceeded `timeout_hours` | Increase `timeout_hours` or optimize |

## See Also
- [bolt.yaml Reference](/guides/bolt-yaml.md) - Configuration schema
- [Daily Workflow](/guides/daily-workflow.md) - Tasks, flows, and params
- [Troubleshooting](/guides/troubleshooting.md) - Common issues and solutions
