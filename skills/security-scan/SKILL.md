---
name: security-scan
description: >
  Hybrid security scanning pipeline that combines static analysis tools with
  LLM-powered triage. Provides zero-dependency regex fallback for environments
  without security tooling installed. Use when performing security scans,
  interpreting scan results, understanding coverage tiers, or triaging
  vulnerability findings. Triggers on: "security scan", "vulnerability scan",
  "secret detection", "static analysis", "security pipeline", "SAST".
---

# Hybrid Security Scanning — Skill Reference

> This file is the **reference doc**. The executable pipeline that actually runs the
> scan lives at `config/commands/security-scan.md` and is invoked with `/security-scan`.
> They are not duplicates; do not delete either.

## Architecture Overview

The hybrid security scanner combines automated static analysis tools with
LLM-based triage to produce high-signal vulnerability reports. It operates
as a 5-phase pipeline:

```
Phase 0: Recon         Detect tools + tech stack
Phase 1: Scan          Run tools + regex fallback
Phase 2: Correlate     Normalize + deduplicate
Phase 3: Triage        LLM classifies findings
Phase 4: Report        Markdown report + artifacts
```

### Design Principles

1. **Graceful degradation** — works with zero tools installed via regex fallback
2. **Provenance tracking** — every finding labeled with its source
3. **Framework-aware triage** — suppresses known-safe patterns per framework
4. **Cross-platform** — Windows (Git Bash), macOS, Linux
5. **Deterministic pipeline** — same inputs produce same outputs (excluding LLM triage)

## Coverage Tiers

| Tier | Tools Available | Estimated Coverage | Typical Scan Time |
|------|----------------|-------------------|-------------------|
| 0 — Regex Only | None | ~35% | 15-30s |
| 1 — +Semgrep | semgrep | ~55% | 1-3 min |
| 2 — +Secrets | semgrep + gitleaks | ~75% | 2-5 min |
| 3 — Full Stack | semgrep + gitleaks + trivy + bandit/gosec | ~85% | 3-8 min |

Coverage percentages are approximate and represent the proportion of OWASP
Top 10 vulnerability classes that can be detected. No automated scanner
achieves 100% — manual review is always required for complete coverage.

### What Each Tool Covers

| Tool | Detects | Install |
|------|---------|---------|
| **Regex patterns** | Hardcoded secrets, obvious injection patterns, dangerous functions, weak crypto | Built-in (zero-dep) |
| **Semgrep** | Taint tracking, data flow, framework-specific rules, OWASP patterns | `pip install semgrep` or `brew install semgrep` |
| **Gitleaks** | Secrets in code and git history, entropy-based detection | `brew install gitleaks` or download binary |
| **Trivy** | Dependency vulnerabilities (CVEs), misconfigurations, license issues | `brew install trivy` or download binary |
| **Bandit** | Python-specific security issues (B1xx-B7xx) | `pip install bandit` |
| **Gosec** | Go-specific security issues | `go install github.com/securego/gosec/v2/cmd/gosec@latest` |

## Scan Modes

### Quick Mode (`--quick`)
- Phases 0 + 1 (regex only) + 4
- Skips external tools and LLM triage
- Best for: pre-commit checks, rapid feedback, CI pipelines

### Standard Mode (default)
- All 5 phases
- Runs all available tools + regex
- LLM triage by the executing Claude instance
- Best for: regular development workflow, PR reviews

### Deep Mode (`--deep`)
- All 5 phases with enhanced scanning
- Delegates triage to the `semgrep-triager` agent for parallel processing
- Uses `semgrep-scanner` agent for comprehensive ruleset coverage
- Best for: pre-release audits, security-sensitive changes

## Regex Pattern Library

The scanner includes 53+ regex patterns in `config/data/security-regex-patterns.json`
organized by vulnerability class:

| Category | Pattern Count | Severity Range |
|----------|--------------|----------------|
| Hardcoded Secrets | 18 | CRITICAL-HIGH |
| SQL Injection | 5 | CRITICAL-HIGH |
| Command Injection | 3 | CRITICAL-HIGH |
| XSS | 6 | HIGH-MEDIUM |
| Dangerous Functions | 7 | HIGH |
| Weak Cryptography | 5 | HIGH-MEDIUM |
| TLS Verification | 3 | HIGH |
| Debug/Config | 3 | HIGH-MEDIUM |
| Path Traversal | 2 | HIGH |
| SSRF | 1 | HIGH |
| Authentication | 2 | CRITICAL |
| CORS | 2 | HIGH-MEDIUM |
| Other (NoSQL, SSTI, logging, etc.) | 5+ | CRITICAL-LOW |

