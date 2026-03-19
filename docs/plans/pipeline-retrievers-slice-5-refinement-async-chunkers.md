# Slice 5 — Refinement + Async Chunkers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 3 new refinement steps (dedup, MMR, expand-context) to the pipeline retriever, introduce an `AsyncPositionAwareChunker` interface, and implement 3 async chunkers (semantic, cluster-semantic, llm-semantic).

**Architecture:** Build pure-function refinement steps that plug into the existing `_applyRefinements` switch-case in `PipelineRetriever`. Add an `AsyncPositionAwareChunker` interface with a discriminator-based type guard. Implement 3 chunkers that use `Embedder` or `PipelineLLM` for intelligent text segmentation. Everything stays within `packages/eval-lib/`.

**Tech Stack:** TypeScript, Vitest, eval-lib only. Reuses `cosineSimilarity` from `utils/similarity.ts`, `spanOverlapChars` from `utils/span.ts`, and `RecursiveCharacterChunker` for sub-splitting oversized chunks.

> Part of the [Pipeline Retrievers Plan](./pipeline-retrievers-shared-context.md). See shared context for codebase state and design decisions.

---

## Improvements Over Original Plan

After deep codebase review, the following improvements were made to the original plan:

1. **Extracted shared helpers**: `contentOverlapRatio()` used by both dedup and MMR is factored into `refinement/overlap-ratio.ts`. `splitIntoSegments()` used by cluster-semantic and llm-semantic chunkers is factored into `chunkers/segment-utils.ts`.
2. **Aligned dedup default**: Changed `method` default from `"exact"` to `"overlap"` to match the registry entry in `registry/refinement-steps.ts` (line 73).
3. **Async chunker helper**: Instead of repeating the `isAsyncPositionAwareChunker` check in every index strategy, extracted `_chunkDocument()` private method in `PipelineRetriever` that handles both sync/async. Applied to all 3 strategies that use `this._chunker` (plain, contextual, summary — parent-child uses its own `RecursiveCharacterChunker` instances).
4. **Expand-context chunk ID**: Expanded chunks get regenerated IDs via `generatePaChunkId()` since their content/position changed.
5. **Corpus cleanup**: Added `this._corpus = null` to `cleanup()` to prevent stale references.
6. **Explicit position tracking**: All chunker implementations include precise character offset tracking with `doc.content.slice(start, end)` invariant.

---

## Codebase Reference (Verified)

All paths below are relative to `packages/eval-lib/`.

**Key existing files:**
- `src/retrievers/pipeline/pipeline-retriever.ts` — main retriever class (416 lines)
- `src/retrievers/pipeline/config.ts` — all config types + hash functions (268 lines)
- `src/retrievers/pipeline/types.ts` — `ScoredChunk` interface
- `src/retrievers/pipeline/refinement/threshold.ts` — existing refinement step
- `src/retrievers/pipeline/refinement/index.ts` — refinement barrel
- `src/retrievers/pipeline/index.ts` — pipeline barrel (55 lines)
- `src/retrievers/index.ts` — retrievers barrel (41 lines)
- `src/chunkers/chunker.interface.ts` — `PositionAwareChunker`, `isPositionAwareChunker`
- `src/chunkers/index.ts` — chunkers barrel (11 lines)
- `src/chunkers/sentence.ts` — sentence regex at line 97: `/(?<=[.!?])\s+(?=[A-Z])/`
- `src/utils/span.ts` — `spanOverlapChars(a, b)` computes char overlap between same-doc spans
- `src/utils/similarity.ts` — `cosineSimilarity(a, b)` returns dot product / norms
- `src/utils/hashing.ts` — `generatePaChunkId(content, docId, start)`
- `src/index.ts` — root barrel (155+ lines)
- `src/registry/refinement-steps.ts` — dedup/mmr/expand-context as "coming-soon"
- `src/registry/chunkers.ts` — semantic/cluster-semantic/llm-semantic as "coming-soon"

**Key test patterns** (from `tests/unit/retrievers/pipeline/refinement/threshold.test.ts`):
- Helper functions: `makeChunk(id)` → `PositionAwareChunk`, `makeScoredChunk(id, score)` → `ScoredChunk`
- Import types from source via relative paths with `.js` extensions
- Import branded type factories: `PositionAwareChunkId`, `DocumentId` from `types/primitives.js`

**Key interfaces used:**
```typescript
// ScoredChunk (types.ts)
interface ScoredChunk { readonly chunk: PositionAwareChunk; readonly score: number; }

// PositionAwareChunk (types/chunks.ts)
interface PositionAwareChunk {
  readonly id: PositionAwareChunkId; readonly content: string;
  readonly docId: DocumentId; readonly start: number; readonly end: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// Corpus (types/documents.ts)
interface Corpus { readonly documents: readonly Document[]; readonly metadata: ... }

// Document (types/documents.ts)
interface Document { readonly id: DocumentId; readonly content: string; readonly metadata: ... }

// Embedder (embedders/embedder.interface.ts)
interface Embedder {
  readonly name: string; readonly dimension: number;
  embed(texts: readonly string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}

// PipelineLLM (retrievers/pipeline/llm.interface.ts)
interface PipelineLLM { readonly name: string; complete(prompt: string): Promise<string>; }
```

---

## Task 1: Content Overlap Ratio Utility

Shared helper for dedup (Task 2) and MMR (Task 3). Computes the character span overlap ratio between two chunks from the same document.

**Files:**
- Create: `src/retrievers/pipeline/refinement/overlap-ratio.ts`
- Test: `tests/unit/retrievers/pipeline/refinement/overlap-ratio.test.ts`

### Step 1: Write the failing test

```typescript
// tests/unit/retrievers/pipeline/refinement/overlap-ratio.test.ts
import { describe, it, expect } from "vitest";
import { contentOverlapRatio } from "../../../../../src/retrievers/pipeline/refinement/overlap-ratio.js";
import {
  PositionAwareChunkId,
  DocumentId,
} from "../../../../../src/types/primitives.js";
import type { PositionAwareChunk } from "../../../../../src/types/index.js";

function makeChunk(
  id: string,
  docId: string,
  start: number,
  end: number,
): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content: "x".repeat(end - start),
    docId: DocumentId(docId),
    start,
    end,
    metadata: {},
  };
}

describe("contentOverlapRatio", () => {
  it("returns 0 for chunks from different documents", () => {
    const a = makeChunk("a", "doc1", 0, 100);
    const b = makeChunk("b", "doc2", 50, 150);
    expect(contentOverlapRatio(a, b)).toBe(0);
  });

  it("returns 0 for non-overlapping chunks from same document", () => {
    const a = makeChunk("a", "doc1", 0, 100);
    const b = makeChunk("b", "doc1", 200, 300);
    expect(contentOverlapRatio(a, b)).toBe(0);
  });

  it("returns 1 for identical spans", () => {
    const a = makeChunk("a", "doc1", 0, 100);
    const b = makeChunk("b", "doc1", 0, 100);
    expect(contentOverlapRatio(a, b)).toBe(1);
  });

  it("computes partial overlap correctly", () => {
    const a = makeChunk("a", "doc1", 0, 100);
    const b = makeChunk("b", "doc1", 50, 150);
    // overlap = 50 chars (50..100), minLength = 100
    expect(contentOverlapRatio(a, b)).toBe(0.5);
  });

  it("uses min length as denominator", () => {
    const a = makeChunk("a", "doc1", 0, 200); // length 200
    const b = makeChunk("b", "doc1", 100, 150); // length 50, fully inside a
    // overlap = 50, minLength = 50
    expect(contentOverlapRatio(a, b)).toBe(1);
  });

  it("returns 0 for zero-length chunks", () => {
    const a = makeChunk("a", "doc1", 0, 0);
    const b = makeChunk("b", "doc1", 0, 0);
    expect(contentOverlapRatio(a, b)).toBe(0);
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/retrievers/pipeline/refinement/overlap-ratio.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```typescript
// src/retrievers/pipeline/refinement/overlap-ratio.ts
import type { PositionAwareChunk } from "../../../types/chunks.js";
import { spanOverlapChars } from "../../../utils/span.js";

/**
 * Compute character span overlap ratio between two chunks.
 * Returns 0 for cross-document chunks. Returns overlap / min(len(a), len(b)).
 */
export function contentOverlapRatio(
  a: PositionAwareChunk,
  b: PositionAwareChunk,
): number {
  if (a.docId !== b.docId) return 0;

  const overlapChars = spanOverlapChars(
    { docId: a.docId, start: a.start, end: a.end },
    { docId: b.docId, start: b.start, end: b.end },
  );

  const minLength = Math.min(a.end - a.start, b.end - b.start);
  if (minLength === 0) return 0;

  return overlapChars / minLength;
}
```

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/retrievers/pipeline/refinement/overlap-ratio.test.ts`
Expected: PASS — all 6 tests

### Step 5: Commit

```bash
git add packages/eval-lib/src/retrievers/pipeline/refinement/overlap-ratio.ts packages/eval-lib/tests/unit/retrievers/pipeline/refinement/overlap-ratio.test.ts
git commit -m "feat(eval-lib): add contentOverlapRatio utility for refinement steps"
```

---

## Task 2: Dedup Refinement Step

Pure function that removes duplicate or near-duplicate chunks from search results.

**Files:**
- Create: `src/retrievers/pipeline/refinement/dedup.ts`
- Test: `tests/unit/retrievers/pipeline/refinement/dedup.test.ts`

### Step 1: Write the failing test

