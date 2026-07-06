/**
 * Cross-platform utility functions for Claude Code hooks and scripts
 * Works on Windows, macOS, and Linux
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// Platform detection
const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

/**
 * Get the user's home directory (cross-platform)
 */
function getHomeDir() {
  return os.homedir();
}

/**
 * Get the Claude config directory
 */
function getClaudeDir() {
  return path.join(getHomeDir(), '.claude');
}

/**
 * DEV_ROOTS — directories that contain projects. cwd must be under one of
 * these to be considered "in a project." Add your project directories here,
 * or set CLAUDE_DEV_ROOT to add one via the environment.
 */
const DEV_ROOTS = [
  path.join(getHomeDir(), 'Dev'),
  ...(process.env.CLAUDE_DEV_ROOT ? [process.env.CLAUDE_DEV_ROOT] : [])
];

/**
 * Directory names (lowercase) that are *containers* for projects rather than
 * projects themselves. This is now a BACKSTOP only: project resolution is
 * git-first (see getProjectRoot), so a real repo or a CLAUDE.md-marked folder
 * is detected without any allowlist. PARENT_DIRS only catches the residual
 * case of a nested child that has neither git nor a CLAUDE.md, so it still
 * gets its own folder instead of collapsing to the container name.
 *
 * Example: ~/Dev/<parent>/ contains both `website/` and `app/` — list
 * '<parent>' here so each child keeps its own folder. Add entries as needed.
 */
const PARENT_DIRS = new Set([]);

/**
 * Resolve the main repo root behind cwd via git's common dir.
 *
 * `git rev-parse --git-common-dir` returns the *shared* .git of the main
 * checkout — for a normal repo it's that repo's .git, for a subdirectory it
 * resolves upward, and for a linked worktree it points at the MAIN checkout's
 * .git (not the worktree's). The parent of the common dir is therefore the one
 * true project root for repos, subdirs, and all worktrees alike.
 *
 * Returns an absolute path, or null if cwd is not in a git repo.
 */
function getGitMainRoot(cwd) {
  const dir = cwd || process.cwd();
  const result = runCommand(
    `git -C "${dir}" rev-parse --path-format=absolute --git-common-dir`
  );
  if (result.success && result.output) {
    const commonDir = result.output.trim();
    if (commonDir) {
      return path.dirname(path.resolve(commonDir));
    }
  }
  // No git binary, or git < 2.31 (--path-format=absolute was added in 2.31.0),
  // or the command otherwise failed — parse .git ourselves.
  return getGitMainRootNoBinary(dir);
}

/**
 * Fallback for getGitMainRoot when the git binary is unavailable.
 * Walks up from startDir to the nearest `.git`:
 *   - `.git` is a directory → repo root is its parent (the dir holding .git).
 *   - `.git` is a file      → linked worktree; follow the `gitdir:` pointer to
 *     the worktree's git dir, read its `commondir` to reach the main .git, and
 *     return that .git's parent (the main checkout root).
 * Returns null if no `.git` is found below the filesystem root.
 */
