# Slice 1 — "The First Real Number" (Cold-Start Agent Score)

**Date:** 2026-05-29
**Status:** Approved design, pre-implementation
**Scope:** First of three slices toward a complete agent-evaluation scoring system.

---

## 1. Background & the mental model

This system evaluates conversational agents so a customer can gain confidence to
deploy to production. Two distinct scores run through the whole system, and
conflating them is the main source of confusion:

- **Score A — "How good is the *evaluator*?"** Produced by *validation*. It compares
  a judge's pass/fail verdicts against held-out **human** labels (TPR / TNR /
  agreement). It answers: *can I trust this automated judge to stand in for a
  human annotator?* This is calibrating the ruler.
- **Score B — "How good is the *agent*?"** Produced by running a *trusted* judge
  across many conversations and computing the pass rate per failure-mode
  dimension. This is measuring with the ruler. It is the number the customer
  buys ("agent passes 95% ± CI on dimension X").

The anchoring invariant: **a human label is ground truth about a *conversation*** —
not about a judge or an agent version. Judges are validated against labels;
agents are measured by judges.

### Current state on this branch (verified in code)

The pipeline skeleton is complete (configure → playground → scenarios →
simulate → annotate → failure modes → spawn judge → labels → validate), but the
**measurement half is hollow**:

1. **LLM-judge scoring is a stub.** `evaluator/scoreOne.ts:7-13` returns
   `{ passed: true, "[stub]…" }` for every `llm_judge`. `spawnJudge.fromFailureMode`
   always creates `type: "llm_judge"`. So the default judge passes everything →
   validation and Score B from it are meaningless. Only **code** judges work.
2. **Score B is never computed.** `conversationSimulations.overallPassRate` /
   `avgScore` exist in `schema.ts:854-855` and are written nowhere. `autoApply`
   stores per-run verdicts but nothing aggregates them.
3. **No batch-apply** across an existing conversation cohort. Judges fire only
   via `autoApply` at sim-run completion (`conversationSim/orchestration.ts`).
4. **Test split created but unused.** `spawnJudge.assignSplit` produces
   train/dev/test; `validate.ts` filters to `dev` only.
5. **No min-labels gate / no CI on Score A.** `validate.ts` emits a crisp point
   TPR/TNR on however few dev labels exist (even 1–2). `bootstrapCI` exists in
   `metrics.ts` but is unused.
6. **Transcript-sourced labels silently skipped** in validation
   (`validate.ts:48-55`) — exactly the warm-start calibration case.
7. **Bias correction unused.** `metrics.ts` has `correctedPassRate`
   (Rogan-Gladen) + `bootstrapCI`, called nowhere.

### Reusable assets already present

- `evaluator/metrics.ts`: `computeTPRTNR`, `correctedPassRate`, `bootstrapCI`
  (pure, no `"use node"`).
- `evaluator/parseJudge.ts`: `parseJudgeResponse(content)` — JSON verdict
  extraction, throws on unparseable.
- `evaluator/splits.ts`: `stratifiedFewShot`, `computeSplit` (pure, seeded).
- OpenAI call pattern: `errorAnalysis/clustering.ts` (`"use node"`,
  `import OpenAI from "openai"`, `response_format: json_object`).

---

## 2. Goal of Slice 1

Make the cold-start path produce a **trustworthy, bias-corrected, per-dimension
agent score with confidence intervals** over simulated conversations.

End-to-end cold-start flow this slice enables:

1. Simulate N scenarios against the agent → conversations.
2. Annotate a subset → cluster into failure modes → spawn judges (LLM or code).
3. Judges inherit train/dev/test labels (existing `spawnJudge` behaviour).
4. **Validate** each judge → Score A on dev, **confirmed on test**, with a CI and
   a minimum-labels gate → status `ready` / `validated` / `calibrating`.
5. **Batch-apply** ready judges across the simulated conversations *not used as
   labels* → per-dimension **Score B** (corrected, with CI) → **agent scorecard**.

Versioning, real-traffic ingestion, coverage, severity, and the acceptance gate
are **out of scope** (Slices 2–3 and later).

---

## 3. Components

### Component A — Make LLM judges actually judge (closes gap #1)

**New module `evaluator/llmJudge.ts` (`"use node"`):**

- `buildJudgePrompt(evaluator, messages, fewShot, contextDocs?) → { system, user }`
  - System prompt instructs the model to act as a strict pass/fail judge for the
    dimension(s), output JSON `{ "answer": "pass"|"fail", "reasoning": "…" }`.
  - Incorporates, per dimension: `rubric`, `passExamples`, `failExamples`.
  - Appends **few-shot examples** drawn from the train split (see below).
  - Renders conversation context per `llmJudgeConfig.inputContext`:
    - `transcript` (Slice 1 default): role-tagged turns.
    - `tool_calls`: included when present in messages.
    - `kb_documents`: **deferred** (no-op in Slice 1; documented as a stub).