```typescript
// tests/unit/retrievers/pipeline/refinement/dedup.test.ts
import { describe, it, expect } from "vitest";
import { applyDedup } from "../../../../../src/retrievers/pipeline/refinement/dedup.js";
import {
  PositionAwareChunkId,
  DocumentId,
} from "../../../../../src/types/primitives.js";
import type { PositionAwareChunk } from "../../../../../src/types/index.js";
import type { ScoredChunk } from "../../../../../src/retrievers/pipeline/types.js";

function makeChunk(
  id: string,
  docId: string,
  start: number,
  end: number,
  content?: string,
): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content: content ?? `content-${id}`,
    docId: DocumentId(docId),
    start,
    end,
    metadata: {},
  };
}

function scored(chunk: PositionAwareChunk, score: number): ScoredChunk {
  return { chunk, score };
}

describe("applyDedup", () => {
  describe("exact method", () => {
    it("removes chunks with identical content, keeps first (highest-scored)", () => {
      const results = [
        scored(makeChunk("a", "doc1", 0, 10, "hello world"), 0.9),
        scored(makeChunk("b", "doc1", 20, 30, "hello world"), 0.7),
        scored(makeChunk("c", "doc1", 40, 50, "different"), 0.5),
      ];

      const deduped = applyDedup(results, "exact", 0.5);

      expect(deduped).toHaveLength(2);
      expect(deduped[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
      expect(deduped[1]!.chunk.id).toBe(PositionAwareChunkId("c"));
    });

    it("returns empty array for empty input", () => {
      expect(applyDedup([], "exact", 0.5)).toEqual([]);
    });

    it("keeps all chunks when content is unique", () => {
      const results = [
        scored(makeChunk("a", "doc1", 0, 5, "alpha"), 0.9),
        scored(makeChunk("b", "doc1", 10, 15, "beta"), 0.7),
      ];

      expect(applyDedup(results, "exact", 0.5)).toHaveLength(2);
    });

    it("deduplicates across different documents", () => {
      const results = [
        scored(makeChunk("a", "doc1", 0, 10, "same text"), 0.9),
        scored(makeChunk("b", "doc2", 0, 10, "same text"), 0.7),
      ];

      const deduped = applyDedup(results, "exact", 0.5);
      expect(deduped).toHaveLength(1);
      expect(deduped[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
    });
  });

  describe("overlap method", () => {
    it("removes chunks with high span overlap from same document", () => {
      // Chunk a: 0-100, chunk b: 10-110 → overlap 90, min length 100 → ratio 0.9
      const results = [
        scored(makeChunk("a", "doc1", 0, 100), 0.9),
        scored(makeChunk("b", "doc1", 10, 110), 0.7),
      ];

      const deduped = applyDedup(results, "overlap", 0.5);

      expect(deduped).toHaveLength(1);
      expect(deduped[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
    });

    it("keeps chunks with low overlap", () => {
      // Chunk a: 0-100, chunk b: 90-200 → overlap 10, min length 100 → ratio 0.1
      const results = [
        scored(makeChunk("a", "doc1", 0, 100), 0.9),
        scored(makeChunk("b", "doc1", 90, 200), 0.7),
      ];

      const deduped = applyDedup(results, "overlap", 0.5);
      expect(deduped).toHaveLength(2);
    });

    it("never removes cross-document chunks via overlap", () => {
      // Same spans but different docs → overlap = 0
      const results = [
        scored(makeChunk("a", "doc1", 0, 100), 0.9),
        scored(makeChunk("b", "doc2", 0, 100), 0.7),
      ];

      const deduped = applyDedup(results, "overlap", 0.5);
      expect(deduped).toHaveLength(2);
    });

    it("handles threshold boundary (equal to threshold is a duplicate)", () => {
      // Chunk a: 0-100, chunk b: 50-150 → overlap 50, min length 100 → ratio 0.5
      const results = [
        scored(makeChunk("a", "doc1", 0, 100), 0.9),
        scored(makeChunk("b", "doc1", 50, 150), 0.7),
      ];

      // threshold = 0.5, ratio = 0.5 → duplicate (>= threshold, not strictly >)
      const deduped = applyDedup(results, "overlap", 0.5);
      expect(deduped).toHaveLength(1);
    });

    it("preserves order of kept results", () => {
      const results = [
        scored(makeChunk("a", "doc1", 0, 100), 0.9),
        scored(makeChunk("b", "doc1", 500, 600), 0.8),
        scored(makeChunk("c", "doc1", 10, 110), 0.7), // overlaps with a
        scored(makeChunk("d", "doc1", 1000, 1100), 0.6),
      ];

      const deduped = applyDedup(results, "overlap", 0.5);
      expect(deduped.map((r) => r.chunk.id)).toEqual([
        PositionAwareChunkId("a"),
        PositionAwareChunkId("b"),
        PositionAwareChunkId("d"),
      ]);
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/retrievers/pipeline/refinement/dedup.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```typescript
// src/retrievers/pipeline/refinement/dedup.ts
import type { ScoredChunk } from "../types.js";
import { contentOverlapRatio } from "./overlap-ratio.js";

/**
 * Remove duplicate or near-duplicate chunks from scored results.
 *
 * "exact": removes chunks with identical content strings, keeps first occurrence.
 * "overlap": removes chunks from the same document whose character span
 *   overlap ratio >= overlapThreshold, keeps the higher-scored chunk.
 *
 * Input is assumed sorted by descending score (first = highest).
 */
export function applyDedup(
  results: readonly ScoredChunk[],
  method: "exact" | "overlap",
  overlapThreshold: number,
): ScoredChunk[] {
  if (method === "exact") {
    const seen = new Set<string>();
    return results.filter(({ chunk }) => {
      if (seen.has(chunk.content)) return false;
      seen.add(chunk.content);
      return true;
    });
  }

  // overlap method: compare against already-kept results
  const kept: ScoredChunk[] = [];
  for (const result of results) {
    const isDuplicate = kept.some(
      (existing) =>
        contentOverlapRatio(existing.chunk, result.chunk) >= overlapThreshold,
    );
    if (!isDuplicate) kept.push(result);
  }
  return kept;
}
```

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/retrievers/pipeline/refinement/dedup.test.ts`
Expected: PASS — all 9 tests

### Step 5: Commit

```bash
git add packages/eval-lib/src/retrievers/pipeline/refinement/dedup.ts packages/eval-lib/tests/unit/retrievers/pipeline/refinement/dedup.test.ts
git commit -m "feat(eval-lib): add dedup refinement step (exact + overlap methods)"
```

---

## Task 3: MMR Refinement Step

Maximal Marginal Relevance: reranks results to balance relevance and diversity using content overlap as the diversity proxy.

**Files:**
- Create: `src/retrievers/pipeline/refinement/mmr.ts`
- Test: `tests/unit/retrievers/pipeline/refinement/mmr.test.ts`

### Step 1: Write the failing test

```typescript
// tests/unit/retrievers/pipeline/refinement/mmr.test.ts
import { describe, it, expect } from "vitest";
import { applyMmr } from "../../../../../src/retrievers/pipeline/refinement/mmr.js";
import {
  PositionAwareChunkId,
  DocumentId,
} from "../../../../../src/types/primitives.js";
import type { PositionAwareChunk } from "../../../../../src/types/index.js";
import type { ScoredChunk } from "../../../../../src/retrievers/pipeline/types.js";

function makeChunk(
  id: string,
  docId: string,
  start: number,
  end: number,
): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content: "x".repeat(end - start),
    docId: DocumentId(docId),
    start,
    end,
    metadata: {},
  };
}

function scored(chunk: PositionAwareChunk, score: number): ScoredChunk {
  return { chunk, score };
}

describe("applyMmr", () => {
  it("returns empty array for empty input", () => {
    expect(applyMmr([], 5, 0.7)).toEqual([]);
  });

  it("returns all results when k >= input length", () => {
    const results = [
      scored(makeChunk("a", "doc1", 0, 100), 0.9),
      scored(makeChunk("b", "doc2", 0, 100), 0.7),
    ];

    const selected = applyMmr(results, 5, 0.7);
    expect(selected).toHaveLength(2);
  });

  it("selects highest-scored first with lambda=1.0 (pure relevance)", () => {
    const results = [
      scored(makeChunk("a", "doc1", 0, 100), 0.9),
      scored(makeChunk("b", "doc1", 10, 110), 0.8), // overlaps with a
      scored(makeChunk("c", "doc1", 500, 600), 0.7),
    ];

    const selected = applyMmr(results, 2, 1.0);
    // With lambda=1.0, MMR = 1.0 * relevance - 0, so just picks by score
    expect(selected[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
    expect(selected[1]!.chunk.id).toBe(PositionAwareChunkId("b"));
  });

  it("prefers diverse results with lambda=0.0 (pure diversity)", () => {
    const results = [
      scored(makeChunk("a", "doc1", 0, 100), 0.9),
      scored(makeChunk("b", "doc1", 10, 110), 0.8), // high overlap with a
      scored(makeChunk("c", "doc1", 500, 600), 0.7), // no overlap with a
    ];

    const selected = applyMmr(results, 2, 0.0);
    // First pick: a (highest mmr when S is empty: lambda*0.9 - 0 = 0, but all have 0 maxSim when S empty, so highest relevance wins the first slot)
    // Actually with lambda=0, mmrScore = 0 * relevance - 1 * maxSimilarity
    // When S is empty, maxSimilarity = 0 for all, so mmrScore = 0 for all → first by input order = a
    // Second pick: b has high overlap with a → maxSimilarity ≈ 0.9, mmrScore = 0 - 0.9 = -0.9
    //              c has no overlap with a → maxSimilarity = 0, mmrScore = 0 - 0 = 0
    // c wins second slot
    expect(selected[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
    expect(selected[1]!.chunk.id).toBe(PositionAwareChunkId("c"));
  });

  it("treats cross-document chunks as fully diverse", () => {
    const results = [
      scored(makeChunk("a", "doc1", 0, 100), 0.9),
      scored(makeChunk("b", "doc2", 0, 100), 0.8), // same span, different doc
      scored(makeChunk("c", "doc1", 0, 100), 0.7), // same span, same doc as a
    ];

    const selected = applyMmr(results, 2, 0.5);
    // First: a (highest score when S empty)
    // b: maxSim=0 (different doc), mmr = 0.5*0.8 - 0 = 0.4
    // c: maxSim=1.0 (same span as a), mmr = 0.5*0.7 - 0.5*1.0 = -0.15
    // b wins
    expect(selected[0]!.chunk.id).toBe(PositionAwareChunkId("a"));
    expect(selected[1]!.chunk.id).toBe(PositionAwareChunkId("b"));
  });

  it("limits output to k results", () => {
    const results = [
      scored(makeChunk("a", "doc1", 0, 100), 0.9),
      scored(makeChunk("b", "doc2", 0, 100), 0.8),
      scored(makeChunk("c", "doc3", 0, 100), 0.7),
    ];

    const selected = applyMmr(results, 2, 0.7);
    expect(selected).toHaveLength(2);
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/retrievers/pipeline/refinement/mmr.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```typescript
// src/retrievers/pipeline/refinement/mmr.ts
import type { ScoredChunk } from "../types.js";
import { contentOverlapRatio } from "./overlap-ratio.js";

