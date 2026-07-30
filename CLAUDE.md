# CLAUDE.md

This file guides Claude Code when working **inside this repo**. For user-facing documentation, see [README.md](./README.md).

## What this repo is

Portable Claude Code configuration — agents, commands, rules, hooks, skills, and tooling. Fork it, customize it, run the setup script to bring any machine's Claude Code environment up to speed.

## Where things live

- **`config/CLAUDE.md`** — Global behavioral rules that get installed to `~/.claude/CLAUDE.md` (symlinked at install). Edit there to change rules that apply to all of Claude's sessions on a machine.
- **`config/rules/`** — Global project-instruction rule files (security, git workflow, agents, performance, verification). Installed to `~/.claude/rules/`. Code-specific rules (style, testing, patterns) live in `dev/rules/` instead, path-scoped via `paths:` frontmatter.
- **`config/commands/`** — Slash command definitions. Installed to `~/.claude/commands/`. Filename becomes command name.
- **`config/scripts/hooks/`** — Lifecycle hooks (session start/end, pre/post tool use, the MCP tool-poisoning warn hook, and the indirect-injection taint gate). Installed to `~/.claude/scripts/hooks/`.
- **`config/scripts/lib/`** — Shared utilities (`utils.js`, `obsidian.js`, `package-manager.js`, `mcp-scan.js`, `taint.js`).
- **`config/scripts/`** (top level) — Standalone CLIs: `check-mcp-health.js`, `scan-mcp-tools.js` (MCP tool-poisoning scanner), `audit-tool-responses.js` (retrospective indirect-injection audit). Installed to `~/.claude/scripts/`.
- **`config/data/`** — Static data files: `security-regex-patterns.json` (secret/vuln patterns), `mcp-poisoning-patterns.json` (tool-poisoning signature pack). Installed to `~/.claude/data/`.
- **`config/settings.hooks.json`** — Canonical hooks + statusLine block, surgically merged into the user's `~/.claude/settings.json` by `merge-hooks-settings.js`.
- **`agents/`** — Sub-agent prompts. Installed to `~/.claude/agents/`.
- **`skills/`** — Static skills. `security-scan` and `harness-setup` are the generic skills shipped; `config/skills/learned/` accumulates patterns from `/learn`.
- **`dev/`** — Optional dev-layer files installed to `$DEV_ROOT` (parent of this repo) when present. Provides `$DEV_ROOT/CLAUDE.md` plus every `dev/rules/*.md` at `$DEV_ROOT/.claude/rules/` for multi-project folders. Setup symlinks the whole glob, so a new rule file needs no script edit.
- **`setup.sh` / `setup.ps1`** — Installers. Re-run after editing any of the above.

## Working in this repo

- **Edit config here, not in `~/.claude/`** — setup scripts copy this repo onto `~/.claude/` (and symlink CLAUDE.md / learned/), so edits to installed files get overwritten.
- **Re-run setup after edits** — `./setup.sh` (mac/linux) or `.\setup.ps1` (Windows). Or `./setup.sh --dry-run` to preview.
- **`config/skills/learned/` is symlinked from `~/.claude/skills/learned/`** — so `/learn` writes here directly, and `git push` syncs learned skills across machines.
- **No build step, linter, or test suite.** Scripts are Node.js (builtins only, no npm install).
- **MCP servers register per-machine.** Their registrations live in `~/.claude.json`, which is not tracked here. See `examples/mcp-server-example.md` for the pattern.

## Counts (for quick reference)

| Component | Count |
|-----------|-------|
| Agents | 14 |
| Commands | 10 |
| Hooks (lifecycle scripts) | 15 |
| Rules | 5 global (`config/rules/`) + 4 dev-layer (`dev/rules/`) |
| Contexts | 3 |
| Skills (bundled) | 2 (`security-scan`, `harness-setup`) |

The `setup.sh` output reports actual counts at install time.

## Setup-script flags

| Flag | sh | ps1 | What it does |
|------|----|-----|-------------|
| Dry run | `--dry-run` or `DRY_RUN=1` | `-DryRun` | Preview all writes/links without applying |
| Force overwrite | `FORCE=1` | `-Force` | Copy files regardless of timestamps |
| Keep stale files | `NO_PRUNE=1` | `-NoPrune` | Don't delete `~/.claude/` files that aren't in this repo |
| Override DEV_ROOT | `DEV_ROOT=path` | `$env:DEV_ROOT = "path"` | Point dev-layer symlinks somewhere other than the parent of this repo |

## References

- [Claude Code: Session Management and 1M Context](https://claude.com/blog/using-claude-code-session-management-and-1m-context) — Anthropic's guide to context rot, compaction, rewind, and subagents
- [Andrej Karpathy's Claude Code setup](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — Inspiration for session persistence hooks
