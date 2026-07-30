---
description: Adversarially stress-test a claim, answer, or research conclusion using three parallel reviewers (provenance, counter-case, search completeness) plus a synthesis verdict. Use before acting on research output, before an irreversible or expensive decision, or when an answer looks too clean and confident for how hard the question was.
argument-hint: "<claim or conclusion to stress-test>"
---

# /challenge — adversarial review of an answer or claim

Runs an adversarial fan-out against a claim, answer, or research conclusion to flush out confidently-wrong content **before** acting on it. Three parallel reviewers attack the target from different angles (provenance, counter-case, search completeness), then a synthesis pass produces a single verdict.

Use this when:
- You've just received research output you're about to act on (business decision, vendor switch, security claim)
- The answer feels too clean / too confident given the question's difficulty
- You're about to make an irreversible choice and want a stress test first

Don't use it for: code review (use `code-reviewer`), trivial lookups, or questions where the cost of being wrong is low. This burns Opus three times in parallel plus a synthesis pass — reserve it for decisions where false confidence is the actual risk.

## Invocation

```
/challenge                       # challenges the last substantive assistant message in this session
/challenge <claim or answer>     # challenges the explicit argument (paste a claim, an answer, or a quote)
```

## Execution Protocol

When invoked, do the following exactly:

### Step 1 — Identify the target

- If `$ARGUMENTS` is non-empty, the target is the literal text in `$ARGUMENTS`.
- If `$ARGUMENTS` is empty, scan upward in the conversation for the most recent substantive assistant message (a research output, recommendation, decision, or factual answer — not a clarifying question, not a tool result). That is the target.
- If no suitable target exists (e.g. session just started, no prior answer to challenge), stop and tell the user: `No target found to challenge. Pass the claim as an argument: /challenge "<text>"`.
- Also identify the **original question** that produced the target if it's available in the conversation. If not, mark it as `not specified`.

### Step 2 — Launch three adversarial reviewers in parallel

Use the `Agent` tool with `subagent_type: adversarial-reviewer`. Send **all three calls in a single message** so they run in parallel. Each call's prompt MUST start with the role line:

**Call 1 — Skeptic:**
```
ROLE: Skeptic

TARGET:
<full target text>

ORIGINAL QUESTION:
<the question that produced this target, or "not specified">
```

**Call 2 — Contrarian:** same format, `ROLE: Contrarian`.

**Call 3 — Missing-Evidence Hunter:** same format, `ROLE: Missing-Evidence Hunter`.

Do not modify the target text. Do not summarize it for the reviewers — they need the original wording to attack provenance correctly. If the target is very long, pass it whole; do not truncate.

### Step 3 — Wait for all three reports, then synthesize

Each reviewer returns a structured report with `VERDICT`, `FINDINGS` (with severities), `TOP FIX`, and `CONFIDENCE IN CRITIQUE`. Merge them using this rubric:

| Synthesis verdict | When to use |
|-------------------|-------------|
| **HELD** | All three roles returned `STANDS` AND there are no `BLOCKING` findings. `MATERIAL` and `MINOR` findings are acceptable. |
| **CONTESTED** | At least one role returned `WEAKENED`, OR there are `MATERIAL` findings from two or more roles, OR there is exactly one `BLOCKING` finding. |
| **OVERTURNED** | Any role returned `UNDERMINED`, OR there are two or more `BLOCKING` findings, OR the Contrarian successfully built a credible counter-case with cited evidence (not just hypothesized). |

For each finding tagged `OUT OF ROLE`, weight it by which role *should* have made it — don't double-count, but don't ignore it either.

### Step 4 — Present to the user

Output exactly this structure:

```
## /challenge verdict: <HELD | CONTESTED | OVERTURNED>

**Target:** <one-line summary of what was challenged>
**Original question:** <one-line summary, or "not specified">

### What survived
<Bulleted list of claims that all three roles left standing. If verdict is OVERTURNED and nothing survived, write "Nothing survived the review — see findings.">

### What's contested or broken
<For each BLOCKING and MATERIAL finding across the three roles, one bullet:>
- **[Severity] [Role]:** <finding> → <recommended action>

### Required before acting
<Ordered list of the most important next steps. Synthesize the three TOP FIX recommendations into the smallest set of actions that would resolve the contested findings. If verdict is HELD, write "None — answer is sound." Otherwise be specific: "Verify <X> by reading <Y>", "Search for <Z>", "Re-source the claim about <W>".>

### Adversary confidence
- Skeptic: <N>%
- Contrarian: <N>%
- Missing-Evidence Hunter: <N>%

<If confidences vary widely, add one sentence: "The roles disagree on how confident this critique should be — see contested findings.">

---
<details>
<summary>Full reports</summary>

#### Skeptic
<full Skeptic report>

#### Contrarian
<full Contrarian report>

#### Missing-Evidence Hunter
<full Missing-Evidence Hunter report>

</details>
```

## Rules

1. **Run the three reviewers in parallel** — one message, three `Agent` tool uses. Sequential defeats the purpose.
2. **Do not defend the target.** You (the synthesis pass) are not the answer's author. Weigh the findings honestly. If you find yourself rationalizing why a `BLOCKING` finding "isn't really that bad," that's the bias you're here to catch — escalate to `CONTESTED` or `OVERTURNED`.
3. **Do not act on the verdict.** This command produces a verdict and a list of next steps. It does not execute them. The user decides whether to proceed, search more, or abandon the answer.
4. **Cost discipline.** Do not invoke this command yourself (as the assistant) without the user asking. It's an opt-in stress test, not a default review layer.