/**
 * Maximal Marginal Relevance: iteratively selects results that balance
 * relevance (from search scores) and diversity (from content overlap).
 *
 * mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity
 *
 * Uses character span overlap ratio as the diversity proxy (not embeddings).
 * Cross-document chunks always have overlap = 0 (treated as fully diverse).
 *
 * @param results  Scored chunks from search stage (assumed descending score).
 * @param k        Maximum number of results to select.
 * @param lambda   Trade-off: 1.0 = pure relevance, 0.0 = pure diversity.
 */
export function applyMmr(
  results: readonly ScoredChunk[],
  k: number,
  lambda: number,
): ScoredChunk[] {
  if (results.length === 0) return [];

  const candidates = [...results];
  const selected: ScoredChunk[] = [];

  while (selected.length < k && candidates.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      const relevance = c.score;

      let maxSimilarity = 0;
      for (const s of selected) {
        const sim = contentOverlapRatio(s.chunk, c.chunk);
        if (sim > maxSimilarity) maxSimilarity = sim;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(candidates.splice(bestIdx, 1)[0]!);
  }

  return selected;
}
```

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/retrievers/pipeline/refinement/mmr.test.ts`
Expected: PASS — all 6 tests

### Step 5: Commit

```bash
git add packages/eval-lib/src/retrievers/pipeline/refinement/mmr.ts packages/eval-lib/tests/unit/retrievers/pipeline/refinement/mmr.test.ts
git commit -m "feat(eval-lib): add MMR refinement step for diversity-aware result selection"
```

---

## Task 4: Expand-Context Refinement Step

Expands each retrieved chunk by including surrounding characters from the original document.

**Files:**
- Create: `src/retrievers/pipeline/refinement/expand-context.ts`
- Test: `tests/unit/retrievers/pipeline/refinement/expand-context.test.ts`

### Step 1: Write the failing test

```typescript
// tests/unit/retrievers/pipeline/refinement/expand-context.test.ts
import { describe, it, expect } from "vitest";
import { applyExpandContext } from "../../../../../src/retrievers/pipeline/refinement/expand-context.js";
import {
  PositionAwareChunkId,
  DocumentId,
} from "../../../../../src/types/primitives.js";
import type { PositionAwareChunk } from "../../../../../src/types/index.js";
import type { ScoredChunk } from "../../../../../src/retrievers/pipeline/types.js";
import type { Corpus, Document } from "../../../../../src/types/index.js";

function makeDoc(id: string, content: string): Document {
  return { id: DocumentId(id), content, metadata: {} };
}

function makeCorpus(docs: Document[]): Corpus {
  return { documents: docs, metadata: {} };
}

function makeChunk(
  id: string,
  docId: string,
  start: number,
  end: number,
  content: string,
): PositionAwareChunk {
  return {
    id: PositionAwareChunkId(id),
    content,
    docId: DocumentId(docId),
    start,
    end,
    metadata: {},
  };
}

function scored(chunk: PositionAwareChunk, score: number): ScoredChunk {
  return { chunk, score };
}

describe("applyExpandContext", () => {
  const docContent = "0123456789".repeat(10); // 100 chars
  const corpus = makeCorpus([makeDoc("doc1", docContent)]);

  it("expands chunk by windowChars in both directions", () => {
    const chunk = makeChunk("a", "doc1", 30, 50, docContent.slice(30, 50));
    const results = [scored(chunk, 0.9)];

    const expanded = applyExpandContext(results, corpus, 10);

    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.chunk.start).toBe(20);
    expect(expanded[0]!.chunk.end).toBe(60);
    expect(expanded[0]!.chunk.content).toBe(docContent.slice(20, 60));
    expect(expanded[0]!.score).toBe(0.9); // score preserved
  });

  it("clamps expansion to document boundaries", () => {
    const chunk = makeChunk("a", "doc1", 5, 15, docContent.slice(5, 15));
    const results = [scored(chunk, 0.8)];

    const expanded = applyExpandContext(results, corpus, 20);

    expect(expanded[0]!.chunk.start).toBe(0); // clamped to 0
    expect(expanded[0]!.chunk.end).toBe(35);
  });

  it("clamps at end of document", () => {
    const chunk = makeChunk("a", "doc1", 90, 100, docContent.slice(90, 100));
    const results = [scored(chunk, 0.7)];

    const expanded = applyExpandContext(results, corpus, 20);

    expect(expanded[0]!.chunk.start).toBe(70);
    expect(expanded[0]!.chunk.end).toBe(100); // clamped to doc length
  });

  it("returns chunk unchanged when doc not found in corpus", () => {
    const chunk = makeChunk("a", "unknown", 0, 10, "some text");
    const results = [scored(chunk, 0.5)];

    const expanded = applyExpandContext(results, corpus, 10);

    expect(expanded[0]!.chunk.start).toBe(0);
    expect(expanded[0]!.chunk.end).toBe(10);
    expect(expanded[0]!.chunk.content).toBe("some text");
  });

  it("handles empty results", () => {
    expect(applyExpandContext([], corpus, 10)).toEqual([]);
  });

  it("preserves chunk metadata", () => {
    const chunk: PositionAwareChunk = {
      id: PositionAwareChunkId("a"),
      content: docContent.slice(30, 50),
      docId: DocumentId("doc1"),
      start: 30,
      end: 50,
      metadata: { source: "test" },
    };
    const results = [scored(chunk, 0.9)];

    const expanded = applyExpandContext(results, corpus, 10);
    expect(expanded[0]!.chunk.metadata).toEqual({ source: "test" });
  });

  it("handles windowChars=0 (no expansion)", () => {
    const chunk = makeChunk("a", "doc1", 30, 50, docContent.slice(30, 50));
    const results = [scored(chunk, 0.9)];

    const expanded = applyExpandContext(results, corpus, 0);

    expect(expanded[0]!.chunk.start).toBe(30);
    expect(expanded[0]!.chunk.end).toBe(50);
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/retrievers/pipeline/refinement/expand-context.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```typescript
// src/retrievers/pipeline/refinement/expand-context.ts
import type { Corpus } from "../../../types/documents.js";
import type { ScoredChunk } from "../types.js";
import { generatePaChunkId } from "../../../utils/hashing.js";

/**
 * Expand each chunk by including surrounding characters from the source document.
 *
 * For each chunk, extends the character span by windowChars in both directions
 * (clamped to document boundaries). The chunk ID is regenerated because content
 * and position have changed.
 *
 * Chunks whose source document is not found in the corpus are returned unchanged.
 */
export function applyExpandContext(
  results: readonly ScoredChunk[],
  corpus: Corpus,
  windowChars: number,
): ScoredChunk[] {
  // Build a lookup map for O(1) doc access
  const docMap = new Map(
    corpus.documents.map((doc) => [String(doc.id), doc]),
  );

  return results.map(({ chunk, score }) => {
    const doc = docMap.get(String(chunk.docId));
    if (!doc) return { chunk, score };

    const newStart = Math.max(0, chunk.start - windowChars);
    const newEnd = Math.min(doc.content.length, chunk.end + windowChars);
    const newContent = doc.content.slice(newStart, newEnd);

    return {
      chunk: {
        ...chunk,
        content: newContent,
        start: newStart,
        end: newEnd,
        id: generatePaChunkId(newContent, String(chunk.docId), newStart),
      },
      score,
    };
  });
}
```

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/retrievers/pipeline/refinement/expand-context.test.ts`
Expected: PASS — all 7 tests

### Step 5: Commit

```bash
git add packages/eval-lib/src/retrievers/pipeline/refinement/expand-context.ts packages/eval-lib/tests/unit/retrievers/pipeline/refinement/expand-context.test.ts
git commit -m "feat(eval-lib): add expand-context refinement step"
```

---

## Task 5: Config Types + Refinement Barrel Exports

Extend the `RefinementStepConfig` union with the 3 new step types. Update the refinement barrel to export the new functions.

**Files:**
- Modify: `src/retrievers/pipeline/config.ts` (lines 170-179)
- Modify: `src/retrievers/pipeline/refinement/index.ts`

### Step 1: Add new config interfaces to config.ts

In `src/retrievers/pipeline/config.ts`, **after** line 177 (the existing `ThresholdRefinementStep`), add the new interfaces and update the union:

```typescript
// ADD after ThresholdRefinementStep (line 177):

export interface DedupRefinementStep {
  readonly type: "dedup";
  /** @default "overlap" */
  readonly method?: "exact" | "overlap";
  /** Minimum overlap ratio to consider chunks duplicates. @default 0.5 */
  readonly overlapThreshold?: number;
}

export interface MmrRefinementStep {
  readonly type: "mmr";
  /** Trade-off: 1.0 = pure relevance, 0.0 = pure diversity. @default 0.7 */
  readonly lambda?: number;
}

export interface ExpandContextRefinementStep {
  readonly type: "expand-context";
  /** Characters to include before and after each chunk. @default 500 */
  readonly windowChars?: number;
}

// REPLACE the existing RefinementStepConfig union (line 179):
export type RefinementStepConfig =
  | RerankRefinementStep
  | ThresholdRefinementStep
  | DedupRefinementStep
  | MmrRefinementStep
  | ExpandContextRefinementStep;
```

### Step 2: Update refinement barrel

Replace `src/retrievers/pipeline/refinement/index.ts`:

```typescript
export { applyThresholdFilter } from "./threshold.js";
export { applyDedup } from "./dedup.js";
export { applyMmr } from "./mmr.js";
export { applyExpandContext } from "./expand-context.js";
export { contentOverlapRatio } from "./overlap-ratio.js";
export type { ScoredChunk } from "../types.js";
```

### Step 3: Update pipeline barrel exports

In `src/retrievers/pipeline/index.ts`, add the new config type exports. After the existing `ThresholdRefinementStep` re-export (line 29), add:

```typescript
  DedupRefinementStep,
  MmrRefinementStep,
  ExpandContextRefinementStep,
```

Also add new refinement function exports. After the existing `applyThresholdFilter` re-export (line 41), add:

```typescript
export { applyDedup, applyMmr, applyExpandContext } from "./refinement/index.js";
```

### Step 4: Run existing tests to ensure no regressions

Run: `pnpm -C packages/eval-lib vitest run`
Expected: All existing tests PASS

### Step 5: Commit

```bash
git add packages/eval-lib/src/retrievers/pipeline/config.ts packages/eval-lib/src/retrievers/pipeline/refinement/index.ts packages/eval-lib/src/retrievers/pipeline/index.ts
git commit -m "feat(eval-lib): extend RefinementStepConfig union with dedup, mmr, expand-context"
```

---

## Task 6: Pipeline Retriever — Store Corpus + Extend _applyRefinements

Add `_corpus` field to `PipelineRetriever`, store it during `init()`, clear during `cleanup()`, and extend `_applyRefinements()` with the 3 new refinement step cases.

**Files:**
- Modify: `src/retrievers/pipeline/pipeline-retriever.ts`

### Step 1: Add imports

At the top of `pipeline-retriever.ts` (around line 25, after the existing `applyThresholdFilter` import), add:

```typescript
import { applyDedup } from "./refinement/dedup.js";
import { applyMmr } from "./refinement/mmr.js";
import { applyExpandContext } from "./refinement/expand-context.js";
```

### Step 2: Add `_corpus` field

Inside the `PipelineRetriever` class (around where other private fields are declared, near line 104-120), add:

```typescript
private _corpus: Corpus | null = null;
```

### Step 3: Store corpus in init()

At the very beginning of `init()` (line 176, after `async init(corpus: Corpus): Promise<void> {`), add:

```typescript
this._corpus = corpus;
```

### Step 4: Clear corpus in cleanup()

In the `cleanup()` method (around line 327-334), add alongside the existing cleanup:

```typescript
this._corpus = null;
```

### Step 5: Extend _applyRefinements

In `_applyRefinements()` (lines 388-415), add new cases **before** the `default` case (line 409):

```typescript
      case "dedup": {
        current = applyDedup(
          current,
          step.method ?? "overlap",
          step.overlapThreshold ?? 0.5,
        );
        break;
      }

      case "mmr": {
        current = applyMmr(current, k, step.lambda ?? 0.7);
        break;
      }

      case "expand-context": {
        if (!this._corpus) {
          throw new Error(
            "expand-context refinement requires corpus (not available after cleanup)",
          );
        }
        current = applyExpandContext(
          current,
          this._corpus,
          step.windowChars ?? 500,
        );
        break;
      }
```

### Step 6: Run existing pipeline tests

Run: `pnpm -C packages/eval-lib vitest run tests/unit/retrievers/pipeline/pipeline-retriever.test.ts`
Expected: All existing tests PASS (no behavioral change to existing code paths)

### Step 7: Commit

```bash
git add packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts
git commit -m "feat(eval-lib): integrate dedup, mmr, expand-context into pipeline retriever"
```

---

## Task 7: AsyncPositionAwareChunker Interface + Type Guard

Add the async chunker interface and type guard to the chunker interface file. Add tests for the type guard.

**Files:**
- Modify: `src/chunkers/chunker.interface.ts`
- Modify: `tests/unit/chunkers/chunkers.test.ts` (add test cases)

### Step 1: Write the failing test

Add to the existing `tests/unit/chunkers/chunkers.test.ts`, at the end of the file:

```typescript
// Add import at top of file:
import { isAsyncPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";

// Add test suite at end of file:
describe("isAsyncPositionAwareChunker", () => {
  it("returns true for chunker with async discriminator", () => {
    const chunker = {
      name: "test-async",
      async: true as const,
      chunkWithPositions: vi.fn(),
    };
    expect(isAsyncPositionAwareChunker(chunker as any)).toBe(true);
  });

  it("returns false for sync chunker without async property", () => {
    const chunker = {
      name: "test-sync",
      chunkWithPositions: vi.fn(),
    };
    expect(isAsyncPositionAwareChunker(chunker as any)).toBe(false);
  });

  it("returns false for chunker with async=false", () => {
    const chunker = {
      name: "test",
      async: false,
      chunkWithPositions: vi.fn(),
    };
    expect(isAsyncPositionAwareChunker(chunker as any)).toBe(false);
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/chunkers.test.ts`
Expected: FAIL — `isAsyncPositionAwareChunker` not found

### Step 3: Add interface and type guard to chunker.interface.ts

Add at the end of `src/chunkers/chunker.interface.ts` (after the existing `isPositionAwareChunker` function):

```typescript
/**
 * Async variant of PositionAwareChunker for chunkers that need
 * async operations (embedding, LLM calls) during chunking.
 *
 * Implementations must set `readonly async = true as const` as a
 * discriminator property for the type guard.
 */
export interface AsyncPositionAwareChunker {
  readonly name: string;
  readonly async: true;
  chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]>;
}

/**
 * Type guard to distinguish async chunkers from sync chunkers.
 * Checks for the `async: true` discriminator property.
 */
export function isAsyncPositionAwareChunker(
  chunker: PositionAwareChunker | AsyncPositionAwareChunker,
): chunker is AsyncPositionAwareChunker {
  return "async" in chunker && (chunker as any).async === true;
}
```

Note: The `Document` and `PositionAwareChunk` types are already imported at the top of `chunker.interface.ts`.

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/chunkers.test.ts`
Expected: PASS — including the 3 new tests

### Step 5: Update chunkers barrel

In `src/chunkers/index.ts`, add:

```typescript
export type { AsyncPositionAwareChunker } from "./chunker.interface.js";
export { isAsyncPositionAwareChunker } from "./chunker.interface.js";
```

### Step 6: Commit

```bash
git add packages/eval-lib/src/chunkers/chunker.interface.ts packages/eval-lib/src/chunkers/index.ts packages/eval-lib/tests/unit/chunkers/chunkers.test.ts
git commit -m "feat(eval-lib): add AsyncPositionAwareChunker interface with type guard"
```

---

## Task 8: Pipeline Retriever — Async Chunker Support

Update `PipelineRetrieverDeps` to accept async chunkers and add a `_chunkDocument` helper method.

**Files:**
- Modify: `src/retrievers/pipeline/pipeline-retriever.ts`

### Step 1: Update imports

Add at the top of `pipeline-retriever.ts`:

```typescript
import type { AsyncPositionAwareChunker } from "../../chunkers/chunker.interface.js";
import { isAsyncPositionAwareChunker } from "../../chunkers/chunker.interface.js";
```

### Step 2: Update PipelineRetrieverDeps

Change the `chunker` field type in `PipelineRetrieverDeps` (line 44):

```typescript
// FROM:
readonly chunker: PositionAwareChunker;
// TO:
readonly chunker: PositionAwareChunker | AsyncPositionAwareChunker;
```

### Step 3: Update private field type

Find the private field declaration for `_chunker` (in the constructor area) and update:

```typescript
// FROM:
private readonly _chunker: PositionAwareChunker;
// TO:
private readonly _chunker: PositionAwareChunker | AsyncPositionAwareChunker;
```

### Step 4: Add _chunkDocument helper

Add a private helper method in the `PipelineRetriever` class (before `init()`):

```typescript
/**
 * Chunk a document, handling both sync and async chunkers.
 */
private async _chunkDocument(doc: Document): Promise<PositionAwareChunk[]> {
  if (isAsyncPositionAwareChunker(this._chunker)) {
    return this._chunker.chunkWithPositions(doc);
  }
  return this._chunker.chunkWithPositions(doc);
}
```

Note: Need to add `Document` to the import from types if not already imported. Check the existing import line 1: `import type { Corpus, PositionAwareChunk } from "../../types/index.js";` — add `Document`:

```typescript
import type { Corpus, Document, PositionAwareChunk } from "../../types/index.js";
```

### Step 5: Update init() — plain strategy

Replace line 183 (`chunks.push(...this._chunker.chunkWithPositions(doc));`) with:

```typescript
chunks.push(...(await this._chunkDocument(doc)));
```

### Step 6: Update init() — contextual strategy

Replace line 194 (`const rawChunks = this._chunker.chunkWithPositions(doc);`) with:

```typescript
const rawChunks = await this._chunkDocument(doc);
```

### Step 7: Update init() — summary strategy

Replace line 217 (`const rawChunks = this._chunker.chunkWithPositions(doc);`) with:

```typescript
const rawChunks = await this._chunkDocument(doc);
```

Note: parent-child strategy (lines 231-266) creates its own `RecursiveCharacterChunker` instances and does NOT use `this._chunker`, so no change needed there.

### Step 8: Run all pipeline tests

Run: `pnpm -C packages/eval-lib vitest run tests/unit/retrievers/pipeline/`
Expected: All tests PASS — sync chunkers still work because `_chunkDocument` returns the sync result directly (it's just not a Promise in that case, but `await` on a non-Promise is a no-op).

### Step 9: Commit

```bash
git add packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts
git commit -m "feat(eval-lib): support async chunkers in pipeline retriever init()"
```

---

## Task 9: Segment Splitting Utility

Shared utility for ClusterSemanticChunker (Task 11) and LLMSemanticChunker (Task 12). Splits text into micro-segments of approximately N characters, respecting word boundaries.

**Files:**
- Create: `src/chunkers/segment-utils.ts`
- Test: `tests/unit/chunkers/segment-utils.test.ts`

### Step 1: Write the failing test

```typescript
// tests/unit/chunkers/segment-utils.test.ts
import { describe, it, expect } from "vitest";
import { splitIntoSegments } from "../../../src/chunkers/segment-utils.js";

describe("splitIntoSegments", () => {
  it("splits text into segments of approximately segmentSize chars", () => {
    const text = "Hello world this is a test of segment splitting logic here";
    const segments = splitIntoSegments(text, 20);

    // Each segment should be roughly 20 chars, broken at word boundaries
    for (const seg of segments) {
      expect(seg.text.length).toBeLessThanOrEqual(25); // some slack for word boundaries
      expect(seg.text.length).toBeGreaterThan(0);
    }
  });

  it("tracks character positions correctly", () => {
    const text = "Hello world this is a test";
    const segments = splitIntoSegments(text, 12);

    for (const seg of segments) {
      expect(text.slice(seg.start, seg.end)).toBe(seg.text);
    }
  });

  it("covers the entire text without gaps", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const segments = splitIntoSegments(text, 10);

    // First segment starts at 0
    expect(segments[0]!.start).toBe(0);
    // Last segment ends at text.length
    expect(segments[segments.length - 1]!.end).toBe(text.length);
    // No gaps between segments
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.start).toBe(segments[i - 1]!.end);
    }
  });

  it("returns single segment for short text", () => {
    const text = "Short";
    const segments = splitIntoSegments(text, 50);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ text: "Short", start: 0, end: 5 });
  });

  it("returns empty array for empty text", () => {
    expect(splitIntoSegments("", 50)).toEqual([]);
  });

  it("handles text shorter than segmentSize", () => {
    const text = "Hello";
    const segments = splitIntoSegments(text, 100);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe("Hello");
  });

  it("handles text with no spaces (cannot break at word boundary)", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    const segments = splitIntoSegments(text, 10);

    // Should still split, just not at word boundaries
    expect(segments.length).toBeGreaterThan(1);
    for (const seg of segments) {
      expect(text.slice(seg.start, seg.end)).toBe(seg.text);
    }
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/segment-utils.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```typescript
// src/chunkers/segment-utils.ts

export interface TextSegment {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Split text into segments of approximately segmentSize characters,
 * preferring to break at word boundaries (spaces).
 *
 * Guarantees: no gaps between segments, full text coverage,
 * positions satisfy text.slice(seg.start, seg.end) === seg.text.
 */
export function splitIntoSegments(
  text: string,
  segmentSize: number,
): TextSegment[] {
  if (text.length === 0) return [];

  const segments: TextSegment[] = [];
  let pos = 0;

  while (pos < text.length) {
    let end = Math.min(pos + segmentSize, text.length);

    // Try to break at a word boundary (last space before end)
    if (end < text.length) {
      const spaceIdx = text.lastIndexOf(" ", end);
      if (spaceIdx > pos) {
        end = spaceIdx + 1; // include the space in the current segment
      }
    }

    segments.push({
      text: text.slice(pos, end),
      start: pos,
      end,
    });
    pos = end;
  }

  return segments;
}
```

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/segment-utils.test.ts`
Expected: PASS — all 7 tests

### Step 5: Commit

```bash
git add packages/eval-lib/src/chunkers/segment-utils.ts packages/eval-lib/tests/unit/chunkers/segment-utils.test.ts
git commit -m "feat(eval-lib): add splitIntoSegments utility for async chunkers"
```

---

## Task 10: Semantic Chunker

Implements the Kamradt method: split text into sentences, embed them, detect topic shifts via cosine similarity drops, and split at those boundaries.

**Files:**
- Create: `src/chunkers/semantic.ts`
- Test: `tests/unit/chunkers/semantic.test.ts`

### Step 1: Write the failing test

```typescript
// tests/unit/chunkers/semantic.test.ts
import { describe, it, expect, vi } from "vitest";
import { SemanticChunker } from "../../../src/chunkers/semantic.js";
import { isAsyncPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { DocumentId } from "../../../src/types/primitives.js";
import type { Document } from "../../../src/types/index.js";
import type { Embedder } from "../../../src/embedders/embedder.interface.js";

function makeDoc(id: string, content: string): Document {
  return { id: DocumentId(id), content, metadata: {} };
}

/**
 * Creates a mock embedder that returns deterministic embeddings.
 * Each sentence gets a unique direction vector so we can control similarity.
 */
function makeMockEmbedder(embeddings: number[][]): Embedder {
  return {
    name: "mock-embedder",
    dimension: embeddings[0]?.length ?? 4,
    embed: vi.fn(async (texts: readonly string[]) => {
      // Return embeddings in order; if more texts than embeddings, cycle
      return texts.map((_, i) => embeddings[i % embeddings.length]!);
    }),
    embedQuery: vi.fn(async () => embeddings[0]!),
  };
}

describe("SemanticChunker", () => {
  it("satisfies isAsyncPositionAwareChunker", () => {
    const embedder = makeMockEmbedder([[1, 0]]);
    const chunker = new SemanticChunker(embedder);
    expect(isAsyncPositionAwareChunker(chunker)).toBe(true);
  });

  it("has correct name format", () => {
    const embedder = makeMockEmbedder([[1, 0]]);
    const chunker = new SemanticChunker(embedder, { percentileThreshold: 90 });
    expect(chunker.name).toBe("Semantic(threshold=90)");
  });

  it("produces chunks with valid positions", async () => {
    // 3 sentences with distinct topics (embeddings in different directions)
    const doc = makeDoc(
      "doc1",
      "The cat sat on the mat. Dogs love to play fetch. The weather is sunny today.",
    );

    // Similar embeddings for all sentences → no splits → one big chunk
    const embedder = makeMockEmbedder([
      [1, 0, 0, 0],
      [0.99, 0.1, 0, 0],
      [0.98, 0.2, 0, 0],
    ]);

    const chunker = new SemanticChunker(embedder, { percentileThreshold: 95 });
    const chunks = await chunker.chunkWithPositions(doc);

    // All chunks must satisfy position invariant
    for (const chunk of chunks) {
      expect(chunk.docId).toBe(doc.id);
      expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeLessThanOrEqual(doc.content.length);
    }
  });

  it("splits at semantic boundaries (dissimilar consecutive embeddings)", async () => {
    const sentences = [
      "Machine learning is transforming industries.",
      "Deep learning uses neural networks.",
      "The stock market crashed today.",
      "Investors are worried about the economy.",
    ];
    const doc = makeDoc("doc1", sentences.join(" "));

    // First two sentences similar, then sharp topic change
    const embedder = makeMockEmbedder([
      [1, 0, 0, 0],    // ML topic
      [0.95, 0.1, 0, 0], // ML topic (similar)
      [0, 0, 1, 0],    // Finance topic (very different)
      [0, 0, 0.95, 0.1], // Finance topic (similar)
    ]);

    const chunker = new SemanticChunker(embedder, { percentileThreshold: 50 });
    const chunks = await chunker.chunkWithPositions(doc);

    // Should produce at least 2 chunks (split between ML and Finance)
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // First chunk should contain ML sentences
    expect(chunks[0]!.content).toContain("Machine learning");
    // Last chunk should contain finance sentences
    expect(chunks[chunks.length - 1]!.content).toContain("stock market");
  });

  it("sub-splits oversized chunks with RecursiveCharacterChunker", async () => {
    // One very long "sentence" that exceeds maxChunkSize
    const longSentence = "A".repeat(500);
    const doc = makeDoc("doc1", longSentence + ". Short sentence here.");

    const embedder = makeMockEmbedder([
      [1, 0],
      [0.99, 0.1],
    ]);

    const chunker = new SemanticChunker(embedder, { maxChunkSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    // The long sentence should be sub-split
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(200);
    }
  });

  it("returns single chunk for short document", async () => {
    const doc = makeDoc("doc1", "Hello world.");
    const embedder = makeMockEmbedder([[1, 0]]);

    const chunker = new SemanticChunker(embedder);
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe("Hello world.");
  });

  it("handles empty document", async () => {
    const doc = makeDoc("doc1", "");
    const embedder = makeMockEmbedder([[1, 0]]);

    const chunker = new SemanticChunker(embedder);
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(0);
  });

  it("calls embedder.embed with all sentence texts", async () => {
    const doc = makeDoc("doc1", "First sentence. Second sentence. Third sentence.");
    const embedder = makeMockEmbedder([
      [1, 0],
      [0.9, 0.1],
      [0.8, 0.2],
    ]);

    const chunker = new SemanticChunker(embedder);
    await chunker.chunkWithPositions(doc);

    expect(embedder.embed).toHaveBeenCalledTimes(1);
    const callArgs = (embedder.embed as any).mock.calls[0][0];
    expect(callArgs).toHaveLength(3);
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/semantic.test.ts`
Expected: FAIL — module not found

### Step 3: Write implementation

```typescript
// src/chunkers/semantic.ts
import type { AsyncPositionAwareChunker } from "./chunker.interface.js";
import type { Document } from "../types/documents.js";
import type { PositionAwareChunk } from "../types/chunks.js";
import type { Embedder } from "../embedders/embedder.interface.js";
import { RecursiveCharacterChunker } from "./recursive-character.js";
import { cosineSimilarity } from "../utils/similarity.js";
import { generatePaChunkId } from "../utils/hashing.js";

export interface SemanticChunkerOptions {
  /** Percentile threshold for split detection. @default 95 */
  percentileThreshold?: number;
  /** Maximum chunk size in characters. Chunks exceeding this are sub-split. @default 2000 */
  maxChunkSize?: number;
}

interface Sentence {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Semantic chunker using the Kamradt method:
 * 1. Split text into sentences
 * 2. Embed all sentences
 * 3. Find split points where consecutive similarity drops below a percentile threshold
 * 4. Merge sentences between split points into chunks
 * 5. Sub-split oversized chunks with RecursiveCharacterChunker
 */
export class SemanticChunker implements AsyncPositionAwareChunker {
  readonly name: string;
  readonly async = true as const;

  private readonly _embedder: Embedder;
  private readonly _percentileThreshold: number;
  private readonly _maxChunkSize: number;

  constructor(embedder: Embedder, options?: SemanticChunkerOptions) {
    this._embedder = embedder;
    this._percentileThreshold = options?.percentileThreshold ?? 95;
    this._maxChunkSize = options?.maxChunkSize ?? 2000;
    this.name = `Semantic(threshold=${this._percentileThreshold})`;
  }

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]> {
    if (doc.content.trim().length === 0) return [];

    const sentences = splitSentences(doc.content);
    if (sentences.length === 0) return [];

    // Single sentence → single chunk
    if (sentences.length === 1) {
      return this._buildChunks(doc, [sentences]);
    }

    // Embed all sentences
    const embeddings = await this._embedder.embed(
      sentences.map((s) => s.text),
    );

    // Compute consecutive similarities
    const similarities: number[] = [];
    for (let i = 0; i < embeddings.length - 1; i++) {
      similarities.push(cosineSimilarity(embeddings[i]!, embeddings[i + 1]!));
    }

    // Find percentile threshold
    const threshold = percentile(similarities, this._percentileThreshold);

    // Split points: where similarity drops below the threshold
    const groups: Sentence[][] = [];
    let currentGroup: Sentence[] = [sentences[0]!];

    for (let i = 0; i < similarities.length; i++) {
      if (similarities[i]! < threshold) {
        // Split here: start a new group
        groups.push(currentGroup);
        currentGroup = [sentences[i + 1]!];
      } else {
        currentGroup.push(sentences[i + 1]!);
      }
    }
    groups.push(currentGroup);

    return this._buildChunks(doc, groups);
  }

  private _buildChunks(
    doc: Document,
    groups: Sentence[][],
  ): PositionAwareChunk[] {
    const chunks: PositionAwareChunk[] = [];
    const subSplitter = new RecursiveCharacterChunker({
      chunkSize: this._maxChunkSize,
      chunkOverlap: 0,
    });

    for (const group of groups) {
      if (group.length === 0) continue;

      const start = group[0]!.start;
      const end = group[group.length - 1]!.end;
      const content = doc.content.slice(start, end);

      if (content.length <= this._maxChunkSize) {
        chunks.push({
          id: generatePaChunkId(content, String(doc.id), start),
          content,
          docId: doc.id,
          start,
          end,
          metadata: {},
        });
      } else {
        // Sub-split oversized groups
        const subDoc: Document = { ...doc, content };
        const subChunks = subSplitter.chunkWithPositions(subDoc);
        // Adjust positions to be relative to original document
        for (const sub of subChunks) {
          chunks.push({
            ...sub,
            id: generatePaChunkId(sub.content, String(doc.id), start + sub.start),
            docId: doc.id,
            start: start + sub.start,
            end: start + sub.end,
          });
        }
      }
    }

    return chunks;
  }
}

/**
 * Split text into sentences using the same regex pattern as SentenceChunker.
 * Splits after sentence-ending punctuation (.!?) followed by whitespace and a capital letter.
 */
function splitSentences(text: string): Sentence[] {
  if (text.trim().length === 0) return [];

  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const result: Sentence[] = [];
  let searchFrom = 0;

  for (const part of parts) {
    if (part.trim().length === 0) continue;
    const idx = text.indexOf(part, searchFrom);
    if (idx === -1) continue;
    result.push({ text: part, start: idx, end: idx + part.length });
    searchFrom = idx + part.length;
  }

  return result;
}

/** Compute the Nth percentile of a sorted array using linear interpolation. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (idx - lower);
}
```

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/semantic.test.ts`
Expected: PASS — all 8 tests

### Step 5: Commit

```bash
git add packages/eval-lib/src/chunkers/semantic.ts packages/eval-lib/tests/unit/chunkers/semantic.test.ts
git commit -m "feat(eval-lib): implement SemanticChunker (Kamradt method)"
```

---

## Task 11: Cluster Semantic Chunker

Implements the DP-based approach: embed micro-segments, compute pairwise similarity, find optimal chunk boundaries that maximize intra-chunk similarity.

**Files:**
- Create: `src/chunkers/cluster-semantic.ts`
- Test: `tests/unit/chunkers/cluster-semantic.test.ts`

### Step 1: Write the failing test

```typescript
// tests/unit/chunkers/cluster-semantic.test.ts
import { describe, it, expect, vi } from "vitest";
import { ClusterSemanticChunker } from "../../../src/chunkers/cluster-semantic.js";
import { isAsyncPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { DocumentId } from "../../../src/types/primitives.js";
import type { Document } from "../../../src/types/index.js";
import type { Embedder } from "../../../src/embedders/embedder.interface.js";

function makeDoc(id: string, content: string): Document {
  return { id: DocumentId(id), content, metadata: {} };
}

/** Mock embedder: each segment gets a unique embedding based on index. */
function makeMockEmbedder(): Embedder {
  let callCount = 0;
  return {
    name: "mock-embedder",
    dimension: 4,
    embed: vi.fn(async (texts: readonly string[]) => {
      callCount++;
      return texts.map((_, i) => {
        // Vary the direction based on index to simulate topic clusters
        const angle = (i / texts.length) * Math.PI;
        return [Math.cos(angle), Math.sin(angle), 0, 0];
      });
    }),
    embedQuery: vi.fn(async () => [1, 0, 0, 0]),
  };
}

/** Mock embedder where specific segments form clusters. */
function makeClusterEmbedder(embeddings: number[][]): Embedder {
  return {
    name: "mock-embedder",
    dimension: embeddings[0]?.length ?? 4,
    embed: vi.fn(async (texts: readonly string[]) => {
      return texts.map((_, i) => embeddings[i % embeddings.length]!);
    }),
    embedQuery: vi.fn(async () => embeddings[0]!),
  };
}

describe("ClusterSemanticChunker", () => {
  it("satisfies isAsyncPositionAwareChunker", () => {
    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder);
    expect(isAsyncPositionAwareChunker(chunker)).toBe(true);
  });

  it("has correct name format", () => {
    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, { maxChunkSize: 500 });
    expect(chunker.name).toBe("ClusterSemantic(size=500)");
  });

  it("produces chunks with valid positions", async () => {
    const content = "Hello world. ".repeat(20); // ~260 chars
    const doc = makeDoc("doc1", content);

    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, {
      maxChunkSize: 100,
      segmentSize: 30,
    });

    const chunks = await chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.docId).toBe(doc.id);
      expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
      expect(chunk.start).toBeGreaterThanOrEqual(0);
      expect(chunk.end).toBeLessThanOrEqual(doc.content.length);
    }
  });

  it("covers entire document without gaps", async () => {
    const content = "Word ".repeat(100); // 500 chars
    const doc = makeDoc("doc1", content);

    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, {
      maxChunkSize: 150,
      segmentSize: 30,
    });

    const chunks = await chunker.chunkWithPositions(doc);

    // First chunk starts at 0
    expect(chunks[0]!.start).toBe(0);
    // Last chunk ends at content.length
    expect(chunks[chunks.length - 1]!.end).toBe(content.length);
    // No gaps
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.start).toBe(chunks[i - 1]!.end);
    }
  });

  it("respects maxChunkSize constraint", async () => {
    const content = "Testing chunker behavior. ".repeat(30); // ~780 chars
    const doc = makeDoc("doc1", content);

    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, {
      maxChunkSize: 200,
      segmentSize: 30,
    });

    const chunks = await chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(200);
    }
  });

  it("handles empty document", async () => {
    const doc = makeDoc("doc1", "");
    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder);
    const chunks = await chunker.chunkWithPositions(doc);
    expect(chunks).toHaveLength(0);
  });

  it("returns single chunk for very short document", async () => {
    const doc = makeDoc("doc1", "Hi.");
    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, { maxChunkSize: 400 });
    const chunks = await chunker.chunkWithPositions(doc);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe("Hi.");
  });

  it("calls embedder.embed once with all segments", async () => {
    const content = "Word ".repeat(50); // 250 chars
    const doc = makeDoc("doc1", content);

    const embedder = makeMockEmbedder();
    const chunker = new ClusterSemanticChunker(embedder, { segmentSize: 30 });

    await chunker.chunkWithPositions(doc);

    expect(embedder.embed).toHaveBeenCalledTimes(1);
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/cluster-semantic.test.ts`
Expected: FAIL — module not found

### Step 3: Write implementation

```typescript
// src/chunkers/cluster-semantic.ts
import type { AsyncPositionAwareChunker } from "./chunker.interface.js";
import type { Document } from "../types/documents.js";
import type { PositionAwareChunk } from "../types/chunks.js";
import type { Embedder } from "../embedders/embedder.interface.js";
import { splitIntoSegments, type TextSegment } from "./segment-utils.js";
import { cosineSimilarity } from "../utils/similarity.js";
import { generatePaChunkId } from "../utils/hashing.js";

export interface ClusterSemanticChunkerOptions {
  /** Maximum chunk size in characters. @default 400 */
  maxChunkSize?: number;
  /** Characters per micro-segment before clustering. @default 50 */
  segmentSize?: number;
}

/**
 * Cluster-based semantic chunker (Chroma's approach):
 * 1. Split text into micro-segments
 * 2. Embed all segments
 * 3. Use dynamic programming to find chunk boundaries that
 *    maximize total intra-chunk embedding similarity
 *
 * Complexity: O(n²) where n = number of segments.
 */
export class ClusterSemanticChunker implements AsyncPositionAwareChunker {
  readonly name: string;
  readonly async = true as const;

  private readonly _embedder: Embedder;
  private readonly _maxChunkSize: number;
  private readonly _segmentSize: number;

  constructor(embedder: Embedder, options?: ClusterSemanticChunkerOptions) {
    this._embedder = embedder;
    this._maxChunkSize = options?.maxChunkSize ?? 400;
    this._segmentSize = options?.segmentSize ?? 50;
    this.name = `ClusterSemantic(size=${this._maxChunkSize})`;
  }

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]> {
    if (doc.content.trim().length === 0) return [];

    const segments = splitIntoSegments(doc.content, this._segmentSize);
    if (segments.length === 0) return [];

    // Single segment or short text → one chunk
    if (segments.length === 1) {
      return [this._makeChunk(doc, segments)];
    }

    // Embed all segments
    const embeddings = await this._embedder.embed(
      segments.map((s) => s.text),
    );

    // Precompute cumulative segment lengths for O(1) range-length queries
    const segLengths = segments.map((s) => s.end - s.start);

    // DP: find optimal chunk boundaries
    const n = segments.length;
    // dp[i] = max total intra-chunk similarity for segments[0..i]
    const dp = new Array<number>(n).fill(-Infinity);
    // parent[i] = the start index of the chunk ending at i
    const parent = new Array<number>(n).fill(0);

    for (let i = 0; i < n; i++) {
      // Try all starting positions j for the chunk ending at i
      let chunkLength = 0;
      for (let j = i; j >= 0; j--) {
        chunkLength += segLengths[j]!;
        if (chunkLength > this._maxChunkSize) break;

        const prevScore = j > 0 ? dp[j - 1]! : 0;
        const similarity = avgPairwiseSimilarity(embeddings, j, i);
        const totalScore = prevScore + similarity;

        if (totalScore > dp[i]!) {
          dp[i] = totalScore;
          parent[i] = j;
        }
      }
    }

    // Backtrack to find chunk boundaries
    const boundaries: Array<[number, number]> = []; // [startSegIdx, endSegIdx]
    let idx = n - 1;
    while (idx >= 0) {
      boundaries.push([parent[idx]!, idx]);
      idx = parent[idx]! - 1;
    }
    boundaries.reverse();

    // Build chunks from boundaries
    return boundaries.map(([startIdx, endIdx]) =>
      this._makeChunk(doc, segments.slice(startIdx, endIdx + 1)),
    );
  }

  private _makeChunk(
    doc: Document,
    segs: TextSegment[],
  ): PositionAwareChunk {
    const start = segs[0]!.start;
    const end = segs[segs.length - 1]!.end;
    const content = doc.content.slice(start, end);

    return {
      id: generatePaChunkId(content, String(doc.id), start),
      content,
      docId: doc.id,
      start,
      end,
      metadata: {},
    };
  }
}

/**
 * Compute average pairwise cosine similarity for embeddings[start..end].
 * For single segment, returns 1.0 (perfect self-similarity).
 */
function avgPairwiseSimilarity(
  embeddings: number[][],
  start: number,
  end: number,
): number {
  if (start === end) return 1.0;

  let total = 0;
  let count = 0;
  for (let i = start; i <= end; i++) {
    for (let j = i + 1; j <= end; j++) {
      total += cosineSimilarity(embeddings[i]!, embeddings[j]!);
      count++;
    }
  }

  return count === 0 ? 1.0 : total / count;
}
```

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/cluster-semantic.test.ts`
Expected: PASS — all 8 tests

### Step 5: Commit

```bash
git add packages/eval-lib/src/chunkers/cluster-semantic.ts packages/eval-lib/tests/unit/chunkers/cluster-semantic.test.ts
git commit -m "feat(eval-lib): implement ClusterSemanticChunker (DP-based boundary optimization)"
```

---

## Task 12: LLM Semantic Chunker

Uses an LLM to identify thematic boundaries in tagged text segments.

**Files:**
- Create: `src/chunkers/llm-semantic.ts`
- Test: `tests/unit/chunkers/llm-semantic.test.ts`

### Step 1: Write the failing test

```typescript
// tests/unit/chunkers/llm-semantic.test.ts
import { describe, it, expect, vi } from "vitest";
import { LLMSemanticChunker } from "../../../src/chunkers/llm-semantic.js";
import { isAsyncPositionAwareChunker } from "../../../src/chunkers/chunker.interface.js";
import { DocumentId } from "../../../src/types/primitives.js";
import type { Document } from "../../../src/types/index.js";
import type { PipelineLLM } from "../../../src/retrievers/pipeline/llm.interface.js";

function makeDoc(id: string, content: string): Document {
  return { id: DocumentId(id), content, metadata: {} };
}

function makeMockLLM(splitPoints: number[]): PipelineLLM {
  return {
    name: "mock-llm",
    complete: vi.fn(async () =>
      splitPoints.length > 0
        ? `split_after: ${splitPoints.join(", ")}`
        : "split_after: none",
    ),
  };
}

describe("LLMSemanticChunker", () => {
  it("satisfies isAsyncPositionAwareChunker", () => {
    const llm = makeMockLLM([]);
    const chunker = new LLMSemanticChunker(llm);
    expect(isAsyncPositionAwareChunker(chunker)).toBe(true);
  });

  it("has correct name", () => {
    const llm = makeMockLLM([]);
    const chunker = new LLMSemanticChunker(llm);
    expect(chunker.name).toBe("LLMSemantic");
  });

  it("produces chunks with valid positions", async () => {
    const content = "The cat sat on the mat. Dogs play fetch. The sun is warm.";
    const doc = makeDoc("doc1", content);

    const llm = makeMockLLM([1]); // split after segment 1
    const chunker = new LLMSemanticChunker(llm, { segmentSize: 25, batchSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(chunk.docId).toBe(doc.id);
      expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("splits text based on LLM-identified boundaries", async () => {
    // 3 segments of ~20 chars each
    const content = "Topic A content here. Topic B starts now. Topic C is last.";
    const doc = makeDoc("doc1", content);

    // LLM says split after segment 0 and segment 1
    const llm = makeMockLLM([0, 1]);
    const chunker = new LLMSemanticChunker(llm, { segmentSize: 20, batchSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("returns single chunk when LLM says no splits", async () => {
    const content = "Short coherent text about one topic.";
    const doc = makeDoc("doc1", content);

    const llm = makeMockLLM([]); // no splits
    const chunker = new LLMSemanticChunker(llm, { segmentSize: 50, batchSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe(content);
  });

  it("handles empty document", async () => {
    const doc = makeDoc("doc1", "");
    const llm = makeMockLLM([]);
    const chunker = new LLMSemanticChunker(llm);
    const chunks = await chunker.chunkWithPositions(doc);
    expect(chunks).toHaveLength(0);
  });

  it("handles invalid LLM response gracefully", async () => {
    const content = "Some text that needs chunking into pieces.";
    const doc = makeDoc("doc1", content);

    const llm: PipelineLLM = {
      name: "bad-llm",
      complete: vi.fn(async () => "I don't know what to do"),
    };

    const chunker = new LLMSemanticChunker(llm, { segmentSize: 20, batchSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    // Should fall back to no splits (one chunk)
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // All chunks should have valid positions
    for (const chunk of chunks) {
      expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("covers entire document without gaps", async () => {
    const content = "Word ".repeat(30); // 150 chars
    const doc = makeDoc("doc1", content);

    const llm = makeMockLLM([1, 3]);
    const chunker = new LLMSemanticChunker(llm, { segmentSize: 25, batchSize: 200 });
    const chunks = await chunker.chunkWithPositions(doc);

    expect(chunks[0]!.start).toBe(0);
    expect(chunks[chunks.length - 1]!.end).toBe(content.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.start).toBe(chunks[i - 1]!.end);
    }
  });
});
```

### Step 2: Run test to verify it fails

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/llm-semantic.test.ts`
Expected: FAIL — module not found

### Step 3: Write implementation

```typescript
// src/chunkers/llm-semantic.ts
import type { AsyncPositionAwareChunker } from "./chunker.interface.js";
import type { Document } from "../types/documents.js";
import type { PositionAwareChunk } from "../types/chunks.js";
import type { PipelineLLM } from "../retrievers/pipeline/llm.interface.js";
import { splitIntoSegments, type TextSegment } from "./segment-utils.js";
import { generatePaChunkId } from "../utils/hashing.js";

export interface LLMSemanticChunkerOptions {
  /** Characters per segment sent to the LLM. @default 50 */
  segmentSize?: number;
  /** Total characters per LLM batch call. @default 800 */
  batchSize?: number;
}

const SPLIT_PROMPT = `You are a document segmentation expert. The following text has been split into numbered segments, each wrapped with tags like <|start_segment_N|> and <|end_segment_N|>.

Identify which segments mark the END of a thematic section. Return ONLY the segment numbers after which a split should occur, in ascending order.

Format your response EXACTLY as:
split_after: 2, 5, 8

If no thematic boundaries are found, respond EXACTLY as:
split_after: none

Tagged text:
`;

/**
 * LLM-based semantic chunker (based on Chroma's approach):
 * 1. Split text into segments of ~segmentSize chars
 * 2. Wrap each segment with tags
 * 3. Batch segments and prompt LLM for split points
 * 4. Merge segments based on identified boundaries
 *
 * Note: Slow and expensive. Best for small-corpus experiments.
 */
export class LLMSemanticChunker implements AsyncPositionAwareChunker {
  readonly name = "LLMSemantic";
  readonly async = true as const;

  private readonly _llm: PipelineLLM;
  private readonly _segmentSize: number;
  private readonly _batchSize: number;

  constructor(llm: PipelineLLM, options?: LLMSemanticChunkerOptions) {
    this._llm = llm;
    this._segmentSize = options?.segmentSize ?? 50;
    this._batchSize = options?.batchSize ?? 800;
  }

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]> {
    if (doc.content.trim().length === 0) return [];

    const segments = splitIntoSegments(doc.content, this._segmentSize);
    if (segments.length === 0) return [];

    if (segments.length === 1) {
      return [makeChunk(doc, segments)];
    }

    // Wrap segments with tags
    const tagged = segments.map(
      (seg, i) => `<|start_segment_${i}|>${seg.text}<|end_segment_${i}|>`,
    );

    // Group into batches
    const batches = this._createBatches(tagged);

    // Collect all split points across batches
    const splitPoints = new Set<number>();
    let segmentOffset = 0;

    for (const batch of batches) {
      const prompt = SPLIT_PROMPT + batch.text;
      const response = await this._llm.complete(prompt);
      const points = parseSplitPoints(response, batch.startIdx, batch.endIdx);
      for (const p of points) {
        splitPoints.add(p);
      }
      segmentOffset += batch.count;
    }

    // Build chunks by splitting at identified boundaries
    const sortedSplits = [...splitPoints].sort((a, b) => a - b);
    const groups: TextSegment[][] = [];
    let groupStart = 0;

    for (const splitAfter of sortedSplits) {
      if (splitAfter + 1 <= groupStart || splitAfter >= segments.length) continue;
      groups.push(segments.slice(groupStart, splitAfter + 1));
      groupStart = splitAfter + 1;
    }
    // Remaining segments
    if (groupStart < segments.length) {
      groups.push(segments.slice(groupStart));
    }

    return groups.map((group) => makeChunk(doc, group));
  }

  private _createBatches(
    tagged: string[],
  ): Array<{ text: string; startIdx: number; endIdx: number; count: number }> {
    const batches: Array<{
      text: string;
      startIdx: number;
      endIdx: number;
      count: number;
    }> = [];
    let currentBatch: string[] = [];
    let currentLength = 0;
    let batchStart = 0;

    for (let i = 0; i < tagged.length; i++) {
      const taggedLen = tagged[i]!.length;

      if (currentLength + taggedLen > this._batchSize && currentBatch.length > 0) {
        batches.push({
          text: currentBatch.join("\n"),
          startIdx: batchStart,
          endIdx: batchStart + currentBatch.length - 1,
          count: currentBatch.length,
        });
        batchStart = i;
        currentBatch = [];
        currentLength = 0;
      }

      currentBatch.push(tagged[i]!);
      currentLength += taggedLen;
    }

    if (currentBatch.length > 0) {
      batches.push({
        text: currentBatch.join("\n"),
        startIdx: batchStart,
        endIdx: batchStart + currentBatch.length - 1,
        count: currentBatch.length,
      });
    }

    return batches;
  }
}

