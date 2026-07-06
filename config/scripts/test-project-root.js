#!/usr/bin/env node
/**
 * Tests for git-first, worktree-aware project-root resolution in lib/utils.js.
 *
 * Plain node + assert; prints a per-test line and exits non-zero on any failure.
 *   Run:  node config/scripts/test-project-root.js
 *
 * NOTE: this file lives at config/scripts/ (NOT hooks/ or lib/) on purpose —
 * setup.ps1/setup.sh only copy hooks/*.js, lib/*.js, and three named standalone
 * scripts to ~/.claude/scripts/, and only prune within those globs. So this
 * test is never deployed and never pruned.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  _resolveProjectRoot,
  getGitMainRoot,
  getGitMainRootNoBinary,
  findMarkerDir,
} = require("./lib/utils");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL   ${name}: ${err.message}`);
  }
}

// --- helpers ---------------------------------------------------------------

// Resolve through symlinks so macOS /var -> /private/var doesn't break equality.
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}
function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function touch(p) {
  fs.writeFileSync(p, "");
}
function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
function withTmp(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "caa-projroot-"));
  try {
    fn(base);
  } finally {
    rmrf(base);
  }
}

// ===========================================================================
// 1. Decision core: _resolveProjectRoot with INJECTED probes (deterministic,
//    no git, no filesystem). Exercises the resolution-order logic directly.
// ===========================================================================

const DEV = path.resolve(path.join(os.tmpdir(), "caa-projroot-fixture-dev"));
const P = (...segs) => path.join(DEV, ...segs);
const PARENTS = new Set(["shc"]);

function resolve(cwd, { git = () => null, marker = () => null } = {}) {
  return _resolveProjectRoot(cwd, {
    devRoots: [DEV],
    parentDirs: PARENTS,
    gitMainRoot: git,
    findMarkerDir: marker,
  });
}

console.log("# decision matrix (_resolveProjectRoot, injected probes)");

test("main repo → itself", () => {
  const root = P("defcon-defacement");
  assert.strictEqual(resolve(root, { git: () => root }), root);
});

test("sibling worktree → main root", () => {
  const main = P("defcon-defacement");
  const wt = P("defcon-defacement-featX");
  // git resolves a worktree's common-dir parent to the MAIN root
  assert.strictEqual(resolve(wt, { git: () => main }), main);
});

test("subdir of worktree → main root", () => {
  const main = P("defcon-defacement");
  const sub = P("defcon-defacement-featX", "src", "deep");
  assert.strictEqual(resolve(sub, { git: () => main }), main);
});

test("no-git + CLAUDE.md → marker dir", () => {
  const proj = P("jobs", "secstudy");
  assert.strictEqual(
    resolve(proj, { git: () => null, marker: () => proj }),
    proj,
  );
});

test("own top-level git repo → itself", () => {
  const root = P("jobhunt");
  assert.strictEqual(resolve(root, { git: () => root }), root);
});

test("SHC/website as its own git repo → SHC/website", () => {
  const root = P("SHC", "website");
  assert.strictEqual(resolve(root, { git: () => root }), root);
});

test("SHC child, no git, no marker → allowlist backstop split", () => {
  const cwd = P("SHC", "website");
  assert.strictEqual(resolve(cwd, { git: () => null, marker: () => null }), cwd);
});

test("DEV_ROOT itself → null", () => {
  assert.strictEqual(resolve(DEV, { git: () => null }), null);
});

test("outside any DEV_ROOT → null", () => {
  const outside = path.resolve(path.join(os.tmpdir(), "caa-elsewhere", "proj"));
  assert.strictEqual(resolve(outside, { git: () => outside }), null);
});

test("git root above DEV_ROOT is rejected → falls through to fallback", () => {
  // e.g. a stray .git one level up; mainRoot would be DEV's parent.
  const cwd = P("jobhunt");
  const bogus = path.dirname(DEV);
  assert.strictEqual(resolve(cwd, { git: () => bogus }), P("jobhunt"));
});

test("non-container nested, no git, no marker → first segment (fallback)", () => {
  // 'jobs' is NOT in PARENT_DIRS, so without a marker it collapses to 'jobs'.
  // (Dropping a CLAUDE.md into the child is the documented fix.)
  const cwd = P("jobs", "secstudy");
  assert.strictEqual(
    resolve(cwd, { git: () => null, marker: () => null }),
    P("jobs"),
  );
});

// ===========================================================================
// 2. findMarkerDir against real filesystem fixtures.
// ===========================================================================

console.log("# findMarkerDir (filesystem fixtures)");

test("nearest ancestor with CLAUDE.md wins", () => {
  withTmp((dev) => {
    const proj = path.join(dev, "proj");
    const sub = path.join(proj, "src", "deep");
    mkdirp(sub);
    touch(path.join(proj, "CLAUDE.md"));
    assert.strictEqual(real(findMarkerDir(sub, dev, PARENTS)), real(proj));
  });
});

test("DEV_ROOT/CLAUDE.md is excluded (never collapse all of Dev)", () => {
  withTmp((dev) => {
    const child = path.join(dev, "plainchild");
    mkdirp(child);
    touch(path.join(dev, "CLAUDE.md")); // only DEV_ROOT has a marker
    assert.strictEqual(findMarkerDir(child, dev, PARENTS), null);
  });
});

test("container dir (PARENT_DIRS) never claims its children", () => {
  withTmp((dev) => {
    const shc = path.join(dev, "shc");
    const website = path.join(shc, "website");
    mkdirp(website);
    touch(path.join(shc, "CLAUDE.md")); // container marked, child not
    assert.strictEqual(findMarkerDir(website, dev, PARENTS), null);
  });
});

test("child with its own CLAUDE.md under a container is returned", () => {
  withTmp((dev) => {
    const website = path.join(dev, "shc", "website");
    mkdirp(website);
    touch(path.join(website, "CLAUDE.md"));
    assert.strictEqual(real(findMarkerDir(website, dev, PARENTS)), real(website));
  });
});

// ===========================================================================
// 3. getGitMainRootNoBinary: the no-git-binary .git parser (worktree handling).
// ===========================================================================

console.log("# getGitMainRootNoBinary (.git parsing without git binary)");

test(".git directory → its parent is the root", () => {
  withTmp((base) => {
    const main = path.join(base, "main");
    mkdirp(path.join(main, ".git"));
    mkdirp(path.join(main, "src"));
    assert.strictEqual(
      real(getGitMainRootNoBinary(path.join(main, "src"))),
      real(main),
    );
  });
});

test("worktree .git file → main checkout root", () => {
  withTmp((base) => {
    const main = path.join(base, "main");
    const wtGitDir = path.join(main, ".git", "worktrees", "feat");
    mkdirp(wtGitDir);
    // commondir points from <main>/.git/worktrees/feat back to <main>/.git
    fs.writeFileSync(path.join(wtGitDir, "commondir"), "../..\n");
    const wt = path.join(base, "main-feat");
    mkdirp(wt);
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${wtGitDir}\n`);
    assert.strictEqual(real(getGitMainRootNoBinary(wt)), real(main));
  });
});

test("no .git anywhere → null", () => {
  withTmp((base) => {
    const proj = path.join(base, "proj", "src");
    mkdirp(proj);
    assert.strictEqual(getGitMainRootNoBinary(proj), null);
  });
});

// ===========================================================================
// 4. Real-git integration (skipped if no git binary). Exercises the PRIMARY
//    git common-dir path end-to-end against an actual worktree.
// ===========================================================================

console.log("# real git worktree integration");

const hasGit =
  spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;

if (!hasGit) {
  console.log("  skip   git binary not found");
} else {
  test("real worktree + subdir resolve to main checkout root", () => {
    withTmp((base) => {
      const main = path.join(base, "main");
      mkdirp(main);

      const git = (args, opts = {}) => {
        const r = spawnSync("git", ["-C", main, ...args], {
          encoding: "utf8",
          ...opts,
        });
        if (r.status !== 0) {
          throw new Error(`git ${args.join(" ")}: ${(r.stderr || r.stdout || "").trim()}`);
        }
        return r.stdout;
      };

      // Minimal repo with one commit (config local to avoid touching globals).
      spawnSync("git", ["init", main], { stdio: "ignore" });
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test"]);
      git(["config", "commit.gpgsign", "false"]);
      fs.writeFileSync(path.join(main, "f.txt"), "hi");
      git(["add", "-A"]);
      git(["commit", "-m", "init"]);

      // Linked worktree as a sibling dir (git creates it).
      const wt = path.join(base, "main-feat");
      git(["worktree", "add", "-b", "feat", wt]);

      const mainReal = real(main);
      assert.strictEqual(real(getGitMainRoot(main)), mainReal, "main → main");
      assert.strictEqual(real(getGitMainRoot(wt)), mainReal, "worktree → main");

      const sub = path.join(wt, "sub");
      mkdirp(sub);
      assert.strictEqual(
        real(getGitMainRoot(sub)),
        mainReal,
        "worktree subdir → main",
      );
    });
  });
}

// --- summary ---------------------------------------------------------------

console.log("");
if (failures.length) {
  console.log(`${passed} passed, ${failures.length} FAILED`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
