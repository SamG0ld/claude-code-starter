# Hooks System

## Hook Types

- **PreToolUse**: Before tool execution (validation, parameter modification)
- **PostToolUse**: After tool execution (auto-format, checks)
- **SessionStart / SessionEnd / PreCompact**: Session lifecycle events
- **Stop**: When session ends (final verification)

## Current Hooks (in ~/.claude/settings.json)

### PreToolUse
- **dev server guard**: Blocks dev server commands outside tmux
- **git push review**: Warns before `git push`
- **context guard**: Warns when context window is getting full before destructive ops
- **vault-write guard**: Blocks non-MCP filesystem writes to an Obsidian vault (opt-in via `OBSIDIAN_VAULT`; no-ops if unset)

### PostToolUse
- **PR creation log**: Logs PR URL after `gh pr create`
- **Prettier**: Auto-formats JS/TS/JSON/MD files after Edit

### SessionStart / SessionEnd / PreCompact
- **session-start**: Loads project knowledge from configured sources (e.g. Obsidian vault if `OBSIDIAN_VAULT` is set)
- **session-end-obsidian**: Writes status (worktree/branch-labeled), extracts insights, appends to monthly logs
- **session-end**: Writes a local session backup to the project's `.claude/sessions/` if Obsidian is unavailable
- **pre-compact**: Saves state and provides compaction hints before context compression

### Stop
- **console.log audit**: Checks all modified files for `console.log` before the session ends
- **session evaluation**: Extracts learnable-pattern candidates from the session transcript (feeds `/learn`)

## Removed, and why

Pruned because native Claude Code features now cover them. Don't re-add without
checking whether the native path regressed.

- **post-edit-typecheck.js**: ran `npx tsc --noEmit` over the whole project after every
  `.ts`/`.tsx` edit. The `typescript-lsp` and `pyright-lsp` plugins give the same
  diagnostics incrementally, without the per-edit full-project typecheck.
- **post-edit-console-warn.js**: fired per edit, including on files still being written.
  The `check-console-log.js` Stop hook audits every modified file once at the end, which
  is the same coverage without the noise.
- **pre-bash-tmux-suggest.js**: predates native background tasks and `/background`.

## Learned skills vs auto memory

Two learning systems can run concurrently. This is deliberate; they are not redundant.

| | `/learn` + evaluate-session.js | Native auto memory |
|---|---|---|
| Writes to | `config/skills/learned/` (git-tracked, symlinked) | `~/.claude/projects/<project>/memory/` |
| Syncs across machines | Yes, via git push/pull | **No.** Machine-local, never synced |
| Trigger | `/learn`, or the Stop hook flags a candidate | Claude decides, automatically |
| Best for | Reusable techniques worth carrying to another machine | Per-repo build commands, local quirks, preferences |

Rule of thumb: if it should exist on every machine you work from, it belongs in a learned
skill. If it is about this checkout on this machine, auto memory is fine. Auto memory's
`MEMORY.md` index is capped at 200 lines / 25KB on load, so keep it an index and push
detail into topic files.

## Unused hook surface

Claude Code exposes roughly 28 hook events; this harness wires 6. Notable unwired ones if
a need comes up: `UserPromptSubmit`, `PostToolUseFailure`, `SubagentStart`/`SubagentStop`,
`PermissionDenied` (supports `retry: true`), `PostCompact`, `SessionStart` output fields
(`sessionTitle`, `reloadSkills`, `watchPaths`), and `InstructionsLoaded` for debugging
which rule files actually load. Hooks can also be type `http`, `prompt`, or `subagent`,
not just `command`; all current ones are `command`.

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