/**
 * Parse LLM response for split points.
 * Expected format: "split_after: 2, 5, 8" or "split_after: none"
 * Returns absolute segment indices (adjusted by batch offset).
 */
function parseSplitPoints(
  response: string,
  batchStartIdx: number,
  batchEndIdx: number,
): number[] {
  const match = response.match(/split_after:\s*(.+)/i);
  if (!match) return [];

  const value = match[1]!.trim();
  if (value.toLowerCase() === "none") return [];

  const points: number[] = [];
  for (const part of value.split(",")) {
    const num = parseInt(part.trim(), 10);
    if (!isNaN(num) && num >= batchStartIdx && num <= batchEndIdx) {
      points.push(num);
    }
  }

  return points.sort((a, b) => a - b);
}

function makeChunk(doc: Document, segs: TextSegment[]): PositionAwareChunk {
  const start = segs[0]!.start;
  const end = segs[segs.length - 1]!.end;
  const content = doc.content.slice(start, end);

  return {
    id: generatePaChunkId(content, String(doc.id), start),
    content,
    docId: doc.id,
    start,
    end,
    metadata: {},
  };
}
```

### Step 4: Run test to verify it passes

Run: `pnpm -C packages/eval-lib vitest run tests/unit/chunkers/llm-semantic.test.ts`
Expected: PASS — all 7 tests

### Step 5: Commit

```bash
git add packages/eval-lib/src/chunkers/llm-semantic.ts packages/eval-lib/tests/unit/chunkers/llm-semantic.test.ts
git commit -m "feat(eval-lib): implement LLMSemanticChunker"
```

---

## Task 13: Barrel Exports + Registry Updates + Re-exports

Update all barrel files to export new types and implementations. Flip registry statuses from "coming-soon" to "available".

**Files:**
- Modify: `src/chunkers/index.ts`
- Modify: `src/retrievers/pipeline/index.ts` (verify exports from Task 5)
- Modify: `src/retrievers/index.ts`
- Modify: `src/index.ts`
- Modify: `src/registry/refinement-steps.ts`
- Modify: `src/registry/chunkers.ts`

### Step 1: Update chunkers barrel

In `src/chunkers/index.ts`, add at the end:

```typescript
export { SemanticChunker } from "./semantic.js";
export type { SemanticChunkerOptions } from "./semantic.js";
export { ClusterSemanticChunker } from "./cluster-semantic.js";
export type { ClusterSemanticChunkerOptions } from "./cluster-semantic.js";
export { LLMSemanticChunker } from "./llm-semantic.js";
export type { LLMSemanticChunkerOptions } from "./llm-semantic.js";
export { splitIntoSegments } from "./segment-utils.js";
export type { TextSegment } from "./segment-utils.js";
```

### Step 2: Update retrievers/index.ts

Add new config type re-exports. In `src/retrievers/index.ts`, add to the existing type exports:

```typescript
  DedupRefinementStep,
  MmrRefinementStep,
  ExpandContextRefinementStep,
