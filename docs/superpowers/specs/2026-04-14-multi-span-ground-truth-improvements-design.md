# Multi-Span Ground Truth Improvements — Design Spec

**Goal:** Improve the multi-span ground truth coverage so that most questions have 2–3+ relevant spans, matching the quality of the old per-question Phase 2 approach.

**Scope:** Changes to eval-lib (GroundTruthAssigner prompt and span finding) and Convex backend (pass 2 integration in `generateForDoc`, observability fields on the job record).

**Out of scope:** Changes to pass 1 (question generation + citation validation). Changes to the frontend (span display is already multi-span aware). Moving pass 2 back to a per-question WorkPool action (considered but rejected — see Alternatives).

---

## Problem

The unified pipeline's pass 2 ground truth enrichment produces fewer multi-span results than the old per-question Phase 2. Many questions still show only 1 span (the citation from pass 1) even though the document contains multiple relevant passages. Three root causes:

1. **Weak prompt** — The `EXCERPT_PROMPT` says "extract exact passages" but never explicitly asks for multiple passages or encourages thoroughness. The LLM often returns just 1 excerpt.
2. **Silent failures in span finding** — When the LLM returns a slightly paraphrased excerpt that can't be located (even after normalized search), the excerpt is silently dropped. If all excerpts fail, the question falls back to its single pass-1 span with no indication that enrichment failed.
3. **No observability** — There's no way to see how many questions were enriched vs. fell back. No metrics on pass 2 success rate.

A secondary issue: the `maxDocumentChars` default of 8,000 characters can truncate longer documents, preventing the LLM from finding passages in the latter portion of the document.

---

## 1. Strengthen the EXCERPT_PROMPT

### Current prompt (`packages/eval-lib/src/synthetic-datagen/ground-truth/token-level.ts:8-12`)

```
You are an expert at identifying relevant text.
Given a document and question, extract exact passages that answer it.
Copy text VERBATIM - do not paraphrase. Each excerpt must appear exactly in the document.

Output JSON: { "excerpts": ["exact text from document...", ...] }
```

### New prompt

```
You are an expert at identifying relevant text passages in documents.

Given a document and a question, find ALL passages in the document that are relevant to answering the question. Most questions can be answered or supported by 2–4 different passages — look for all of them, not just the most obvious one.

Rules:
- Copy each passage VERBATIM from the document — do not paraphrase, summarize, or reword
- Each excerpt must appear exactly as written in the document
- Include passages that directly answer the question AND passages that provide important supporting context
- Prefer complete sentences over sentence fragments
- Return at least 1 passage, ideally 2–4

Output JSON: { "excerpts": ["exact verbatim passage 1...", "exact verbatim passage 2...", ...] }
```

Key changes:
- Explicit instruction to find "ALL passages" and "2–4 different passages"
- Distinguishes direct answers from supporting context
- "Prefer complete sentences" — reduces the chance of partial matches that fail span finding
- "Return at least 1, ideally 2–4" — sets explicit expectations

### User prompt change

Current (`token-level.ts:66`):
```
Document:\n${docContent}\n\nQuestion: ${question}\n\nExtract exact passages.
```

New:
```
Document:\n${docContent}\n\nQuestion: ${question}\n\nFind all relevant passages from the document that answer or support this question. Return 2-4 passages if possible.
```

---

## 2. Improve Span Finding with Fuzzy Fallback

### Current behavior (`_findSpanPositions`, `token-level.ts:78-119`)

Two-tier matching:
1. Exact: `docContent.indexOf(excerpt)`
2. Normalized: whitespace-collapsed + lowercase

If both fail, the excerpt is dropped with a `console.warn`.

### New behavior: Add sentence-level fuzzy matching as tier 3

When tiers 1 and 2 fail, split the excerpt into sentences and try to find the best-matching sentence in the document using Levenshtein distance (the `fastest-levenshtein` package is already a dependency in eval-lib).

