## Context

The Agents-tab eval pipeline already has every primitive this change needs; it has just never wired them together for multi-dimensional labeling:

- **Discovery** (`errorAnalysis/clustering.ts` `recluster`) — one gpt-4o call that reads *failing* annotations and writes `failureModes` + `failureModeMemberships`. Human-gated, destructive replace.
- **Per-mode judge** (`evaluator/spawnJudge.ts` `fromFailureMode`) — turns ONE failure mode into ONE evaluator with a one-dimension `llmJudgeConfig`. Each becomes a separately calibrated/validated judge.
- **Judge prompt** (`evaluator/llmJudge.ts` `buildJudgePrompt`) — already loops `dimensions[]`, but the "Slice 1 simplification" collapses to a single model-side fail-if-any `{answer, reasoning}` and never reads `outputFormat`.
- **Schema** (`schemas/agent.schema.ts`) — `llmJudgeConfig.dimensions[]` each carry an optional `failureModeId`; `outputFormat: "per_dimension" | "aggregate"` already exists; `failureModeMemberships` is `{failureModeId, source}` with no provenance field; `annotations.ratedBy` is a **required** `v.id("users")` and annotations are upserted per-source.
- **Cohort fan-out** (`conversationSim/orchestration.ts`) — the canonical Workpool pattern: start mutation → `enqueueAction` per item → store `workIds` → `onComplete` aggregation → finalize. `evaluator/batchApply.ts` `runOnCohort` is the closest existing cohort labeler, but it loops per *evaluator* synchronously and is fail-fast (one judge error aborts the whole cohort).
- **Metrics** (`evaluator/metrics.ts`) — `computeTPRTNR`, `wilsonCI`, `correctedPassRate`, `scoreBCI`, reused as-is for validation.

This change adds a **label-only** multi-dimensional agent: given the *existing* human-approved `failureModes` for an `errorAnalysis`, classify every member against all modes in one LLM call, deriving overall pass/fail and writing memberships for failing modes.

## Goals / Non-Goals

**Goals:**
- One LLM call per conversation/transcript scores it against ALL existing failure modes → `{ [modeKey]: {pass/fail, reasoning} }`.
- Overall pass ⟺ every mode passes. Each failing mode → a `failureModeMembership` on the polymorphic `source`.
- Reuse `buildJudgePrompt`'s `dimensions[]` loop and the existing `outputFormat: "per_dimension"` switch; keep the pure parser path and injectable `JudgeLlmClient` unit-testable.
- Fan out over a cohort with Workpool (parallelism cap, `workIds` cancel, `onComplete`), tolerant to per-item failures (not fail-fast).
- Persist full agent verdicts (overall + per-mode + reasoning + model) with provenance, **without** touching `annotations` or human ground truth.
- Where humans labeled the same source, report per-mode TPR/TNR/agreement with Wilson CIs.

**Non-Goals:**
- Agent-driven mode discovery (dropping the annotation gate) — separate future change.
- Removing or replacing the per-mode `evaluators` concept or `aggregate`-mode judges (unchanged).
- Changing `recluster`, `spawnJudge`, or the existing failure-modes UI write/read contract beyond additive fields.

## Decisions

### D1: Label-only — taxonomy comes from existing `failureModes`
The agent reads `failureModes` for the `errorAnalysis` (via `failureModes.crud` `by_analysis`) and labels against them. It never proposes or mutates the mode set. If an analysis has zero modes, the run is a no-op error ("no modes to label against"). This keeps humans in control of the rubric and sidesteps the riskiest part of the explainer doc's vision.

