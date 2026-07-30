---
name: security-scan
description: "Hybrid security scanner: regex fallback + static analysis tools + LLM triage. Supports --quick, --deep, --diff, --path flags."
argument-hint: "[--quick | --deep] [--diff] [--path <dir>]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Task
---

# Hybrid Security Scan

> This file is the **executable pipeline** run by `/security-scan`. The companion
> reference doc (architecture, coverage tiers, how to read provenance labels and
> severity, limitations) is the `security-scan` skill at `skills/security-scan/SKILL.md`.
> They are not duplicates; do not delete either.

**Arguments:** $ARGUMENTS

You are executing a hybrid security scanning pipeline. Parse the arguments and
run through each phase below. Adapt based on which tools are available and which
flags are set.

## Argument Parsing

Parse `$ARGUMENTS` for these flags:
- `--quick` — Regex-only scan, skip external tools and LLM triage (~30s)
- `--deep` — Full scan with delegated triage via semgrep-triager agent
- `--diff` — Only scan files changed vs the main branch (auto-detect: main or master)
- `--path <dir>` — Restrict scan scope to a specific directory
- No flags = **standard mode** (all available tools + inline LLM triage)

If `--path` is not provided, use the current working directory.

---

## Phase 0: Recon

### 0a. Detect Installed Tools

Check for each tool and record version. Run these checks in parallel:

```bash
semgrep --version 2>/dev/null
gitleaks version 2>/dev/null
trivy --version 2>/dev/null
bandit --version 2>/dev/null
gosec --version 2>/dev/null || go env GOPATH 2>/dev/null && test -f "$(go env GOPATH)/bin/gosec" 2>/dev/null
```

Record results in a tool inventory object:
```
tool_inventory = {
  semgrep: { available: bool, version: string },
  gitleaks: { available: bool, version: string },
  trivy: { available: bool, version: string },
  bandit: { available: bool, version: string },
  gosec: { available: bool, version: string }
}
```

Determine coverage tier:
- Tier 0 (~35%): No tools available
- Tier 1 (~55%): semgrep available
- Tier 2 (~75%): semgrep + gitleaks available
- Tier 3 (~85%): semgrep + gitleaks + (trivy or bandit or gosec)

### 0b. Detect Tech Stack

Use Glob to find project indicators and determine:
- **Languages**: Check for `*.py`, `*.js`, `*.ts`, `*.go`, `*.java`, `*.rb`, `*.php`, `*.cs`, `*.rs`
- **Frameworks**: Check for:
  - `package.json` (Node.js) — inspect for express, react, next, angular, vue
  - `requirements.txt` / `pyproject.toml` / `Pipfile` (Python) — inspect for django, flask, fastapi
  - `go.mod` (Go)
  - `Gemfile` (Ruby/Rails)
  - `pom.xml` / `build.gradle` (Java)
  - `Cargo.toml` (Rust)
  - `composer.json` (PHP)
- **Infrastructure**: Check for `Dockerfile`, `docker-compose.yml`, `*.tf`, `*.yaml`/`*.yml` in `.github/`, `k8s/`

Record the detected stack for framework-aware triage in Phase 3.

### 0c. Determine File Scope

If `--diff` flag is set:
```bash
# Detect default branch
git rev-parse --verify main 2>/dev/null && echo main || echo master
# Get changed files
git diff --name-only <default-branch>...HEAD
```

If `--path <dir>` is set, restrict all scanning to that directory.

Otherwise, scan the entire project directory (respecting .gitignore).

Print a summary:
```
=== Security Scan: Recon Complete ===
Mode: [quick|standard|deep]
Scope: [N files | diff: N changed files | path: <dir>]
Stack: [detected languages and frameworks]
Tools: [list available tools] (Tier N, ~XX% coverage)
```

---

## Phase 1: Scan

### 1a. Regex Pattern Scan (Always Runs)

Load patterns from the `security-regex-patterns.json` data file (located in
`config/data/` in this repo, installed to `~/.claude/data/`).

For each file in scope:
1. Read the file content
2. Determine applicable patterns based on file extension:
   - `.py` → patterns with `python` or `*` in languages
   - `.js` → patterns with `javascript` or `*` in languages
   - `.ts`/`.tsx` → patterns with `typescript` or `*` in languages
   - `.go` → patterns with `go` or `*` in languages
   - `.java` → patterns with `java` or `*` in languages
   - `.php` → patterns with `php` or `*` in languages
   - `.rb` → patterns with `ruby` or `*` in languages
   - `.cs` → patterns with `csharp` or `*` in languages
   - Other → patterns with `*` in languages only
3. Use Grep with each applicable pattern against the file
4. Record matches with file path, line number, matched text, and pattern metadata

