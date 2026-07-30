#!/usr/bin/env bash
# Claude Code configuration installer
# Works on macOS and Linux. For Windows, use setup.ps1 or run via Git Bash/WSL.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

# Dry-run support: --dry-run flag or DRY_RUN=1 env var
DRY_RUN_FLAG=0
for arg in "$@"; do
  [ "$arg" = "--dry-run" ] && DRY_RUN_FLAG=1
done
[ "${DRY_RUN:-0}" = "1" ] && DRY_RUN_FLAG=1

if [ "$DRY_RUN_FLAG" = "1" ]; then
  echo "DRY-RUN MODE -- no files will be written, no symlinks created."
  echo "Re-run without --dry-run (or unset DRY_RUN) to actually apply."
  echo ""
fi

echo "Installing Claude Code configuration from $SCRIPT_DIR"
echo "Target: $CLAUDE_DIR"
echo ""

# Symlink capability probe. Runs ONCE, before any file is touched.
# On mac/linux this almost always succeeds, but can fail on read-only
# filesystems, permission issues, or target conflicts. The probe protects
# against `set -euo pipefail` halting the script after a destructive step.
CAN_SYMLINK=0
PROBE_DIR="${TMPDIR:-/tmp}"
PROBE_TARGET="$PROBE_DIR/claude-starter-symlink-probe-target.$$"
PROBE_LINK="$PROBE_DIR/claude-starter-symlink-probe-link.$$"
rm -f "$PROBE_LINK" 2>/dev/null
echo "probe" > "$PROBE_TARGET"
if ln -s "$PROBE_TARGET" "$PROBE_LINK" 2>/dev/null; then
  CAN_SYMLINK=1
  rm -f "$PROBE_LINK" "$PROBE_TARGET"
  echo "  Symlink capability: OK"
else
  rm -f "$PROBE_LINK" "$PROBE_TARGET" 2>/dev/null
  echo "  Symlink capability: UNAVAILABLE"
  echo "    CLAUDE.md and dev-layer files will be left in place. Investigate"
  echo "    filesystem/perms, then re-run setup.sh to create the symlinks."
fi
echo ""

# Create directories
if [ "$DRY_RUN_FLAG" = "1" ]; then
  for d in agents rules commands contexts scripts/hooks scripts/lib skills; do
    [ ! -d "$CLAUDE_DIR/$d" ] && echo "  WOULD create dir: $CLAUDE_DIR/$d"
  done
else
  mkdir -p "$CLAUDE_DIR"/{agents,rules,commands,contexts,scripts/hooks,scripts/lib,skills}
fi

# sync_dir <src_dir> <dst_dir> <glob>
# Copies files newer than dst (or all with FORCE=1), and removes files in dst
# that no longer exist in src (the repo is source of truth). Set NO_PRUNE=1 to
# keep stale files (e.g. if you have local-only commands you manage by hand).
sync_dir() {
  local src_dir="$1"
  local dst_dir="$2"
  local glob="$3"
  [ -d "$src_dir" ] || return 0
  [ "$DRY_RUN_FLAG" = "1" ] || mkdir -p "$dst_dir"

  local had_nullglob=0
  shopt -q nullglob && had_nullglob=1
  shopt -s nullglob

  for src in "$src_dir"/$glob; do
    local dst="$dst_dir/$(basename "$src")"
    if [ ! -f "$dst" ] || [ "$src" -nt "$dst" ] || [ "${FORCE:-}" = "1" ]; then
      if [ "$DRY_RUN_FLAG" = "1" ]; then
        echo "    WOULD copy: $(basename "$src") -> $dst"
      else
        cp "$src" "$dst"
      fi
    fi
  done

  if [ "${NO_PRUNE:-}" != "1" ]; then
    for dst in "$dst_dir"/$glob; do
      local src="$src_dir/$(basename "$dst")"
      if [ ! -f "$src" ]; then
        if [ "$DRY_RUN_FLAG" = "1" ]; then
          echo "    WOULD prune stale: $(basename "$dst")"
        else
          rm "$dst"
          echo "    Pruned stale: $(basename "$dst")"
        fi
      fi
    done
  fi

  [ "$had_nullglob" = "0" ] && shopt -u nullglob
}

# Agents
if [ -d "$SCRIPT_DIR/agents" ]; then
  sync_dir "$SCRIPT_DIR/agents" "$CLAUDE_DIR/agents" "*.md"
  echo "  Installed $(ls "$SCRIPT_DIR/agents/"*.md | wc -l | tr -d ' ') agents"
fi

# Skills (copy skill folders, but symlink learned/)
if [ -d "$SCRIPT_DIR/skills" ]; then
  for skill_dir in "$SCRIPT_DIR/skills/"*/; do
    [ -d "$skill_dir" ] || continue
    skill_name="$(basename "$skill_dir")"
    [ "$skill_name" = "learned" ] && continue
    skill_dest="$CLAUDE_DIR/skills/$skill_name"
    if [ "$DRY_RUN_FLAG" = "1" ]; then
      echo "    WOULD install skill: $skill_name"
    else
      # Remove the destination first. `cp -r src/ dest/` copies the source *into*
      # an existing dest/src rather than replacing it, which nested a fresh copy
      # one level deeper on every run (skills/foo/foo/foo/...).
      rm -rf "$skill_dest"
      cp -r "$skill_dir" "$skill_dest"
    fi
  done
  echo "  Installed skills"
