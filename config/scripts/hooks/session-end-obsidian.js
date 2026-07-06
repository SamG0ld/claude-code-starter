#!/usr/bin/env node
/**
 * SessionEnd Hook — Update Obsidian project knowledge on session end
 *
 * Parses the session transcript and writes/updates:
 *   1. Development/<project>/Status.md — ephemeral session snapshot (overwritten)
 *   2. Development/Logs/YYYY-MM.md — append-only monthly session log
 *   3. Development/<project>/Session Insights.md — accumulated decisions & gotchas
 *
 * Insight extraction: scans user messages for decision/gotcha signal patterns
 * (keyword matching, no LLM). Also captures git commit messages. Deduplicates
 * against existing content. Enforces 20KB size cap (oldest entries trimmed).
 *
 * Project is determined from cwd → ~/Dev/<project-name>
 * Auto-maps any Dev project; override names via PROJECT_MAP in ../lib/obsidian.js
 * Vault path: OBSIDIAN_VAULT env var (strictly opt-in; no default)
 *
 * Skips gracefully if:
 *   - cwd is not under ~/Dev
 *   - No transcript available
 *   - Vault path doesn't exist
 */

const path = require("path");
const fs = require("fs");
const {
  getProjectRoot,
  getGitMainRoot,
  getDateString,
  getTimeString,
  readStdinJson,
  ensureDir,
  readFile,
  runCommand,
  log,
} = require("../lib/utils");
const {
  getVaultPath,
  getObsidianFolder,
  getObsidianLogPath,
  getMonthDisplayName,
} = require("../lib/obsidian");

const DEV_DIR = "Development";
const TIMEOUT_MS = 8000;
const INSIGHTS_MAX_BYTES = 20480; // 20KB cap for Session Insights.md

/**
 * Signal patterns that indicate a user message contains a decision, gotcha, or insight.
 * These are intentionally conservative to reduce noise.
 */