Each pattern includes:
- **CWE mapping** for compliance reporting
- **Language applicability** for targeted scanning
- **Severity classification** aligned with CVSS qualitative ratings

## Framework-Aware Triage

The LLM triage phase suppresses known-safe patterns:

| Framework | Suppressed Pattern | Reason |
|-----------|-------------------|--------|
| Django ORM | `.filter()`, `.exclude()`, `.get()` | ORM parameterizes queries automatically |
| Rails ActiveRecord | `.where()`, `.find_by()` | ActiveRecord parameterizes by default |
| React JSX | Dynamic values in JSX `{}` | React escapes by default (not innerHTML) |
| Express + Helmet | Missing security headers | Helmet middleware adds headers |
| SQLAlchemy | `.query.filter()` | ORM parameterizes queries |
| Prisma | `prisma.model.findMany()` | Query builder is injection-safe |

## Suppression System

Users can suppress known false positives via `.security/suppressions.json`:

```json
{
  "suppressions": [
    {
      "id": "SECRET-014",
      "file": "tests/fixtures/mock-data.ts",
      "reason": "Test fixture with fake password",
      "author": "developer@example.com",
      "date": "2026-03-16"
    }
  ]
}
```

Suppressions are:
- Scoped to specific file + pattern ID
- Require a documented reason
- Tracked in the scan report under "Suppressed Findings"

## Artifacts

The scanner writes artifacts to `.security/`:

```
.security/
  scan-report-YYYY-MM-DD.md    # Human-readable report
  findings-raw.json             # All raw findings before triage
  findings-triaged.json         # Findings with triage classification
  suppressions.json             # User-maintained suppressions
  tool-inventory.json           # Detected tools and versions
```

## Interpreting Results

### Finding Classifications

| Classification | Meaning | Action |
|---------------|---------|--------|
| `TRUE_POSITIVE` | Confirmed vulnerability | Fix before merge |
| `FALSE_POSITIVE` | Not actually vulnerable | Optionally add suppression |
| `NEEDS_REVIEW` | Uncertain — requires human judgment | Manual review required |

### Severity Levels

| Severity | CVSS Range | SLA Guidance |
|----------|-----------|--------------|
| CRITICAL | 9.0-10.0 | Fix immediately, block merge |
| HIGH | 7.0-8.9 | Fix before production deploy |
| MEDIUM | 4.0-6.9 | Fix within current sprint |
| LOW | 0.1-3.9 | Track and fix when convenient |

### Provenance Labels

Every finding carries a provenance label indicating its source:

- `[Static: semgrep]` — Semgrep rule match
- `[Static: gitleaks]` — Gitleaks secret detection
- `[Static: trivy]` — Trivy vulnerability/misconfiguration
- `[Static: bandit]` — Bandit Python check
- `[Static: gosec]` — Gosec Go check
- `[Static: regex]` — Built-in regex pattern match
- `[LLM: triage]` — LLM classification annotation

## Integration with Other Agents

| Agent | Role in Pipeline |
|-------|-----------------|
| `semgrep-scanner` | Deep mode: runs comprehensive semgrep rulesets in parallel |
| `semgrep-triager` | Deep mode: classifies semgrep findings with source context |
| `security-reviewer` | Standalone: manual OWASP review (complementary, not part of pipeline) |
| `code-reviewer` | Can invoke security scan as part of review workflow |

## Limitations

1. **Regex patterns have high false-positive rates** — they lack data flow analysis
2. **No runtime analysis** — this is purely static; DAST requires separate tooling
3. **LLM triage is probabilistic** — confidence varies by vulnerability type
4. **Git history scanning** requires gitleaks — regex only scans current files
5. **Dependency scanning** requires trivy — regex cannot detect vulnerable versions
6. **Coverage gaps** in binary formats, minified code, and generated files
