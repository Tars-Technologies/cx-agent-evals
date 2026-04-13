# Generation Quality Improvements — Design Spec

**Goal:** Fix question count shortfalls, add multi-span ground truth, tag real-world questions, improve progress visibility, and fix the review step allocation display.

**Scope:** Changes to eval-lib (generation pipeline), Convex backend (orchestration, schema), and Next.js frontend (banner, question list, review step).

**Out of scope:** Real-world question matching algorithm improvements (parking for a future iteration). Skipped-question visibility (future — belongs in the knowledge base section).

**Section dependencies:** Section 1 (retry loop) must be implemented first — it restructures `generateForDoc` in the backend. Sections 2, 3, and 4 all build on that restructured action. Section 5 (allocation fix) is independent and can be done in any order.

---

## 1. Retry Mechanism for Exact Question Counts

### Problem

When the LLM generates a question with a citation that doesn't match the source document (even after 3-tier fuzzy matching with 0.7 threshold), the question is silently dropped. No retry, no audit trail. Requesting 50 questions can yield 40.

### Design

The retry loop lives in the backend action (`generateForDoc` in `packages/backend/convex/generation/actions.ts`), not in eval-lib. This keeps eval-lib stateless and single-pass while the backend owns retry policy and progress tracking.

**Per-document retry flow:**

```
Document quota: 8
Pass 1: Generate 8 → validate citations → 6 pass, 2 fail
Pass 2: Generate 4 (2 shortfall + 2 buffer), exclude 6 succeeded → validate → 3 pass, 1 fail
  Take first 2 needed → document total: 8 ✓
```

**Rules:**
- After each generation + citation validation pass, count shortfall (quota − validated count)
- If shortfall > 0, retry with `retryCount = shortfall + 2` (buffer for expected failures)
- Pass already-succeeded questions as exclusions in the LLM prompt: "Do NOT generate questions similar to these: [list]"
- **Max 4 retry rounds** per document to avoid infinite loops
- After all retries exhausted, accept whatever was produced
- The existing `updateDocProgress` mutation is called **once** after the retry loop completes (not after each pass)

**Shortfall tracking:**
- `generateForDoc` returns `{ questionsGenerated, failedCitations, missedQuestions }` where `missedQuestions = quota − validatedCount` after all retries
- `onDocGenerated` accumulates `missedQuestions` on the job record (same pattern as `questionsGenerated` — see Section 4)
- Surfaced in the UI so the user knows if the final count fell short and by how much

**Retry exclusion and scenario interaction:** **Skip the retry loop entirely when scenario === 1** (all direct reuse) — the set of real-world questions is fixed and cannot be supplemented by retrying. If citation validation fails for some direct-reuse questions in scenario 1, accept the shortfall as `missedQuestions`. Retries only apply when the LLM generates new questions (scenarios 2–4). When retrying in scenarios 2–4, exclusions are the question texts of already-succeeded *generated* questions only — they do not overlap with the `[STYLE EXAMPLES]` section since style examples are the original real-world questions while exclusions are the successfully generated questions.

### Eval-lib changes

`generateForDocument()` in `packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts`:
- Add `excludeQuestions?: string[]` to `GenerateForDocumentParams` interface (line 269)
- Pass it through to `BuildPromptParams` and into `buildPrompt()` (line 59)
- In `buildPrompt()`, when `excludeQuestions` is non-empty, append a new section to the `[TASK]` block (lines 106–175): "Do NOT generate questions similar to the following:\n[list]"
- No other changes — eval-lib remains single-pass

### Backend changes

`generateForDoc` action in `packages/backend/convex/generation/actions.ts`:
- Wrap the generate → validate cycle in a retry loop (max 4 rounds)
- Track succeeded questions across rounds; pass their texts as `excludeQuestions` to subsequent rounds
- After loop completes, compute `missedQuestions = quota - validatedCount` and return alongside `questionsGenerated` and `failedCitations`

Schema (`packages/backend/convex/schema.ts`):
- Add `missedQuestions: v.optional(v.number())` to `generationJobs` table

---

## 2. Two-Pass Multi-Span Ground Truth

### Problem

Each question gets a single span from the inline citation extracted during generation. Real ground truth is often multi-span — a question like "What authentication methods are supported?" may have relevant passages in 3 different paragraphs.

### Design

After pass 1 (generation + citation validation + retries) produces the final validated questions for a document, pass 2 enriches each question with comprehensive multi-span ground truth.

