#!/usr/bin/env node
/**
 * block_vault_writes.js — PreToolUse hook: enforce Obsidian-MCP-only vault access.
 *
 * WHY THIS EXISTS
 * ---------------
 * When an Obsidian vault is sync'd (Obsidian Sync, iCloud, Dropbox, etc.),
 * direct filesystem writes to it cause real problems: binaries (PDFs, xlsx,
 * docx) dropped in and replicated everywhere, unilateral file moves that
 * disrupt the vault's organization, and Bash being used for vault interaction
 * when the Obsidian MCP exists.
 *
 * A memory-rule alone isn't enough — the model doesn't reliably honor "never do
 * X" instructions in the heat of a task. This hook is the enforcement layer: it
 * fails the tool call before any bytes hit the filesystem, and the stderr
 * message redirects the model to the right tool.
 *
 * WHAT IT DOES
 * ------------
 * Blocks Write/Edit/NotebookEdit/Bash whenever the target is inside the Obsidian
 * vault, regardless of file extension. Allows everything outside the vault to
 * pass through. The block message names the mcp__obsidian__* tool to use instead.
 *
 * VAULT PATH RESOLUTION
 * ---------------------
 * Strictly opt-in via the OBSIDIAN_VAULT environment variable — the same pattern
 * as config/scripts/lib/obsidian.js. If OBSIDIAN_VAULT is unset, this hook has
 * no vault to guard and no-ops (allows everything). Point it at your vault to
 * enable the guard.
 *
 * HOOK SPEC
 * ---------
 * - stdin: JSON payload with tool_name, tool_input
 * - exit 0: allow (no output)
 * - exit 2 + stderr: block; stderr is shown to the model so it can self-correct
 * - Fail-open: empty/unparseable stdin or any internal error → exit 0 (allow).
 */

const path = require('path');

const ALLOWED_EXTENSIONS = new Set(['.md', '.canvas', '.base']);

function normalize(p) {
  return String(p == null ? '' : p)
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\/+$/, '');
}

function loadVaultPrefixes() {
  const envVault = process.env.OBSIDIAN_VAULT;
  if (!envVault) return [];
  const n = normalize(envVault);
  return n ? [n] : [];
}

const VAULT_PREFIXES = loadVaultPrefixes();

function isVaultPath(p) {
  if (!p) return false;
  const n = normalize(p);
  return VAULT_PREFIXES.some((prefix) => n === prefix || n.startsWith(prefix + '/'));
}

function vaultPathsInCommand(cmd) {
  if (!cmd) return [];
  const nCmd = String(cmd).replace(/\\/g, '/').toLowerCase();
  return VAULT_PREFIXES.filter((prefix) => nCmd.includes(prefix));
}

function getExtension(p) {
  return path.extname(String(p || '')).toLowerCase();
}

const MCP_GUIDE = [
  'Use Obsidian MCP tools instead:',
  '  - mcp__obsidian__write_note (create/overwrite/append/prepend)',
  '  - mcp__obsidian__patch_note (incremental edits)',
  '  - mcp__obsidian__read_note / read_multiple_notes',
  '  - mcp__obsidian__list_directory',
  '  - mcp__obsidian__search_notes',
  '  - mcp__obsidian__move_note / move_file / delete_note',
  '  - mcp__obsidian__update_frontmatter / get_frontmatter',
  'See ~/.claude/CLAUDE.md "Always use the available MCP" for the full rule.',
].join('\n');

function block(reason) {
  process.stderr.write(`[block_vault_writes] ${reason}\n\n${MCP_GUIDE}`, () =>
    process.exit(2)
  );
}

function allow() {
  process.exit(0);
}

function run(raw) {
  if (!raw || !raw.trim()) return allow();

  // No vault configured → nothing to guard.
  if (VAULT_PREFIXES.length === 0) return allow();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return allow();
  }

  const toolName = payload.tool_name || '';
  const toolInput = payload.tool_input || {};

  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') {
    const p = toolInput.file_path || toolInput.notebook_path || '';
    if (!isVaultPath(p)) return allow();
    const ext = getExtension(p);
    if (ALLOWED_EXTENSIONS.has(ext)) {
      return block(
        `BLOCKED: ${toolName} on vault path '${p}'. ` +
          `Even for .md/.canvas/.base files inside the vault, use the Obsidian MCP ` +
          `so writes go through the proper API.`
      );
    }
    return block(
      `BLOCKED: ${toolName} on vault path '${p}' with disallowed ` +
        `extension '${ext || '(none)'}'. The vault is for Obsidian-native files only ` +
        `(${[...ALLOWED_EXTENSIONS].sort().join(', ')}). ` +
        `Document types like .pdf/.xlsx/.docx/.csv must NOT be placed in the vault. ` +
        `Move them to an out-of-vault location and reference by external path ` +
        `from the markdown note.`
    );
  }

  if (toolName === 'Bash') {
    const cmd = toolInput.command || '';
    const hits = vaultPathsInCommand(cmd);
    if (hits.length) {
      return block(
        `BLOCKED: Bash command references the Obsidian vault ` +
          `(${hits[0]}). All vault interaction must go through the Obsidian MCP — ` +
          `do not use cp/mv/rm/cat/ls/echo/redirects against vault paths.`
      );
    }
  }

  return allow();
}

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  if (data.length < 2_000_000) data += c;
});
process.stdin.on('end', () => {
  try {
    run(data);
  } catch {
    allow(); // a gate bug must never break a session
  }
});
process.stdin.on('error', allow);
