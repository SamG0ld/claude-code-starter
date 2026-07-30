---
description: Write a structured handoff note capturing current state, what was tried, what failed, and the next step. Use when ending a session mid-task, before /clear or a rewind, when context is filling up during unfinished work, or when the user says they are stopping for now, switching machines, or picking this up later.
argument-hint: "[reason for the handoff]"
---

# Handoff Command

Create a structured summary for session transitions, before rewind, or when handing off to another session.

## Usage

`/handoff [reason]`

## When to Use

- **Before `/clear`** — Capture what matters before starting fresh
- **Before rewind** — Document what was tried so you don't repeat it
- **Task transition** — Switching focus within a session
- **End of day** — Summarize progress for tomorrow's session

## Output Format

Generate a handoff summary with these sections:

```markdown
## Handoff Summary

### Context
[What task/problem was being worked on]

### What Was Tried
- [Approach 1]: [Result - worked/failed/partial]
- [Approach 2]: [Result]
...

### What Worked
- [Successful changes, commits, or discoveries]

### What Didn't Work
- [Failed approaches and WHY they failed]

### Current State
- [Where things stand right now]
- [Any uncommitted changes]
- [Any running processes]

### Next Steps
- [Recommended next actions]
- [Open questions to resolve]

### Key Files
- [List of files that are central to this work]
```

## Workflow

### Before Rewind
```
/handoff "auth debugging didn't work"
[Esc Esc to rewind]
[Re-prompt with constraints learned]
```

### Before Clear
```
/handoff
[Copy summary to clipboard or let session-end hook capture it]
/clear
[Paste summary as context in new session]
```

### Task Transition
```
/handoff "switching from auth to billing"
[Continue in same session with clear mental break]
```

## Integration

If Obsidian is configured, the handoff summary will be appended to:
- `Development/<project>/Handoffs.md` (dated entries)

This complements the automatic session-end insights extraction with explicit, human-triggered summaries.

## Arguments

$ARGUMENTS:
- `[reason]` - Optional reason/context for the handoff (e.g., "switching tasks", "end of day", "approach failed")

## Reference

See [Claude Code: Session Management and 1M Context](https://claude.com/blog/using-claude-code-session-management-and-1m-context) for the rationale behind rewind and handoff strategies.