const INSIGHT_SIGNALS = [
  // Decisions
  /\b(decided|chose|switched|picking)\b.*\b(to|from|over|instead)\b/i,
  /\b(going with|went with|sticking with|moved to)\b/i,
  // Gotchas and corrections
  /\b(turns out|gotcha|watch out|careful|trap|pitfall)\b/i,
  /\b(that'?s not|it'?s not|it'?s actually|actually it'?s)\b.*\b(a |the |how |what |where )/i,
  /\b(wrong|broken|doesn'?t work)\b.*\b(because|since|due to)\b/i,
  // Directives
  /\b(don'?t use|never use|always use|must use)\b/i,
  /\b(don'?t|never|stop|quit)\b.*\b(do that|doing that|change|touch|modify|guess)\b/i,
  // Learnings
  /\b(learned|discovered|realized|figured out)\b/i,
  /\b(workaround|the fix was|root cause|the (real |actual )?problem)\b/i,
  /\b(because|the reason)\b.*\b(is that|was that|it'?s)\b/i,
  // Patterns and rules
  /\b(pattern|approach|convention)\b.*\b(is|should|must)\b/i,
  /\b(important:|note:|remember:|fyi:?)\b/i,
  /\b(from now on|going forward|in the future)\b/i,
];

/**
 * Extract meaningful session data from transcript
 */
function parseTranscript(transcriptPath) {
  const result = {
    userMessages: [],
    filesEdited: new Set(),
    filesCreated: new Set(),
    toolsUsed: new Set(),
    gitCommits: [],
    gitPushes: [],
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return result;
  }

  // Skip transcripts over 10MB to avoid memory exhaustion within 8s timeout
  const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size > MAX_TRANSCRIPT_BYTES) {
      log(
        `[Obsidian] Transcript too large (${(stat.size / 1024 / 1024).toFixed(1)}MB), skipping parse`,
      );
      return result;
    }
  } catch {
    return result;
  }

  try {
    const content = fs.readFileSync(transcriptPath, "utf8");
    const lines = content.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // User messages
        if (entry.type === "user" && entry.message?.content) {
          const msg = entry.message.content;
          if (
            typeof msg === "string" &&
            !msg.startsWith("<") &&
            msg.length > 10 &&
            msg.length < 500
          ) {
            result.userMessages.push(msg);
          }
        }

        // Tool usage from assistant messages
        if (
          entry.type === "assistant" &&
          entry.message?.content &&
          Array.isArray(entry.message.content)
        ) {
          for (const block of entry.message.content) {
            if (block.type !== "tool_use") continue;

            result.toolsUsed.add(block.name);

            if (block.name === "Edit" && block.input?.file_path) {
              result.filesEdited.add(block.input.file_path);
            }
            if (block.name === "Write" && block.input?.file_path) {
              result.filesCreated.add(block.input.file_path);
            }
          }
        }

        // Detect git commits and pushes from tool results
        if (entry.type === "tool_result") {
          const toolOutput = entry.tool_result?.output || "";
          const commitMatch = toolOutput.match(
            /^\[[\w-]+ ([a-f0-9]{7,})\] (.+)$/m,
          );
          if (commitMatch) {
            result.gitCommits.push({
              hash: commitMatch[1],
              message: commitMatch[2],
            });
          }
          if (/-> (main|master|origin)/.test(toolOutput)) {
            result.gitPushes.push(
              toolOutput.match(/([a-f0-9]{7,})\.\.([a-f0-9]{7,})/)?.[2] ||
                "pushed",
            );
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    log(`[Obsidian] Error parsing transcript: ${err.message}`);
  }

  return result;
}

/**
 * Best-effort current branch for cwd (worktree-aware label).
 */
function getBranch(cwd) {
  const r = runCommand(`git -C "${cwd}" rev-parse --abbrev-ref HEAD`);
  return r.success && r.output ? r.output.trim() : null;
}

/**
 * Build the worktree/branch label for the session heading. Shows the cwd
 * basename, prefixed "worktree: " when cwd is a linked worktree (its basename
 * differs from the main checkout's), plus the branch if known.
 */
function buildSessionLabel(cwd) {
  const resolvedCwd = path.resolve(cwd);
  const base = path.basename(resolvedCwd);
  const mainRoot = getGitMainRoot(cwd);
  // A linked worktree is a SIBLING of the main checkout, not a descendant — so
  // cwd is "a worktree" only when it sits outside the main root. A plain
  // subdirectory of the main repo is under mainRoot and must not be labeled one.
  const isWorktree =
    mainRoot &&
    resolvedCwd !== mainRoot &&
    !resolvedCwd.startsWith(mainRoot + path.sep);
  const branch = getBranch(cwd);
  const name = isWorktree ? `worktree: ${base}` : base;
  return branch ? `${name} @ ${branch}` : name;
}

/**
 * Build status markdown from parsed transcript.
 * Status.md is a fresh snapshot (overwritten each session); the date-headed
 * session label records which worktree/branch last wrote it.
 */
function buildStatusContent(parsed, sessionId, projectName, cwd) {
  const today = getDateString();
  const shortId = sessionId ? sessionId.slice(-8) : "unknown";
  const label = buildSessionLabel(cwd);

  // Build completed list from concrete actions
  const completed = [];

  for (const commit of parsed.gitCommits) {
    completed.push(`${commit.message} (\`${commit.hash}\`)`);
  }

  if (parsed.gitPushes.length > 0) {
    completed.push("Pushed to remote");
  }

  // Group file changes
  if (parsed.filesCreated.size > 0) {
    const created = Array.from(parsed.filesCreated)
      .filter((f) => !f.includes("node_modules") && !f.includes(".git"))
      .map((f) => path.basename(f));
    if (created.length > 0) {
      completed.push(`Created: ${created.join(", ")}`);
    }
  }

  if (parsed.filesEdited.size > 0) {
    const edited = Array.from(parsed.filesEdited)
      .filter((f) => !f.includes("node_modules") && !f.includes(".git"))
      .map((f) => path.basename(f));
    if (edited.length > 0) {
      completed.push(`Edited: ${edited.join(", ")}`);
    }
  }

  // Build user request summary for context
  const requests = parsed.userMessages.slice(-10);

  // Format the status note
  const completedList =
    completed.length > 0
      ? completed.map((c) => `- ${c}`).join("\n")
      : "- (auto-detected — check session transcript for details)";

  const requestList =
    requests.length > 0
      ? requests
          .map((r) => `- ${r.length > 120 ? r.slice(0, 120) + "..." : r}`)
          .join("\n")
      : "- (none captured)";

  const frontmatter = [
    "---",
    `tags: [development, status, ${projectName}]`,
    `project: ${projectName}`,
    `updated: "${today}"`,
    `session: "${shortId}"`,
    "---",
  ].join("\n");

  const body = [
    `# Status  (${projectName})`,
    "",
    `## ${today}  (session ${shortId}) — ${label}`,
    "",
    "### Completed",
    completedList,
    "",
    "### In Progress / Next Up / Gotchas",
    "- (update manually or in next session)",
    "",
    "### Session Requests",
    requestList,
  ].join("\n");

  return `${frontmatter}\n\n${body}\n`;
}

/**
 * Append a lean entry to the global monthly session log
 */
function appendToSessionLog(parsed, sessionId, projectName) {
  const logPath = getObsidianLogPath();
  if (!logPath) return;

  const today = getDateString();
  const time = getTimeString();
  const shortId = sessionId ? sessionId.slice(-8) : "unknown";

  // Build lean entry lines
  const details = [];

  for (const commit of parsed.gitCommits) {
    details.push(`- ${commit.message} (\`${commit.hash}\`)`);
  }

  if (parsed.gitPushes.length > 0) {
    details.push("- Pushed to remote");
  }

  const created = Array.from(parsed.filesCreated)
    .filter((f) => !f.includes("node_modules") && !f.includes(".git"))
    .map((f) => path.basename(f));
  if (created.length > 0) {
    details.push(`- Created: ${created.join(", ")}`);
  }

  const edited = Array.from(parsed.filesEdited)
    .filter((f) => !f.includes("node_modules") && !f.includes(".git"))
    .map((f) => path.basename(f));
  if (edited.length > 0) {
    details.push(`- Edited: ${edited.join(", ")}`);
  }

  // Condense user requests to 3 most recent, short
  const requests = parsed.userMessages
    .slice(-3)
    .map((r) => (r.length > 80 ? r.slice(0, 80) + "..." : r));
  if (requests.length > 0) {
    details.push(`- Requests: ${requests.map((r) => `"${r}"`).join(", ")}`);
  }

  // If somehow no details, skip
  if (details.length === 0) return;

  // Check if log file exists and if today's date header is already present
  ensureDir(path.dirname(logPath));
  const existing = readFile(logPath) || "";
  const dateHeader = `## ${today}`;

  let entry = "";

  if (existing.length === 0) {
    // New monthly log — add frontmatter and month header
    const monthName = getMonthDisplayName();
    entry += `---\ntags: [development, log]\n---\n\n# Session Log — ${monthName}\n\n`;
    entry += `${dateHeader}\n\n`;
  } else if (!existing.includes(dateHeader)) {
    // Existing log but new day — add date header
    entry += `\n${dateHeader}\n\n`;
  } else {
    // Same day — just append
    entry += "\n";
  }

  entry += `### ${time} — ${projectName} \`${shortId}\`\n`;
  entry += details.join("\n") + "\n";

  fs.appendFileSync(logPath, entry, "utf8");
  log(
    `[Obsidian] Appended to session log: Development/Logs/${path.basename(logPath)}`,
  );
}

/**
 * Extract insight-worthy messages from parsed user messages.
 * Returns array of strings — messages that match decision/gotcha signal patterns.
 */
function extractInsights(parsed) {
  const insights = [];

  // Negative patterns — filter out trivial matches
  const NOISE_FILTERS = [
    /^(yes|no|ok|sure|yeah|nah|do it|go ahead)\b/i,
    /^(read|check|look at|open|show|run|list)\b/i,
    /\b(the file|the directory|the path|the test)\b.*\b(at|in|from)\b/i,
  ];

  // Extract from user messages that match signal patterns
  for (const msg of parsed.userMessages) {
    if (msg.length < 30 || msg.length > 500) continue;
    if (msg.startsWith("<")) continue;
    if (msg.split(/\s+/).length < 5) continue; // require 5+ words

    const matchesSignal = INSIGHT_SIGNALS.some((pattern) => pattern.test(msg));
    if (!matchesSignal) continue;

    const isNoise = NOISE_FILTERS.some((pattern) => pattern.test(msg));
    if (isNoise) continue;

    // Clean up the message for storage
    const cleaned = msg.replace(/\s+/g, " ").trim();
    insights.push(`"${cleaned}"`);
  }

  // Include git commit messages as lightweight decision records
  for (const commit of parsed.gitCommits) {
    insights.push(`Commit: ${commit.message} (\`${commit.hash}\`)`);
  }

  return insights;
}

/**
 * Append extracted insights to Session Insights.md.
 * Creates the file if it doesn't exist. Enforces a size cap by removing
 * oldest date-headed blocks when the file exceeds INSIGHTS_MAX_BYTES.
 */
function appendInsights(insights, sessionId, projectDir, folderName) {
  if (insights.length === 0) return;

  const insightsPath = path.join(projectDir, "Session Insights.md");
  const today = getDateString();
  const shortId = sessionId ? sessionId.slice(-8) : "unknown";

  // Deduplicate against existing lines (exact match, not substring)
  const existing = readFile(insightsPath) || "";
  const existingLines = new Set(
    existing.split("\n").map((l) => l.replace(/^- /, "").trim()),
  );
  const newInsights = insights.filter((i) => !existingLines.has(i));
  if (newInsights.length === 0) {
    log("[Obsidian] All insights already present, skipping");
    return;
  }

  // Create file with frontmatter if it doesn't exist
  if (!existing) {
    const header = [
      "---",
      `tags: [development, insights, ${folderName}]`,
      `project: ${folderName}`,
      "---",
      "",
      "# Session Insights",
      "",
      "Auto-extracted decisions, gotchas, and patterns from coding sessions.",
      "",
      "---",
      "",
    ].join("\n");
    fs.writeFileSync(insightsPath, header, "utf8");
  }

  // Build entry
  let entry = `\n## ${today} (session ${shortId})\n\n`;
  for (const insight of newInsights) {
    entry += `- ${insight}\n`;
  }

  fs.appendFileSync(insightsPath, entry, "utf8");
  log(
    `[Obsidian] Appended ${newInsights.length} insights to Session Insights.md`,
  );

  // Enforce size cap
  enforceInsightsCap(insightsPath);
}

/**
 * Enforce the size cap on Session Insights.md by removing oldest
 * date-headed blocks until the file is under INSIGHTS_MAX_BYTES.
 */
function enforceInsightsCap(filePath) {
  const content = readFile(filePath);
  if (!content || Buffer.byteLength(content, "utf8") <= INSIGHTS_MAX_BYTES) {
    return;
  }

  // Split into header (before first date section) and date blocks
  const datePattern = /^## \d{4}-\d{2}-\d{2}/m;
  const firstMatch = content.match(datePattern);
  if (!firstMatch) return;

  const headerEnd = content.indexOf(firstMatch[0]);
  const header = content.slice(0, headerEnd);
  const body = content.slice(headerEnd);

  const blocks = body
    .split(/(?=^## \d{4}-\d{2}-\d{2})/m)
    .filter((b) => b.trim());

  // Remove oldest blocks from front until under cap — O(n) incremental
  const headerBytes = Buffer.byteLength(header, "utf8");
  const blockBytes = blocks.map((b) => Buffer.byteLength(b, "utf8"));
  let totalBytes = headerBytes + blockBytes.reduce((a, b) => a + b, 0);

  while (blocks.length > 1 && totalBytes > INSIGHTS_MAX_BYTES) {
    totalBytes -= blockBytes.shift();
    blocks.shift();
  }

  fs.writeFileSync(filePath, header + blocks.join(""), "utf8");
  log("[Obsidian] Trimmed Session Insights.md to stay under size cap");
}

async function main() {
  const input = await readStdinJson();

  const sessionId = input.session_id || "";
  const transcriptPath = input.transcript_path || "";
  const cwd = input.cwd || process.cwd();

  // Determine project from cwd (auto-maps any Dev project)
  const projectRoot = getProjectRoot(cwd);
  if (!projectRoot) {
    log("[Obsidian] Not in a ~/Dev project, skipping status update");
    process.exit(0);
  }

  const obsidianFolder = getObsidianFolder(cwd);
  if (!obsidianFolder) {
    log("[Obsidian] Could not resolve Obsidian folder");
    process.exit(0);
  }

  // Check vault exists
  const vaultPath = getVaultPath();
  if (!fs.existsSync(vaultPath)) {
    log(`[Obsidian] Vault not found at: ${vaultPath}`);
    process.exit(0);
  }

  const statusDir = path.join(vaultPath, DEV_DIR, obsidianFolder);
  const statusFile = path.join(statusDir, "Status.md");

  // Parse transcript
  const parsed = parseTranscript(transcriptPath);

  // Only update if there was meaningful activity
  const hasActivity =
    parsed.filesEdited.size > 0 ||
    parsed.filesCreated.size > 0 ||
    parsed.gitCommits.length > 0 ||
    parsed.userMessages.length > 2;

  if (!hasActivity) {
    log("[Obsidian] No meaningful activity detected, skipping status update");
    process.exit(0);
  }

  // Write status
  ensureDir(statusDir);
  const content = buildStatusContent(parsed, sessionId, obsidianFolder, cwd);
  fs.writeFileSync(statusFile, content, "utf8");
  log(`[Obsidian] Updated ${DEV_DIR}/${obsidianFolder}/Status.md`);

  // Append to global monthly session log
  appendToSessionLog(parsed, sessionId, obsidianFolder);

  // Extract and append session insights
  const insights = extractInsights(parsed);
  if (insights.length > 0) {
    appendInsights(insights, sessionId, statusDir, obsidianFolder);
  }

  process.exit(0);
}

const timeout = setTimeout(() => {
  log("[Obsidian] Timeout reached, exiting gracefully");
  process.exit(0);
}, TIMEOUT_MS);

main()
  .then(() => clearTimeout(timeout))
  .catch((err) => {
    clearTimeout(timeout);
    log(`[Obsidian] Error: ${err.message}`);
    process.exit(0);
  });