Skip these paths during regex scanning:
- `node_modules/`, `vendor/`, `venv/`, `.venv/`, `__pycache__/`
- `.git/`, `.next/`, `dist/`, `build/`, `out/`, `target/`
- `*.min.js`, `*.min.css`, `*.map`, `*.lock`
- Binary files (images, fonts, compiled artifacts)
- Files listed in `.gitignore`

For efficiency with large codebases:
- Process files in batches by language
- Use Grep with the `glob` parameter to filter file types
- Limit to first 50 matches per pattern (cap runaway patterns)

**If `--quick` mode**: Skip to Phase 4 after regex scan. Do not run external tools.

### 1b. Semgrep Scan (if available, not --quick)

If semgrep is available:

```bash
# Create output directory
mkdir -p .security

# Run with auto-config for broad coverage
semgrep --config auto --metrics=off --json -o .security/semgrep-results.json <target_path> 2>/dev/null
```

If `--deep` mode, delegate to the `semgrep-scanner` agent with comprehensive rulesets:
- `p/default` (general security)
- `p/owasp-top-ten`
- `p/secrets`
- `p/javascript` / `p/typescript` / `p/python` / `p/golang` (per detected stack)
- `p/react` / `p/django` / `p/flask` / `p/express` (per detected framework)

### 1c. Gitleaks Scan (if available, not --quick)

If gitleaks is available:

```bash
# Scan current state
gitleaks detect --source <target_path> --report-format json --report-path .security/gitleaks-results.json --no-banner 2>/dev/null

# If --deep, also scan git history
gitleaks detect --source <target_path> --log-opts="--all" --report-format json --report-path .security/gitleaks-history.json --no-banner 2>/dev/null
```

### 1d. Trivy Scan (if available, not --quick)

If trivy is available and `package.json`/`requirements.txt`/`go.mod` exists:

```bash
trivy fs --format json --output .security/trivy-results.json --severity HIGH,CRITICAL <target_path> 2>/dev/null
```

### 1e. Language-Specific Scans (if available, not --quick)

**Bandit** (if Python files detected and bandit available):
```bash
bandit -r <target_path> -f json -o .security/bandit-results.json --severity-level medium 2>/dev/null
```

**Gosec** (if Go files detected and gosec available):
```bash
gosec -fmt=json -out=.security/gosec-results.json ./... 2>/dev/null
```

---

## Phase 2: Correlate

Normalize all findings into a unified format:

```json
{
  "id": "<pattern-id or tool-rule-id>",
  "source": "<tool-name or regex>",
  "provenance": "[Static: <source>]",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "cwe": "CWE-XXX",
  "file": "path/to/file.ext",
  "line": 42,
  "column": 10,
  "title": "Short description",
  "description": "Detailed explanation",
  "snippet": "the matched code line",
  "classification": null
}
```

### Deduplication Rules

When multiple tools flag the same location:
1. **Exact match**: Same file + line + CWE → keep highest-confidence source (tool > regex), merge metadata
2. **Overlapping**: Same file + line, different CWE → keep both (different vulnerability types)
3. **Adjacent**: Same file, lines within 3 of each other, same CWE → merge into single finding, note both sources

### Suppression Check

Load `.security/suppressions.json` if it exists. Remove any finding where:
- `finding.id` matches `suppression.id` AND
- `finding.file` matches `suppression.file`

Track suppressed findings separately for the report.

Write the normalized findings to `.security/findings-raw.json`.

---

## Phase 3: Triage (skip if --quick)

### LLM Classification

For each finding, classify as one of:
- `TRUE_POSITIVE` — Confirmed vulnerability requiring remediation
- `FALSE_POSITIVE` — Not actually vulnerable in context
- `NEEDS_REVIEW` — Uncertain, requires human judgment

### Triage Decision Process

For each finding, read the source code context (5-10 lines before and after).
Apply these checks in order:

1. **Test file?** → `FALSE_POSITIVE` (pattern: `test/`, `tests/`, `__tests__/`, `spec/`, `*.test.*`, `*.spec.*`)
2. **Example/documentation?** → `FALSE_POSITIVE` (pattern: `examples/`, `docs/`, `*.example.*`)
3. **Generated/vendored code?** → `FALSE_POSITIVE` (pattern: `generated/`, `vendor/`, auto-generated headers)
4. **Has suppression comment?** → `FALSE_POSITIVE` (pattern: `nosemgrep`, `noqa`, `# nosec`, `// nolint`, `NOLINT`)
5. **Framework-safe pattern?** → Check the framework-aware rules below
6. **Input sanitized upstream?** → Read 10-20 lines before for validation/sanitization
7. **Dead code?** → Check if function is called/exported
8. **None of the above** → `TRUE_POSITIVE`

When uncertain, classify as `NEEDS_REVIEW`. Never silently dismiss findings.

### Framework-Aware Suppressions

Apply these ONLY when the corresponding framework was detected in Phase 0:

