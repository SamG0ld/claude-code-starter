---
description: Run the full ship-loop — scope lock, ground-truth pre-flight, isolated worktree, gated implement, review, rebase, squash-merge, cleanup
argument-hint: "<issue/track/feature to ship>"
---

# Ship

**Arguments:** $ARGUMENTS

Execute the ship-loop for the scope named above. Be terse and checklist-driven: execute each stage, report the result, no commentary.

## Hard rules (violating any of these is a failed run)

- **Never enter or modify another session's worktree or branch.** Other Claude sessions may be running in parallel; their worktrees are off-limits.
- **Never infer repo state from Status.md, memory, or session context.** Only live git output counts.
- **Scope is a named list, not a vibe.** If the request is ambiguous ("do those"), resolve it to explicit item names with the user before stage 1.
- If a gate fails twice on the same error, stop and report — don't try workaround variants.

## Stages

1. **Scope lock** — Restate the exact scope as a list. State what is explicitly OUT (adjacent tracks, refactors, drive-by fixes). Get confirmation if anything was ambiguous.
2. **Ground-truth pre-flight** — Verify live state: `git status`, `git worktree list`, `git fetch` then ahead/behind vs origin, target branch merge state, related open PRs (`gh pr list`). List every assumption with the evidence backing it.
3. **Isolated worktree** — Create a fresh worktree + branch for this scope. Confirm no other worktree already owns these files.
4. **Implement** — In-scope changes only. Follow the repo's own CLAUDE.md conventions.
5. **Gate** — Run tests, typecheck, and build. All must pass before proceeding.
6. **Review** — Run the native /code-review on the diff (fall back to invoking the code-reviewer agent if the command is unavailable). Fix critical and high findings; re-gate after fixes.
7. **Rebase** — Rebase onto latest main. If conflict resolution touched code, re-run stage 5.
8. **Merge** — Push, open PR (summary + test plan), squash-merge, close the linked issue.
9. **Cleanup** — Delete the branch and worktree, prune remotes. Verify with `git worktree list` and `git branch -a` that nothing lingers.

## Final report

One status table: stage | result | evidence (commit SHA, PR #, test counts). Nothing else.
