# Phase 1: Question Generation — Bug Fixes + Quick UI Wins

**Date**: 2026-03-23
**Branch**: `va_generate_questions_improvements`
**Parent plan**: `docs/superpowers/plans/question-generation-improvements.md`

---

## Overview

Fix three bugs and deliver two UI improvements to the question generation module. This phase stabilizes the existing system before Phase 2 (new combined strategy) and Phase 3 (manual editing).

## Items

| # | Item | Type |
|---|------|------|
| 1 | Dimension discovery URL not working | Bug |
| 2 | Simple strategy: "questions per doc" → "total questions" slider | UI |
| 3 | Unified "total questions" slider across all strategies | UI |
| 7 | Dataset delete with typed confirmation modal | Feature |
| 8 | Tab-switching corrupts question display | Bug |
| 10 | Dimension-driven generates too few questions | Bug |

---

## Bug #1: Dimension Discovery Not Working

### Root Cause

`DimensionWizard.tsx:39` calls `POST /api/discover-dimensions`, but **no Next.js API route exists** at `packages/frontend/src/app/api/discover-dimensions/route.ts`. The route was never created. The eval-lib function `discoverDimensions()` in `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/discovery.ts` exists and works — it just has no HTTP endpoint.

### Fix

Create `packages/frontend/src/app/api/discover-dimensions/route.ts`:
- POST handler that accepts `{ url: string }`
- **Import path**: `discoverDimensions` is NOT on the main eval-lib entry point. Import from `rag-evaluation-system/pipeline/internals` sub-path. Do NOT pass `outputPath` (that triggers a `node:fs/promises` import which may not be needed).
- Constructs a `DiscoverDimensionsOptions` object: `{ url, llmClient, model }` — note the function takes an options object, not positional args
- Uses server-side `OPENAI_API_KEY` env var to create the OpenAI LLM client. `defaultFetchPage` uses standard `fetch` (safe for Next.js API routes on Node 18+).
- Returns `{ dimensions: Dimension[] }` JSON response
- **Note**: This function fetches the main URL plus up to 4 same-domain linked pages, then calls LLM — expect 5-15 second response time. The DimensionWizard already shows a loading spinner during this call.
- Handles errors (invalid URL, fetch failures, LLM errors) with appropriate HTTP status codes

### Files Changed

- `packages/frontend/src/app/api/discover-dimensions/route.ts` (new)

---

## Bug #8: Tab-Switching Corrupts Question Display

### Symptom

During question generation, switching browser tabs and returning shows many questions with single characters each. Concatenating them forms the actual question text. Observed on dimension-driven and possibly real-world strategies. Questions stay corrupted — they don't self-repair.

### Investigation Plan

1. Check `insertBatch` mutation in `packages/backend/convex/crud/questions.ts` — are questions being split at character boundaries?
2. Check if WorkPool `onComplete` callback (`onQuestionGenerated` in `orchestration.ts`) is being called multiple times or with partial data
3. Check the Convex reactive query `api.crud.questions.byDataset` — does it emit intermediate states during batch insertion?
4. Check if there's a race between multiple `insertBatch` calls writing overlapping `queryId` values
5. Test: run generation, check Convex dashboard for actual question records — are they single chars in the DB, or is it a rendering issue?

### Likely Root Cause

The `insertBatch` mutation inserts questions in batches of 100. If the strategy's `generate()` method returns results incrementally or if the action is being retried by WorkPool, partial/duplicate insertions could occur. Another possibility: the `queryId` format (e.g., `dd_q0`, `dd_q1`) doesn't account for retries, causing overwrites or duplicates.

### Fix Strategy

> **Note**: This is a hypothesis. Investigation steps 1–5 must be completed first to confirm root cause before implementing any fix.

- Add idempotency guards to `insertBatch` — check for existing `queryId` before inserting
- Ensure `generate()` returns complete results (not streaming partial chars)
- If WorkPool retries are the cause, make the action idempotent by checking what's already been inserted

### Files Changed