| Framework | Pattern | Suppress When |
|-----------|---------|---------------|
| Django | SQLI-* | Query uses ORM methods (`.filter()`, `.exclude()`, `.get()`, `.values()`) |
| Rails | SQLI-* | Query uses ActiveRecord (`.where()`, `.find_by()`, `.pluck()`) |
| React | XSS-001, XSS-003 | Value is in JSX expression `{}` (React auto-escapes) |
| Express + Helmet | HEADER-001 | `helmet` is in package.json dependencies |
| SQLAlchemy | SQLI-* | Query uses session.query() with model attributes |
| Prisma | SQLI-* | Query uses Prisma client methods (not `$queryRaw`) |
| Flask + WTForms | XSS-* | Template uses `{{ }}` Jinja2 auto-escaping |

### Deep Mode Delegation

If `--deep` mode and semgrep findings exist, delegate triage of semgrep findings
to the `semgrep-triager` agent:

> **Task for semgrep-triager**: Triage the findings in `.security/semgrep-results.json`.
> Write classified results to `.security/semgrep-triage.json`.
> See the agent definition at `agents/semgrep-triager.md` for the full workflow.

Continue triaging regex and other tool findings inline while the agent works.

Write all classified findings to `.security/findings-triaged.json`.

---

## Phase 4: Report

### Generate Markdown Report

Write the report to `.security/scan-report-YYYY-MM-DD.md` (use today's date).

Use this structure:

```markdown
# Security Scan Report

**Date:** YYYY-MM-DD
**Mode:** [quick|standard|deep]
**Scope:** [full project | diff vs main | path: <dir>]
**Coverage Tier:** Tier N (~XX%)
**Tools Used:** [list of tools that ran]

## Summary

| Severity | True Positives | Needs Review | False Positives | Suppressed |
|----------|---------------|--------------|-----------------|------------|
| CRITICAL | N | N | N | N |
| HIGH     | N | N | N | N |
| MEDIUM   | N | N | N | N |
| LOW      | N | N | N | N |
| **Total** | **N** | **N** | **N** | **N** |

**Risk Assessment:** [CRITICAL / HIGH / MEDIUM / LOW / CLEAN]
Based on: [highest severity TRUE_POSITIVE or NEEDS_REVIEW finding]

## Critical Findings

### [Finding Title] — [provenance label]
- **Severity:** CRITICAL
- **CWE:** CWE-XXX
- **File:** `path/to/file.ext:line`
- **Classification:** TRUE_POSITIVE | NEEDS_REVIEW

**Description:** [What the vulnerability is]

**Code:**
[Relevant code snippet, 3-5 lines of context]

**Remediation:** [Specific fix guidance]

---

## High Findings
[Same format as Critical]

## Medium Findings
[Same format, can be condensed into a table for many findings]

## Low Findings
[Table format]

| ID | File | Line | Description | Classification |
|----|------|------|-------------|----------------|
| ... | ... | ... | ... | ... |

## Suppressed Findings

| ID | File | Reason | Suppressed By |
|----|------|--------|---------------|
| ... | ... | ... | ... |

## False Positives

<details>
<summary>N findings classified as false positives (click to expand)</summary>

| ID | File | Line | Reason |
|----|------|------|--------|
| ... | ... | ... | ... |

</details>

## Recommendations

1. [Prioritized remediation steps]
2. [Tool installation suggestions if coverage < Tier 3]
3. [Process improvements]

## Coverage Notes

- **Tools available:** [list]
- **Tools missing:** [list with install commands]
- **Detection gaps:** [what is NOT covered at current tier]
```

### Console Summary

After writing the report, print a concise summary to the conversation:

```
=== Security Scan Complete ===
Risk: [CRITICAL|HIGH|MEDIUM|LOW|CLEAN]
Findings: N true positives, N needs review, N false positives, N suppressed
  CRITICAL: N | HIGH: N | MEDIUM: N | LOW: N
Coverage: Tier N (~XX%)
Report: .security/scan-report-YYYY-MM-DD.md

[If CRITICAL findings exist:]
BLOCKING: N critical findings must be resolved before merge.

[If tools are missing:]
TIP: Install [tools] to increase coverage to Tier N (~XX%).
  [one-liner install commands]
```

---

## Important Notes

1. **Never expose secrets in output.** If a regex matches an actual secret, show only the first 4 and last 4 characters with `****` in between. For example: `ghp_Abc1****xyz9`
2. **Respect .gitignore.** Do not scan ignored files unless explicitly requested.
3. **Create .security/ directory** at the project root if it does not exist.
4. **Do not modify source code.** This command is read-only analysis. Fixes are a separate step.
5. **Handle large projects gracefully.** If more than 500 files are in scope, process in batches and prioritize high-risk file types (auth, API routes, config) first.
6. **Cross-platform paths.** Use forward slashes in all output. Normalize Windows backslashes.
7. **If no findings at all**, still generate a report confirming the clean scan with coverage notes.