**Relationship to existing Phase 2 WorkPool:** The codebase has a separate ground truth assignment phase (`assignGroundTruthForQuestion` / `onGroundTruthAssigned`) used by the non-unified pipeline. The **unified** pipeline does not use this phase — its `onDocGenerated` callback goes straight to completion with no ground truth enrichment. This design adds multi-span enrichment **inline inside `generateForDoc`** for the unified pipeline only. The existing non-unified Phase 2 WorkPool is untouched.

**Pass 2 flow (per document, inside `generateForDoc`):**
1. After the retry loop produces the final set of validated questions (with single spans from citation validation)
2. For each validated question, call the existing `GroundTruthAssigner` (`packages/eval-lib/src/synthetic-datagen/ground-truth/token-level.ts`)
3. The assigner sends the LLM the full document + question, gets back `{ excerpts: [string, ...] }`
4. Each excerpt is located via exact → normalized → fuzzy matching
5. The resulting `CharacterSpan[]` array **replaces** the single span from pass 1
6. Questions are then inserted into the database with the enriched multi-span ground truth

**GroundTruthAssigner calling convention:** The assigner's `assign()` method (line 16 of `token-level.ts`) takes `queries: GeneratedQuery[]` and `context: { corpus, llmClient, model }`. It requires a `corpus` object, not raw document text. Inside `generateForDoc`, construct a single-document corpus from the doc content already loaded in the action. Follow the existing pattern from `assignGroundTruthForQuestion` (lines 437–455 of `actions.ts`) which calls `loadCorpusFromKb()` — but since `generateForDoc` already has the doc content loaded, construct the corpus object directly without re-loading from the KB. Process questions sequentially (one LLM call per question).

**Fallback:** If pass 2 fails for a specific question (LLM error, no excerpts found, or `results.length === 0 || results[0].relevantSpans.length === 0`), keep the single span from pass 1. The question is never dropped at this stage. Per-question failures are swallowed silently — the single span from pass 1 is an acceptable fallback. This matches the existing check pattern in `assignGroundTruthForQuestion` (lines 458–469).

**No retries for pass 2** — the question is already confirmed answerable from pass 1. Pass 2 only enriches the span coverage.

**Timeout consideration:** For a document with many questions (e.g., 15), sequential LLM calls could take 1–2 minutes. Convex actions have a 10-minute timeout. This is safe for typical quotas (≤20 questions per document). No parallelism needed.

**Cost:** One additional LLM call per validated question. For 50 questions, ~50 short-prompt calls. Modest overhead for significantly better ground truth accuracy.

### Eval-lib changes

No changes to the `GroundTruthAssigner` itself. It already supports multi-span and has the right interface. No changes to `generator.ts` either — the wiring happens entirely in the backend action.

### Backend changes

In `generateForDoc` action (`packages/backend/convex/generation/actions.ts`): after the retry loop produces validated questions, call the ground truth assigner for each question before inserting into the database. Construct a single-document corpus from the doc content already loaded. Replace the single span with the multi-span result (or keep the original if enrichment fails). This happens entirely within the single `generateForDoc` action — no new WorkPool phase, no new callbacks.

---

## 3. Real-World Question Tagging

### Problem

No way to distinguish which questions came directly from the user's real-world input vs. were LLM-generated. Users can't see how many of their seed questions were actually used.

### Design

**Existing state:** The pipeline already carries a `source` field through the flow. `generateForDocument()` (eval-lib) returns `source: "direct-reuse"` or `source: "generated"` on each `UnifiedQuestion` (typed as a union in `packages/eval-lib/src/synthetic-datagen/unified/types.ts`). The value is set in `buildPrompt()` (lines 119, 140, 168 of `per-doc-generation.ts`) and mapped in the response parser (line 337). The backend action (`generateForDoc`) already reads `q.source` and stores it in `metadata.source` on each inserted question. However, `source` lives buried in the `metadata` JSON blob — not queryable or directly visible to the frontend.

**Schema changes:**

`questions` table (`packages/backend/convex/schema.ts`):
- Add `source: v.optional(v.string())` as a **top-level field** — value `"real-world"` for direct reuses, `undefined` for generated
- This promotes the existing `metadata.source` to a first-class field with a renamed value (`"direct-reuse"` → `"real-world"` for user-facing clarity)
- No data migration needed — only new questions get the top-level field

`datasets` table:
- Add `realWorldQuestionCount: v.optional(v.number())` — set when generation completes

**How source gets set (eval-lib → backend → database):**

1. **Eval-lib type change:** In `packages/eval-lib/src/synthetic-datagen/unified/types.ts`, rename the `UnifiedQuestion.source` union from `"generated" | "direct-reuse"` to `"generated" | "real-world"`