- `packages/backend/convex/crud/questions.ts` — idempotency guards
- `packages/backend/convex/generation/actions.ts` — retry safety
- Possibly `packages/backend/convex/generation/orchestration.ts` — callback handling

---

## Bug #10: Dimension-Driven Generates Too Few Questions

### Root Cause Analysis

The dimension-driven pipeline has a multi-stage funnel that loses question budget at each step:

1. **Filtering** (`filtering.ts`): Pairwise combo filtering removes "unrealistic" combinations. Aggressive LLM filtering can eliminate most combos.
2. **Assignment** (`relevance.ts`): Combo-to-document assignment is selective — combos only match docs where the profile is "genuinely relevant."
3. **Sampling** (`generator.ts`): `stratifiedSample()` allocates from the remaining assigned combos. If few combos survive, the sample is small.

The pipeline never compensates for losses — if filtering removes 80% of combos, the final question count is ~20% of target.

### Fix

Add a **deficit fill** step after stratified sampling:

1. After `stratifiedSample()`, compute `deficit = totalQuestions - sampledAssignments.length`
2. If `deficit > 0`, generate additional questions without specific profiles:
   - Distribute deficit across documents proportionally
   - Use a simplified prompt (similar to SimpleStrategy) to fill the gap
3. This ensures the final count always matches `totalQuestions`

Also add logging at each pipeline stage to track funnel metrics:
- Combos generated → combos after filtering → assignments → sampled → final count

### Files Changed

- `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/generator.ts` — deficit fill logic
- `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/filtering.ts` — optional: less aggressive default filtering

---

## UI: Unified "Total Questions" Slider (#2, #3)

### Design

Replace all per-strategy question count inputs with a single unified slider component:

- **Range**: 1–100
- **Default**: 30
- **Display**: Label on left, large numeric value on right, slider track below, range labels at ends
- **Helper text**: Strategy-specific, shown below the slider:
  - Simple: "Distributed equally across N documents (~M/doc)"
  - Dimension-driven: "Distributed via stratified sampling across dimension combos"
  - Real-world: "Direct matches + synthetic generation to fill remaining"

### Backend Changes

**eval-lib**:
- `SimpleStrategy` accepts `totalQuestions` instead of `queriesPerDoc`
- `SimpleStrategyOptions` type changes: `queriesPerDoc` → `totalQuestions` (this is a **breaking change** to the eval-lib public API — acceptable since this is an internal workspace package, not published externally)
- `generate()` already iterates `context.corpus.documents` internally, so it naturally works corpus-wide
- After generation, trims to exactly `totalQuestions` if over-generated (due to `Math.ceil` rounding per doc)

**Backend**:
- `startGeneration` mutation: Simple strategy config changes from `{ queriesPerDoc }` to `{ totalQuestions }`
- **Simple strategy becomes a single corpus-wide action** (like dimension-driven and real-world) instead of per-doc. Remove the `isPerDoc` branch (lines 96-112 in `orchestration.ts`) and add a new branch matching the dimension-driven pattern.
- **Remove `generateForDocument` action** from `actions.ts` — replaced by new `generateSimple` corpus-wide action that loads all docs, creates full corpus, and calls `SimpleStrategy.generate()`
- The per-doc WorkPool loop in orchestration is replaced by a single `pool.enqueueAction` call