- `runLlmJudge(openai, evaluator, messages, fewShot, contextDocs?) → Verdict`
  - Calls OpenAI (`model = llmJudgeConfig.model ?? "gpt-4o-mini"`),
    `response_format: { type: "json_object" }`.
  - Parses via `parseJudgeResponse`. On parse failure, throws; caller records the
    conversation as an error (not a silent pass).
- **Multi-dimension** (`outputFormat: "per_dimension"`): score each dimension,
  aggregate with **fail-if-any** for Slice 1. Single-dimension judges (the
  `spawnJudge` default) are the common case.

**Few-shot construction:** built **once per validation/batch run** (not per
conversation) to bound cost. Fetch the train-split labels' conversations,
normalize to transcripts, and select a balanced set via
`stratifiedFewShot(passIds, failIds, targetCount, seed)`. Pass the rendered
few-shot block into `runLlmJudge`.

**Keep `scoreOne` pure** for code judges. Add an async dispatcher used inside
node actions:

```
scoreOneAsync(openai, evaluator, messages, fewShot?) → Promise<Verdict>
  code      → scoreOne(evaluator, messages)        // sync, unchanged
  llm_judge → runLlmJudge(openai, evaluator, messages, fewShot)
```

**Call-site migration:**
- `evaluator/validate.ts` → add `"use node"`, instantiate OpenAI, use
  `scoreOneAsync`.
- `evaluator/autoApply.ts` → add `"use node"`, instantiate OpenAI, use
  `scoreOneAsync`. (Few-shot built once at the top from the evaluator's train
  labels.)

### Component B — Honest validation (closes gaps #4, #5, #6)

**New module `evaluator/sources.ts` — unified message fetcher (internal query):**

- `getMessagesForSource({ source }) → { role, content }[]`
  - `kind: "conversation"` → `internal.crud.conversations.listMessagesInternal`.
  - `kind: "transcript"` → load `livechatConversations`, map messages:
    `user → user`, `human_agent → assistant`, `workflow_input → system` (skipped
    from judge context). Use `translatedMessages` when present, else `messages`.
- Validation and batch-apply both use this. **Transcript labels are no longer
  skipped.**

**`evaluator/validate.ts` rewrite:**

- Constants: `TPR_THRESHOLD = 0.85`, `TNR_THRESHOLD = 0.85`,
  `MIN_PER_CLASS = 5` (minimum labels of each class required to declare `ready`).
- Compute the confusion matrix on the **dev** split (tuning) and, when test
  labels exist, on the **test** split (held-out confirmation), via
  `computeTPRTNR`.
- Add `wilsonCI(successes, n) → { lower, upper }` to `metrics.ts` (pure). Report
  CIs on TPR and TNR for both dev and test.
- **Gate logic:**
  - Let `final = test metrics if test labels sufficient, else dev metrics`.
  - `sufficient = passCount ≥ MIN_PER_CLASS && failCount ≥ MIN_PER_CLASS`
    (counted on the split used for the final gate).
  - If `!sufficient` → status `calibrating`, store metrics, return a
    `reason: "insufficient_labels"` with how many more are needed. Do **not**
    emit a `ready`/`validated` verdict off too little data.
  - Else `ready` iff `final.tpr ≥ 0.85 && final.tnr ≥ 0.85`, otherwise
    `validated`.
- Persist `devMetrics`, `testMetrics`, their CIs, label counts, `validatedAt`.

### Component C — Score B: batch-apply + aggregation (closes gaps #2, #3, #7)

**New module `evaluator/batchApply.ts` (`"use node"`):**

