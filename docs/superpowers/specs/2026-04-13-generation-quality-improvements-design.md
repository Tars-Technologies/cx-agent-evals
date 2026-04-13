# Generation Quality Improvements — Design Spec

**Goal:** Fix question count shortfalls, add multi-span ground truth, tag real-world questions, improve progress visibility, and fix the review step allocation display.

**Scope:** Changes to eval-lib (generation pipeline), Convex backend (orchestration, schema), and Next.js frontend (banner, question list, review step).

**Out of scope:** Real-world question matching algorithm improvements (parking for a future iteration). Skipped-question visibility (future — belongs in the knowledge base section).

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

**Shortfall tracking:**
- Add `missedQuestions` field to the generation job record (sum of unfulfilled quotas across all docs)
- Surfaced in the UI so the user knows if the final count fell short and by how much

### Eval-lib changes

`generateForDocument()` in `packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts`:
- Accept an optional `excludeQuestions: string[]` parameter
- When provided, append to the LLM prompt: "Do NOT generate questions similar to the following: [list]"
- No other changes — eval-lib remains single-pass

### Backend changes

`generateForDoc` action in `packages/backend/convex/generation/actions.ts`:
- Wrap the generate → validate cycle in a retry loop (max 4 rounds)
- Track succeeded questions across rounds; pass as exclusions to subsequent rounds
- After loop completes, compute `missedQuestions` for this document and include in the callback patch

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

**Fallback:** If pass 2 fails for a specific question (LLM error, no excerpts found), keep the single span from pass 1. The question is never dropped at this stage. Per-question failures are swallowed silently (not retried via WorkPool) — the single span from pass 1 is an acceptable fallback.

**No retries for pass 2** — the question is already confirmed answerable from pass 1. Pass 2 only enriches the span coverage.

**Cost:** One additional LLM call per validated question. For 50 questions, ~50 short-prompt calls. Modest overhead for significantly better ground truth accuracy.

### Eval-lib changes

Wire the existing `GroundTruthAssigner` into the unified pipeline. The assigner already supports multi-span — it just wasn't called from the unified flow. No changes to the assigner itself.

### Backend changes

In `generateForDoc` action: after the retry loop produces validated questions, call the ground truth assigner for each question before inserting into the database. Replace the single span with the multi-span result (or keep the original if enrichment fails). This happens entirely within the single `generateForDoc` action — no new WorkPool phase, no new callbacks.

---

## 3. Real-World Question Tagging

### Problem

No way to distinguish which questions came directly from the user's real-world input vs. were LLM-generated. Users can't see how many of their seed questions were actually used.

### Design

**Existing state:** The pipeline already carries a `source` field through the flow. `generateForDocument()` (eval-lib) returns `source: "direct-reuse"` or `source: "generated"` on each `UnifiedQuestion`. The backend action (`generateForDoc`) already reads `q.source` and stores it in `metadata.source` on each inserted question. However, `source` lives buried in the `metadata` JSON blob — not queryable or directly visible to the frontend.

**Schema changes:**

`questions` table (`packages/backend/convex/schema.ts`):
- Add `source: v.optional(v.string())` as a **top-level field** — value `"real-world"` for direct reuses, `undefined` for generated
- This promotes the existing `metadata.source` to a first-class field with a renamed value (`"direct-reuse"` → `"real-world"` for user-facing clarity)
- No data migration needed — only new questions get the top-level field. Existing questions can still be read via `metadata.source` as a fallback if needed, but this is not required for the current UI changes.

`datasets` table:
- Add `realWorldQuestionCount: v.optional(v.number())` — set when generation completes

**How source gets set:**

In `generateForDocument()` (eval-lib), rename the existing `source: "direct-reuse"` value to `source: "real-world"` for questions that are direct reuses from the real-world list. LLM-generated questions keep `source: "generated"` (or `undefined`).

The backend action reads this field and writes it as a **top-level `source` field** on the question record (in addition to the existing `metadata.source` for backward compatibility).

After all documents are processed, count the total `source === "real-world"` questions and write `realWorldQuestionCount` to the dataset record.

**Frontend display:**

Question list header (`QuestionList.tsx`):
- When not generating: `"50 total · 8 real-world"` (only show the real-world count if > 0)

Per-question row:
- Small pill badge `real-world` in accent green (bg: `accent-dim`, text: `accent`) next to the question text
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