function getGitMainRootNoBinary(startDir) {
  let dir = path.resolve(startDir);

  for (;;) {
    const gitPath = path.join(dir, '.git');
    let stat = null;
    try {
      stat = fs.statSync(gitPath);
    } catch {
      stat = null;
    }

    if (stat && stat.isDirectory()) {
      return dir; // .git dir lives at the repo root
    }

    if (stat && stat.isFile()) {
      try {
        const content = fs.readFileSync(gitPath, 'utf8');
        const m = content.match(/^gitdir:\s*(.+?)\s*$/m);
        if (m) {
          // worktree git dir, e.g. <main>/.git/worktrees/<name>. The commondir
          // file points back to the main .git (usually "../.."). If it is
          // missing — which never happens for a git-created worktree — fall
          // back to that standard two-levels-up location so we still resolve to
          // <main>/.git rather than a path the caller's guard would reject.
          const worktreeGitDir = path.resolve(dir, m[1].trim());
          let commonDir = path.resolve(worktreeGitDir, '..', '..');
          try {
            const rel = fs.readFileSync(
              path.join(worktreeGitDir, 'commondir'),
              'utf8'
            ).trim();
            commonDir = path.resolve(worktreeGitDir, rel);
          } catch {
            // keep the standard-layout fallback computed above
          }
          return path.dirname(commonDir);
        }
      } catch {
        // Unreadable .git file — give up on this level.
      }
      return null;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
}

/**
 * Walk up from startDir to (but excluding) devRoot, returning the nearest
 * ancestor that contains a CLAUDE.md — a first-class "this is a project root"
 * marker for projects with no git yet. Dirs whose basename is a known
 * container (parentDirs) are skipped so a container's CLAUDE.md never claims
 * its children. devRoot itself is excluded, so DEV_ROOT/CLAUDE.md can never
 * make all of Dev one project.
 *
 * Returns an absolute path, or null.
 */
function findMarkerDir(startDir, devRoot, parentDirs) {
  const root = path.resolve(devRoot);
  let dir = path.resolve(startDir);

  while (dir !== root && dir.startsWith(root + path.sep)) {
    const base = path.basename(dir).toLowerCase();
    if (!parentDirs.has(base) && fs.existsSync(path.join(dir, 'CLAUDE.md'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Pure project-root decision logic. IO (git, filesystem, the root list) is
 * injected so this can be unit-tested deterministically across platforms.
 *
 * Resolution order:
 *   1. cwd must be under a DEV_ROOT (and not BE one) — else null.
 *   2. Git pass (primary): main repo root behind cwd. Covers repos, subdirs,
 *      and all worktrees → main checkout.
 *   3. Marker pass: nearest ancestor with a CLAUDE.md (no-git projects).
 *   4. Allowlist backstop: descend one level under a known container dir.
 *   5. Fallback: first path segment under DEV_ROOT (legacy behavior).
 *
 * Future opt-out lever (not yet implemented): a `.not-a-project` sentinel file
 * or `claude-project: false` frontmatter could let a CLAUDE.md-bearing
 * subfolder decline to be its own project.
 */
function _resolveProjectRoot(cwd, opts) {
  if (!cwd) return null;
  const { devRoots, parentDirs, gitMainRoot, findMarkerDir: findMarker } = opts;

  const normalizedCwd = path.resolve(cwd);

  // 1. Find the DEV_ROOT containing cwd.
  let devRoot = null;
  for (const dr of devRoots) {
    const ndr = path.resolve(dr);
    if (normalizedCwd === ndr || normalizedCwd.startsWith(ndr + path.sep)) {
      devRoot = ndr;
      break;
    }
  }
  if (!devRoot) return null;
  if (normalizedCwd === devRoot) return null; // DEV_ROOT itself is never a project

  // A candidate root is usable only if it sits strictly under THIS DEV_ROOT.
  // Guards bare repos / out-of-tree git roots (e.g. mainRoot === DEV_ROOT).
  const usable = (p) => !!p && p !== devRoot && p.startsWith(devRoot + path.sep);

  // 2. Git pass (primary) — covers repos, subdirs, and worktrees.
  const mainRoot = gitMainRoot(normalizedCwd);
  if (usable(mainRoot)) return mainRoot;

  // 3. Marker pass — no-git projects identified by a CLAUDE.md.
  const marker = findMarker(normalizedCwd, devRoot, parentDirs);
  if (usable(marker)) return marker;

  // 4. Allowlist backstop + 5. fallback (first segment under DEV_ROOT).
  const parts = path.relative(devRoot, normalizedCwd).split(path.sep);
  if (parentDirs.has(parts[0].toLowerCase()) && parts.length >= 2) {
    return path.join(devRoot, parts[0], parts[1]);
  }
  return path.join(devRoot, parts[0]);
}

/**
 * Get the project root if cwd is under any DEV_ROOT. Returns null otherwise.
 * Git-first (worktree-aware), then CLAUDE.md marker, then PARENT_DIRS backstop.
 */
function getProjectRoot(cwd) {
  return _resolveProjectRoot(cwd, {
    devRoots: DEV_ROOTS,
    parentDirs: PARENT_DIRS,
    gitMainRoot: getGitMainRoot,
    findMarkerDir,
  });
}

/**
 * Get the git repository name — the MAIN repo's basename, so worktrees report
 * the same identity as their main checkout (not the worktree dir name).
 */
function getGitRepoName(cwd = process.cwd()) {
  const mainRoot = getGitMainRoot(cwd);
  return mainRoot ? path.basename(mainRoot) : null;
}

/**
 * Get project name from the git main root, falling back to the cwd basename.
 */
function getProjectName(cwd = process.cwd()) {
  return getGitRepoName(cwd) || path.basename(path.resolve(cwd)) || null;
}

/**
 * Get the sessions directory
 * If cwd is provided and is under Dev, returns project-specific sessions dir
 * Otherwise returns global sessions dir
 */
function getSessionsDir(cwd) {
  const projectRoot = getProjectRoot(cwd);

  if (projectRoot) {
    return path.join(projectRoot, '.claude', 'sessions');
  }

  return path.join(getClaudeDir(), 'sessions');
}

/**
 * Get the learned skills directory
 */
function getLearnedSkillsDir() {
  return path.join(getClaudeDir(), 'skills', 'learned');
}

/**
 * Get the temp directory (cross-platform)
 */
function getTempDir() {
  return os.tmpdir();
}

/**
 * Ensure a directory exists (create if not)
 * @param {string} dirPath - Directory path to create
 * @returns {string} The directory path
 * @throws {Error} If directory cannot be created (e.g., permission denied)
 */
function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    // EEXIST is fine (race condition with another process creating it)
    if (err.code !== 'EEXIST') {
      throw new Error(`Failed to create directory '${dirPath}': ${err.message}`);
    }
  }
  return dirPath;
}

/**
 * Get the configured timezone.
 * Uses CLAUDE_TIMEZONE env var, falls back to system default.
 */
function getTimezone() {
  return process.env.CLAUDE_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Get current date in YYYY-MM-DD format (configured timezone)
 */
function getDateString() {
  const tz = getTimezone();
  const now = new Date();
  const localized = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const year = localized.getFullYear();
  const month = String(localized.getMonth() + 1).padStart(2, '0');
  const day = String(localized.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get current time in HH:MM format (configured timezone)
 */
function getTimeString() {
  const tz = getTimezone();
  const now = new Date();
  const localized = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const hours = String(localized.getHours()).padStart(2, '0');
  const minutes = String(localized.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Get short session ID from CLAUDE_SESSION_ID environment variable
 * Returns last 8 characters, falls back to project name then 'default'
 */
function getSessionIdShort(fallback = 'default') {
  const sessionId = process.env.CLAUDE_SESSION_ID;
  if (sessionId && sessionId.length > 0) {
    return sessionId.slice(-8);
  }
  return getProjectName() || fallback;
}

/**
 * Get current datetime in YYYY-MM-DD HH:MM:SS format (configured timezone)
 */
function getDateTimeString() {
  const tz = getTimezone();
  const now = new Date();
  const localized = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const year = localized.getFullYear();
  const month = String(localized.getMonth() + 1).padStart(2, '0');
  const day = String(localized.getDate()).padStart(2, '0');
  const hours = String(localized.getHours()).padStart(2, '0');
  const minutes = String(localized.getMinutes()).padStart(2, '0');
  const seconds = String(localized.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Find files matching a pattern in a directory (cross-platform alternative to find)
 * @param {string} dir - Directory to search
 * @param {string} pattern - File pattern (e.g., "*.tmp", "*.md")
 * @param {object} options - Options { maxAge: days, recursive: boolean }
 */
function findFiles(dir, pattern, options = {}) {
  if (!dir || typeof dir !== 'string') return [];
  if (!pattern || typeof pattern !== 'string') return [];

  const { maxAge = null, recursive = false } = options;
  const results = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  // Escape all regex special characters, then convert glob wildcards.
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexPattern}$`);

  function searchDir(currentDir) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isFile() && regex.test(entry.name)) {
          let stats;
          try {
            stats = fs.statSync(fullPath);
          } catch {
            continue; // File deleted between readdir and stat
          }

          if (maxAge !== null) {
            const ageInDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
            if (ageInDays <= maxAge) {
              results.push({ path: fullPath, mtime: stats.mtimeMs });
            }
          } else {
            results.push({ path: fullPath, mtime: stats.mtimeMs });
          }
        } else if (entry.isDirectory() && recursive) {
          searchDir(fullPath);
        }
      }
    } catch (_err) {
      // Ignore permission errors
    }
  }

  searchDir(dir);

  // Sort by modification time (newest first)
  results.sort((a, b) => b.mtime - a.mtime);

  return results;
}

/**
 * Read JSON from stdin (for hook input)
 * @param {object} options - Options
 * @param {number} options.timeoutMs - Timeout in milliseconds (default: 5000).
 * @returns {Promise<object>} Parsed JSON object, or empty object if stdin is empty
 */
async function readStdinJson(options = {}) {
  const { timeoutMs = 5000, maxSize = 1024 * 1024 } = options;

  return new Promise((resolve) => {
    let data = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          resolve(data.trim() ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      }
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (data.length < maxSize) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });

    process.stdin.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({});
    });
  });
}

/**
 * Log to stderr (visible to user in Claude Code)
 */
function log(message) {
  console.error(message);
}

/**
 * Output to stdout (returned to Claude)
 */
function output(data) {
  if (typeof data === 'object') {
    console.log(JSON.stringify(data));
  } else {
    console.log(data);
  }
}

/**
 * Read a text file safely
 */
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Write a text file
 */
function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Append to a text file
 */
function appendFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, content, 'utf8');
}

/**
 * Check if a command exists in PATH
 * Uses execFileSync to prevent command injection
 */
function commandExists(cmd) {
  // Validate command name - only allow alphanumeric, dash, underscore, dot
  if (!/^[a-zA-Z0-9_.-]+$/.test(cmd)) {
    return false;
  }

  try {
    if (isWindows) {
      const result = spawnSync('where', [cmd], { stdio: 'pipe' });
      return result.status === 0;
    } else {
      const result = spawnSync('which', [cmd], { stdio: 'pipe' });
      return result.status === 0;
    }
  } catch {
    return false;
  }
}

/**
 * Run a command and return output
 *
 * SECURITY NOTE: This function executes shell commands. Only use with
 * trusted, hardcoded commands. Never pass user-controlled input directly.
 *
 * @param {string} cmd - Command to execute (should be trusted/hardcoded)
 * @param {object} options - execSync options
 */
function runCommand(cmd, options = {}) {
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options
    });
    return { success: true, output: result.trim() };
  } catch (err) {
    return { success: false, output: err.stderr || err.message };
  }
}

/**
 * Check if current directory is a git repository
 */
function isGitRepo() {
  return runCommand('git rev-parse --git-dir').success;
}

/**
 * Get git modified files, optionally filtered by regex patterns
 * @param {string[]} patterns - Array of regex pattern strings to filter files.
 *   Invalid patterns are silently skipped.
 * @returns {string[]} Array of modified file paths
 */
function getGitModifiedFiles(patterns = []) {
  if (!isGitRepo()) return [];

  const result = runCommand('git diff --name-only HEAD');
  if (!result.success) return [];

  let files = result.output.split('\n').filter(Boolean);

  if (patterns.length > 0) {
    // Pre-compile patterns, skipping invalid ones
    const compiled = [];
    for (const pattern of patterns) {
      if (typeof pattern !== 'string' || pattern.length === 0) continue;
      try {
        compiled.push(new RegExp(pattern));
      } catch {
        // Skip invalid regex patterns
      }
    }
    if (compiled.length > 0) {
      files = files.filter(file => compiled.some(regex => regex.test(file)));
    }
  }

  return files;
}

/**
 * Replace text in a file (cross-platform sed alternative)
 * @param {string} filePath - Path to the file
 * @param {string|RegExp} search - Pattern to search for
 * @param {string} replace - Replacement string
 * @param {object} options - Options
 * @param {boolean} options.all - When true and search is a string, replaces ALL occurrences
 * @returns {boolean} true if file was written, false on error
 */
function replaceInFile(filePath, search, replace, options = {}) {
  const content = readFile(filePath);
  if (content === null) return false;

  try {
    let newContent;
    if (options.all && typeof search === 'string') {
      newContent = content.replaceAll(search, replace);
    } else {
      newContent = content.replace(search, replace);
    }
    writeFile(filePath, newContent);
    return true;
  } catch (err) {
    log(`[Utils] replaceInFile failed for ${filePath}: ${err.message}`);
    return false;
  }
}

/**
 * Count occurrences of a pattern in a file
 * @param {string} filePath - Path to the file
 * @param {string|RegExp} pattern - Pattern to count
 * @returns {number} Number of matches found
 */
function countInFile(filePath, pattern) {
  const content = readFile(filePath);
  if (content === null) return 0;

  let regex;
  try {
    if (pattern instanceof RegExp) {
      regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    } else if (typeof pattern === 'string') {
      regex = new RegExp(pattern, 'g');
    } else {
      return 0;
    }
  } catch {
    return 0;
  }
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Search for pattern in file and return matching lines with line numbers
 */
function grepFile(filePath, pattern) {
  const content = readFile(filePath);
  if (content === null) return [];

  let regex;
  try {
    regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  } catch {
    return [];
  }
  const lines = content.split('\n');
  const results = [];

  lines.forEach((line, index) => {
    if (regex.test(line)) {
      results.push({ lineNumber: index + 1, content: line });
    }
  });

  return results;
}

module.exports = {
  // Platform info
  isWindows,
  isMacOS,
  isLinux,

  // Directories
  getHomeDir,
  getClaudeDir,
  getSessionsDir,
  getProjectRoot,
  _resolveProjectRoot,
  getGitMainRoot,
  getGitMainRootNoBinary,
  findMarkerDir,
  getLearnedSkillsDir,
  getTempDir,
  ensureDir,
  DEV_ROOTS,
  PARENT_DIRS,

  // Date/Time
  getTimezone,
  getDateString,
  getTimeString,
  getDateTimeString,

  // Session/Project
  getSessionIdShort,
  getGitRepoName,
  getProjectName,

  // File operations
  findFiles,
  readFile,
  writeFile,
  appendFile,
  replaceInFile,
  countInFile,
  grepFile,

  // Hook I/O
  readStdinJson,
  log,
  output,

  // System
  commandExists,
  runCommand,
  isGitRepo,
  getGitModifiedFiles
};
