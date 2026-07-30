---
name: harness-setup
description: Set up, repair, or verify this Claude Code harness on a machine. Covers prerequisites, running setup.sh/setup.ps1, registering MCP servers at user scope, and health checks. Use when setting up a new machine, when MCP tools are registered but not loading into sessions, when the setup script fails, or when asked to bring a machine to parity with the repo.
---

# Harness Setup

Full reference tables (what gets installed where, setup flags, platform differences) live
in `README.md` at the repo root. Read the relevant section there rather than reproducing
it here. This skill covers the ordering and the gotchas that actually cost debugging time.

## Order of operations

1. **Clone and run the setup script.** `./setup.sh` on macOS/Linux, `.\setup.ps1` on
   Windows. This installs agents, rules, commands, contexts, hooks, skills, scripts, the
   learned-skills link, and merges the hooks block into `~/.claude/settings.json`. It does
   *not* register MCP servers.
2. **Preview first if unsure.** `./setup.sh --dry-run` (or `.\setup.ps1 -DryRun`) prints
   every write and symlink without applying any of them.
3. **Register MCP servers** you want, at user scope. See below and
   `examples/mcp-server-example.md`.
4. **Third-party skills and plugins.** Installed separately; the setup script does not
   manage them.
5. **Verify.** See below.

## The gotcha that matters most

**MCP servers MUST be registered at user scope**, via `claude mcp add <name> -s user`
with `-e KEY=value` for env vars, using absolute paths.

Project-scope `.mcp.json` servers show "Connected" in `claude mcp list` but their tools
silently never load into sessions. This failure mode is quiet and misleading: the server
looks healthy and the tools simply are not there.

```bash
# Server needing credentials, read from your own env file
claude mcp add my-server -s user -e "MY_API_KEY=$MY_API_KEY" -- /abs/path/to/python /abs/path/to/server.py

# Third-party server, no credentials
claude mcp add some-server -s user -- npx some-mcp-package@latest
```

## Platform gotchas

- **Windows requires a `cmd /c` wrapper** in the `command` field for Python servers:
  `-- cmd /c python C:\abs\path\to\server.py`. Without it the server fails to spawn.
- **Learned skills link**: symlink on macOS/Linux, junction on Windows. The setup script
  handles it. If `~/.claude/skills/learned/` already exists as a real directory, move its
  contents into `config/skills/learned/` first, or the script will replace it.
- **CLI tools that install by cloning over SSH** can fail on Windows with an SSH
  permission error. Force HTTPS for GitHub clones first:
  `git config --global url."https://github.com/".insteadOf "git@github.com:"`.

## Verify

```bash
node config/scripts/check-mcp-health.js   # MCP servers + CLI tools
node config/scripts/scan-mcp-tools.js     # tool-poisoning baseline (first run pins it)
ls ~/.claude/skills/learned/              # learned-skills link resolves
ls ~/.claude/scripts/hooks/               # hooks installed
```

Then start a session and confirm MCP tools actually appear. `claude mcp list` showing
"Connected" is not sufficient evidence, per the user-scope gotcha above.

## Credentials

Never print `.env` contents, tokens, or git remote URLs while debugging setup. If auth is
broken, tell the user what to run themselves. GitHub auto-revokes leaked tokens.