**Frontend**:
- New shared `TotalQuestionsSlider` component used by all strategy configs
- Remove `questionsPerDoc` from `GenerateSettings` type
- `GenerateConfig` renders the slider for all strategies
- Persist value to state (already done for dimension-driven's `totalQuestions`)

### Files Changed

- `packages/eval-lib/src/synthetic-datagen/strategies/simple/generator.ts` — accept totalQuestions, iterate all corpus docs
- `packages/eval-lib/src/synthetic-datagen/strategies/types.ts` — change `SimpleStrategyOptions.queriesPerDoc` → `totalQuestions`
- `packages/eval-lib/tests/unit/synthetic-datagen/strategies/simple.test.ts` — update tests to use `totalQuestions` instead of `queriesPerDoc`
- `packages/backend/convex/generation/orchestration.ts` — simple strategy becomes single corpus-wide action (remove per-doc loop), config uses `totalQuestions`
- `packages/backend/convex/generation/actions.ts` — new `generateSimple` corpus-wide action, remove `generateForDocument`
- `packages/frontend/src/components/GenerateConfig.tsx` — unified slider for all strategies, remove `questionsPerDoc` from `GenerateSettings` type (defined in this file)
- `packages/frontend/src/components/TotalQuestionsSlider.tsx` (new) — shared slider component
- `packages/frontend/src/app/generate/page.tsx` — state management changes (remove `questionsPerDoc`, unify on `totalQuestions`)
- `packages/frontend/src/lib/types.ts` — remove `questionsPerDoc` from `GenerateSettings`

---

## Feature: Dataset Delete (#7)

### Design

**Trash icon** on each dataset list item:
- Same SVG path as `AgentSidebar.tsx` trash icon
- `opacity: 0` by default, `opacity: 1` on parent hover
- Turns red (`text-red-400`) on icon hover
- Click opens confirmation modal

**Confirmation modal** (follows `ConfirmDeleteModal` pattern):
- Header: "Delete Dataset" in red
- Impact box: dataset name, question count, strategy
- Warning box: "This action cannot be undone. All questions and their ground truth spans will be permanently removed."
- **Experiment guard**: If experiments reference this dataset, show an error instead: "Cannot delete — used by N experiment(s). Delete the experiments first."
- Typed confirmation: "Type DELETE to confirm" with monospace input
- Delete button disabled until input matches "DELETE"
- Cancel button

### Backend

New `deleteDataset` mutation in `packages/backend/convex/crud/datasets.ts`:
- Auth check (orgId ownership)
- **Guard**: If any `experiments` reference this dataset (query `experiments.by_dataset` index), **prevent deletion** and return an error listing the experiment names. Datasets with experiment history should not be casually deleted — the user must delete experiments first.
- Delete all questions in the dataset (`questions.byDatasetInternal` → batch delete)
- Cancel any running generation job for this dataset (query `generationJobs` by `datasetId` index to find active jobs, then call cancel logic)
- Delete the dataset record
- LangSmith synced data is left as-is (we don't manage LangSmith cleanup from here)

### Files Changed

- `packages/backend/convex/crud/datasets.ts` — `deleteDataset` mutation (with experiment guard)
- `packages/backend/convex/crud/questions.ts` — `deleteByDataset` internal mutation
- `packages/frontend/src/app/generate/page.tsx` — trash icon on dataset items, delete modal state, experiment guard error display
- New dataset-specific delete modal component (the existing `ConfirmDeleteModal` is retriever-specific with `action: "retriever" | "index"` typing — create a simpler variant for datasets)

---

## Testing Strategy

- **Bug #1**: Manual test — enter URL in DimensionWizard, verify dimensions are discovered
- **Bug #8**: Manual test — start generation, switch tabs, return, verify questions display correctly. Also check Convex dashboard for data integrity.
- **Bug #10**: Unit test — run dimension-driven strategy with known inputs, verify output count matches `totalQuestions`. Add funnel logging assertions.
- **Slider**: Update existing `simple.test.ts` — change `queriesPerDoc` to `totalQuestions`, verify correct count with multi-doc corpus. Add test for trimming when over-generated.
- **Dataset delete**: Integration test — create dataset with questions, delete, verify both are gone. Frontend: verify modal flow.

---

## Order of Implementation

1. Bug #1 (Dimension discovery) — quick win, isolated change
2. UI #2/#3 (Total questions slider) — foundational for the rest
3. Bug #10 (Too few questions) — depends on understanding the pipeline, may inform slider defaults
4. Feature #7 (Dataset delete) — independent, can be parallelized
5. Bug #8 (Tab-switching) — investigation-heavy, may require deeper debugging