The `generateForDoc` action already returns `{ questionsGenerated, failedCitations }`. In the `onDocGenerated` callback (`packages/backend/convex/generation/orchestration.ts`), read `questionsGenerated` from `result.returnValue` and accumulate it on the job record:

```
const returnValue = result.returnValue as { questionsGenerated?: number } | undefined;
const newQuestionsGenerated = (job.questionsGenerated ?? 0) + (returnValue?.questionsGenerated ?? 0);
await ctx.db.patch(context.jobId, { ...counterPatch(counters), questionsGenerated: newQuestionsGenerated, docsProcessed });
```

This threads the per-document question count through the existing WorkPool callback pattern — no separate `ctx.runMutation` call needed.

**Frontend `GenerationBanner.tsx` changes:**

New props:
- `questionsGenerated: number` (in addition to existing `strategy`, `kbName`, `phase`, `processedItems`, `totalItems`)

Layout:
- Line 1: `Generating: <strategy> on "<kbName>"`
- Line 2: `Phase: <phase> │ Docs: <processedItems> of <totalItems> │ Questions: <questionsGenerated>`
- Line 3: thin 2px progress bar — width percentage = `processedItems / totalItems * 100`

Preparation phase (before per-doc generation starts):
- `Phase: Preparing │ Docs: — │ Questions: —`
- No progress bar

**Frontend `QuestionList.tsx` changes:**

The inline phase status banner (shown when questions are already visible and generation is ongoing) also shows the structured format instead of the raw phase string:
- `Phase: Generating │ 3 of 9 docs │ 17 questions`

**Frontend `page.tsx` changes:**

Pass `questionsGenerated` from the job/activeJob record to `GenerationBanner` and derive the structured `phaseStatus` string for `QuestionList`.

---

## 5. Review Step Allocation Fix

### Problem

`WizardStepReview.tsx` calculates each document's allocation independently with `Math.round(priority / totalWeight * totalQuestions)`, producing sums that don't equal the requested total due to rounding residuals. The backend uses "last gets remainder" which is correct.

### Design

**Fix the calculation in `WizardStepReview.tsx`:**

Replace the per-row independent rounding with the backend's algorithm:
1. Sort documents by priority ascending
2. For each doc except the last: `quota = Math.round(priority / totalWeight * totalQuestions)`
3. Track running sum
4. Last doc gets `totalQuestions - runningSum`

Extract this into a helper function `calculateAllocations(docs, totalQuestions)` defined in the same file (no shared module needed — the backend uses eval-lib's version).

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
| `packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts` | Add `excludeQuestions` parameter; add `source` field to returned questions |
| `packages/eval-lib/src/synthetic-datagen/unified/generator.ts` | Wire ground truth assigner into unified pipeline (pass 2) |

### Backend (modified)

| File | Change |
|------|--------|
| `packages/backend/convex/schema.ts` | Add `missedQuestions`, `questionsGenerated` to `generationJobs`; add `realWorldQuestionCount` to `datasets`; add `source` to `questions` |
| `packages/backend/convex/generation/actions.ts` | Retry loop in `generateForDoc`; pass 2 ground truth enrichment; track `questionsGenerated` and `missedQuestions`; set `source` on inserted questions |
| `packages/backend/convex/generation/orchestration.ts` | Pass `questionsGenerated` through callback; write `realWorldQuestionCount` to dataset on completion |

### Frontend (modified)

| File | Change |
|------|--------|
| `packages/frontend/src/components/GenerationBanner.tsx` | New `questionsGenerated` prop; structured layout with separators and progress bar |
| `packages/frontend/src/components/QuestionList.tsx` | Real-world pill badge per question; real-world count in header; structured phase status |
| `packages/frontend/src/components/WizardStepReview.tsx` | Correct allocation algorithm with remainder; footer row |
| `packages/frontend/src/app/generate/page.tsx` | Pass `questionsGenerated` to banner; derive structured phase status |

### No new files created. No files deleted.

---

## Testing Approach

**Eval-lib:** Unit tests for `generateForDocument` with `excludeQuestions` parameter. Verify exclusions appear in the prompt. Verify `source` field is set correctly for real-world vs. generated questions.

**Backend:** Integration tests for the retry loop — mock a scenario where first pass produces fewer questions than quota, verify retry fires with exclusions, verify final count meets quota. Test `missedQuestions` tracking when retries exhaust. Test `questionsGenerated` counter increments correctly. Test `realWorldQuestionCount` is written to dataset.

**Frontend:** TypeScript build verification. Manual visual checks for banner layout, question tags, allocation footer.