2. **Eval-lib prompt change:** In `per-doc-generation.ts`, update `buildPrompt()` to use `"real-world"` instead of `"direct-reuse"` in the LLM prompt instructions (lines 119, 140, 168) and the response mapping (line 337)

3. **Backend action:** In `generateForDoc`, when building question records for insertion, write `source` as a **top-level field** (e.g., `source: q.source === "real-world" ? "real-world" : undefined`). Keep `metadata.source` for backward compatibility.

4. **Backend insertion:** The `insertBatch` mutation in `packages/backend/convex/crud/questions.ts` needs to accept and pass through the `source` field in its validator and insertion logic.

5. **Completion count:** In `onDocGenerated` (`orchestration.ts`), within the `isComplete` branch (after the existing `questionCount` query at line 526), count questions where `source === "real-world"` and write `realWorldQuestionCount` to the dataset via `ctx.db.patch(job.datasetId, { questionCount: questions.length, realWorldQuestionCount })`. Filter in memory (acceptable at ≤200 questions).

**Frontend display:**

`GeneratedQuestion` type in `packages/frontend/src/lib/types.ts`:
- Add `source?: string` to the interface

`page.tsx`:
- Include `source: q.source` in the question mapping (lines 137–141 and 196–201)

Question list header (`QuestionList.tsx`):
- Accept `realWorldCount?: number` prop
- When not generating and `realWorldCount > 0`: `"50 total · 8 real-world"`

Per-question row:
- Small pill badge `real-world` in accent green (bg: `accent-dim`, text: `accent`) next to the question text when `question.source === "real-world"`
- No label on generated questions — they are the default

---

## 4. Enhanced Progress Banner

### Problem

The `GenerationBanner` shows `"Phase: generating (0/9 items)"` — unclear what "items" means, no question count, no visual progress indicator.

### Design

**Schema changes:**

`generationJobs` table:
- Add `questionsGenerated: v.optional(v.number())` — accumulated across documents as they complete

**Backend changes:**

The `generateForDoc` action already returns `{ questionsGenerated, failedCitations }` (extended to include `missedQuestions` per Section 1). In the `onDocGenerated` callback (`packages/backend/convex/generation/orchestration.ts`), read the return values and accumulate on the job record.

**Accessing return values from WorkPool:** The `result` parameter in `onDocGenerated` is a `RunResult` from `@convex-dev/workpool`. The implementer must check the exact field name for action return values on the `RunResult` type — likely `result.returnValue` but this should be verified against the workpool library's type definitions since no existing callback in the codebase reads return values. Pattern:

```typescript
if (result.kind === "success") {
  const returnValue = result.returnValue as { questionsGenerated?: number; missedQuestions?: number } | undefined;
  const newQuestionsGenerated = (job.questionsGenerated ?? 0) + (returnValue?.questionsGenerated ?? 0);
  const newMissedQuestions = (job.missedQuestions ?? 0) + (returnValue?.missedQuestions ?? 0);
  // include in the db.patch call
}
```

**Frontend `GenerationBanner.tsx` changes:**

New props:
- `questionsGenerated: number` (in addition to existing `strategy`, `kbName`, `phase`, `processedItems`, `totalItems`)

Layout:
- Line 1: `Generating: <strategy> on "<kbName>"`
- Line 2: `Phase: <phase> │ Docs: <processedItems> of <totalItems> │ Questions: <questionsGenerated>`
- Line 3: thin 2px progress bar — width percentage = `processedItems / totalItems * 100`

Preparation phase display (when `job.phase === "preparing"`):
- `Phase: Preparing │ Docs: — │ Questions: —`
- No progress bar

Generating phase display (when `job.phase === "generating"`):
- Show numeric counts and progress bar

**Frontend `QuestionList.tsx` changes:**

The inline phase status banner (shown when questions are already visible and generation is ongoing) also shows the structured format instead of the raw phase string:
- `Phase: Generating │ 3 of 9 docs │ 17 questions`

**Frontend `page.tsx` changes:**

Pass `questionsGenerated` from the job/activeJob record to `GenerationBanner`. The `getActiveJob` query returns the full job record spread, so `questionsGenerated` will be available automatically once the schema field is added.

Replace the current `displayPhaseStatus` string construction (lines 187–213) with structured format:
- When `phase === "preparing"`: `"Phase: Preparing │ Docs: — │ Questions: —"`
- When `phase === "generating"`: `` `Phase: Generating │ ${processedItems} of ${totalItems} docs │ ${questionsGenerated ?? 0} questions` ``

---

## 5. Review Step Allocation Fix

### Problem

`WizardStepReview.tsx` calculates each document's allocation independently with `Math.round(priority / totalWeight * totalQuestions)`, producing sums that don't equal the requested total due to rounding residuals. The backend uses "last gets remainder" which is correct.