fi

# Learned skills -- symlink so /learn saves to the repo and syncs across machines
LEARNED_TARGET="$SCRIPT_DIR/config/skills/learned"
LEARNED_LINK="$CLAUDE_DIR/skills/learned"
if [ -d "$LEARNED_TARGET" ]; then
  if [ -L "$LEARNED_LINK" ]; then
    existing="$(readlink "$LEARNED_LINK")"
    if [ "$existing" = "$LEARNED_TARGET" ]; then
      echo "  Learned skills symlink already exists"
    else
      rm "$LEARNED_LINK"
      ln -s "$LEARNED_TARGET" "$LEARNED_LINK"
      echo "  Updated learned skills symlink -> $LEARNED_TARGET (was $existing)"
    fi
  elif [ -d "$LEARNED_LINK" ]; then
    mv "$LEARNED_LINK" "${LEARNED_LINK}.bak"
    ln -s "$LEARNED_TARGET" "$LEARNED_LINK"
    echo "  Backed up learned/ to learned.bak/ and created symlink -> $LEARNED_TARGET"
  else
    ln -s "$LEARNED_TARGET" "$LEARNED_LINK"
    echo "  Created learned skills symlink -> $LEARNED_TARGET"
  fi
else
  echo "  Skipped learned skills (config/skills/learned/ not found -- will be created on first /learn)"
fi

# Rules
if [ -d "$SCRIPT_DIR/config/rules" ]; then
  sync_dir "$SCRIPT_DIR/config/rules" "$CLAUDE_DIR/rules" "*.md"
  echo "  Installed $(ls "$SCRIPT_DIR/config/rules/"*.md | wc -l | tr -d ' ') rules"
fi

# Commands
if [ -d "$SCRIPT_DIR/config/commands" ]; then
  sync_dir "$SCRIPT_DIR/config/commands" "$CLAUDE_DIR/commands" "*.md"
  echo "  Installed $(ls "$SCRIPT_DIR/config/commands/"*.md | wc -l | tr -d ' ') commands"
fi

# Contexts
if [ -d "$SCRIPT_DIR/config/contexts" ]; then
  sync_dir "$SCRIPT_DIR/config/contexts" "$CLAUDE_DIR/contexts" "*.md"
  echo "  Installed $(ls "$SCRIPT_DIR/config/contexts/"*.md | wc -l | tr -d ' ') contexts"
fi

# Scripts/hooks (js + py)
if [ -d "$SCRIPT_DIR/config/scripts" ]; then
  sync_dir "$SCRIPT_DIR/config/scripts/hooks" "$CLAUDE_DIR/scripts/hooks" "*.js"
  sync_dir "$SCRIPT_DIR/config/scripts/hooks" "$CLAUDE_DIR/scripts/hooks" "*.py"
  # Make .py hooks executable so shebang is honored on mac/linux
  chmod +x "$CLAUDE_DIR/scripts/hooks/"*.py 2>/dev/null || true
  sync_dir "$SCRIPT_DIR/config/scripts/lib" "$CLAUDE_DIR/scripts/lib" "*.js"
  # Standalone scripts (health check, MCP tool-poisoning scanner, injection audit)
  for s in check-mcp-health.js scan-mcp-tools.js audit-tool-responses.js; do
    [ -f "$SCRIPT_DIR/config/scripts/$s" ] && cp "$SCRIPT_DIR/config/scripts/$s" "$CLAUDE_DIR/scripts/"
  done
  echo "  Installed hook scripts"
fi

# Data files (regex patterns, etc.)
if [ -d "$SCRIPT_DIR/config/data" ]; then
  mkdir -p "$CLAUDE_DIR/data"
  cp "$SCRIPT_DIR/config/data/"* "$CLAUDE_DIR/data/"
  echo "  Installed data files"
fi

# Statusline (cross-platform Node.js version)
if [ -f "$SCRIPT_DIR/config/statusline.js" ]; then
  cp "$SCRIPT_DIR/config/statusline.js" "$CLAUDE_DIR/statusline.js"
  echo "  Installed statusline.js"
fi

# Settings -- surgical merge of canonical hooks + statusLine into local settings.json
# Preserves per-machine keys (model, enabledPlugins, voiceEnabled, extraKnownMarketplaces).
if [ "$DRY_RUN_FLAG" = "1" ]; then
  node "$SCRIPT_DIR/config/scripts/merge-hooks-settings.js" "$SCRIPT_DIR" --dry-run >/dev/null
else
  node "$SCRIPT_DIR/config/scripts/merge-hooks-settings.js" "$SCRIPT_DIR"
fi

