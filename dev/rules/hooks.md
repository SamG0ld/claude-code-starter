# Hooks System

## Hook Types

- **PreToolUse**: Before tool execution (validation, parameter modification)
- **PostToolUse**: After tool execution (auto-format, checks)
- **SessionStart / SessionEnd / PreCompact**: Session lifecycle events
- **Stop**: When session ends (final verification)

## Current Hooks (in ~/.claude/settings.json)

### PreToolUse
- **dev server guard**: Blocks dev server commands outside tmux
- **tmux reminder**: Suggests tmux for long-running commands (npm, pnpm, yarn, cargo, etc.)
- **git push review**: Warns before `git push`
- **context guard**: Warns when context window is getting full before destructive ops
- **vault-write guard**: Blocks non-MCP filesystem writes to an Obsidian vault (opt-in via `OBSIDIAN_VAULT`; no-ops if unset)

### PostToolUse
- **PR creation log**: Logs PR URL after `gh pr create`
- **Prettier**: Auto-formats JS/TS/JSON/MD files after Edit
- **TypeScript check**: Runs `tsc --noEmit` after editing .ts/.tsx files
- **console.log warning**: Warns about `console.log` in edited files

### SessionStart / SessionEnd / PreCompact
- **session-start**: Loads project knowledge from configured sources (e.g. Obsidian vault if `OBSIDIAN_VAULT` is set)
- **session-end-obsidian**: Writes status (worktree/branch-labeled), extracts insights, appends to monthly logs
- **session-end**: Writes a local session backup to the project's `.claude/sessions/` if Obsidian is unavailable
- **pre-compact**: Saves state and provides compaction hints before context compression

### Stop
- **console.log audit**: Checks all modified files for `console.log` before the session ends
- **session evaluation**: Extracts learnable-pattern candidates from the session transcript (feeds `/learn`)

## Auto-Accept Permissions

Use with caution:
- Enable for trusted, well-defined plans
- Disable for exploratory work
- Never use the `--dangerously-skip-permissions` flag
- Configure `allowedTools` in `~/.claude.json` instead

## TodoWrite / TaskCreate Best Practices

Use the task tool to:
- Track progress on multi-step tasks
- Verify understanding of instructions
- Enable real-time steering
- Show granular implementation steps

The task list reveals:
- Out-of-order steps
- Missing items
- Extra unnecessary items
- Wrong granularity
- Misinterpreted requirements