```typescript
import { distance } from "fastest-levenshtein";

// Tier 3: Sentence-level fuzzy match
if (start === -1) {
  // Split excerpt into sentences, try to match each
  const sentences = excerpt.match(/[^.!?]+[.!?]+/g) ?? [excerpt];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 20) continue; // Skip very short fragments

    // Slide a window over the document to find the best match
    const windowSize = trimmed.length;
    let bestScore = Infinity;
    let bestStart = -1;

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
      // Snap to word boundaries: expand start backward to nearest space/newline,
      // expand end forward to nearest space/newline
      while (bestStart > 0 && !/\s/.test(docContent[bestStart - 1])) bestStart--;
      let bestEnd = bestStart + windowSize;
      while (bestEnd < docContent.length && !/\s/.test(docContent[bestEnd])) bestEnd++;

      try {
        spans.push(createCharacterSpan({
          docId,
          start: bestStart,
          end: bestEnd,
          text: docContent.substring(bestStart, bestEnd),
        }));
      } catch { /* skip invalid span */ }
    }
  }
}
```

**Performance note:** The sliding window with step=10 is O(n * m / 10) per sentence where n=document length and m=sentence length. For a 10,000-char document and 3 sentences of ~100 chars each, this is ~3,000 comparisons per sentence — fast enough for the per-question context.

**Word boundary snapping:** After finding the best window position, the start/end are adjusted to word boundaries to avoid mid-word span edges. This may slightly change the span length, but ensures clean, readable span text.

**Alternative considered:** Using the existing `normalizedFind` with a Levenshtein pre-filter. Rejected because the normalized find already handles whitespace/case differences — the remaining failures are genuine wording differences that need fuzzy matching.

---

## 3. Increase `maxDocumentChars` Default

### Current default: 8,000 characters

Many documents exceed this, causing truncation. The LLM can't find passages from the latter portion of the document.

### New default: 15,000 characters

This fits comfortably within GPT-4o-mini's context window (128K tokens) and o3-mini's context window. For `gpt-4o-mini` with a 15K-char document + system prompt + output, the total token count is approximately 5,000 tokens — well within limits.

The change is in `_extractExcerpts` (`token-level.ts:62`):

```typescript
const maxChars = context.maxDocumentChars ?? 15000;
```

**No backend changes needed** — the `maxDocumentChars` field is optional on `GroundTruthAssignerContext` and the backend doesn't pass it (uses default).

---

## 4. Pass 2 Observability

### Problem

There's no way to see if pass 2 is working. Failures are silently swallowed.

### Design

Add two counters to the `generateForDoc` return value and accumulate them on the job record.

**New return fields from `generateForDoc`:**
- `pass2Enriched: number` — questions where pass 2 produced multi-span results (> 1 span)
- `pass2Unchanged: number` — questions where pass 2 returned 0 or 1 span (kept pass 1 single span)

**Schema additions** (`generationJobs` table):
- `pass2Enriched: v.optional(v.number())`
- `pass2Unchanged: v.optional(v.number())`

**Backend changes** in `generateForDoc` (`actions.ts`):

```typescript
let pass2Enriched = 0;
let pass2Unchanged = 0;

for (const question of allValidated) {
  try {
    const results = await assigner.assign([...], { corpus, llmClient, model });

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

return {
  questionsGenerated: allValidated.length,
  failedCitations: totalFailedCitations,
  missedQuestions: missedQuestions > 0 ? missedQuestions : 0,
  pass2Enriched,
  pass2Unchanged,
};
```

Note the change from `results[0].relevantSpans.length > 0` to `results[0].relevantSpans.length > 1`. If pass 2 returns exactly 1 span, it's not meaningfully better than the pass-1 citation span — keep the original to avoid replacing a validated citation with a potentially less precise excerpt.

**Orchestration changes** in `onDocGenerated` (`orchestration.ts`):