### D2: Per-dimension judge output, gated on `outputFormat`
Extend `buildJudgePrompt` so that when `outputFormat === "per_dimension"` it requests a per-mode object:
`{ "<modeKey_1>": {"answer":"pass"|"fail","reasoning":"..."}, ... }`. The existing `aggregate` path (today's single `{answer,reasoning}` fail-if-any) is preserved byte-for-byte so existing evaluators are unaffected. `modeKey` is a stable, prompt-safe alias (`m0`, `m1`, …) assigned by index; a sidecar map `modeKey → failureModeId` lets the parser tie verdicts back to modes without leaking raw IDs into the prompt.

### D3: New `parseMultiJudge`, sibling of `parseJudge.ts`
A pure function `parseMultiJudge(content, modeKeys)` that strict-JSON-parses, validates every expected `modeKey` is present, reuses `extractVerdict`'s pass/yes & fail/no normalization per entry, and **throws** on a missing/garbled mode (same refuse-to-guess discipline as `parseJudgeResponse`). Throwing lets the per-item action record an error instead of silently mislabeling. Lives in `parseJudge.ts` (still no `"use node"`, directly unit-testable).

### D4: Persist verdicts in a new `agentLabelRuns` + `agentLabels`, not `annotations`
`annotations.ratedBy` is required `v.id("users")` and rows are upserted per-source — writing agent verdicts there would need a synthetic user and could clobber a human row. Instead:
- `agentLabelRuns` (run-level): `orgId, agentId, errorAnalysisId, model, status, counters {total,processed,failed,skipped}, workIds[], createdAt, completedAt`. Mirrors the `generationJobs`/`indexingJobs` tracker shape.
- `agentLabels` (per-source): `orgId, runId, errorAnalysisId, source (polymorphic), overallPass, perMode: [{failureModeId, pass, reasoning}], createdAt`. Carries the reasoning that memberships can't hold.

Human `annotations` are never read-modified-written by this path; they remain the sole ground truth.

### D5: Failing modes also write `failureModeMemberships` (for the existing UI)
The failure-modes page reads `failureModeMemberships`, so the agent writes a membership per failing (source, mode) — same sink `recluster` uses. To keep agent-written memberships distinguishable and idempotently replaceable per run, add an **optional** `origin` discriminator to `failureModeMemberships` (`{kind:"clustering"} | {kind:"manual"} | {kind:"agent", runId}`); absent = legacy/human. Additive and backward compatible. A re-run deletes only `origin.kind==="agent"` memberships for the analysis before writing fresh ones, never touching clustering/manual memberships.

### D6: New `labelingPool` Workpool instance + non-fail-fast per-item action
Register a `labelingPool` alongside the existing pools (mirrors the `generationPool`/`experimentPool` decision in `migrate-jobs-to-workpool`). `startLabeling` mutation creates an `agentLabelRuns` record, snapshots the mode set, and enqueues one `labelOneSource` action per cohort member, storing `workIds`. `labelOneSource` (a `"use node"` action) hydrates messages via `evaluator/sources.ts` `getMessagesForSource`, calls the multi-dim judge once, writes `agentLabels` + memberships, and returns a per-item result. Unlike `batchApply`'s fail-fast loop, a single item's judge/parse error increments `failed` and is recorded in the run, not aborting the cohort. `onLabeled` (`onComplete`) uses the shared `applyResult`/`counterPatch` helpers and finalizes when all items settle.

### D7: One-shot model call, not the agentic loop (for now)
Use the existing one-shot `new OpenAI()` + `json_object` pattern (as `recluster`/`runLlmJudge` do), default model `gpt-4o-mini` (configurable up to `gpt-4o`). Only graduate to `lib/agentLoop.ts` `runAgentLoop` with retriever tools if a mode provably needs KB context to judge (e.g. detecting hallucinated policy). Deferred — keeps cost and complexity down and matches the established judge path.

### D8: Validation reuses `metrics.ts`, per mode
For sources that have BOTH an agent label and a human signal (an `annotations` row, or `evaluatorLabels`), compute per-mode TPR/TNR/agreement + Wilson CI. The agent's per-mode "fail = exhibits mode" is compared against the human's failing membership / fail rating for that mode. Surfaced as an additive agreement view; the ≥85% TPR/TNR bar that gates evaluators is reused as the "trustworthy" threshold per dimension.

### D9: Atomic-ish replace
Following `recluster`'s lesson, the membership/label replace happens only AFTER the per-item LLM call parses successfully, and per-source writes are scoped to that source — a transient failure on one member never wipes another's labels. Run-level idempotency (delete prior `agent` memberships for the analysis) happens once in `startLabeling` before fan-out, or lazily per-source; design favors per-source replace so partial re-runs are safe.

## Risks / Trade-offs

- **[Prompt bloat with many modes]** — N modes inflate the system prompt and the output object. Mitigation: cap modes per call (e.g. ≤8, matching `recluster`'s range); if an analysis exceeds it, batch modes across calls and merge. Reuse `MAX_TRANSCRIPT_CHARS`/`MAX_TURNS` truncation for the transcript.
- **[Membership provenance migration]** — adding `origin` to `failureModeMemberships` is additive, but existing rows lack it; the replace logic must treat absent `origin` as non-agent (never deletes legacy rows). Covered by D5.
- **[Cost on large cohorts]** — one call per member. Bounded by the Workpool parallelism cap and model tier (D6/D7). Discovery is not re-run, so cost is strictly the labeling pass.
- **[Agent vs human divergence]** — agent labels are *proposals*; D4 keeps them in their own tables so they can never be mistaken for ground truth, and D8 quantifies divergence rather than hiding it.
- **[Non-atomic run finalize]** — same class of issue as `recluster`'s noted non-atomicity; mitigated by per-source scoping (D9) and Workpool's `onComplete` settle-counting.

## Migration Plan

1. Schema (additive, backward compatible): add `agentLabelRuns` + `agentLabels` tables; add optional `origin` to `failureModeMemberships`. Deploy — no data migration (no existing agent rows).
2. Register `labelingPool` in `convex.config.ts`.
3. Add `parseMultiJudge` + per-dimension branch in `buildJudgePrompt` (pure, unit-tested first — TDD).
4. Add `labelOneSource` action, `startLabeling`/`onLabeled`/`cancelLabeling` mutations, and the mode-snapshot query.
5. Wire the validation/agreement query reusing `metrics.ts`.
6. Frontend: agent memberships render in the existing failure-modes view with no change; add an additive "agent labeling" trigger + agreement surface.
