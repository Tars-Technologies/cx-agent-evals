# Multi-Span Ground Truth Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve multi-span ground truth coverage so most questions get 2–3+ relevant spans instead of the current single citation span.

**Architecture:** Four tasks touching two packages. Task 1 is the largest — all eval-lib changes to `token-level.ts` (stronger prompt, fuzzy matching, higher char limit, diagnostic return type) are bundled together since they modify the same file. Task 2 adds backend schema fields. Task 3 wires up pass 2 observability counters in the backend action and orchestration. Task 4 runs end-to-end verification.

**Tech Stack:** TypeScript, Vitest, Convex backend, `fastest-levenshtein` (already in eval-lib deps).

**Spec:** `docs/superpowers/specs/2026-04-14-multi-span-ground-truth-improvements-design.md`

---

## File Map

### Eval-lib (modified)

| File | Responsibility |
|------|---------------|
| `packages/eval-lib/src/synthetic-datagen/ground-truth/token-level.ts` | Stronger EXCERPT_PROMPT, fuzzy span finding (tier 3), maxDocumentChars 8K→15K, `_findSpanPositions` returns `{ spans, failedExcerpts }` |
| `packages/eval-lib/tests/unit/synthetic-datagen/ground-truth/assigners.test.ts` | Update existing tests + add new tests for fuzzy matching and multi-span prompt |

### Backend (modified)

| File | Responsibility |
|------|---------------|
| `packages/backend/convex/schema.ts` | Add `pass2Enriched`, `pass2Unchanged` to `generationJobs` |
| `packages/backend/convex/generation/actions.ts` | Count pass 2 enriched vs unchanged, change threshold from `> 0` to `> 1`, return new counters |
| `packages/backend/convex/generation/orchestration.ts` | Accumulate `pass2Enriched`/`pass2Unchanged` from returnValue in `onDocGenerated` |

No new files. No deleted files.

---

## Verification Approach

**Eval-lib tests:** `pnpm test` (vitest in packages/eval-lib)
**Backend tests:** `pnpm -C packages/backend test` (convex-test)
**Backend deploy:** `cd packages/backend && npx convex dev --once`
**Eval-lib rebuild:** `pnpm build` (required after eval-lib changes before backend can see them)

---

## Task 1: Eval-lib — Prompt, fuzzy matching, char limit, diagnostics

**Files:**
- Modify: `packages/eval-lib/src/synthetic-datagen/ground-truth/token-level.ts`
- Modify: `packages/eval-lib/tests/unit/synthetic-datagen/ground-truth/assigners.test.ts`

All four spec sections (1, 2, 3, 5) that touch `token-level.ts` are bundled here to avoid editing the same file across multiple tasks.

- [ ] **Step 1: Read the current source and tests**

Read `packages/eval-lib/src/synthetic-datagen/ground-truth/token-level.ts` (full file, ~142 lines) and `packages/eval-lib/tests/unit/synthetic-datagen/ground-truth/assigners.test.ts` (full file, ~72 lines).

- [ ] **Step 2: Replace the EXCERPT_PROMPT**

Replace the `EXCERPT_PROMPT` constant (lines 8–12) with:

```typescript
const EXCERPT_PROMPT = `You are an expert at identifying relevant text passages in documents.

Given a document and a question, find ALL passages in the document that are relevant to answering the question. Most questions can be answered or supported by 2–4 different passages — look for all of them, not just the most obvious one.

Rules:
- Copy each passage VERBATIM from the document — do not paraphrase, summarize, or reword
- Each excerpt must appear exactly as written in the document
- Include passages that directly answer the question AND passages that provide important supporting context
- Prefer complete sentences over sentence fragments
- Return at least 1 passage, ideally 2–4

Output JSON: { "excerpts": ["exact verbatim passage 1...", "exact verbatim passage 2...", ...] }`;
```

- [ ] **Step 3: Update the user prompt in `_extractExcerpts`**

In `_extractExcerpts` (line 66), replace:

```typescript
const prompt = `Document:\n${docContent.substring(0, maxChars)}\n\nQuestion: ${question}\n\nExtract exact passages.`;
```

with:

```typescript
const prompt = `Document:\n${docContent.substring(0, maxChars)}\n\nQuestion: ${question}\n\nFind all relevant passages from the document that answer or support this question. Return 2-4 passages if possible.`;
```

- [ ] **Step 4: Increase `maxDocumentChars` default**

In `_extractExcerpts` (line 62), change:

```typescript
const maxChars = context.maxDocumentChars ?? 8000;
```

to:

```typescript
const maxChars = context.maxDocumentChars ?? 15000;
```

- [ ] **Step 5: Add `fastest-levenshtein` import**

At the top of the file, add:

```typescript
import { distance } from "fastest-levenshtein";
```