```

And add to the existing value exports (if not already done in Task 5):

```typescript
export { applyDedup, applyMmr, applyExpandContext } from "./pipeline/index.js";
```

### Step 3: Update root barrel (src/index.ts)

Add new chunker exports to `src/index.ts`. After the existing chunker exports:

```typescript
// Async chunkers
export type { AsyncPositionAwareChunker, SemanticChunkerOptions, ClusterSemanticChunkerOptions, LLMSemanticChunkerOptions } from "./chunkers/index.js";
export { isAsyncPositionAwareChunker, SemanticChunker, ClusterSemanticChunker, LLMSemanticChunker } from "./chunkers/index.js";
```

Add new refinement config types to the existing `RefinementStepConfig` type export block:

```typescript
  DedupRefinementStep,
  MmrRefinementStep,
  ExpandContextRefinementStep,
```

### Step 4: Update refinement-steps registry

In `src/registry/refinement-steps.ts`, change status for dedup (line 39), mmr (line 81), and expand-context (line 100):

```typescript
// dedup: change line 39
status: "available",  // was "coming-soon"

// mmr: change line 81
status: "available",  // was "coming-soon"

// expand-context: change line 100
status: "available",  // was "coming-soon"
```

### Step 5: Update chunkers registry

In `src/registry/chunkers.ts`, change status for semantic (line 168), cluster-semantic (line 197), and llm-semantic (line 227):

```typescript
// semantic: change line 168
status: "available",  // was "coming-soon"

