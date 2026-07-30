# Verification

Claude stops when the work *looks* done. Without a check it can run, "looks done" is the
only signal available, and the user becomes the verification loop. Give the work a check
that returns pass or fail and the loop closes on its own.

A check is anything producing a readable signal: a test suite, a build exit code, a
linter, a script that diffs output against a fixture, a screenshot compared to a design.

## Pick the tier that matches the risk

| Approach | Who decides it's done | Use when |
|---|---|---|
| State the goal in the prompt, run the check in the same turn | Claude | Short task, user is watching and will notice an early stop |
| `/goal <condition>` | A separate evaluator, re-checked every turn | The user walks away, or the run is long enough that the goal drifts out of attention |
| `Stop` hook running a check script | The script, deterministically | The check must hold every time and is scriptable |

The middle tier is the one that matters for unattended work. `/goal` puts a different
process in the grading seat, so Claude's own "I think I'm finished" does not end the run.
Claude Code overrides a blocking Stop hook after 8 consecutive blocks, so a Stop-hook gate
is a strong gate, not an infinite one.

For a task the user is actively watching, stating the goal is enough. `/goal` is overhead
there, not insurance.

## Before saying it's done

Show the evidence, do not assert the outcome. Paste the test output, the command and what
it returned, the file that now exists. Reviewing evidence is faster than re-running the
verification, and it is the only thing that works for a session the user did not watch.

If a step was skipped or a test fails, say so plainly with the output. A green summary
over a red run destroys the ability to walk away at all, which is the whole point of this
file.

## Independent review

The agent that wrote the code is the wrong one to grade it. For anything non-trivial,
have a fresh context check the diff: the bundled `/code-review` for correctness, or a
subagent told what to check it against (a plan, a spec, the stated requirements).

A reviewer asked to find gaps will find some, because that is what it was asked to do.
Scope it to correctness and stated requirements, and treat style commentary as optional,
or it turns into over-engineering.