# Symlink helper. Safety properties:
#   1. If symlink capability is not available, skip without touching $link_path.
#   2. Otherwise, create the symlink at a temp sibling path FIRST; only after
#      success do we back up or remove the original.
new_repo_symlink() {
  local link_path="$1"
  local target_path="$2"
  local label="$3"
  if [ ! -f "$target_path" ]; then
    echo "  Skipped $label symlink (source missing: $target_path)"
    return
  fi

  # SAFETY GATE: no capability -> do nothing destructive.
  if [ "$CAN_SYMLINK" != "1" ]; then
    echo "  Skipped $label symlink (no symlink capability)"
    return
  fi

  [ "$DRY_RUN_FLAG" = "1" ] || mkdir -p "$(dirname "$link_path")"

  # Short-circuit if link already correctly in place.
  if [ -L "$link_path" ]; then
    local existing
    existing="$(readlink "$link_path")"
    if [ "$existing" = "$target_path" ]; then
      echo "  $label symlink already in place"
      return
    fi
  fi

  if [ "$DRY_RUN_FLAG" = "1" ]; then
    echo "  WOULD create $label symlink -> $target_path"
    return
  fi

  # Create temp symlink FIRST. Only proceed if it works.
  local temp_link="${link_path}.symlinktmp-$(date +%Y%m%d%H%M%S)-$$"
  if ! ln -s "$target_path" "$temp_link" 2>/dev/null; then
    echo "  FAILED to create $label symlink (temp probe). Original at $link_path NOT touched."
    rm -f "$temp_link" 2>/dev/null
    return
  fi

  # Temp link exists. Now safe to deal with original.
  if [ -L "$link_path" ] || [ -e "$link_path" ]; then
    if [ -L "$link_path" ]; then
      rm "$link_path"
    else
      # Regular file. ALWAYS back up so audit trail is preserved.
      local backup="${link_path}.backup-$(date +%Y%m%d-%H%M%S)"
      mv "$link_path" "$backup"
      echo "  Backed up local $label to $(basename "$backup")"
    fi
  fi

  # Final atomic swap.
  mv "$temp_link" "$link_path"
  echo "  Created $label symlink -> $target_path"
}

# DEV_ROOT is where your project repos live. Defaults to the parent of this repo
# (e.g. ~/Dev when this clone is at ~/Dev/claude-code-starter). Override with
# DEV_ROOT=/path/to/dev to point dev-layer symlinks somewhere else.
DEV_ROOT="${DEV_ROOT:-$(dirname "$SCRIPT_DIR")}"

new_repo_symlink \
  "$CLAUDE_DIR/CLAUDE.md" \
  "$SCRIPT_DIR/config/CLAUDE.md" \
  "global CLAUDE.md"

if [ -d "$DEV_ROOT" ]; then
  new_repo_symlink \
    "$DEV_ROOT/CLAUDE.md" \
    "$SCRIPT_DIR/dev/CLAUDE.md" \
    "Dev-layer CLAUDE.md"

  # Dev-layer rules. Symlink every *.md in dev/rules/ so adding a rule needs no
  # edit here. Rules carrying `paths:` frontmatter load only when Claude touches
  # matching files; rules without it load on every session under DEV_ROOT.
  [ "$DRY_RUN_FLAG" = "1" ] || mkdir -p "$DEV_ROOT/.claude/rules"
  for rule in "$SCRIPT_DIR"/dev/rules/*.md; do
    [ -e "$rule" ] || continue
    rule_name="$(basename "$rule")"
    new_repo_symlink \
      "$DEV_ROOT/.claude/rules/$rule_name" \
      "$rule" \
      "Dev-layer rules/$rule_name"
  done

  # Prune stale rule symlinks: only those pointing into this repo's dev/rules/
  # whose target no longer exists. Leaves user-created files untouched.
  for link in "$DEV_ROOT"/.claude/rules/*.md; do
    [ -L "$link" ] || continue
    target="$(readlink "$link")"
    case "$target" in
      */dev/rules/*)
        if [ ! -e "$target" ]; then
          if [ "$DRY_RUN_FLAG" = "1" ]; then
            echo "  WOULD prune stale Dev-layer rule symlink: $(basename "$link")"
          else
            rm -f "$link"
            echo "  Pruned stale Dev-layer rule symlink: $(basename "$link")"
          fi
        fi
        ;;
    esac
  done
else
  echo "  Skipped dev-layer symlinks (DEV_ROOT does not exist: $DEV_ROOT)"
fi

echo ""
echo "Done. Restart Claude Code to pick up changes."
echo ""
echo "Optional next steps:"
echo "  - Set OBSIDIAN_VAULT env var if you use Obsidian for session-knowledge tracking"
echo "  - Set CLAUDE_TIMEZONE env var (e.g., America/New_York) to override system timezone"
echo "  - Set CLAUDE_DEV_ROOT env var if your projects live outside ~/Dev"
echo "  - Add MCP servers: see examples/mcp-server-example.md"
echo ""
echo "Tip: Re-run with FORCE=1 to overwrite all files regardless of timestamps"
echo "     Re-run with NO_PRUNE=1 to keep files in ~/.claude/ that aren't in this repo"
echo "     Re-run with --dry-run (or DRY_RUN=1) to preview changes without writing anything"
echo "     Set DEV_ROOT=path to override the dev-layer symlink target (default: parent of this repo)"