### Design

**Fix the calculation in `WizardStepReview.tsx`:**

Replace the per-row independent rounding with the backend's algorithm (matching `calculateQuotas()` in `packages/eval-lib/src/synthetic-datagen/unified/quota.ts`, line 26):
1. Sort a **copy** of the documents array by priority ascending (for calculation only — display order remains unchanged)
2. For each doc except the last (by priority): `quota = Math.round(priority / totalWeight * totalQuestions)`
3. Track running sum
4. Last doc (highest priority) gets `totalQuestions - runningSum`
5. Return a `Map<docId, allocation>` that the render loop looks up

Extract this into a helper function `calculateAllocations(docs, totalQuestions)` defined in the same file. The frontend cannot import `calculateQuotas` from `rag-evaluation-system` (server-only package), so re-implement the algorithm. Reference `quota.ts` to match the exact logic.

**Footer row:**

Add a `<tfoot>` row:
- Left cell: `Total` (text-muted)
- Right cell: the sum in accent green (which now always equals `totalQuestions`)
- Separated from tbody by a slightly heavier border (`border-border-bright`)

**No backend changes** — the backend's allocation was already correct.

---

## File Map

### Eval-lib (modified)

| File | Change |
|------|--------|
| `packages/eval-lib/src/synthetic-datagen/unified/types.ts` | Rename `UnifiedQuestion.source` union: `"direct-reuse"` → `"real-world"` |
| `packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts` | Add `excludeQuestions` to `GenerateForDocumentParams` and `BuildPromptParams`; inject exclusions into `buildPrompt()` `[TASK]` section; update `"direct-reuse"` → `"real-world"` in prompt strings and response mapping |

### Backend (modified)

| File | Change |
|------|--------|
| `packages/backend/convex/schema.ts` | Add `missedQuestions`, `questionsGenerated` to `generationJobs`; add `realWorldQuestionCount` to `datasets`; add `source` to `questions` |
| `packages/backend/convex/generation/actions.ts` | Retry loop in `generateForDoc`; pass 2 ground truth enrichment (construct single-doc corpus, call assigner); return `missedQuestions`; write top-level `source` on inserted questions |
| `packages/backend/convex/generation/orchestration.ts` | Read `questionsGenerated` and `missedQuestions` from `result.returnValue` in `onDocGenerated`; accumulate on job; write `realWorldQuestionCount` to dataset on completion |
| `packages/backend/convex/crud/questions.ts` | Update `insertBatch` validator/mutation to accept and write top-level `source` field |

### Frontend (modified)

| File | Change |
|------|--------|
| `packages/frontend/src/lib/types.ts` | Add `source?: string` to `GeneratedQuestion` interface |
| `packages/frontend/src/components/GenerationBanner.tsx` | New `questionsGenerated` prop; structured layout with separators and progress bar |
| `packages/frontend/src/components/QuestionList.tsx` | Real-world pill badge per question; real-world count in header; structured phase status |
| `packages/frontend/src/components/WizardStepReview.tsx` | Correct allocation algorithm with remainder; footer row |
| `packages/frontend/src/app/generate/page.tsx` | Pass `questionsGenerated` to banner; derive structured `phaseStatus`; include `source` in question mapping |

### No new files created. No files deleted.

---

## Testing Approach

**Eval-lib:** Unit tests for `generateForDocument` with `excludeQuestions` parameter — verify exclusions appear in the prompt. Verify `source` field uses `"real-world"` (not `"direct-reuse"`) for direct reuses.

**Backend — retry loop:** Integration tests mocking a scenario where first pass produces fewer questions than quota. Verify retry fires with exclusions. Verify final count meets quota. Test `missedQuestions` tracking when all retries exhaust. Test `questionsGenerated` counter increments correctly.

**Backend — ground truth enrichment:** Test that pass 2 is called for each validated question. Test that single span is replaced with multi-span result. Test that failure in pass 2 (assigner returns empty results) falls back to the original single span without dropping the question.

**Backend — source tagging:** Test that `source: "real-world"` is written as top-level field on direct-reuse questions. Test `realWorldQuestionCount` is written to dataset on completion.

**Frontend — allocation:** Unit test for `calculateAllocations()` — verify the sum always equals `totalQuestions` for various doc counts and priority distributions. Specifically test edge cases: all same priority, one doc with priority 1 rest with 5, totalQuestions < numDocs.

**Frontend — build + visual:** TypeScript build verification (`pnpm -C packages/frontend build`). Manual visual checks for banner layout, question tags, allocation footer.
