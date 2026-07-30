# Agent Orchestration

## Available Agents

Located in `~/.claude/agents/`. Each agent pins a model in its frontmatter matched to task complexity (see `performance.md` for the tiering rationale).

| Agent | Model | Purpose | When to Use |
|-------|-------|---------|-------------|
| planner | Opus | Implementation planning | Complex features, refactoring |
| architect | Opus | System design | Architectural decisions |
| security-reviewer | Opus | Security analysis | Before commits; user input / auth / sensitive data |
| function-analyzer | Opus | Per-function deep analysis | Security audit context building |
| adversarial-reviewer | Opus | Adversarial stress-testing of claims/answers | Vetting important answers before acting (used by /challenge) |
| code-reviewer | Sonnet | Code review | After writing code |
| database-reviewer | Sonnet | PostgreSQL review | SQL / schema / migration work |
| tdd-guide | Sonnet | Test-driven development | New features, bug fixes |
| semgrep-triager | Sonnet | Classify semgrep findings | After semgrep-scanner runs |
| build-error-resolver | Haiku | Fix build errors | When build fails |
| refactor-cleaner | Haiku | Dead code cleanup | Code maintenance |
| doc-updater | Haiku | Documentation | Updating docs / codemaps |
| e2e-runner | Haiku | E2E testing | Critical user flows |
| semgrep-scanner | Haiku | Run semgrep scans | Static analysis |

Override per-call by passing a `model:` param at invocation when an agent needs bumping for a specific task.

## Built-in agents

Claude Code ships two read-only agents that need no definition here. Prefer them over a
custom agent when the task is plain search or planning, because they skip loading CLAUDE.md
and git status and so start cheaper.

| Agent | Use for |
|-------|---------|
| **Explore** | Broad fan-out search across many files or naming conventions when only the conclusion is needed. Specify breadth ("medium", "very thorough"). It locates code; it does not review it. |
| **Plan** | Designing an implementation strategy: step-by-step plans, critical files, architectural trade-offs. |

## Subagent vs agent team

Both parallelize, but they differ structurally:

- **Subagent**: own context, reports back to the caller, the lead manages all work. Lower
  token cost because only a summary returns. This is the right default.
- **Agent team**: fully independent sessions that message each other and share a task list.
  Higher cost, since each teammate is a separate instance. Worth it when teammates need to
  challenge each other or own separate pieces of a feature.

Agent teams are experimental and disabled by default. Reach for one only when parallel
subagents are already hitting context limits or genuinely need to talk to each other.

## When to reach for an agent
Some work is worth delegating without being asked:
- Complex feature request: **planner**
- Code just written or modified: **code-reviewer**
- Bug fix or new feature: **tdd-guide**
- Architectural decision: **architect**

Run independent agent tasks in parallel rather than sequentially (e.g. security analysis of one file, performance review of another, and type-checking a third, all in one batch).

## Subagents for context isolation
Subagents run with clean context windows. Use one when a task generates intermediate output you won't need again. The test: will I need this tool output again, or just the conclusion? If just the conclusion, delegate, and the intermediate noise stays in the child context.

Good candidates: verifying results against a spec, reviewing other codebases and synthesizing approaches, writing docs from git changes, running test suites and summarizing failures, scanning for patterns across many files.

Keep in the main context: debugging where you're iterating on the same code, implementation work where prior reads inform the next edit, conversations where earlier context matters.

Reference: [Claude Code: Session Management and 1M Context](https://claude.com/blog/using-claude-code-session-management-and-1m-context)

## Multi-perspective analysis
For complex problems, split-role subagents (factual reviewer, senior engineer, security expert, consistency and redundancy checks) can surface issues a single pass misses.