- `runOnCohort({ evaluatorIds, cohort, sampleSize? })` action.
  - Slice-1 `cohort = { kind: "simulation", simulationId }`.
  - Resolve cohort → list of conversation sources (the sim's run conversations).
  - **Exclude** any source that is an `evaluatorLabel` for the evaluators being
    applied (never measure on the calibration set).
  - `sampleSize` optional; defaults to "all" for sims. (This is the cost lever
    that Slice 3 uses for real traffic.)
  - For each evaluator: build few-shot once, score each cohort conversation via
    `scoreOneAsync`. Run through WorkPool (repo job pattern) for scale.
- **Aggregation per evaluator:**
  - `observedPassRate = passes / n`.
  - `correctedPassRate(observedPassRate, tpr, tnr)` using that evaluator's
    **validated** TPR/TNR. If the evaluator is not `ready`/`validated`, mark its
    Score B as `uncorrected` and surface a warning.
  - CI: bootstrap that resamples **both** the cohort verdicts (sampling
    uncertainty in `p_obs`) and the validation test pairs (uncertainty in
    TPR/TNR). Add `scoreBCI(...)` to `metrics.ts`, generalizing the existing
    `bootstrapCI`.
- **Agent scorecard rollup:** per-dimension corrected pass rate ± CI plus an
  overall figure (mean across dimensions for Slice 1; severity-weighted /
  safety-floor logic is later).

### Schema changes

- `evaluators` (extend): `testMetrics?: { tpr, tnr, agreement, n }`,
  `devMetricsCI?`, `testMetricsCI?`, `labelCounts?: { passDev, failDev, passTest,
  failTest }`, `validatedAt?: number`. (Keep existing `devMetrics`.)
- **New `evaluationRuns`**: `{ orgId, agentId, evaluatorId, cohort, n,
  observedPassRate, correctedPassRate, ci: { lower, upper }, corrected: boolean,
  createdAt }`. Indexes: `by_agent`, `by_evaluator`.
- **New `evaluationResults`** (drill-down + future failure-mode discovery):
  `{ orgId, evaluationRunId, source, passed, justification }`. Index:
  `by_run`.

### Frontend (thin)

- **Validate page** (`evaluators/[evalId]/validate`): show dev **and** test
  metrics with CIs; render the `insufficient_labels` state with "annotate N
  more" guidance instead of a fake number.
- **Simulation results page** (`experiments/[runId]`): a **scorecard panel** —
  per-dimension corrected pass rate ± CI and an overall number, with a "Run
  scorecard" action that calls `runOnCohort`. Surface the `uncorrected` warning
  when a judge isn't validated.

---

## 4. Data flow (cold-start, end to end)

```
Simulate scenarios ─► conversations (conversationSimRuns → conversations)
        │
        ▼
Annotate a subset ─► annotations ─► cluster ─► failureModes
        │
        ▼
spawnJudge.fromFailureMode ─► evaluator (+ inherited train/dev/test labels)
        │
        ▼
validate.run ──────────────► Score A: TPR/TNR on dev, CONFIRM on test,
        │                    with Wilson CI + MIN_PER_CLASS gate
        │                    status → ready | validated | calibrating
        ▼ (validated/ready judges corrected; others reported uncorrected)
batchApply.runOnCohort ────► score sim conversations MINUS the label set
        │                    observed → Rogan-Gladen corrected → bootstrap CI
        ▼
evaluationRuns + evaluationResults ─► agent scorecard (per-dimension + overall)
```

---

## 5. Testing (TDD, matching repo conventions)

**Pure unit (vitest):**
- `buildJudgePrompt` renders rubric + examples + few-shot + transcript context.
- `scoreOneAsync` dispatch (code vs llm) with a mock OpenAI client.
- `wilsonCI` and `scoreBCI` numeric correctness (known inputs).
- Transcript→message normalization in `sources.ts` mapping.

**Integration (convex-test):**
- Validation: test-split confirmation path; `MIN_PER_CLASS` floor blocks
  premature `ready`; transcript-sourced labels are scored (not skipped).
- `runOnCohort`: aggregation correctness, calibration-set exclusion, Rogan-Gladen
  correction applied with the evaluator's validated metrics, `uncorrected`
  warning when judge unvalidated.

Mock the OpenAI client to return canned verdicts (same approach as existing
strategy tests).

---

## 6. Out of scope (tracked for later slices)

- **Slice 2 — Versioning & regression:** version-stamp agents + conversations,
  Score B(v1) vs Score B(v2) diff, light re-validation on a new-version sample,
  judge-drift triggers (gaps #8–#10).
- **Slice 3 — Real traffic & monitoring:** real-conversation ingestion into the
  eval flow, batch-apply over sampled production traffic, new-failure-mode
  discovery loop (gaps #11–#12).
- **Later:** scenario coverage/representativeness, distribution-weighted Score B
  (#13–#14), severity / safety floors / task-success / K-run variance
  (#16–#18), acceptance gate / release policy (#19), retrieval-eval ↔ agent-eval
  root-cause linkage (#20), code-vs-LLM judge choice at spawn (#22),
  `kb_documents` input context.

---

## 7. Resolved decisions

- **First slice = cold-start "first real number"; versioning deferred** to Slice 2.
- **Statistical-integrity fixes folded in** (test split, CI, min-labels,
  transcript labels) so the first number is honest.
- **Judge model = OpenAI `gpt-4o-mini`**, configurable per evaluator (matches the
  repo's existing OpenAI usage).
- **Score B runs over the simulation batch minus the calibration set** (one
  batch, exclude labeled), rather than requiring a second measurement
  simulation. A dedicated measurement run is a later refinement.