// cluster-semantic: change line 197
status: "available",  // was "coming-soon"

// llm-semantic: change line 227
status: "available",  // was "coming-soon"
```

### Step 6: Verify build

Run: `pnpm -C packages/eval-lib build`
Expected: Build succeeds with no errors

### Step 7: Commit

```bash
git add packages/eval-lib/src/chunkers/index.ts packages/eval-lib/src/retrievers/index.ts packages/eval-lib/src/retrievers/pipeline/index.ts packages/eval-lib/src/index.ts packages/eval-lib/src/registry/refinement-steps.ts packages/eval-lib/src/registry/chunkers.ts
git commit -m "feat(eval-lib): update barrel exports and mark slice 5 features as available in registry"
```

---

## Task 14: Final Verification

Run the full test suite, typecheck, and build to ensure everything works together.

### Step 1: Run full test suite

Run: `pnpm -C packages/eval-lib vitest run`
Expected: All tests PASS (existing + new)

### Step 2: Run TypeScript type check

Run: `pnpm typecheck`
Expected: No type errors

### Step 3: Run build

Run: `pnpm build`
Expected: Clean build, no errors

### Step 4: Verify new test count

Run: `pnpm -C packages/eval-lib vitest run --reporter=verbose 2>&1 | tail -5`
Expected: Test count increased from baseline (225+). New tests added:
- `overlap-ratio.test.ts` — 6 tests
- `dedup.test.ts` — 9 tests
- `mmr.test.ts` — 6 tests
- `expand-context.test.ts` — 7 tests
- `chunkers.test.ts` — 3 new tests (isAsyncPositionAwareChunker)
- `segment-utils.test.ts` — 7 tests
- `semantic.test.ts` — 8 tests
- `cluster-semantic.test.ts` — 8 tests
- `llm-semantic.test.ts` — 7 tests

**Total new tests: ~61**

---

## Summary

### New Files (14)
| File | Purpose |
|------|---------|
| `src/retrievers/pipeline/refinement/overlap-ratio.ts` | Content overlap ratio helper |
| `src/retrievers/pipeline/refinement/dedup.ts` | Dedup refinement step |
| `src/retrievers/pipeline/refinement/mmr.ts` | MMR refinement step |
| `src/retrievers/pipeline/refinement/expand-context.ts` | Expand-context refinement step |
| `src/chunkers/segment-utils.ts` | Micro-segment splitting utility |
| `src/chunkers/semantic.ts` | Semantic chunker (Kamradt method) |
| `src/chunkers/cluster-semantic.ts` | Cluster semantic chunker (DP) |
| `src/chunkers/llm-semantic.ts` | LLM semantic chunker |
| `tests/unit/retrievers/pipeline/refinement/overlap-ratio.test.ts` | Tests |
| `tests/unit/retrievers/pipeline/refinement/dedup.test.ts` | Tests |
| `tests/unit/retrievers/pipeline/refinement/mmr.test.ts` | Tests |
| `tests/unit/retrievers/pipeline/refinement/expand-context.test.ts` | Tests |
| `tests/unit/chunkers/segment-utils.test.ts` | Tests |
| `tests/unit/chunkers/semantic.test.ts` | Tests |
| `tests/unit/chunkers/cluster-semantic.test.ts` | Tests |
| `tests/unit/chunkers/llm-semantic.test.ts` | Tests |

### Modified Files (8)
| File | Change |
|------|--------|
| `src/retrievers/pipeline/config.ts` | +3 interfaces, extend `RefinementStepConfig` union |
| `src/retrievers/pipeline/pipeline-retriever.ts` | +`_corpus` field, +`_chunkDocument()`, extend `_applyRefinements()`, async chunker in deps |
| `src/retrievers/pipeline/refinement/index.ts` | Re-export new refinement functions |
| `src/retrievers/pipeline/index.ts` | Re-export new types and functions |
| `src/chunkers/chunker.interface.ts` | +`AsyncPositionAwareChunker`, +`isAsyncPositionAwareChunker` |
| `src/chunkers/index.ts` | Re-export new chunkers |
| `src/retrievers/index.ts` | Re-export new config types |
| `src/index.ts` | Root barrel updates |

### Registry Updates (2)
| File | Change |
|------|--------|
| `src/registry/refinement-steps.ts` | dedup, mmr, expand-context → "available" |
| `src/registry/chunkers.ts` | semantic, cluster-semantic, llm-semantic → "available" |
