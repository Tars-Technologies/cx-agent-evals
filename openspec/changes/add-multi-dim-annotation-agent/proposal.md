## Why

Today the Agents-tab eval loop scales poorly past the labeling step. To get an automated pass/fail signal for one axis of behavior, a human must hand-annotate a cohort, `recluster` (one gpt-4o call) groups the *failing* annotations into 3–8 failure modes, and then **each failure mode is spun off into its own separate evaluator** (`spawnJudge.fromFailureMode`) that must be individually calibrated and validated. Ten failure modes means ten judges, ten calibration jobs, ten validation passes — the work grows linearly with the number of axes.

But the data model already anticipates a multi-dimensional judge: `llmJudgeConfig` holds a `dimensions[]` array, each dimension carries an optional `failureModeId`, and the schema already has `outputFormat: "per_dimension" | "aggregate"`. The judge prompt builder (`buildJudgePrompt`) *already loops over `dimensions[]`*. The only reason it produces a single verdict is the deliberate "Slice 1 simplification" in `llmJudge.ts`, which forces model-side fail-if-any and never reads `outputFormat`.

This change finishes that wiring: **one agent that, in a single LLM call per conversation, classifies it against an existing (human-approved) set of failure modes and emits a per-mode pass/fail + reasoning verdict.** Overall pass = every mode passes; each failing mode maps directly to a `failureModeMembership`. This collapses N per-mode evaluators into one multi-dimensional pass, removing the per-axis calibration tax while keeping humans as the source of truth.

## What Changes

- **Label-only, not discovery.** The agent does **not** invent the taxonomy. It reads the existing `failureModes` for an `errorAnalysis` (modes a human approved, whether authored by hand or produced by `recluster`) and labels against them. Mode discovery stays a separate, human-gated step.
- Add a **per-mode verdict path** to the judge: `buildJudgePrompt` emits a per-dimension request, and a new `parseMultiJudge` (sibling of `parseJudge.ts`) parses `{ [modeKey]: { answer: pass|fail, reasoning } }`. Honor `outputFormat: "per_dimension"`; keep the injectable `JudgeLlmClient` so it stays unit-testable with a mocked client.
- Map each dimension's `failureModeId` → a FAIL verdict writes a `failureModeMembership` (polymorphic `source`, same sink `recluster` uses). Overall pass/fail is derived: pass ⟺ all modes pass.
- Add a **cohort run action** that fans the per-conversation labeling over a cohort using the Workpool pattern from `conversationSim/orchestration.ts` (parallelism cap, stored `workIds` for selective cancel, `onComplete` aggregation) — replacing `batchApply`'s synchronous, fail-fast per-evaluator loop for this path.
- **Never write `annotations`.** `annotations.ratedBy` is a required `v.id("users")` and annotations are upserted per-source, so machine verdicts cannot safely live there (would need a synthetic user and could clobber a human row). Agent verdicts persist to `failureModeMemberships` plus a dedicated machine-label/run record carrying provenance; human `annotations` are never read-modified-written by this path.
- **Validation reuses `metrics.ts`.** Where human labels exist on the same sources, compute per-mode TPR/TNR/agreement with Wilson CIs to report how trustworthy each agent dimension is.

## Capabilities

### New Capabilities
- `multi-dim-judge-verdict`: Per-mode pass/fail+reasoning verdict from a single LLM call — prompt construction (`buildJudgePrompt` per-dimension output), `parseMultiJudge` parser, and overall-pass derivation. Pure + unit-testable.
- `failure-mode-labeling-run`: Cohort orchestration that discovers no modes but labels every member against the existing `failureModes`, fanning out via Workpool, writing `failureModeMemberships` for failing modes and a machine-label run record.
- `agent-label-validation`: Per-mode agreement metrics (TPR/TNR/Wilson CI) of agent verdicts vs. human labels on overlapping sources, reusing `metrics.ts`.

### Modified Capabilities
- `evaluator-llm-judge`: `buildJudgePrompt` / `runLlmJudge` gain a per-dimension output path gated on `outputFormat`; `aggregate` (today's fail-if-any) behavior is preserved unchanged for existing evaluators.

## Impact

- **Backend**: `evaluator/llmJudge.ts`, `evaluator/parseJudge.ts` (new `parseMultiJudge`), new labeling orchestration + action under `errorAnalysis/` (modeled on `conversationSim/orchestration.ts` and `batchApply.ts`), `failureModes/memberships.ts` sink reused. Possible new schema table for machine-label runs (provenance) — TBD in design.
- **Schema**: No change to `annotations`. Reuses existing `failureModes`, `failureModeMemberships`, and the already-present `outputFormat`/`failureModeId` fields. A new machine-label-run table may be added (additive, backward compatible).
- **Frontend**: The failure-modes view (`.../failure-modes/page.tsx`) renders agent-written memberships with no change; a validation/agreement surface is additive.
- **Non-goals**: Agent-driven mode discovery (the doc's "drop the annotation gate" Slice 1), removing/replacing the existing per-mode `evaluators` concept, and any change to `aggregate`-mode evaluators.
