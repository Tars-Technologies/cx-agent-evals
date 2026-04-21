# Generation Quality Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix question count shortfalls via per-document retries, add two-pass multi-span ground truth, tag real-world questions, improve progress visibility, and fix the review step allocation display.

**Architecture:** Five mostly-independent changes. Section 1 (retry loop) restructures the backend `generateForDoc` action and must land first — Sections 2, 3, and 4 build on it. Section 5 (allocation fix) is fully independent. The eval-lib remains stateless; retry logic and ground truth enrichment live in the backend action.

**Tech Stack:** TypeScript, Convex (backend mutations/actions/schema), Next.js 16 (App Router), Tailwind CSS v4, `rag-evaluation-system` eval-lib, `@convex-dev/workpool`.

**Spec:** `docs/superpowers/specs/2026-04-13-generation-quality-improvements-design.md`

---

## File Map

### Eval-lib (modified)

| File | Responsibility |
|------|---------------|
| `packages/eval-lib/src/synthetic-datagen/unified/types.ts` | Rename `UnifiedQuestion.source` union: `"direct-reuse"` → `"real-world"` |
| `packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts` | Add `excludeQuestions` parameter to `GenerateForDocumentParams`, `BuildPromptParams`, and `buildPrompt()`; update `"direct-reuse"` → `"real-world"` in prompt strings and response mapper |

### Backend (modified)

| File | Responsibility |
|------|---------------|
| `packages/backend/convex/schema.ts` | Add `missedQuestions`, `questionsGenerated` to `generationJobs`; add `realWorldQuestionCount` to `datasets`; add `source` to `questions` |
| `packages/backend/convex/generation/actions.ts` | Retry loop in `generateForDoc`; pass 2 ground truth enrichment; return `missedQuestions`; write top-level `source` on inserted questions |
| `packages/backend/convex/generation/orchestration.ts` | Read return values from `onDocGenerated` result; accumulate `questionsGenerated` and `missedQuestions`; write `realWorldQuestionCount` on completion |
| `packages/backend/convex/crud/questions.ts` | Update `insertBatch` validator to accept and write top-level `source` field |

### Frontend (modified)

| File | Responsibility |
|------|---------------|
| `packages/frontend/src/lib/types.ts` | Add `source?: string` to `GeneratedQuestion` |
| `packages/frontend/src/components/GenerationBanner.tsx` | Structured layout with phase/docs/questions and progress bar |
| `packages/frontend/src/components/QuestionList.tsx` | Real-world pill badge; real-world count in header; structured phase status |
| `packages/frontend/src/components/WizardStepReview.tsx` | Correct allocation algorithm; footer row |
| `packages/frontend/src/app/generate/page.tsx` | Pass new props to banner; structured `phaseStatus`; include `source` in question mapping |

No new files created. No files deleted.

---

## Verification Approach

**Eval-lib tests:** `pnpm test` (vitest in packages/eval-lib)
**Backend tests:** `pnpm -C packages/backend test` (convex-test)
**Backend deploy:** `cd packages/backend && npx convex dev --once`
**Frontend build:** `pnpm -C packages/frontend build`
**Eval-lib rebuild:** `pnpm build` (required after eval-lib changes before backend can see them)

---

## Task 1: Schema Changes

**Files:**
- Modify: `packages/backend/convex/schema.ts:75-85` (questions table)
- Modify: `packages/backend/convex/schema.ts:56-72` (datasets table)
- Modify: `packages/backend/convex/schema.ts:113-160` (generationJobs table)

**Why first:** Schema changes must land before any backend logic can reference the new fields. Deploying schema first ensures Convex type generation is up-to-date.

- [ ] **Step 1: Read the current schema**

Read `packages/backend/convex/schema.ts` lines 56–160 to confirm current field shapes for `datasets`, `questions`, and `generationJobs`.

- [ ] **Step 2: Add `source` to `questions` table**

In the `questions` table definition (line 75), add `source: v.optional(v.string())` after `metadata`:

```typescript
  questions: defineTable({
    datasetId: v.id("datasets"),
    queryId: v.string(),
    queryText: v.string(),
    sourceDocId: v.string(),
    relevantSpans: v.array(spanValidator),
    langsmithExampleId: v.optional(v.string()),
    metadata: v.any(),
    source: v.optional(v.string()),
  })
```

