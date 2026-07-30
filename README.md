# claude-code-starter

An opinionated configuration layer for [Claude Code](https://claude.ai/code) that enhances the built-in agents, commands, and hooks with specialized workflows, quality gates, and automation. Fork it, customize it, run the setup script.

## What you get

| Component | Count | What it does |
|-----------|-------|-------------|
| **Agents** | 14 | Specialized sub-agents for planning, code review, TDD, security analysis, architecture, adversarial review |
| **Commands** | 10 | Slash commands like `/ship`, `/challenge`, `/audit-injection`, `/security-scan`, `/learn` for opinionated workflows |
| **Rules** | 5 global + 4 dev-layer | Security, git workflow, agents, performance, and verification standards; code style / testing / patterns load only when Claude touches source files |
| **Hooks** | 15 | Auto-formatting, context freshness guard, session persistence, vault-write guard, MCP tool-poisoning warnings, indirect-injection taint gate |
| **Skills** | 2+ | Security-scanning and harness-setup skills + your own learned patterns via `/learn` |
| **Contexts** | 3 | Switch between dev, research, and review modes |
| **Agent-safety tooling** | 3 | MCP tool-poisoning scanner, indirect-injection taint gate, retrospective injection audit |

## Why this exists

Claude Code ships with agents, slash commands, hooks, and memory out of the box. This starter kit builds on that foundation with opinionated defaults so you don't have to configure everything from scratch:

- **Specialized agents with model routing** — 14 purpose-built agents for planning, code review, TDD, security, architecture, adversarial review, and more. Opus tier for planner/architect/security-reviewer/adversarial-reviewer; Sonnet for code/database/tdd reviewers; Haiku for build/refactor/doc/e2e/scanner workers.
- **Context freshness guard** — Tracks tool calls and context window usage, warns at thresholds, and prevents degraded responses from stale context.
- **Session persistence** — Session hooks save context so the next session can pick up where you left off.
- **Continuous learning** — Run `/learn` after solving a non-trivial problem. The pattern is extracted and saved as a skill file that persists across sessions and machines via git.
- **Auto-formatting** — After every edit, Prettier formats automatically, so style issues never compound. Type diagnostics are left to the native LSP plugins rather than a per-edit full-project typecheck.
- **The ship-loop** — `/ship` runs a disciplined end-to-end flow: scope lock, ground-truth git pre-flight, isolated worktree, gated implement, review, rebase, squash-merge, and cleanup. Built to be safe when multiple sessions run in parallel.
- **Agent-security tooling (beyond code security)** — Most of the security layer here reviews the code Claude *writes*. This adds defenses for the *agent itself*: a SHA-256 MCP tool-poisoning scanner (catches rug-pulls / hidden-instruction tool descriptions / cross-server shadowing), a taint-tracking sink gate that asks for confirmation before an outbound action once untrusted web/email/chat content has entered the session, and `/audit-injection` for a retrospective sweep of past transcripts. These are **advisory checkpoints, not a tamper-proof perimeter** — fail-open and ask-only by design, so they raise the cost of an attack and surface the dangerous moment without bricking a session.
- **Cross-platform** — Works on macOS and Windows. Setup scripts handle the differences.

## Quick start

```bash
# Clone
git clone https://github.com/SamG0ld/claude-code-starter ~/Dev/claude-code-starter
cd ~/Dev/claude-code-starter

# Install (copies config to ~/.claude/)
./setup.sh          # macOS/Linux
# .\setup.ps1       # Windows PowerShell

# Restart Claude Code to pick up changes
```

That's it. You now have 14 agents, 10 commands, and 15 hooks active. Re-run with `--dry-run` (`-DryRun` on PowerShell) to preview changes before applying.

## What this adds over vanilla Claude Code

| Capability | Claude Code (built-in) | With this starter |
|-----------|----------------------|-------------------|
| Agents | General-purpose | 14 specialized agents with model-tier routing |
| Slash commands | Built-in basics | 10 additional workflow commands (`/ship`, `/challenge`, `/audit-injection`, `/security-scan`, etc.) |
| Hooks | Framework exists | 15 pre-configured hooks (auto-format, context guard, session persistence, vault-write guard, MCP poisoning warnings, injection taint gate) |
| Session memory | Memory system | Session hooks that save/restore context automatically |
| Pattern learning | Skills system | `/learn` extracts and saves reusable patterns via git |
| Multi-agent workflows | Manual | `/challenge` fans out adversarial reviewers; `/ship` runs a gated end-to-end ship-loop |
| Prompt-injection / MCP defense | None | MCP tool-poisoning scanner, taint-tracking sink gate, retrospective injection audit (advisory, fail-open) |
| Rules | Project-level CLAUDE.md | 9 opinionated rules (security, git, agents, performance, verification; plus path-scoped style/testing/patterns) |
| Settings install | Manual | Surgical merge of hooks block; preserves your `model`, `enabledPlugins`, etc. |

## What's included

### Agents

Specialized sub-agents launched via the Agent tool. Each has a focused prompt and optional model override.

| Agent | When to use |
|-------|-------------|
| `planner` | Complex features, multi-step tasks |
| `architect` | System design, tech decisions |
| `code-reviewer` | After writing code, before committing |
| `tdd-guide` | New features — writes tests first |
| `security-reviewer` | Security-sensitive code |
| `adversarial-reviewer` | Stress-test a claim or research conclusion (used by `/challenge`) |
| `build-error-resolver` | Build failures, type errors |
| `e2e-runner` | Critical user flow testing |
| `refactor-cleaner` | Dead code, tech debt cleanup |
| `doc-updater` | Documentation updates |
| `database-reviewer` | SQL, schema, query optimization |
| `function-analyzer` | Deep per-function analysis |
| `semgrep-scanner` | Static analysis scans |
| `semgrep-triager` | Triage scan findings |

### Slash commands

Type `/` in Claude Code to see all available commands. Key ones (basics like TDD, code review, and build-fixing are now covered by native Claude Code features, so they've been pruned here):

- **`/ship`** — Run the full ship-loop: scope lock, ground-truth git pre-flight, isolated worktree, gated implement, review, rebase, squash-merge, cleanup
- **`/challenge`** — Fan out three adversarial reviewers (Skeptic / Contrarian / Missing-Evidence Hunter) against a claim or research output, then synthesize a HELD / CONTESTED / OVERTURNED verdict
- **`/learn`** — Extract a reusable pattern from the current session
- **`/handoff`** — Write a structured handoff note before `/clear` or a rewind
- **`/security-scan`** — Scan for vulnerabilities with regex fallback + static analysis
- **`/audit-injection`** — Retrospective indirect-prompt-injection sweep of session transcripts + data-at-rest (inbound email, web-clipped notes). Read-only tripwire.
- **`/update-codemaps`** / **`/update-docs`** — Regenerate codemaps and documentation

### Hooks

Hooks run automatically at specific lifecycle points:

| Hook | When | What it does |
|------|------|-------------|
| `pre-bash-dev-server.js` | Before Bash | Blocks dev server outside tmux (only when tmux is installed) |
| `pre-bash-git-push.js` | Before Bash | Warns before git push |
| `context-guard.js` | Before Edit/Write/Bash | Warns when context window is getting full |
| `block_vault_writes.js` | Before Write/Edit/NotebookEdit/Bash | Blocks non-MCP filesystem writes to an Obsidian vault (opt-in via `OBSIDIAN_VAULT`; no-ops if unset) |
| `pre-tool-taint-gate.js` | Before Bash/WebFetch/send-MCPs | Asks for confirmation before an outbound/exfil action when the session is tainted by untrusted content (**ships disabled by default** via `TAINT_GATE_DISABLE=1`; remove that env entry in `settings.hooks.json` to enable) |
| `post-edit-format.js` | After Edit | Auto-formats with Prettier |
| `post-bash-pr-log.js` | After Bash | Logs PR URL after `gh pr create` |
| `post-tool-taint-source.js` | After web/email/chat tools | Marks the session tainted after untrusted external content enters context |
| `check-console-log.js` | On Stop | Audits all modified files for console.log |
| `evaluate-session.js` | On Stop | Signals pattern extraction for long sessions |
| `session-start.js` | Session Start | Loads project knowledge (6 files, 30KB budget) |
| `session-start-mcp-scan.js` | Session Start | Replays unresolved MCP tool-poisoning findings and refreshes the SHA-256 pin baseline in the background (`MCP_SCAN_DISABLE=1` to disable) |
| `session-end-obsidian.js` | Session End | Saves status (worktree/branch-labeled), extracts insights, writes monthly logs |
| `session-end.js` | Session End | Writes a local session file to the project's `.claude/sessions/` as a backup if Obsidian is unavailable |
| `pre-compact.js` | Before Compact | Saves state before context compression |

### Rules

Global rules (`config/rules/` → `~/.claude/rules/`) load as project instructions in every session:

- **security** — No hardcoded secrets, input validation, OWASP awareness
- **git-workflow** — Conventional commits, PR workflow
- **agents** — When and how to use each agent, plus built-in vs custom agents
- **performance** — Model selection strategy, effort levels, context window management
- **verification** — Give the work a check that returns pass/fail; show evidence before claiming done

Code-specific rules live in the [dev layer](#dev-layer-optional) (`dev/rules/`) and carry
`paths:` frontmatter, so they load only when Claude actually touches matching source files
instead of on every session:

- **coding-style** — Immutability, small files, error handling
- **testing** — 80% coverage minimum, TDD workflow
- **patterns** — Skeleton-project pattern for new implementations
- **hooks** — Reference for the hook wiring above (no `paths:`; loads for any session under `$DEV_ROOT`)

### Agent-safety tooling

Beyond reviewing the code Claude writes, this starter ships a small defensive layer for the **agent itself** — the prompt-injection / malicious-MCP threat class:

| Tool | What it does |
|------|-------------|
| `scan-mcp-tools.js` | Enumerates your stdio MCP servers, pins each tool definition's SHA-256, and flags **drift** (rug-pulls / [CVE-2025-54136](https://nvd.nist.gov/vuln/detail/CVE-2025-54136)-style swaps), **tool-poisoning signatures** in any tool field (hidden `<IMPORTANT>` instructions, credential/exfil references — with zero-width/NFKC normalization), and **cross-server name collisions** (shadowing). Trust-on-first-use; run with `--approve` to accept reviewed changes. |
| `pre-tool-taint-gate.js` + `post-tool-taint-source.js` | Classic taint tracking: a web/email/chat tool marks the session tainted, then the next outbound/exfil action (WebFetch, network Bash, send-capable MCPs) prompts for confirmation. Gates the *action*, not the (undecidable) content. |
| `audit-tool-responses.js` / `/audit-injection` | Retrospective, read-only scan of past session transcripts (and optionally inbound email + web-clipped notes) for injection signatures in **untrusted-source** tool output. A tripwire, not proof. |

Signatures live in `config/data/mcp-poisoning-patterns.json`. Knobs: `TAINT_GATE_DISABLE=1`, `MCP_SCAN_DISABLE=1`, `MCP_SCAN_THROTTLE_HOURS`.

**Honest scope:** these are advisory checkpoints — **fail-open and ask-only by design**. They raise an attacker's cost and surface the dangerous moment to a human; they do **not** hard-stop a determined, injection-aware attacker (egress paths outside the deny-list and clearing the state file remain bypasses). The sink-gate matchers in `config/settings.hooks.json` and the sink classifier in `config/scripts/lib/taint.js` ship with common MCPs (Gmail, Calendar, Discord, email) as examples — extend both for the write/send tools of whatever servers you run. The gate **ships disabled by default** (`TAINT_GATE_DISABLE=1` in `config/settings.hooks.json`); remove that env entry to turn it on.

## Customization

### Add your own agent

Create `agents/my-agent.md`:

```markdown
You are a specialized agent for [purpose].

## When to use
[Trigger conditions]

## How to approach
[Instructions]
```

Run `./setup.sh` to install.

### Add your own slash command

Create `config/commands/my-command.md` with the command prompt. The filename becomes `/my-command`.

### Add your own skill

See `examples/custom-skill-example.md` for a complete walkthrough.

### Add MCP servers

See `examples/mcp-server-example.md` for the full pattern including registration, health checks, and cross-platform setup.

### Dev-layer (optional)

If you keep multiple projects under one directory (e.g. `~/Dev/`), the starter can install a `CLAUDE.md` and a set of rules at that parent so they apply to every child project automatically.

- **Default behavior**: setup uses the parent of this clone as `$DEV_ROOT` (e.g. `~/Dev` if you cloned into `~/Dev/claude-code-starter`).
- **Override**: set the `DEV_ROOT` environment variable to point somewhere else, or unset/point at a non-existent path to skip dev-layer install entirely.
- **What gets installed**: `dev/CLAUDE.md` → `$DEV_ROOT/CLAUDE.md`, and every `dev/rules/*.md` → `$DEV_ROOT/.claude/rules/`. All symlinked, so editing the files in this repo updates them everywhere immediately.
- **Adding a rule**: drop a `.md` file in `dev/rules/` and re-run setup — no script edit needed. Give it `paths:` frontmatter to load it only when Claude touches matching files; omit `paths:` to load it in every session under `$DEV_ROOT`. Setup also prunes symlinks whose target you deleted, leaving your own files alone.

Edit `dev/CLAUDE.md` to tailor the multi-project workflow guidance to your setup.

### Obsidian Integration (Optional but Recommended)

The session hooks integrate with [Obsidian](https://obsidian.md) to persist project knowledge across sessions. This is optional — hooks silently no-op if Obsidian isn't configured.

**What it does:**
- **Session start:** Loads up to 6 knowledge files (Status, Session Insights, Tech Debt, Bugs, Architecture, Decisions) with a 30KB budget cap
- **Session end:** Writes session status, extracts insights from your messages, appends to monthly session logs
- **Continuous learning:** Patterns and decisions accumulate in `Session Insights.md` with deduplication (20KB cap)

**Setup:**

1. **Install Obsidian** — Download from [obsidian.md](https://obsidian.md) (free for personal use)

2. **Create your vault structure:**
   ```
   Your-Vault/
   └── Development/
       ├── Logs/           # Monthly session logs (auto-created)
       └── <project-name>/ # One folder per project
           ├── Status.md
           ├── Session Insights.md
           ├── Tech Debt.md
           ├── Bugs.md
           ├── Architecture.md
           └── Decisions.md
   ```
   
   You don't need all files — hooks only load what exists.

3. **Set the environment variable:**
   ```bash
   # Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
   export OBSIDIAN_VAULT="/path/to/your/vault"
   ```

4. **Project name mapping:**
   - By default, hooks use your `~/Dev/<project-name>` directory name
   - To override, edit `config/scripts/lib/obsidian.js` and add to `PROJECT_MAP`

**Recommended Obsidian plugins:**
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview) — Query your session data
- [Templater](https://github.com/SilentVoid13/Templater) — Templates for new project folders

**Without Obsidian:**
All session hooks check for the vault and skip gracefully if not found. You lose session persistence but everything else works normally.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLAUDE_TIMEZONE` | System timezone | Timezone for date/time in hooks and logs |
| `CLAUDE_DEV_ROOT` | (none) | Additional project root directory the hooks recognize |
| `DEV_ROOT` | Parent of this repo | Where the setup scripts install the dev-layer symlinks (set to skip / redirect) |
| `OBSIDIAN_VAULT` | (none, strictly opt-in) | Path to Obsidian vault for session persistence |
| `CLAUDE_PACKAGE_MANAGER` | Auto-detected | Force a specific package manager (npm/pnpm/yarn/bun) |
| `TAINT_GATE_DISABLE` | `1` (ships disabled) | The indirect-injection sink gate is off by default; remove this entry from `settings.hooks.json` (or set to `0`) to enable it |
| `MCP_SCAN_DISABLE` | (unset) | Set to `1` to disable the SessionStart MCP tool-poisoning warn hook |
| `MCP_SCAN_THROTTLE_HOURS` | `12` | Hours between background MCP tool-poisoning re-scans |

## Setup-script flags

Both `setup.sh` and `setup.ps1` accept these:

| Flag | sh | ps1 | What it does |
|------|----|-----|-------------|
| Dry run | `--dry-run` or `DRY_RUN=1` | `-DryRun` | Preview everything that would be written, without changing files |
| Force overwrite | `FORCE=1` | `-Force` | Copy regardless of timestamps |
| Keep stale files | `NO_PRUNE=1` | `-NoPrune` | Don't delete files in `~/.claude/` that aren't in this repo |
| Override DEV_ROOT | `DEV_ROOT=path` | `$env:DEV_ROOT = "path"` | Target a non-default directory for dev-layer symlinks |

### Settings merge behavior

The setup script does **not** overwrite your `~/.claude/settings.json`. Instead, it runs `merge-hooks-settings.js`, which:

1. Reads `config/settings.hooks.json` (this repo's canonical hooks + statusLine block)
2. Merges it into your existing `~/.claude/settings.json`, preserving keys like `model`, `enabledPlugins`, `voiceEnabled`, `extraKnownMarketplaces`, etc.
3. Backs up your prior settings to `settings.json.backup-<timestamp>` before writing

This means you can safely re-run setup at any time without losing per-machine preferences.

## Platform support

| Item | macOS | Windows |
|------|-------|---------|
| Setup script | `./setup.sh` | `.\setup.ps1` |
| Learned skills link | symlink | junction (`mklink /J`) |
| MCP server command | direct path or `bash` | `cmd /c` wrapper |
| Python venvs | `source .venv/bin/activate` | `.venv\Scripts\activate` |

## Health check

Verify all your MCP servers are healthy:

```bash
node ~/.claude/scripts/check-mcp-health.js
```

Scan your registered MCP servers for tool poisoning / rug-pulls (the first run silently pins the baseline; later runs flag drift and signatures):

```bash
node ~/.claude/scripts/scan-mcp-tools.js          # report; --approve to accept reviewed changes
```

## Context Management

Session hooks and context management are designed around Anthropic's guidance on context rot and session hygiene.

**Key principles:**
- **Context rot is real** — Performance degrades as context expands. Use `/clear` for new tasks.
- **Subagents for isolation** — Use when task generates intermediate output you won't need again.
- **Compact with hints** — `pre-compact.js` reads `Focus.md` and git context to guide compaction.
- **Handoff for transitions** — `/handoff` creates structured summaries before `/clear` or rewind.

| Situation | Action |
|-----------|--------|
| New task | `/clear` (session hooks reload context from Obsidian) |
| Wrong approach | Rewind (`Esc Esc`), use `/handoff` first to document what failed |
| Stale context | `/compact` with hint, or let `pre-compact.js` provide one |
| Lots of intermediate output | Delegate to subagent |

### Focus.md

Create `Development/<project>/Focus.md` in your Obsidian vault with a single line describing your current task focus. This file is:
- Loaded first at session start (highest priority)
- Read by `pre-compact.js` to guide compaction summaries

Example content:
```
Implementing OAuth flow for the billing integration
```

## License

MIT

Maintained by [@SamG0ld](https://github.com/SamG0ld)

## Prerequisites

| Dependency | Required | What needs it |
|------------|----------|---------------|
| [Node.js](https://nodejs.org) | Yes (18+) | Hooks, health check, MCP tool-poisoning scanner |
| [Claude Code CLI](https://claude.ai/code) | Yes | Everything |
| [Git](https://git-scm.com) | Yes | Clone and sync |
| [Obsidian](https://obsidian.md) | Optional | Session persistence, knowledge loading |

## Credits

Built on [Claude Code](https://claude.ai/code) by [Anthropic](https://anthropic.com).

**References:**
- [Claude Code: Session Management and 1M Context](https://claude.com/blog/using-claude-code-session-management-and-1m-context) — Anthropic's guide to context rot, compaction, rewind, and subagents
- [Andrej Karpathy's Claude Code setup](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — Inspiration for session persistence hooks