- [ ] **Step 6: Change `_findSpanPositions` return type to include failedExcerpts**

Replace the `_findSpanPositions` method signature and body (lines 78–119):

```typescript
  private _findSpanPositions(
    docContent: string,
    docId: string,
    excerpts: string[],
  ): { spans: CharacterSpan[]; failedExcerpts: string[] } {
    const spans: CharacterSpan[] = [];
    const failedExcerpts: string[] = [];

    for (const excerpt of excerpts) {
      // Tier 1: Exact match
      let start = docContent.indexOf(excerpt);

      // Tier 2: Normalized (whitespace + case)
      if (start === -1) {
        start = normalizedFind(docContent, excerpt);
      }

      // Tier 3: Sentence-level fuzzy match via Levenshtein
      if (start === -1) {
        const fuzzySpans = this._fuzzyFindSentences(docContent, docId, excerpt);
        if (fuzzySpans.length > 0) {
          spans.push(...fuzzySpans);
          continue; // Fuzzy found spans for this excerpt, move to next
        }
      }

      if (start === -1) {
        failedExcerpts.push(excerpt.substring(0, 80));
        continue;
      }

      const end = start + excerpt.length;
      const actualText = docContent.substring(start, end);

      try {
        spans.push(
          createCharacterSpan({
            docId,
            start,
            end,
            text: actualText,
          }),
        );
      } catch {
        failedExcerpts.push(excerpt.substring(0, 80));
      }
    }

    return { spans, failedExcerpts };
  }
```

- [ ] **Step 7: Add the `_fuzzyFindSentences` helper method**

Add this method to the `GroundTruthAssigner` class, after `_findSpanPositions`:

```typescript
  private _fuzzyFindSentences(
    docContent: string,
    docId: string,
    excerpt: string,
  ): CharacterSpan[] {
    const spans: CharacterSpan[] = [];
    const sentences = excerpt.match(/[^.!?]+[.!?]+/g) ?? [excerpt];

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 20) continue;

      const windowSize = trimmed.length;
      let bestScore = Infinity;
      let bestStart = -1;

      // Slide a window with step=10 for performance
      for (let i = 0; i <= docContent.length - windowSize; i += 10) {
        const windowText = docContent.substring(i, i + windowSize);
        const d = distance(trimmed.toLowerCase(), windowText.toLowerCase());
        if (d < bestScore) {
          bestScore = d;
          bestStart = i;
        }
      }

      // Accept if edit distance < 15% of string length
      const threshold = Math.ceil(trimmed.length * 0.15);
      if (bestScore <= threshold && bestStart !== -1) {
        // Snap to word boundaries
        while (bestStart > 0 && !/\s/.test(docContent[bestStart - 1])) bestStart--;
        let bestEnd = bestStart + windowSize;
        while (bestEnd < docContent.length && !/\s/.test(docContent[bestEnd])) bestEnd++;

        try {
          spans.push(
            createCharacterSpan({
              docId,
              start: bestStart,
              end: bestEnd,
              text: docContent.substring(bestStart, bestEnd),
            }),
          );
        } catch {
          // Skip invalid span
        }
      }
    }

    return spans;
  }
```

- [ ] **Step 8: Update `assign()` to use new return type**

In the `assign` method (lines 35–39), change:

```typescript
      const spans = this._findSpanPositions(
        doc.content,
        query.targetDocId,
        excerpts,
      );

      if (spans.length === 0) continue;
```

to:

```typescript
      const { spans, failedExcerpts } = this._findSpanPositions(
        doc.content,
        query.targetDocId,
        excerpts,
      );

      if (failedExcerpts.length > 0) {
        console.warn(
          `GroundTruthAssigner: ${failedExcerpts.length} excerpt(s) failed span finding for "${query.query.substring(0, 40)}..."`,
        );
      }

      if (spans.length === 0) continue;
```

- [ ] **Step 9: Update existing tests**

The existing test "should assign valid spans to queries" should still pass since the `assign()` public API is unchanged. The test "should skip excerpts not found in document" may now pass if fuzzy matching finds a close enough match. Update it:

The mock LLM returns `"This text does not exist in the document at all"` — this is dissimilar enough that tier 3 fuzzy matching (15% threshold) won't match. The test should still pass as-is. Verify by running tests.

- [ ] **Step 10: Add new test — multi-span extraction**

Add to the test file:

```typescript
  it("should return multiple spans when LLM provides multiple excerpts", async () => {
    const llm = makeLLM(
      JSON.stringify({
        excerpts: [
          "RAG combines retrieval with generation",
          "It uses relevant documents to answer questions",
        ],
      }),
    );

    const assigner = new GroundTruthAssigner();
    const queries: GeneratedQuery[] = [
      { query: "What is RAG?", targetDocId: "test.md", metadata: {} },
    ];

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results).toHaveLength(1);
    expect(results[0].relevantSpans).toHaveLength(2);
    expect(results[0].relevantSpans[0].text).toBe(
      "RAG combines retrieval with generation",
    );
    expect(results[0].relevantSpans[1].text).toBe(
      "It uses relevant documents to answer questions",
    );
  });
```

- [ ] **Step 11: Add new test — fuzzy matching (tier 3)**

Add to the test file:

```typescript
  it("should fuzzy-match excerpts with minor differences", async () => {
    // The excerpt has a small difference ("combines" → "combined") — within 15% threshold
    const llm = makeLLM(
      JSON.stringify({
        excerpts: ["RAG combined retrieval with generation."],
      }),
    );

    const assigner = new GroundTruthAssigner();
    const queries: GeneratedQuery[] = [
      { query: "What does RAG do?", targetDocId: "test.md", metadata: {} },
    ];

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results).toHaveLength(1);
    expect(results[0].relevantSpans.length).toBeGreaterThanOrEqual(1);
    // The span should be from the actual document text, not the LLM's paraphrase
    expect(results[0].relevantSpans[0].text).toContain("RAG combines retrieval");
  });
```

- [ ] **Step 12: Add new test — failed excerpt reporting**

Add to the test file:

```typescript
  it("should report failed excerpts without crashing", async () => {
    const llm = makeLLM(
      JSON.stringify({
        excerpts: [
          "RAG combines retrieval with generation",
          "Completely unrelated text that is absolutely nowhere in the document whatsoever at all",
        ],
      }),
    );

    const assigner = new GroundTruthAssigner();
    const queries: GeneratedQuery[] = [
      { query: "What is RAG?", targetDocId: "test.md", metadata: {} },
    ];

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    // Should still return the one valid span
    expect(results).toHaveLength(1);
    expect(results[0].relevantSpans).toHaveLength(1);
    expect(results[0].relevantSpans[0].text).toBe(
      "RAG combines retrieval with generation",
    );
  });
```

- [ ] **Step 13: Run tests**

Run: `pnpm test`
Expected: All tests pass (existing + 3 new).

- [ ] **Step 14: Rebuild eval-lib**

Run: `pnpm build`
Expected: Build succeeds. This must happen before backend can see the changes.

- [ ] **Step 15: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/ground-truth/token-level.ts packages/eval-lib/tests/unit/synthetic-datagen/ground-truth/assigners.test.ts
git commit -m "feat(eval-lib): strengthen ground truth — prompt, fuzzy matching, diagnostics

Rewrites EXCERPT_PROMPT to explicitly request 2-4 passages.
Adds tier 3 fuzzy span finding via Levenshtein sentence matching.
Increases maxDocumentChars from 8K to 15K.
_findSpanPositions now returns { spans, failedExcerpts } for diagnostics."
```

---

## Task 2: Backend schema — pass 2 observability fields

**Files:**
- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1: Read the current generationJobs table definition**

Read `packages/backend/convex/schema.ts` and find the `generationJobs` table definition. Note the `questionsGenerated` and `missedQuestions` fields added earlier.

- [ ] **Step 2: Add pass 2 counter fields**

In the `generationJobs` table definition, after `missedQuestions`, add:

```typescript
    pass2Enriched: v.optional(v.number()),
    pass2Unchanged: v.optional(v.number()),
```

- [ ] **Step 3: Deploy to Convex**

Run: `cd packages/backend && npx convex dev --once`
Expected: `✔ Convex functions ready!` with no errors.

- [ ] **Step 4: Run backend tests**

Run: `pnpm -C packages/backend test`
Expected: All tests pass. Schema additions are backward-compatible.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add pass2Enriched/pass2Unchanged schema fields

Tracks how many questions were enriched with multi-span ground truth
vs fell back to the single citation span."
```

---

## Task 3: Backend — Wire up pass 2 counters in action + orchestration

**Files:**
- Modify: `packages/backend/convex/generation/actions.ts`
- Modify: `packages/backend/convex/generation/orchestration.ts`

- [ ] **Step 1: Read the current pass 2 code in actions.ts**

Read `packages/backend/convex/generation/actions.ts` lines 416–473 (the pass 2 enrichment loop and return statement).

- [ ] **Step 2: Add counters and change enrichment threshold**

The current pass 2 block (lines 418–449) looks like:

```typescript
    // Pass 2: Enrich with multi-span ground truth
    const assigner = new GroundTruthAssigner();
    const singleDocCorpus = createCorpusFromDocuments([
      { id: args.docId, content: doc.content },
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

Replace with:

```typescript
    // Pass 2: Enrich with multi-span ground truth
    const assigner = new GroundTruthAssigner();
    const singleDocCorpus = createCorpusFromDocuments([
      { id: args.docId, content: doc.content },
    ]);

    let pass2Enriched = 0;
    let pass2Unchanged = 0;

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

        if (results.length > 0 && results[0].relevantSpans.length > 1) {
          question.relevantSpans = results[0].relevantSpans.map((s) => ({
            docId: String(s.docId),
            start: s.start,
            end: s.end,
            text: s.text,
          }));
          pass2Enriched++;
        } else {
          pass2Unchanged++;
        }
      } catch {
        pass2Unchanged++;
      }
    }
```

Key change: threshold from `> 0` to `> 1` — only replace pass-1 span if pass 2 found multiple spans.

- [ ] **Step 3: Update the return statement**

Replace the return statement (line ~468) to include the new counters:

```typescript
    return {
      questionsGenerated: allValidated.length,
      failedCitations: totalFailedCitations,
      missedQuestions: missedQuestions > 0 ? missedQuestions : 0,
      pass2Enriched,
      pass2Unchanged,
    };
```

- [ ] **Step 4: Read onDocGenerated in orchestration.ts**

Read `packages/backend/convex/generation/orchestration.ts` — find the `onDocGenerated` mutation and the section where `questionsGenerated` and `missedQuestions` are accumulated from `result.returnValue`.

- [ ] **Step 5: Accumulate pass 2 counters in onDocGenerated**

Find the existing accumulation block (around line 513–523). It currently looks like:

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

Replace with:

```typescript
    // Accumulate return values from generateForDoc
    let newQuestionsGenerated = job.questionsGenerated ?? 0;
    let newMissedQuestions = job.missedQuestions ?? 0;
    let newPass2Enriched = job.pass2Enriched ?? 0;
    let newPass2Unchanged = job.pass2Unchanged ?? 0;
    if (result.kind === "success" && result.returnValue) {
      const rv = result.returnValue as {
        questionsGenerated?: number;
        missedQuestions?: number;
        pass2Enriched?: number;
        pass2Unchanged?: number;
      };
      newQuestionsGenerated += rv.questionsGenerated ?? 0;
      newMissedQuestions += rv.missedQuestions ?? 0;
      newPass2Enriched += rv.pass2Enriched ?? 0;
      newPass2Unchanged += rv.pass2Unchanged ?? 0;
    }
```

- [ ] **Step 6: Add pass 2 fields to ALL three `ctx.db.patch` calls**

In `onDocGenerated`, add `pass2Enriched: newPass2Enriched, pass2Unchanged: newPass2Unchanged` to:
1. The canceling branch (`status: "canceled"`)
2. The normal completion branch
3. The non-complete (in-progress) branch

Same pattern as `questionsGenerated` and `missedQuestions`.

- [ ] **Step 7: Deploy to Convex**

Run: `cd packages/backend && npx convex dev --once`
Expected: Succeeds.

- [ ] **Step 8: Run backend tests**

Run: `pnpm -C packages/backend test`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/backend/convex/generation/actions.ts packages/backend/convex/generation/orchestration.ts
git commit -m "feat(backend): wire up pass 2 observability counters

generateForDoc tracks pass2Enriched (multi-span) vs pass2Unchanged
(single-span fallback). onDocGenerated accumulates on the job record.
Enrichment threshold changed from > 0 to > 1 spans."
```

---

## Task 4: End-to-end verification

**Files:** None modified — verification only.

- [ ] **Step 1: Eval-lib tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 2: Backend tests**

Run: `pnpm -C packages/backend test`
Expected: All tests pass.

- [ ] **Step 3: Backend deploy**

Run: `cd packages/backend && npx convex dev --once`
Expected: Succeeds.

- [ ] **Step 4: Frontend build**

Run: `pnpm -C packages/frontend build`
Expected: Succeeds (no frontend changes, but verify nothing broke).

- [ ] **Step 5: Verify commit history**

Run: `git log --oneline HEAD~4..HEAD`
Expected: ~3 clean commits with clear feat prefixes.

- [ ] **Step 6: No commit for this task**

Task 4 is verification only.

---

## Summary

| Task | Files | Key change |
|------|-------|------------|
| 1. Eval-lib prompt + fuzzy + diagnostics | `token-level.ts`, `assigners.test.ts` | Stronger prompt, tier 3 Levenshtein, 15K char limit, failedExcerpts |
| 2. Backend schema | `schema.ts` | Add pass2Enriched, pass2Unchanged |
| 3. Backend action + orchestration | `actions.ts`, `orchestration.ts` | Count and accumulate pass 2 metrics, threshold > 1 |
| 4. End-to-end verification | (none) | Build + test + deploy |

Total: ~3 commits across ~5 files. No new files, no deletions.