Accumulate `pass2Enriched` and `pass2Unchanged` from `result.returnValue` the same way as `questionsGenerated` and `missedQuestions`. Include in all three `ctx.db.patch` calls.

**Frontend:** No changes in this iteration. The counters are available on the job record for debugging via the Convex dashboard. A future iteration can surface them in the UI.

---

## 5. Log Failed Excerpts for Debugging

In `_findSpanPositions`, change the silent `console.warn` to also return diagnostic information:

```typescript
private _findSpanPositions(
  docContent: string,
  docId: string,
  excerpts: string[],
): { spans: CharacterSpan[]; failedExcerpts: string[] } {
  const spans: CharacterSpan[] = [];
  const failedExcerpts: string[] = [];

  for (const excerpt of excerpts) {
    // ... existing matching logic ...

    if (start === -1) {
      failedExcerpts.push(excerpt.substring(0, 80));
      continue;
    }

    // ... existing span creation ...
  }

  return { spans, failedExcerpts };
}
```

Update `assign()` to use the new return type. The `failedExcerpts` are not stored permanently — they're for the calling code to log if desired. The backend can log them at `console.warn` level for debugging.

**Breaking change note:** This changes `_findSpanPositions` from returning `CharacterSpan[]` to `{ spans, failedExcerpts }`. Since this is a private method, there's no external API impact. The `assign()` method's public signature is unchanged.

---

## Summary of Changes

| Section | Files | Change |
|---------|-------|--------|
| 1. Stronger prompt | `token-level.ts` | New EXCERPT_PROMPT + user prompt |
| 2. Fuzzy span finding | `token-level.ts` | Tier 3 Levenshtein sentence matching |
| 3. Higher char limit | `token-level.ts` | Default 8K → 15K |
| 4. Observability | `actions.ts`, `orchestration.ts`, `schema.ts` | pass2Enriched/pass2Unchanged counters |
| 5. Diagnostic logging | `token-level.ts` | Return failedExcerpts from span finding |

**Eval-lib changes:** 1 file (`token-level.ts`) — all of Sections 1, 2, 3, 5 modify this file, so they should be implemented together in one task to avoid merge conflicts
**Backend changes:** 3 files (`schema.ts`, `actions.ts`, `orchestration.ts`)
**Frontend changes:** None
**New dependencies:** None (`fastest-levenshtein` already in eval-lib)
**Test impact:** Existing `GroundTruthAssigner` tests need updating for the new `_findSpanPositions` return type (Section 5). New tests needed for fuzzy matching (Section 2)

---

## Alternatives Considered

### Move pass 2 back to per-question WorkPool actions

**Pros:** Better isolation, per-question error visibility, can retry individually.
**Cons:** Significantly more WorkPool overhead (e.g., 50 questions = 50 actions scheduled), much slower overall generation, more complex orchestration.
**Decision:** Rejected. The inline loop in `generateForDoc` is simpler and faster. The prompt and span-finding improvements should solve the root cause. If multi-span coverage is still poor after these changes, we can revisit.

### Use the full KB corpus instead of single-document corpus in pass 2

**Pros:** The old `assignGroundTruthForQuestion` used `loadCorpusFromKb` (all KB documents). This could theoretically find cross-document spans.
**Cons:** (1) Cross-document spans are not the goal — we want multiple passages within the same source document. (2) Loading all KB documents per action is expensive. (3) The unified pipeline's questions are already scoped to a single document.
**Decision:** Rejected. Single-document corpus is correct for the unified pipeline.

### Retry pass 2 if only 1 span returned

**Pros:** Could catch cases where the LLM is lazy on the first try.
**Cons:** Doubles LLM costs for pass 2 in the common case. The stronger prompt should address this directly.
**Decision:** Deferred. Try the prompt improvement first. If multi-span coverage is still low (< 50% of questions), add a conditional retry.