- [ ] **Step 3: Add `realWorldQuestionCount` to `datasets` table**

In the `datasets` table definition (line 56), add `realWorldQuestionCount: v.optional(v.number())` after `metadata`:

```typescript
    metadata: v.any(),
    realWorldQuestionCount: v.optional(v.number()),
    createdBy: v.id("users"),
```

- [ ] **Step 4: Add `questionsGenerated` and `missedQuestions` to `generationJobs` table**

In the `generationJobs` table definition, add after the `generationPlan` field (before the closing `})`:

```typescript
    generationPlan: v.optional(v.any()),
    questionsGenerated: v.optional(v.number()),
    missedQuestions: v.optional(v.number()),
  })
```

- [ ] **Step 5: Deploy to Convex**

Run: `cd packages/backend && npx convex dev --once`
Expected: `✔ Convex functions ready!` with no errors.

- [ ] **Step 6: Run backend tests**

Run: `pnpm -C packages/backend test`
Expected: All 96 tests pass. Schema additions are backward-compatible — no test should break.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add schema fields for generation quality improvements

Adds source to questions, realWorldQuestionCount to datasets,
questionsGenerated and missedQuestions to generationJobs."
```

---

## Task 2: Eval-lib — Rename `source` values + add `excludeQuestions` parameter

**Files:**
- Modify: `packages/eval-lib/src/synthetic-datagen/unified/types.ts:40-46`
- Modify: `packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts:35-43,105-157,269-278,334-340`

**Why second:** Backend retry loop (Task 3) needs the `excludeQuestions` parameter. Source rename is bundled here since it touches the same files.

- [ ] **Step 1: Read the current types and per-doc-generation code**

Read `packages/eval-lib/src/synthetic-datagen/unified/types.ts` lines 40–46 and `packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts` lines 35–43, 105–157, 269–278, 334–340.

- [ ] **Step 2: Rename `source` union in `types.ts`**

In `UnifiedQuestion` (line 43 of types.ts), change:

```typescript
  readonly source: "generated" | "direct-reuse";
```

to:

```typescript
  readonly source: "generated" | "real-world";
```

- [ ] **Step 3: Add `excludeQuestions` to `BuildPromptParams`**

In `BuildPromptParams` (line 35 of per-doc-generation.ts), add:

```typescript
export interface BuildPromptParams {
  readonly scenario: GenerationScenario;
  readonly docContent: string;
  readonly quota: number;
  readonly matched: readonly MatchedRealWorldQuestion[];
  readonly combos: ReadonlyArray<Record<string, string>>;
  readonly preferences: PromptPreferences;
  readonly model: string;
  readonly excludeQuestions?: readonly string[];
}
```

- [ ] **Step 4: Add `excludeQuestions` to `GenerateForDocumentParams`**

In `GenerateForDocumentParams` (line 269), add:

```typescript
export interface GenerateForDocumentParams {
  readonly docId: string;
  readonly docContent: string;
  readonly quota: number;
  readonly matched: readonly MatchedRealWorldQuestion[];
  readonly combos: ReadonlyArray<Record<string, string>>;
  readonly preferences: PromptPreferences;
  readonly llmClient: LLMClient;
  readonly model: string;
  readonly excludeQuestions?: readonly string[];
}
```

- [ ] **Step 5: Inject exclusions into `buildPrompt()` `[TASK]` section**

In `buildPrompt()`, after the `[TASK]` section's citation instruction (after the line `For each question, provide a "citation" as a verbatim excerpt...`), add:

```typescript
  // Exclusions for retry rounds
  if (params.excludeQuestions && params.excludeQuestions.length > 0) {
    parts.push("");
    parts.push(
      "IMPORTANT: Do NOT generate questions similar to the following (these have already been generated):",
    );
    params.excludeQuestions.forEach((q, i) => {
      parts.push(`  ${i + 1}. ${q}`);
    });
  }
```

- [ ] **Step 6: Pass `excludeQuestions` through in `generateForDocument()`**

In `generateForDocument()` (line 284), pass the parameter to `buildPrompt`:

Find where `buildPrompt` is called (around line 298) and add `excludeQuestions: params.excludeQuestions`:

```typescript
    const { system, user } = buildPrompt({
      scenario,
      docContent: params.docContent,
      quota: params.quota,
      matched: params.matched,
      combos: params.combos,
      preferences: params.preferences,
      model: params.model,
      excludeQuestions: params.excludeQuestions,
    });
```

- [ ] **Step 7: Rename `"direct-reuse"` → `"real-world"` in prompt strings**

In `buildPrompt()`:
- Line 119: Change `"direct-reuse"` to `"real-world"` in the scenario 1 instruction
- Line 140: Change `"direct-reuse"` to `"real-world"` in the scenario 2 instruction

In the response mapper (line 337):

```typescript
  return parsed.map((q) => ({
    question: q.question,
    citation: q.citation,
    source: q.source === "real-world" ? "real-world" : "generated",
    profile: q.profile,
    docId,
  }));
```

- [ ] **Step 8: Run eval-lib tests**

Run: `pnpm test`
Expected: Some tests may fail if they assert on `"direct-reuse"` — update those assertions to `"real-world"`. All tests must pass after fixes.

- [ ] **Step 9: Rebuild eval-lib**

Run: `pnpm build`
Expected: Build succeeds. This is required before backend can see the changes.

- [ ] **Step 10: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/unified/types.ts packages/eval-lib/src/synthetic-datagen/unified/per-doc-generation.ts
git commit -m "feat(eval-lib): add excludeQuestions param and rename source to real-world

generateForDocument() now accepts excludeQuestions for retry rounds.
Source value renamed from direct-reuse to real-world for UI clarity."
```

---

## Task 3: Backend — Retry loop in `generateForDoc`

**Files:**
- Modify: `packages/backend/convex/generation/actions.ts:316-422`

**Why third:** This restructures the core action. Tasks 4 and 5 build on this structure.

- [ ] **Step 1: Read the current `generateForDoc` action**

Read `packages/backend/convex/generation/actions.ts` lines 316–422 to understand the full generate → validate → insert flow.

- [ ] **Step 2: Wrap the generate → validate cycle in a retry loop**

Replace the body of the `generateForDoc` handler (lines 330–421) with the retry loop. The key structure:

```typescript
  handler: async (ctx, args) => {
    if (args.quota === 0) return { questionsGenerated: 0, failedCitations: 0, missedQuestions: 0 };

    // Read shared plan data from job record
    const job = await ctx.runQuery(
      internal.generation.orchestration.getJobInternal,
      { jobId: args.jobId },
    );
    const sharedPlan = (job?.generationPlan ?? {}) as {
      validCombos?: Record<string, string>[];
      globalStyleExamples?: string[];
      preferences?: any;
    };

    const doc = await ctx.runQuery(internal.crud.documents.getInternal, {
      id: args.docConvexId,
    });
    const llmClient = createLLMClient();

    // Determine scenario for retry eligibility
    const matchedCount = (args.matchedQuestions ?? []).length;
    const isScenario1 = matchedCount >= args.quota;

    const allValidated: Array<{
      queryId: string;
      queryText: string;
      sourceDocId: string;
      relevantSpans: Array<{ docId: string; start: number; end: number; text: string }>;
      metadata: Record<string, unknown>;
      source: string | undefined;
    }> = [];
    let totalFailedCitations = 0;
    const MAX_RETRIES = 4;

    for (let round = 0; round <= MAX_RETRIES; round++) {
      const remaining = args.quota - allValidated.length;
      if (remaining <= 0) break;

      // Skip retry loop for scenario 1 (direct reuse only — fixed question set)
      if (round > 0 && isScenario1) break;
      // For retries, request shortfall + 2 buffer
      if (round > 0 && remaining <= 0) break;

      const requestCount = round === 0 ? args.quota : remaining + 2;
      const excludeQuestions = round === 0
        ? undefined
        : allValidated.map((q) => q.queryText);

      const rawQuestions = await generateForDocument({
        docId: args.docId,
        docContent: doc.content,
        quota: requestCount,
        // Always pass matched — style examples should be available on every round
        matched: args.matchedQuestions ?? [],
        combos: sharedPlan.validCombos ?? [],
        preferences: sharedPlan.preferences ?? {
          questionTypes: ["factoid", "procedural", "conditional"],
          tone: "professional but accessible",
          focusAreas: "",
        },
        llmClient,
        model: args.model,
        excludeQuestions,
      });

      // Validate citations
      for (const q of rawQuestions) {
        if (allValidated.length >= args.quota) break;

        const span = findCitationSpan(doc.content, q.citation);
        if (span) {
          allValidated.push({
            queryId: `unified_${args.docId}_q${allValidated.length}`,
            queryText: q.question,
            sourceDocId: args.docId,
            relevantSpans: [
              { docId: args.docId, start: span.start, end: span.end, text: span.text },
            ],
            metadata: {
              source: q.source,
              profile: q.profile ?? "",
              citation: span.text,
            },
            // Top-level source field added in Task 4 (insertBatch validator update)
            source: q.source === "real-world" ? "real-world" : undefined,
          });
        } else {
          totalFailedCitations++;
        }
      }
    }

    const missedQuestions = args.quota - allValidated.length;

    // Insert questions in batches
    if (allValidated.length > 0) {
      for (let i = 0; i < allValidated.length; i += QUESTION_INSERT_BATCH_SIZE) {
        const batch = allValidated.slice(i, i + QUESTION_INSERT_BATCH_SIZE);
        await ctx.runMutation(internal.crud.questions.insertBatch, {
          datasetId: args.datasetId,
          questions: batch,
        });
      }
    }

    // Report progress (once, after all retries)
    await ctx.runMutation(
      internal.generation.orchestration.updateDocProgress,
      { jobId: args.jobId, docName: doc.title },
    );

    return {
      questionsGenerated: allValidated.length,
      failedCitations: totalFailedCitations,
      missedQuestions: missedQuestions > 0 ? missedQuestions : 0,
    };
  },
```

Note: The `source` field on each question record is set as a top-level field for the `insertBatch` call — this is wired in Task 4 (insertBatch validator update).

- [ ] **Step 3: Do NOT deploy or commit yet**

Task 3 and Task 4 must be deployed together — the `source` field on question records requires the `insertBatch` validator update from Task 4. Proceed directly to Task 4.

---

## Task 4: Backend — Update `insertBatch` + `onDocGenerated` + source tagging

**Files:**
- Modify: `packages/backend/convex/crud/questions.ts:28-65`
- Modify: `packages/backend/convex/generation/orchestration.ts:490-562`

- [ ] **Step 1: Read the current `insertBatch` and `onDocGenerated`**

Read `packages/backend/convex/crud/questions.ts` lines 28–65 and `packages/backend/convex/generation/orchestration.ts` lines 490–562.

- [ ] **Step 2: Add `source` to `insertBatch` validator and insertion**

In the `insertBatch` validator (line 32), add `source: v.optional(v.string())`:

```typescript
    questions: v.array(
      v.object({
        queryId: v.string(),
        queryText: v.string(),
        sourceDocId: v.string(),
        relevantSpans: v.array(spanValidator),
        metadata: v.optional(v.any()),
        source: v.optional(v.string()),
      }),
    ),
```

In the insertion block (around line 55), add `source` to the `ctx.db.insert` call:

```typescript
      const id = await ctx.db.insert("questions", {
        datasetId: args.datasetId,
        queryId: q.queryId,
        queryText: q.queryText,
        sourceDocId: q.sourceDocId,
        relevantSpans: q.relevantSpans,
        metadata: q.metadata ?? {},
        source: q.source,
      });
```

- [ ] **Step 3: Update `onDocGenerated` to accumulate return values**

In `onDocGenerated` (orchestration.ts line 490), after `const counters = applyResult(...)` and `const docsProcessed = ...`, add return value reading:

```typescript
    // Accumulate return values from generateForDoc
    let newQuestionsGenerated = job.questionsGenerated ?? 0;
    let newMissedQuestions = job.missedQuestions ?? 0;
    if (result.kind === "success" && result.returnValue) {
      const rv = result.returnValue as {
        questionsGenerated?: number;
        missedQuestions?: number;
      };
      newQuestionsGenerated += rv.questionsGenerated ?? 0;
      newMissedQuestions += rv.missedQuestions ?? 0;
    }
```

Note: Check `result.kind` and the actual field name for the return value on `RunResult` from `@convex-dev/workpool`. It may be `result.returnValue` or similar — inspect the workpool type definition to confirm.

Then include these in ALL `ctx.db.patch` calls in `onDocGenerated`:
- In the `isComplete` + canceling branch: add `questionsGenerated: newQuestionsGenerated, missedQuestions: newMissedQuestions`
- In the `isComplete` + normal completion branch: add `questionsGenerated: newQuestionsGenerated, missedQuestions: newMissedQuestions`
- In the non-complete branch: add `questionsGenerated: newQuestionsGenerated, missedQuestions: newMissedQuestions`

- [ ] **Step 4: Write `realWorldQuestionCount` on completion**

In the `isComplete` branch, after the existing `questionCount` query and patch (lines 524–531), count real-world questions and include in the dataset patch:

```typescript
      const realWorldQuestionCount = questions.filter(
        (q) => q.source === "real-world"
      ).length;

      await ctx.db.patch(job.datasetId, {
        questionCount: questions.length,
        realWorldQuestionCount,
      });
```

- [ ] **Step 5: Deploy to Convex (Tasks 3 + 4 together)**

Run: `cd packages/backend && npx convex dev --once`
Expected: Succeeds. This deploys both the retry loop (Task 3) and the insertBatch/orchestration changes together.

- [ ] **Step 6: Run backend tests**

Run: `pnpm -C packages/backend test`
Expected: All tests pass. If any test asserts on `insertBatch` args or `onDocGenerated` patches, update to include the new fields.

- [ ] **Step 7: Commit Tasks 3 + 4 together**

```bash
git add packages/backend/convex/generation/actions.ts packages/backend/convex/crud/questions.ts packages/backend/convex/generation/orchestration.ts
git commit -m "feat(backend): retry loop, source tagging, progress accumulation

Adds max-4-round retry loop to generateForDoc. insertBatch writes
top-level source field. onDocGenerated accumulates questionsGenerated
and missedQuestions. Writes realWorldQuestionCount on completion."
```

---

## Task 5: Backend — Pass 2 ground truth enrichment in `generateForDoc`

**Files:**
- Modify: `packages/backend/convex/generation/actions.ts` (inside the retry loop, after validation, before insertion)

- [ ] **Step 1: Read the existing `assignGroundTruthForQuestion` for reference**

Read `packages/backend/convex/generation/actions.ts` lines 424–476 to understand how `GroundTruthAssigner` is called in the non-unified pipeline. Note: it uses `loadCorpusFromKb`, `createCorpusFromDocuments`, and `assigner.assign()`.

- [ ] **Step 2: Add ground truth enrichment after the retry loop, before insertion**

In `generateForDoc` (modified in Task 3), after the retry loop completes and before the `// Insert questions in batches` section, add:

```typescript
    // Pass 2: Enrich with multi-span ground truth
    const assigner = new GroundTruthAssigner();
    const singleDocCorpus = createCorpusFromDocuments([
      { docId: args.docId, content: doc.content },
    ]);

    for (const question of allValidated) {
      try {
        const results = await assigner.assign(
          [
            {
              query: question.queryText,
              targetDocId: question.sourceDocId,
              metadata: (question.metadata ?? {}) as Record<string, string>,
            },
          ],
          { corpus: singleDocCorpus, llmClient, model: args.model },
        );

        if (results.length > 0 && results[0].relevantSpans.length > 0) {
          question.relevantSpans = results[0].relevantSpans.map((s) => ({
            docId: String(s.docId),
            start: s.start,
            end: s.end,
            text: s.text,
          }));
        }
        // If no results or empty spans, keep the original single span from pass 1
      } catch {
        // Swallow — keep original single span
      }
    }
```

Note: `GroundTruthAssigner` and `createCorpusFromDocuments` are already imported at the top of `actions.ts` (line 11, 13). Verify they are still there after Task 3 changes.

- [ ] **Step 3: Deploy to Convex**

Run: `cd packages/backend && npx convex dev --once`
Expected: Succeeds.

- [ ] **Step 4: Run backend tests**

Run: `pnpm -C packages/backend test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/generation/actions.ts
git commit -m "feat(backend): add pass 2 multi-span ground truth enrichment

After retry loop validates questions with single spans, calls
GroundTruthAssigner to find all relevant passages. Falls back to
single span if enrichment fails."
```

---

## Task 6: Frontend — Review step allocation fix

**Files:**
- Modify: `packages/frontend/src/components/WizardStepReview.tsx:38,80-111`

**Why now:** This is independent of all backend changes and can land anytime. Doing it now since it's self-contained.

- [ ] **Step 1: Read the current allocation code**

Read `packages/frontend/src/components/WizardStepReview.tsx` lines 38–111.

- [ ] **Step 2: Add `calculateAllocations` helper**

Above the component function (after the imports, around line 24), add:

```typescript
function calculateAllocations(
  docs: DocInfo[],
  totalQuestions: number,
): Map<string, number> {
  const allocations = new Map<string, number>();
  const totalWeight = docs.reduce((s, d) => s + d.priority, 0);
  if (totalWeight === 0 || docs.length === 0) return allocations;

  if (totalQuestions < docs.length) {
    const sorted = [...docs].sort((a, b) => b.priority - a.priority);
    for (let i = 0; i < sorted.length; i++) {
      allocations.set(sorted[i]._id, i < totalQuestions ? 1 : 0);
    }
    return allocations;
  }

  // Sort ascending — lowest priority first, highest last gets remainder
  const sorted = [...docs].sort((a, b) => a.priority - b.priority);
  let allocated = 0;

  for (let i = 0; i < sorted.length; i++) {
    if (i === sorted.length - 1) {
      allocations.set(sorted[i]._id, totalQuestions - allocated);
    } else {
      const quota = Math.round(
        (sorted[i].priority / totalWeight) * totalQuestions,
      );
      allocations.set(sorted[i]._id, quota);
      allocated += quota;
    }
  }

  return allocations;
}
```

- [ ] **Step 3: Replace per-row calculation with the helper**

Remove the inline `totalWeight` calculation (line 38):

```typescript
  const totalWeight = documents.reduce((s, d) => s + d.priority, 0);
```

Replace with:

```typescript
  const allocations = calculateAllocations(documents, config.totalQuestions);
```

In the table body, replace the per-row allocation (lines 93–96):

```typescript
                  const alloc = totalWeight > 0
                    ? Math.round((doc.priority / totalWeight) * config.totalQuestions)
                    : 0;
```

with:

```typescript
                  const alloc = allocations.get(doc._id) ?? 0;
```

- [ ] **Step 4: Add footer row**

After the `</tbody>`, before `</table>`, add:

```tsx
              <tfoot>
                <tr className="border-t-2 border-border-bright">
                  <td className="px-3 py-2 text-text-muted text-xs font-medium">Total</td>
                  <td className="px-3 py-2 text-center"></td>
                  <td className="px-3 py-2 text-right font-mono text-accent text-xs font-medium">
                    {config.totalQuestions}
                  </td>
                </tr>
              </tfoot>
```

- [ ] **Step 5: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/WizardStepReview.tsx
git commit -m "fix(frontend): correct allocation algorithm in review step

Replaces per-row Math.round with last-gets-remainder algorithm matching
the backend. Adds footer row showing the total."
```

---

## Task 7: Frontend — Enhanced progress banner

**Files:**
- Modify: `packages/frontend/src/components/GenerationBanner.tsx`
- Modify: `packages/frontend/src/app/generate/page.tsx:186-214,254-272`

- [ ] **Step 1: Read the current banner and page.tsx**

Read `packages/frontend/src/components/GenerationBanner.tsx` and `packages/frontend/src/app/generate/page.tsx` lines 186–272.

- [ ] **Step 2: Update `GenerationBanner` props and layout**

Replace the entire `GenerationBanner` component:

```tsx
"use client";

interface GenerationBannerProps {
  strategy: string;
  kbName: string;
  phase: string;
  processedItems: number;
  totalItems: number;
  questionsGenerated: number;
  onView: () => void;
}

export function GenerationBanner({
  strategy,
  kbName,
  phase,
  processedItems,
  totalItems,
  questionsGenerated,
  onView,
}: GenerationBannerProps) {
  const isPreparing = phase === "preparing";
  const progress = totalItems > 0 ? (processedItems / totalItems) * 100 : 0;

  return (
    <div className="mx-4 mt-3 mb-1 px-4 py-2.5 rounded-lg border border-accent/30 bg-accent/5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs text-text font-medium truncate">
              Generating: <span className="text-accent">{strategy}</span> on &ldquo;{kbName}&rdquo;
            </div>
            <div className="flex items-center gap-0 mt-1">
              <span className="text-[10px] text-text-dim">Phase:</span>
              <span className="text-[10px] text-accent-bright ml-1">{isPreparing ? "Preparing" : "Generating"}</span>
              <span className="text-[10px] text-border mx-2.5">│</span>
              <span className="text-[10px] text-text-dim">Docs:</span>
              <span className="text-[10px] text-text ml-1">
                {isPreparing ? "—" : <>{processedItems} <span className="text-text-dim">of</span> {totalItems}</>}
              </span>
              <span className="text-[10px] text-border mx-2.5">│</span>
              <span className="text-[10px] text-text-dim">Questions:</span>
              <span className="text-[10px] text-accent ml-1">{isPreparing ? "—" : questionsGenerated}</span>
            </div>
            {!isPreparing && (
              <div className="mt-1.5 h-[2px] w-[280px] bg-border rounded-sm overflow-hidden">
                <div
                  className="h-full bg-accent rounded-sm transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onView}
          className="flex-shrink-0 ml-3 px-3 py-1 text-[10px] font-medium text-accent border border-accent/30 rounded
                     hover:bg-accent/10 transition-colors cursor-pointer"
        >
          View
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `page.tsx` — pass `questionsGenerated` to banner**

In the `<GenerationBanner>` usage (around line 256), add the new prop:

```tsx
          <GenerationBanner
            strategy={activeJob.strategy}
            kbName={activeJobKb?.name ?? "..."}
            phase={activeJob.phase}
            processedItems={activeJob.processedItems}
            totalItems={activeJob.totalItems}
            questionsGenerated={activeJob.questionsGenerated ?? 0}
            onView={() => { ... }}
          />
```

- [ ] **Step 4: Update `page.tsx` — structured `phaseStatus`**

Replace the `phaseStatus` construction (line 187–188):

```typescript
  const phaseStatus = job?.phase
    ? `${job.phase}... (${job.processedItems}/${job.totalItems})`
    : null;
```

with:

```typescript
  const phaseStatus = job?.phase
    ? job.phase === "preparing"
      ? "Phase: Preparing │ Docs: — │ Questions: —"
      : `Phase: Generating │ ${job.processedItems} of ${job.totalItems} docs │ ${job.questionsGenerated ?? 0} questions`
    : null;
```

Similarly update the `displayPhaseStatus` for the browse-active-dataset path (line 213):

```typescript
      ? activeJob.phase === "preparing"
        ? "Phase: Preparing │ Docs: — │ Questions: —"
        : `Phase: Generating │ ${activeJob.processedItems} of ${activeJob.totalItems} docs │ ${activeJob.questionsGenerated ?? 0} questions`
```

- [ ] **Step 5: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/components/GenerationBanner.tsx packages/frontend/src/app/generate/page.tsx
git commit -m "feat(frontend): enhanced progress banner with phase/docs/questions

Shows Phase: Generating │ Docs: 3 of 9 │ Questions: 17 with a
progress bar. Preparing phase shows dash placeholders."
```

---

## Task 8: Frontend — Real-world question tagging

**Files:**
- Modify: `packages/frontend/src/lib/types.ts:14-18`
- Modify: `packages/frontend/src/components/QuestionList.tsx:5-55,103-124`
- Modify: `packages/frontend/src/app/generate/page.tsx:137-141,195-201`

- [ ] **Step 1: Add `source` to `GeneratedQuestion` type**

In `packages/frontend/src/lib/types.ts`, add `source` to the interface:

```typescript
export interface GeneratedQuestion {
  docId: string;
  query: string;
  relevantSpans?: SpanInfo[];
  source?: string;
}
```

- [ ] **Step 2: Include `source` in question mapping in `page.tsx`**

In the generate-mode mapping (line 139):

```typescript
  const questions: GeneratedQuestion[] = (questionsData ?? []).map((q) => ({
    docId: q.sourceDocId,
    query: q.queryText,
    relevantSpans: q.relevantSpans,
    source: q.source,
  }));
```

In the browse-mode mapping (line 197):

```typescript
      ? (browseQuestions ?? []).map((q) => ({
          docId: q.sourceDocId,
          query: q.queryText,
          relevantSpans: q.relevantSpans,
          source: q.source,
        }))
```

- [ ] **Step 3: Update `QuestionList` header to show real-world count**

In `QuestionList.tsx`, add `realWorldCount` to the props:

```typescript
  realWorldCount?: number;
```

Update the header count display (lines 44–55). Replace the non-generating display:

```tsx
          {generating ? (
            <span className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-accent animate-pulse-dot" />
              {questions.length} generated
            </span>
          ) : totalDone !== null ? (
            <>
              {totalDone} total
              {realWorldCount && realWorldCount > 0 && (
                <span className="text-accent"> · {realWorldCount} real-world</span>
              )}
            </>
          ) : (
            `${questions.length}`
          )}
```

- [ ] **Step 4: Add real-world pill badge to question rows**

In the question button (lines 115–118), add the badge next to the question text:

```tsx
                <p className="text-xs text-text leading-relaxed">
                  {question.query}
                </p>
                {question.source === "real-world" && (
                  <span className="inline-block text-[9px] text-accent bg-accent-dim px-1.5 py-0.5 rounded mt-1">
                    real-world
                  </span>
                )}
```

- [ ] **Step 5: Pass `realWorldCount` from `page.tsx` to `QuestionList`**

In `page.tsx`, compute and pass the count. Find the `<QuestionList>` usage and add:

```tsx
                  realWorldCount={
                    !displayGenerating
                      ? displayQuestions.filter((q) => q.source === "real-world").length
                      : undefined
                  }
```

Alternatively, if the dataset has `realWorldQuestionCount`, read it from the dataset query for the browse path.

- [ ] **Step 6: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/lib/types.ts packages/frontend/src/components/QuestionList.tsx packages/frontend/src/app/generate/page.tsx
git commit -m "feat(frontend): real-world question tags and count

Questions sourced from the real-world list show a pill badge.
Header displays the count alongside total."
```

---

## Task 9: End-to-end verification

**Files:** None modified — verification only.

- [ ] **Step 1: Full TypeScript builds**

Run: `pnpm -C packages/frontend build`
Expected: Succeeds.

- [ ] **Step 2: Backend deploy**

Run: `cd packages/backend && npx convex dev --once`
Expected: Succeeds.

- [ ] **Step 3: Backend tests**

Run: `pnpm -C packages/backend test`
Expected: All tests pass.

- [ ] **Step 4: Eval-lib tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 5: Verify commit history**

Run: `git log --oneline HEAD~8..HEAD`
Expected: ~8 clean commits with clear feat/fix prefixes.

- [ ] **Step 6: No commit for this task**

Task 9 is verification only.

---

## Summary

| Task | Files | Key change |
|------|-------|------------|
| 1. Schema changes | `schema.ts` | Add source, questionsGenerated, missedQuestions, realWorldQuestionCount |
| 2. Eval-lib params + source rename | `types.ts`, `per-doc-generation.ts` | excludeQuestions param, direct-reuse → real-world |
| 3. Backend retry loop | `actions.ts` | Max 4 retry rounds in generateForDoc |
| 4. Backend insertion + orchestration | `questions.ts`, `orchestration.ts` | Source field in insertBatch, accumulate counters in onDocGenerated |
| 5. Backend ground truth enrichment | `actions.ts` | Pass 2 multi-span via GroundTruthAssigner |
| 6. Frontend allocation fix | `WizardStepReview.tsx` | Last-gets-remainder + footer row |
| 7. Frontend progress banner | `GenerationBanner.tsx`, `page.tsx` | Structured Phase │ Docs │ Questions display |
| 8. Frontend real-world tags | `types.ts`, `QuestionList.tsx`, `page.tsx` | Pill badge + count |
| 9. End-to-end verification | (none) | Build + test + deploy |

Total: ~8 commits across ~10 files. No new files, no deletions.
