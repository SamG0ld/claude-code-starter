# Performance Optimization

## Model Selection Strategy

Pick by tier, not version number. Use the latest model in each tier; check Anthropic's current model list for live IDs.

- **Opus** (top tier, deepest capability): main interactive sessions, the hardest reasoning and long-horizon agentic work, and the pinned tier for the heavyweight agents.
- **Sonnet** (strong coding tier): code review, database work, TDD, general coding throughput.
- **Haiku** (cheap, fast worker tier): frequently-invoked worker agents and mechanical tasks.

If a tier above Opus is available on the current plan (e.g. Fable/Mythos-class), use it for main interactive sessions; the agent pins below don't change.

### How this is applied

Models are pinned per-agent in each `.md` frontmatter (e.g. `model: sonnet`). Current tiering:
- **Opus**: architect, planner, security-reviewer, function-analyzer, adversarial-reviewer
- **Sonnet**: code-reviewer, database-reviewer, tdd-guide, semgrep-triager
- **Haiku**: build-error-resolver, doc-updater, e2e-runner, refactor-cleaner, semgrep-scanner

The main interactive session and the heavyweight agents both run Opus; nothing is pinned above it.

Precedence (per [Claude Code docs](https://code.claude.com/docs/en/agents.md#choose-a-model)): `CLAUDE_CODE_SUBAGENT_MODEL` env var, then per-call `model:` param, then agent frontmatter, then parent session model. Claude Code does not auto-downgrade subagents; tiering is explicit via frontmatter.

## Context Window Management

Avoid the last 20% of the context window for large refactors, multi-file feature work, and debugging complex interactions. Single-file edits, independent utilities, doc updates, and simple fixes are less sensitive.

## Plan Mode

For complex or hard-to-reverse work, use Plan Mode to structure the approach and get sign-off before editing. Current models think adaptively, so there's no need for manual "think harder" prompting.

## Build Troubleshooting

If a build fails, use the **build-error-resolver** agent: read the errors, fix incrementally, verify after each fix.
