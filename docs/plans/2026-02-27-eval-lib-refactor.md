# eval-lib Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the eval-lib package and backend per all suggestions in `packages/eval-lib/docs/refactor_suggestions.md` — removing dead code, consolidating duplicates, improving type safety, and restructuring for scalability.

**Architecture:** Phased approach starting with safe deletions and quick wins (zero blast radius), then structural consolidations, then code quality improvements, then the LangSmith migration (cross-package), then scalability/extensibility changes, and finally test improvements. Each phase builds on the prior one.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, tsup, Convex backend

**Baseline:** 205 tests passing, 3 pre-existing failures (hardcoded temp paths in `dimensions.test.ts`)

---

## Phase 1: Dead Code Removal & Quick Fixes (zero blast radius)

### Task 1: Fix identical ternary branches (2.1)

**Files:**
- Modify: `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts:103-107`

**Step 1: Fix the dead ternary**

Replace lines 103-107:
```typescript
const bm25Config =
  this._searchConfig.strategy === "bm25"
    ? { k1: this._searchConfig.k1, b: this._searchConfig.b }
    : { k1: this._searchConfig.k1, b: this._searchConfig.b };
```

With:
```typescript
const bm25Config = { k1: this._searchConfig.k1, b: this._searchConfig.b };
```

**Step 2: Run tests**

Run: `pnpm test`
Expected: Same baseline (205 pass, 3 pre-existing fail)

**Step 3: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts
git commit -m "fix: remove identical ternary branches in pipeline-retriever (2.1)"
```

---

### Task 2: Delete 3 stale duplicate files in experiments/ (1.1)

**Files:**
- Delete: `packages/eval-lib/src/experiments/retriever.interface.ts`
- Delete: `packages/eval-lib/src/experiments/callback-retriever.ts`
- Delete: `packages/eval-lib/src/experiments/baseline-vector-rag/retriever.ts`

**Step 1: Verify these are orphaned duplicates**

Confirm `experiments/index.ts` already re-exports from `retrievers/` (it does — lines 3-7). Confirm nothing imports from the stale paths:
```bash
cd packages/eval-lib && grep -r "from.*experiments/retriever\.interface" src/ tests/ --include="*.ts" | grep -v "node_modules"
cd packages/eval-lib && grep -r "from.*experiments/callback-retriever" src/ tests/ --include="*.ts" | grep -v "node_modules"
cd packages/eval-lib && grep -r "from.*experiments/baseline-vector-rag/retriever" src/ tests/ --include="*.ts" | grep -v "node_modules"
```
Expected: No results (stale copies only import each other).

**Step 2: Delete the files**

```bash
rm packages/eval-lib/src/experiments/retriever.interface.ts
rm packages/eval-lib/src/experiments/callback-retriever.ts
rm packages/eval-lib/src/experiments/baseline-vector-rag/retriever.ts
```

**Step 3: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 4: Commit**

```bash
git add -A packages/eval-lib/src/experiments/
git commit -m "chore: delete 3 stale duplicate files in experiments/ (1.1)"
```

---

### Task 3: Delete dead `SyntheticDatasetGenerator` abstract class (1.7)

**Files:**
- Modify: `packages/eval-lib/src/synthetic-datagen/base.ts`

**Step 1: Verify it's unused**

```bash
grep -r "extends SyntheticDatasetGenerator" packages/eval-lib/src/ --include="*.ts"
grep -r "SyntheticDatasetGenerator" packages/eval-lib/src/ --include="*.ts"
```
Expected: Only the definition in `base.ts` and possibly its export (not used elsewhere).

**Step 2: Remove the class**

Delete the `abstract class SyntheticDatasetGenerator` definition from `base.ts`. Keep `LLMClient`, `openAIClientAdapter`, and `callLLM` — those are actively used.

Also remove `SyntheticDatasetGenerator` from any barrel exports (`synthetic-datagen/index.ts`, `src/index.ts`).

**Step 3: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 4: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/base.ts packages/eval-lib/src/synthetic-datagen/index.ts packages/eval-lib/src/index.ts
git commit -m "chore: delete dead SyntheticDatasetGenerator abstract class (1.7)"
```

---

### Task 4: Delete dead `corpusFromFolder` + `matchesGlob` (2.3)

**Files:**
- Modify: `packages/eval-lib/src/types/documents.ts` — remove `corpusFromFolder` and `matchesGlob`
- Modify: `packages/eval-lib/src/types/index.ts` — remove re-export
- Modify: `packages/eval-lib/src/index.ts` — remove re-export

**Step 1: Verify unused**

```bash
grep -r "corpusFromFolder\|matchesGlob" packages/eval-lib/src/ packages/eval-lib/tests/ packages/backend/ packages/frontend/ --include="*.ts" -l
```
Expected: Only definition and re-export files, no actual usage.

**Step 2: Remove functions from `documents.ts`**

Delete the `matchesGlob` function and `corpusFromFolder` function (approximately lines 54-95).

**Step 3: Remove re-exports**

Remove `corpusFromFolder` from `src/types/index.ts` and `src/index.ts`.

**Step 4: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 5: Commit**

```bash
git add packages/eval-lib/src/types/documents.ts packages/eval-lib/src/types/index.ts packages/eval-lib/src/index.ts
git commit -m "chore: delete dead corpusFromFolder and matchesGlob (2.3)"
```

---

### Task 5: Delete dead `ChromaVectorStore` + clean up packaging (2.4)

**Files:**
- Delete: `packages/eval-lib/src/vector-stores/chroma.ts`
- Modify: `packages/eval-lib/package.json` — remove `./vector-stores/chroma` sub-path export, remove `chromadb` from `peerDependencies` and `peerDependenciesMeta`
- Modify: `packages/eval-lib/tsup.config.ts` — remove chroma build entry

**Step 1: Verify unused**

```bash
grep -r "ChromaVectorStore\|from.*chroma" packages/eval-lib/src/ packages/eval-lib/tests/ packages/backend/ --include="*.ts" | grep -v "node_modules" | grep -v "chroma.ts"
```
Expected: No actual imports of ChromaVectorStore.

**Step 2: Delete file and clean packaging**

- Delete `src/vector-stores/chroma.ts`
- From `package.json`: remove the `"./vector-stores/chroma"` entry in `exports`, remove `chromadb` from `peerDependencies` and `peerDependenciesMeta`, and from `bundledDependencies` if present
- From `tsup.config.ts`: remove the `src/vector-stores/chroma.ts` build entry

**Step 3: Build**

Run: `pnpm build`
Expected: Builds successfully without chroma entry

**Step 4: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 5: Commit**

```bash
git add packages/eval-lib/src/vector-stores/chroma.ts packages/eval-lib/package.json packages/eval-lib/tsup.config.ts
git commit -m "chore: delete dead ChromaVectorStore and chromadb peer dep (2.4)"
```

---

## Phase 2: Deduplication & Consolidation

### Task 6: Extract `ScoredChunk` to shared pipeline types file (1.4)

**Files:**
- Create: `packages/eval-lib/src/retrievers/pipeline/types.ts`
- Modify: `packages/eval-lib/src/retrievers/pipeline/search/bm25.ts` — remove local `ScoredChunk`, import from `../types.js`
- Modify: `packages/eval-lib/src/retrievers/pipeline/search/fusion.ts` — remove local `ScoredChunk`, import from `../types.js`
- Modify: `packages/eval-lib/src/retrievers/pipeline/refinement/threshold.ts` — remove local `ScoredChunk`, import from `../types.js`
- Modify: `packages/eval-lib/src/retrievers/pipeline/index.ts` — re-export `ScoredChunk`

**Step 1: Create shared types file**

```typescript
// packages/eval-lib/src/retrievers/pipeline/types.ts
import type { PositionAwareChunk } from "../../types/chunks.js";

export interface ScoredChunk {
  readonly chunk: PositionAwareChunk;
  readonly score: number;
}
```

**Step 2: Update imports in bm25.ts, fusion.ts, threshold.ts**

In each file, remove the local `ScoredChunk` interface definition and add:
```typescript
import type { ScoredChunk } from "../types.js"; // bm25.ts, fusion.ts
import type { ScoredChunk } from "../types.js"; // threshold.ts (already one level up)
```

Adjust relative paths:
- `bm25.ts` and `fusion.ts` are in `search/`, so: `from "../types.js"`
- `threshold.ts` is in `refinement/`, so: `from "../types.js"`

**Step 3: Re-export from pipeline index**

Add to `packages/eval-lib/src/retrievers/pipeline/index.ts`:
```typescript
export type { ScoredChunk } from "./types.js";
```

**Step 4: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 5: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/
git commit -m "refactor: extract ScoredChunk to shared pipeline types file (1.4)"
```

---

### Task 7: Move `cosineSimilarity` to utils/ (1.6)

**Files:**
- Create: `packages/eval-lib/src/utils/similarity.ts`
- Modify: `packages/eval-lib/src/vector-stores/in-memory.ts` — remove private function, import from utils
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/real-world-grounded/matching.ts` — remove exported function, import from utils
- Modify: `packages/eval-lib/src/utils/index.ts` — re-export

**Step 1: Create shared utility**

```typescript
// packages/eval-lib/src/utils/similarity.ts
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
```

**Step 2: Update in-memory.ts**

Remove the private `cosineSimilarity` function (lines 4-15). Add:
```typescript
import { cosineSimilarity } from "../utils/similarity.js";
```

**Step 3: Update matching.ts**

Remove the exported `cosineSimilarity` function (lines 43-54). Add:
```typescript
import { cosineSimilarity } from "../../../../utils/similarity.js";
```
Keep the `export { cosineSimilarity }` or re-export: `export { cosineSimilarity } from "../../../../utils/similarity.js";`

**Step 4: Update utils/index.ts**

Add: `export { cosineSimilarity } from "./similarity.js";`

**Step 5: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 6: Commit**

```bash
git add packages/eval-lib/src/utils/ packages/eval-lib/src/vector-stores/in-memory.ts packages/eval-lib/src/synthetic-datagen/strategies/real-world-grounded/matching.ts
git commit -m "refactor: consolidate cosineSimilarity into utils/similarity.ts (1.6)"
```

---

### Task 8: Move span geometry functions to utils/span.ts (1.5)

**Files:**
- Modify: `packages/eval-lib/src/utils/span.ts` — add `mergeOverlappingSpans`, `calculateOverlap`, `totalSpanLength`
- Modify: `packages/eval-lib/src/evaluation/metrics/utils.ts` — remove moved functions, re-export from utils
- Modify: `packages/eval-lib/src/evaluation/metrics/recall.ts`, `precision.ts`, `iou.ts`, `f1.ts` — update imports if they import from `./utils.js`
- Modify: `packages/eval-lib/src/utils/index.ts` — re-export new functions

**Step 1: Move functions to utils/span.ts**

Append `mergeOverlappingSpans`, `calculateOverlap`, and `totalSpanLength` to `packages/eval-lib/src/utils/span.ts`. These functions already import from `utils/span.ts` so they become co-located with their dependencies.

**Step 2: Update evaluation/metrics/utils.ts**

Replace the function bodies with re-exports:
```typescript
export { mergeOverlappingSpans, calculateOverlap, totalSpanLength } from "../../utils/span.js";
```

This way all existing metric imports from `./utils.js` continue to work without modification.

**Step 3: Update utils/index.ts**

Add: `export { mergeOverlappingSpans, calculateOverlap, totalSpanLength } from "./span.js";`

**Step 4: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 5: Commit**

```bash
git add packages/eval-lib/src/utils/ packages/eval-lib/src/evaluation/metrics/utils.ts
git commit -m "refactor: move span geometry functions to utils/span.ts (1.5)"
```

---

### Task 9: Collapse preset subdirectories into single presets.ts (1.2)

**Files:**
- Create: `packages/eval-lib/src/experiments/presets.ts`
- Delete: `packages/eval-lib/src/experiments/baseline-vector-rag/config.ts`
- Delete: `packages/eval-lib/src/experiments/baseline-vector-rag/index.ts`
- Delete: `packages/eval-lib/src/experiments/bm25/config.ts`
- Delete: `packages/eval-lib/src/experiments/bm25/index.ts`
- Delete: `packages/eval-lib/src/experiments/hybrid/config.ts`
- Delete: `packages/eval-lib/src/experiments/hybrid/index.ts`
- Delete: `packages/eval-lib/src/experiments/hybrid-reranked/config.ts`
- Delete: `packages/eval-lib/src/experiments/hybrid-reranked/index.ts`
- Modify: `packages/eval-lib/src/experiments/index.ts` — update imports
- Modify: `packages/eval-lib/tests/unit/experiments/presets.test.ts` — update imports

**Step 1: Create `presets.ts`**

```typescript
// packages/eval-lib/src/experiments/presets.ts
import type { PositionAwareChunker } from "../chunkers/chunker.interface.js";
import type { Embedder } from "../embedders/embedder.interface.js";
import type { VectorStore } from "../vector-stores/vector-store.interface.js";
import type { Reranker } from "../rerankers/reranker.interface.js";
import type { PipelineConfig } from "../retrievers/pipeline/config.js";
import { PipelineRetriever } from "../retrievers/pipeline/pipeline-retriever.js";

// --- Shared deps interface ---

export interface PipelinePresetDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
}

// --- Preset configs ---

export const BASELINE_VECTOR_RAG_CONFIG: PipelineConfig = {
  name: "baseline-vector-rag",
  index: { strategy: "plain" },
  search: { strategy: "dense" },
};

export const BM25_CONFIG: PipelineConfig = {
  name: "bm25",
  index: { strategy: "plain" },
  search: { strategy: "bm25" },
};

export const HYBRID_CONFIG: PipelineConfig = {
  name: "hybrid",
  index: { strategy: "plain" },
  search: {
    strategy: "hybrid",
    denseWeight: 0.7,
    sparseWeight: 0.3,
    fusionMethod: "weighted",
    candidateMultiplier: 4,
  },
};

export const HYBRID_RERANKED_CONFIG: PipelineConfig = {
  name: "hybrid-reranked",
  index: { strategy: "plain" },
  search: {
    strategy: "hybrid",
    denseWeight: 0.7,
    sparseWeight: 0.3,
    fusionMethod: "weighted",
    candidateMultiplier: 4,
  },
  refinement: [{ type: "rerank" }],
};

// --- Generic factory ---

const PRESET_CONFIGS = {
  "baseline-vector-rag": BASELINE_VECTOR_RAG_CONFIG,
  "bm25": BM25_CONFIG,
  "hybrid": HYBRID_CONFIG,
  "hybrid-reranked": HYBRID_RERANKED_CONFIG,
} as const;

export function createPresetRetriever(
  presetName: keyof typeof PRESET_CONFIGS,
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
): PipelineRetriever {
  const base = PRESET_CONFIGS[presetName];
  const config: PipelineConfig = {
    ...base,
    ...overrides,
    name: overrides?.name ?? base.name,
  };
  return new PipelineRetriever(config, deps);
}

// --- Named convenience wrappers (backward compat) ---

/** @deprecated Use `PipelinePresetDeps` instead */
export type BaselineVectorRagPresetDeps = PipelinePresetDeps;
/** @deprecated Use `PipelinePresetDeps` instead */
export type BM25PresetDeps = PipelinePresetDeps;
/** @deprecated Use `PipelinePresetDeps` instead */
export type HybridPresetDeps = PipelinePresetDeps;
/** @deprecated Use `PipelinePresetDeps` with required `reranker` instead */
export interface HybridRerankedPresetDeps extends PipelinePresetDeps {
  readonly reranker: Reranker;
}

export const createBaselineVectorRagRetriever = (
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
) => createPresetRetriever("baseline-vector-rag", deps, overrides);

export const createBM25Retriever = (
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
) => createPresetRetriever("bm25", deps, overrides);

export const createHybridRetriever = (
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
) => createPresetRetriever("hybrid", deps, overrides);

export const createHybridRerankedRetriever = (
  deps: HybridRerankedPresetDeps,
  overrides?: Partial<PipelineConfig>,
) => createPresetRetriever("hybrid-reranked", deps, overrides);
```

**Step 2: Update experiments/index.ts**

Replace the preset imports with:
```typescript
// Re-export from retrievers/ for backward compatibility.
export type { Retriever } from "../retrievers/index.js";
export { VectorRAGRetriever } from "../retrievers/index.js";
export type { VectorRAGRetrieverConfig } from "../retrievers/index.js";
export { CallbackRetriever } from "../retrievers/index.js";
export type { CallbackRetrieverConfig } from "../retrievers/index.js";

// Experiment presets
export {
  createPresetRetriever,
  createBaselineVectorRagRetriever,
  BASELINE_VECTOR_RAG_CONFIG,
  createBM25Retriever,
  BM25_CONFIG,
  createHybridRetriever,
  HYBRID_CONFIG,
  createHybridRerankedRetriever,
  HYBRID_RERANKED_CONFIG,
} from "./presets.js";
export type {
  PipelinePresetDeps,
  BaselineVectorRagPresetDeps,
  BM25PresetDeps,
  HybridPresetDeps,
  HybridRerankedPresetDeps,
} from "./presets.js";
```

**Step 3: Delete the 4 subdirectories (8 files)**

```bash
rm -rf packages/eval-lib/src/experiments/baseline-vector-rag/
rm -rf packages/eval-lib/src/experiments/bm25/
rm -rf packages/eval-lib/src/experiments/hybrid/
rm -rf packages/eval-lib/src/experiments/hybrid-reranked/
```

**Step 4: Update presets.test.ts imports**

Update `tests/unit/experiments/presets.test.ts` to import from the new location. Change any imports from the old subdirectory paths to import from `../../../src/experiments/presets.js` or the barrel.

**Step 5: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 6: Commit**

```bash
git add packages/eval-lib/src/experiments/ packages/eval-lib/tests/unit/experiments/presets.test.ts
git commit -m "refactor: collapse preset subdirectories into single presets.ts (1.2)"
```

---

### Task 10: Flatten `retrievers/baseline-vector-rag/` (1.3)

**Files:**
- Create: `packages/eval-lib/src/retrievers/vector-rag-retriever.ts` (moved from `baseline-vector-rag/retriever.ts`)
- Delete: `packages/eval-lib/src/retrievers/baseline-vector-rag/` directory
- Modify: `packages/eval-lib/src/retrievers/index.ts` — update import path
- Modify: `packages/eval-lib/tests/unit/experiments/vector-rag-retriever.test.ts` — update import
- Modify: `packages/eval-lib/tests/integration/evaluation.test.ts` — update import if needed

**Step 1: Copy and add deprecation**

Copy `src/retrievers/baseline-vector-rag/retriever.ts` to `src/retrievers/vector-rag-retriever.ts`. Add `@deprecated` JSDoc to the class:

```typescript
/** @deprecated Use `createBaselineVectorRagRetriever()` from `experiments/presets` instead */
export class VectorRAGRetriever implements Retriever { ... }
```

Fix imports — they'll use `./retriever.interface.js` instead of `../retriever.interface.js`.

**Step 2: Delete subdirectory**

```bash
rm -rf packages/eval-lib/src/retrievers/baseline-vector-rag/
```

**Step 3: Update retrievers/index.ts**

Change import from `./baseline-vector-rag/index.js` to `./vector-rag-retriever.js`.

**Step 4: Update test imports**

Update `tests/unit/experiments/vector-rag-retriever.test.ts` and `tests/integration/evaluation.test.ts` if they import directly from the old path.

**Step 5: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 6: Commit**

```bash
git add packages/eval-lib/src/retrievers/ packages/eval-lib/tests/
git commit -m "refactor: flatten baseline-vector-rag into vector-rag-retriever.ts with @deprecated (1.3)"
```

---

## Phase 3: Code Quality & Type Safety

### Task 11: Replace `any` with structural interfaces for SDK clients (3.1)

**Files:**
- Modify: `packages/eval-lib/src/embedders/openai.ts` — replace `private _client: any` with structural interface
- Modify: `packages/eval-lib/src/rerankers/cohere.ts` — replace `private _client: any` with structural interface

**Step 1: Add structural interface for OpenAI embedder**

In `openai.ts`, add before the class:
```typescript
interface OpenAIEmbeddingsClient {
  embeddings: {
    create(opts: {
      model: string;
      input: string[];
    }): Promise<{
      data: Array<{ embedding: number[] }>;
    }>;
  };
}
```

Change `private _client: any` to `private _client: OpenAIEmbeddingsClient`.
Also type the constructor parameter and `create()` method accordingly.

**Step 2: Add structural interface for Cohere reranker**

In `cohere.ts`, add:
```typescript
interface CohereRerankClient {
  rerank(opts: {
    model: string;
    query: string;
    documents: string[];
    topN: number;
  }): Promise<{
    results: Array<{ index: number; relevanceScore: number }>;
  }>;
}
```

Change `private _client: any` to `private _client: CohereRerankClient`.

**Step 3: Build and test**

Run: `pnpm build && pnpm test`
Expected: Builds clean, same baseline

**Step 4: Commit**

```bash
git add packages/eval-lib/src/embedders/openai.ts packages/eval-lib/src/rerankers/cohere.ts
git commit -m "refactor: replace any with structural interfaces for SDK clients (3.1)"
```

---

### Task 12: Add `safeParseLLMResponse` utility (3.3)

**Files:**
- Create: `packages/eval-lib/src/utils/json.ts`
- Modify: `packages/eval-lib/src/utils/index.ts` — re-export
- Modify: 7 files with bare `JSON.parse()` calls (see list below)

**Step 1: Create utility**

```typescript
// packages/eval-lib/src/utils/json.ts
export function safeParseLLMResponse<T>(response: string, fallback: T): T {
  try {
    const cleaned = response.replace(/^```(?:json)?\n?|\n?```$/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    console.warn("Failed to parse LLM response:", response.slice(0, 200));
    return fallback;
  }
}
```

**Step 2: Update utils/index.ts**

Add: `export { safeParseLLMResponse } from "./json.js";`

**Step 3: Replace bare JSON.parse in each file**

Files to update:
1. `src/synthetic-datagen/strategies/simple/generator.ts:70`
2. `src/synthetic-datagen/strategies/dimension-driven/generator.ts:122`
3. `src/synthetic-datagen/strategies/dimension-driven/filtering.ts:71`
4. `src/synthetic-datagen/strategies/dimension-driven/relevance.ts:56,103`
5. `src/synthetic-datagen/strategies/dimension-driven/discovery.ts:74`
6. `src/synthetic-datagen/ground-truth/token-level.ts:71`

In each file: import `safeParseLLMResponse` and replace `JSON.parse(response)` with `safeParseLLMResponse(response, <appropriate-fallback>)`.

Fallbacks:
- `generator.ts` (simple): `{ questions: [] }`
- `generator.ts` (dimension-driven): `{ questions: [] }`
- `filtering.ts`: `{ unrealistic_pairs: [] }`
- `relevance.ts:56`: `{ summary: "" }`
- `relevance.ts:103`: `{ assignments: [] }`
- `discovery.ts`: `{ dimensions: [] }`
- `token-level.ts`: `{ excerpts: [] }`

**Step 4: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 5: Commit**

```bash
git add packages/eval-lib/src/utils/ packages/eval-lib/src/synthetic-datagen/
git commit -m "feat: add safeParseLLMResponse utility for resilient LLM JSON parsing (3.3)"
```

---

### Task 13: Strengthen chunk ID hashing (3.7)

**Files:**
- Modify: `packages/eval-lib/src/utils/hashing.ts`
- Modify: `packages/eval-lib/src/chunkers/recursive-character.ts` — pass docId and start to hash
- Modify: `packages/eval-lib/tests/unit/utils/hashing.test.ts` — update tests

**Step 1: Update `generatePaChunkId` signature**

Make new params optional for backward compat:
```typescript
export function generatePaChunkId(
  content: string,
  docId?: string,
  start?: number,
): PositionAwareChunkId {
  const input = docId != null ? `${docId}:${start}:${content}` : content;
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 16);
  return PositionAwareChunkId(`pa_chunk_${hash}`);
}
```

Add `import { createHash } from "node:crypto";` at the top. Keep the existing `fnv1aHash` for now (it may be used elsewhere — check first; if only used by `generatePaChunkId`, remove it).

**Step 2: Update RecursiveCharacterChunker**

In `recursive-character.ts`, where `generatePaChunkId` is called, pass the document ID and chunk start position:
```typescript
generatePaChunkId(chunkText, String(docId), startPosition)
```

**Step 3: Update hashing tests**

Update existing tests to match new behavior. Add tests for:
- Two chunks with same content but different docId → different IDs
- Two chunks with same content and position but different docId → different IDs
- Backward compat: calling with just content still works

**Step 4: Run tests**

Run: `pnpm test`
Expected: Same baseline (update snapshot assertions if needed)

**Step 5: Commit**

```bash
git add packages/eval-lib/src/utils/hashing.ts packages/eval-lib/src/chunkers/recursive-character.ts packages/eval-lib/tests/unit/utils/hashing.test.ts
git commit -m "feat: strengthen chunk ID hashing with SHA-256 and position awareness (3.7)"
```

---

### Task 14: Add concurrency limits to LLM fan-outs (3.8)

**Files:**
- Create: `packages/eval-lib/src/utils/concurrency.ts`
- Modify: `packages/eval-lib/src/utils/index.ts` — re-export
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/relevance.ts`
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/filtering.ts`

**Step 1: Create concurrency utility**

```typescript
// packages/eval-lib/src/utils/concurrency.ts
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit: number = 5,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

**Step 2: Update relevance.ts**

Replace `Promise.all(corpus.documents.map(...))` with `mapWithConcurrency(corpus.documents, ..., 5)`.

**Step 3: Update filtering.ts**

Replace `Promise.all(tasks.map(...))` with `mapWithConcurrency(tasks, ..., 5)`.

**Step 4: Run tests**

Run: `pnpm test`
Expected: Same baseline

**Step 5: Commit**

```bash
git add packages/eval-lib/src/utils/ packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/
git commit -m "feat: add concurrency limits to LLM fan-outs in dimension-driven strategy (3.8)"
```

---

### Task 15: Add `@deprecated` to `VectorRAGRetriever` export (2.2)

**Files:**
- Modify: `packages/eval-lib/src/index.ts` — add deprecation comment to export

**Step 1: Add deprecation**

Find `VectorRAGRetriever` in `src/index.ts` exports and add JSDoc:
```typescript
/** @deprecated Use `createBaselineVectorRagRetriever()` instead */
```

Note: The actual class already has `@deprecated` from Task 10. This adds it to the barrel re-export site as well.

**Step 2: Commit**

```bash
git add packages/eval-lib/src/index.ts
git commit -m "chore: add @deprecated to VectorRAGRetriever export (2.2)"
```

---

## Phase 4: LangSmith Migration (1.10 — cross-package, atomic)

### Task 16: Move LangSmith code from eval-lib to backend

This is the largest task. It must be done atomically.

**Files (eval-lib — removals):**
- Delete: `packages/eval-lib/src/langsmith/` (entire directory — 8 files)
- Modify: `packages/eval-lib/src/index.ts` — remove all LangSmith exports
- Modify: `packages/eval-lib/src/synthetic-datagen/index.ts` — remove `uploadToLangsmith`/`datasetName` options
- Modify: `packages/eval-lib/package.json` — remove langsmith sub-path exports, peer deps, build entries
- Modify: `packages/eval-lib/tsup.config.ts` — remove langsmith build entries
- Delete: `packages/eval-lib/tests/unit/langsmith/` (entire directory)
- Delete: `packages/eval-lib/tests/unit/experiments/runner.test.ts` (tests `runLangSmithExperiment`)

**Files (backend — additions):**
- Create: `packages/backend/convex/lib/langsmith.ts` — shared `getLangSmithClient()` helper
- Modify: `packages/backend/convex/langsmithSync.ts` — inline `uploadDataset` (replace eval-lib import)
- Modify: `packages/backend/convex/experimentActions.ts` — inline `runLangSmithExperiment`, `createLangSmithEvaluators`, `deserializeSpans` (replace eval-lib subpath import)

**Step 1: Create backend `lib/langsmith.ts`**

```typescript
// packages/backend/convex/lib/langsmith.ts
export async function getLangSmithClient(): Promise<any> {
  const { Client } = await import("langsmith");
  return new Client();
}
```

**Step 2: Inline `uploadDataset` into `langsmithSync.ts`**

Copy the implementation from `eval-lib/src/langsmith/upload.ts` into `langsmithSync.ts`. Replace the `import { uploadDataset } from "rag-evaluation-system"` with a local function. Use `getLangSmithClient` from `./lib/langsmith.js`.

**Step 3: Inline `runLangSmithExperiment` + helpers into `experimentActions.ts`**

Copy `runLangSmithExperiment` from `eval-lib/src/langsmith/experiment-runner.ts`, `createLangSmithEvaluators`/`deserializeSpans` from `evaluator-adapters.ts`. Replace the subpath import (`from "rag-evaluation-system/langsmith/experiment-runner"`) with local code. Import eval-lib types (`Metric`, `Retriever`, `CharacterSpan`, etc.) from `rag-evaluation-system` (already done for other types).

**Step 4: Clean up eval-lib synthetic-datagen/index.ts**

Remove `uploadToLangsmith` and `datasetName` from `GenerateOptions`. Delete the dynamic import block for langsmith upload.

**Step 5: Clean up eval-lib index.ts**

Remove all LangSmith exports (approximately lines 147-170 — `getLangSmithClient`, `uploadDataset`, `loadDataset`, `createLangSmithEvaluator`, `createLangSmithEvaluators`, `listDatasets`, `listExperiments`, `getCompareUrl`, and all langsmith-related type re-exports).

**Step 6: Clean up eval-lib packaging**

- `package.json`: remove `"./langsmith"` and `"./langsmith/experiment-runner"` sub-path exports, remove `langsmith` from `peerDependencies`/`peerDependenciesMeta`/`bundledDependencies`
- `tsup.config.ts`: remove `"src/langsmith/index.ts"` and `"src/langsmith/experiment-runner.ts"` entries

**Step 7: Delete eval-lib langsmith directory and tests**

```bash
rm -rf packages/eval-lib/src/langsmith/
rm -rf packages/eval-lib/tests/unit/langsmith/
rm packages/eval-lib/tests/unit/experiments/runner.test.ts
```

**Step 8: Build both packages**

```bash
pnpm build
pnpm typecheck
pnpm typecheck:backend
```
Expected: Both build and typecheck cleanly.

**Step 9: Run eval-lib tests**

Run: `pnpm test`
Expected: Remaining tests pass (count will be lower since langsmith and runner tests were deleted)

**Step 10: Commit**

```bash
git add -A packages/eval-lib/ packages/backend/
git commit -m "refactor: move all LangSmith code from eval-lib to backend (1.10)"
```

---

## Phase 5: Readability & Structure

### Task 17: Fix test directory misalignment (1.8)

**Files:**
- Move: `tests/unit/experiments/runner.test.ts` → already deleted in Task 16
- Move: `tests/unit/experiments/vector-rag-retriever.test.ts` → `tests/unit/retrievers/vector-rag-retriever.test.ts`

**Step 1: Move test file**

```bash
mv packages/eval-lib/tests/unit/experiments/vector-rag-retriever.test.ts packages/eval-lib/tests/unit/retrievers/vector-rag-retriever.test.ts
```

Update imports in the moved file if needed.

**Step 2: Run tests**

Run: `pnpm test`
Expected: Same passing count

**Step 3: Commit**

```bash
git add packages/eval-lib/tests/
git commit -m "chore: move vector-rag-retriever test to match source location (1.8)"
```

---

### Task 18: Fix hardcoded temp paths in tests (7.1)

**Files:**
- Modify: `packages/eval-lib/tests/unit/synthetic-datagen/strategies/dimension-driven-integration.test.ts`
- Modify: `packages/eval-lib/tests/unit/synthetic-datagen/strategies/dimensions.test.ts`

**Step 1: Fix both test files**

Replace:
```typescript
const tmpDir = "/private/tmp/claude-501/dd-integration-test";
```

With:
```typescript
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";

// In beforeAll/beforeEach:
const tmpDir = await mkdtemp(path.join(tmpdir(), "dd-integration-"));
```

Add cleanup in afterAll/afterEach:
```typescript
import { rm } from "node:fs/promises";
// In afterAll:
await rm(tmpDir, { recursive: true, force: true });
```

**Step 2: Run tests**

Run: `pnpm test`
Expected: The 3 previously failing tests now PASS. New baseline: **208 tests passing, 0 failures**.

**Step 3: Commit**

```bash
git add packages/eval-lib/tests/unit/synthetic-datagen/strategies/
git commit -m "fix: replace hardcoded temp paths with os.tmpdir() in tests (7.1)"
```

---

### Task 19: Rename confusing `generation.ts` to `few-shot.ts` (4.3)

**Files:**
- Rename: `packages/eval-lib/src/synthetic-datagen/strategies/real-world-grounded/generation.ts` → `few-shot.ts`
- Modify: Any file that imports from `./generation.js` in that directory

**Step 1: Rename and update imports**

```bash
mv packages/eval-lib/src/synthetic-datagen/strategies/real-world-grounded/generation.ts packages/eval-lib/src/synthetic-datagen/strategies/real-world-grounded/few-shot.ts
```

Find and update all imports from `./generation.js` to `./few-shot.js` in the `real-world-grounded/` directory (likely `generator.ts` and/or `index.ts`).

**Step 2: Run tests**

Run: `pnpm test`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/strategies/real-world-grounded/
git commit -m "refactor: rename generation.ts to few-shot.ts for clarity (4.3)"
```

---

### Task 20: Document silent truncation + add maxDocumentChars config (4.2)

**Files:**
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/types.ts` — add `maxDocumentChars` to strategy options if not present
- Modify: `packages/eval-lib/src/synthetic-datagen/ground-truth/token-level.ts` — make truncation configurable
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/simple/generator.ts` — make truncation configurable
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/generator.ts` — make truncation configurable

**Step 1: Add config option**

Add `maxDocumentChars?: number` to relevant config types/interfaces. Default to existing values (6000-8000).

**Step 2: Add console.warn when truncation occurs**

At each truncation site, add:
```typescript
if (content.length > maxChars) {
  console.warn(`Document "${docId}" truncated from ${content.length} to ${maxChars} chars`);
}
```

**Step 3: Run tests**

Run: `pnpm test`
Expected: All pass

**Step 4: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/
git commit -m "feat: add configurable maxDocumentChars with truncation warnings (4.2)"
```

---

### Task 21: Surface hidden hyperparameters (4.4)

**Files:**
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/real-world-grounded/matching.ts` — add JSDoc to constants
- Modify: `packages/eval-lib/src/retrievers/pipeline/search/bm25.ts` — add JSDoc to `DEFAULT_BM25_DELTA`
- Modify: `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts` — make `_batchSize` configurable via deps

**Step 1: Add JSDoc comments to all buried constants**

Each constant gets a brief `/** ... */` explaining what it controls and how to tune it.

**Step 2: Make `_batchSize` configurable**

Add `embeddingBatchSize?: number` to `PipelineRetrieverDeps` or `IndexConfig`. Default to 100.

**Step 3: Run tests**

Run: `pnpm test`
Expected: All pass

**Step 4: Commit**

```bash
git add packages/eval-lib/src/
git commit -m "docs: surface hidden hyperparameters with JSDoc and configurable defaults (4.4)"
```

---

### Task 22: Slim root barrel export (4.1)

**Files:**
- Modify: `packages/eval-lib/src/index.ts`

**Step 1: Identify safe removals**

Items safe to remove from the barrel (unused by backend — confirmed in blast radius analysis):
- `InMemoryVectorStore`
- `VectorRAGRetriever` (keep for now but deprecated)
- `mergeOverlappingSpans`, `calculateOverlap`, `totalSpanLength` (now in utils/span.ts — keep them as they may have external consumers, but they're re-exported from metrics/utils.ts already)
- `discoverDimensions`, `loadDimensions`, `loadDimensionsFromFile` (dimension discovery utils)
- `DEFAULT_INDEX_CONFIG`, `DEFAULT_QUERY_CONFIG`, `DEFAULT_SEARCH_CONFIG` (pipeline defaults)

**Step 2: Move removed items behind sub-path exports**

Add sub-path exports in `package.json`:
- `"./pipeline/internals"` for config defaults, hash functions
- Keep `"./utils"` for utility functions

Remove from root barrel: `discoverDimensions`, `loadDimensions`, `loadDimensionsFromFile`, `DEFAULT_*_CONFIG` constants, dimension-related type exports.

**IMPORTANT:** Verify these 23 items STAY in the barrel: `CallbackRetriever`, `computeIndexConfigHash`, `createCorpusFromDocuments`, `createDocument`, `DocumentId`, `PositionAwareChunkId`, `OpenAIEmbedder`, `SimpleStrategy`, `DimensionDrivenStrategy`, `RealWorldGroundedStrategy`, `GroundTruthAssigner`, `parseDimensions`, `computeRetrieverConfigHash`, `PipelineConfig`, `RecursiveCharacterChunker`, `QueryId`, `QueryText`, `openAIClientAdapter`, `LLMClient`, `PipelineRetriever`, plus all type exports the backend uses.

**Step 3: Build and test**

Run: `pnpm build && pnpm test && pnpm typecheck:backend`
Expected: All pass

**Step 4: Commit**

```bash
git add packages/eval-lib/src/index.ts packages/eval-lib/package.json
git commit -m "refactor: slim root barrel, move internal exports to sub-paths (4.1)"
```

---

## Phase 6: Scalability & Extensibility

### Task 23: Extract search strategies into strategy object pattern (5.1)

**Files:**
- Create: `packages/eval-lib/src/retrievers/pipeline/search/strategy.interface.ts`
- Create: `packages/eval-lib/src/retrievers/pipeline/search/dense.ts`
- Modify: `packages/eval-lib/src/retrievers/pipeline/search/bm25.ts` — extract to `BM25SearchStrategy` class
- Create: `packages/eval-lib/src/retrievers/pipeline/search/hybrid.ts`
- Modify: `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts` — delegate to strategy
- Modify: `packages/eval-lib/src/retrievers/pipeline/search/index.ts` — re-export strategies

**Step 1: Define `SearchStrategy` interface**

```typescript
// search/strategy.interface.ts
import type { PositionAwareChunk } from "../../../types/chunks.js";
import type { Embedder } from "../../../embedders/embedder.interface.js";
import type { VectorStore } from "../../../vector-stores/vector-store.interface.js";
import type { ScoredChunk } from "../types.js";

export interface SearchStrategyDeps {
  readonly embedder: Embedder;
  readonly vectorStore: VectorStore;
}

export interface SearchStrategy {
  readonly name: string;
  init(chunks: readonly PositionAwareChunk[], deps: SearchStrategyDeps): Promise<void>;
  search(query: string, k: number, deps: SearchStrategyDeps): Promise<ScoredChunk[]>;
  cleanup(): Promise<void>;
}
```

**Step 2: Implement DenseSearchStrategy, BM25SearchStrategy, HybridSearchStrategy**

Extract the existing logic from `pipeline-retriever.ts` into individual strategy classes. Each implements the `SearchStrategy` interface.

**Step 3: Refactor PipelineRetriever**

Replace switch statements with:
```typescript
private _searchStrategy: SearchStrategy;
// In init:
this._searchStrategy = createSearchStrategy(this._searchConfig);
await this._searchStrategy.init(chunks, { embedder, vectorStore });
// In retrieve:
return this._searchStrategy.search(query, k, { embedder, vectorStore });
```

**Step 4: Run tests**

Run: `pnpm test`
Expected: All pass (no behavioral change)

**Step 5: Commit**

```bash
git add packages/eval-lib/src/retrievers/pipeline/
git commit -m "refactor: extract search strategies into strategy object pattern (5.1)"
```

---

### Task 24: Make `VectorStore.search()` return scores (5.2)

**Files:**
- Modify: `packages/eval-lib/src/vector-stores/vector-store.interface.ts`
- Modify: `packages/eval-lib/src/vector-stores/in-memory.ts`
- Modify: `packages/eval-lib/src/retrievers/pipeline/search/dense.ts` (or pipeline-retriever.ts)
- Modify: `packages/eval-lib/src/retrievers/vector-rag-retriever.ts`
- Modify: `packages/eval-lib/tests/unit/vector-stores/in-memory.test.ts`

**Step 1: Update interface**

```typescript
search(queryEmbedding: readonly number[], k?: number): Promise<ScoredChunk[]>;
```

Import `ScoredChunk` from pipeline types (or define a similar type in vector-stores).

**Step 2: Update InMemoryVectorStore**

Return `{ chunk, score }` pairs instead of just chunks.

**Step 3: Update consumers**

Update `DenseSearchStrategy` and `VectorRAGRetriever` to use scores from vector store results.

**Step 4: Run tests**

Run: `pnpm test`
Expected: All pass after updating test assertions

**Step 5: Commit**

```bash
git add packages/eval-lib/src/vector-stores/ packages/eval-lib/src/retrievers/ packages/eval-lib/tests/
git commit -m "feat: make VectorStore.search() return ScoredChunk with real similarity scores (5.2)"
```

---

### Task 25: Add Document index for O(1) lookup (5.3)

**Files:**
- Modify: `packages/eval-lib/src/synthetic-datagen/ground-truth/token-level.ts` — build Map once
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/dimension-driven/relevance.ts` — build Map once
- Modify: `packages/eval-lib/src/synthetic-datagen/strategies/real-world-grounded/generator.ts` — build Map once

**Step 1: Replace `corpus.documents.find()` with Map lookup**

At the start of each function that does `corpus.documents.find(d => String(d.id) === docId)`, build:
```typescript
const docIndex = new Map(corpus.documents.map(d => [String(d.id), d]));
```

Then replace `.find()` with `docIndex.get(docId)`.

**Step 2: Run tests**

Run: `pnpm test`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/eval-lib/src/synthetic-datagen/
git commit -m "perf: use Map-based document index for O(1) lookups (5.3)"
```

---

### Task 26: Cache `mergeOverlappingSpans` in metric computation (5.4)

**Files:**
- Modify: `packages/eval-lib/src/evaluation/evaluator.ts`

**Step 1: Pre-compute merged spans**

In `computeMetrics`, before calling individual metrics, merge spans once:
```typescript
const mergedGroundTruth = mergeOverlappingSpans(result.groundTruthSpans);
const mergedRetrieved = mergeOverlappingSpans(result.retrievedSpans);
```

Pass pre-merged spans to each metric (requires updating metric signatures or adding a cache wrapper).

**Step 2: Run tests**

Run: `pnpm test`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/eval-lib/src/evaluation/
git commit -m "perf: pre-compute merged spans in computeMetrics to avoid redundant merging (5.4)"
```

---

### Task 27: Add InMemoryVectorStore deduplication guard (5.5)

**Files:**
- Modify: `packages/eval-lib/src/vector-stores/in-memory.ts`

**Step 1: Clear on re-init**

At the start of `add()` method (or make `init()` call `clear()` first), add:
```typescript
// If being re-initialized, clear previous state
```

Actually, the safer approach: call `this._chunks = []; this._embeddings = [];` at the start of the `add()` method if already populated, OR document that `add()` accumulates. The cleaner fix: add a `clear()` call at the start of `init()` if `_chunks.length > 0`.

**Step 2: Run tests**

Run: `pnpm test`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/eval-lib/src/vector-stores/in-memory.ts
git commit -m "fix: add deduplication guard to InMemoryVectorStore (5.5)"
```

---

### Task 28: Add retry logic to LLM calls (5.6)

**Files:**
- Create: `packages/eval-lib/src/utils/retry.ts`
- Modify: `packages/eval-lib/src/utils/index.ts` — re-export
- Modify: `packages/eval-lib/src/synthetic-datagen/base.ts` — wrap LLM calls in retry

**Step 1: Create retry utility**

```typescript
// packages/eval-lib/src/utils/retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; backoffMs?: number } = {},
): Promise<T> {
  const { maxRetries = 3, backoffMs = 1000 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}
```

**Step 2: Apply to `callLLM` or `openAIClientAdapter`**

Wrap the LLM call in `withRetry()` in `base.ts` so all strategies automatically get retry behavior.

**Step 3: Run tests**

Run: `pnpm test`
Expected: All pass

**Step 4: Commit**

```bash
git add packages/eval-lib/src/utils/ packages/eval-lib/src/synthetic-datagen/base.ts
git commit -m "feat: add retry logic with exponential backoff for LLM calls (5.6)"
```

---

## Phase 7: Test Improvements

### Task 29: Fix conditional assertions in pipeline-retriever tests (7.2)

**Files:**
- Modify: `packages/eval-lib/tests/unit/retrievers/pipeline/pipeline-retriever.test.ts:309-313`

**Step 1: Replace conditional with unconditional assertions**

Replace:
```typescript
if (results.length > 1 && plainResults.length > 1) {
  const rerankedFirst = results[0];
  const plainLast = plainResults[plainResults.length - 1];
  expect(rerankedFirst.id).toBe(plainLast.id);
}
```

With:
```typescript
expect(results.length).toBeGreaterThan(1);
expect(plainResults.length).toBeGreaterThan(1);
expect(results[0].id).toBe(plainResults[plainResults.length - 1].id);
```

**Step 2: Run tests**

Run: `pnpm test`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/eval-lib/tests/unit/retrievers/pipeline/pipeline-retriever.test.ts
git commit -m "test: replace conditional assertions with unconditional in pipeline tests (7.2)"
```

---

### Task 30: Fix non-null assertions without guard (7.3)

**Files:**
- Modify: `packages/eval-lib/tests/unit/experiments/runner.test.ts` — NOTE: this file was deleted in Task 16. Skip if already gone. Otherwise apply the fix.

If the file still exists (different test ordering), add `expect(capturedTarget).toBeDefined();` before the `!` usage.

---

### Task 31: Fix progress event ordering test (7.4)

**Files:**
- Modify: `packages/eval-lib/tests/unit/synthetic-datagen/strategies/real-world-grounded-integration.test.ts:111-114`

**Step 1: Replace presence check with order check**

Replace:
```typescript
expect(phases).toContain("embedding-questions");
expect(phases).toContain("embedding-passages");
expect(phases).toContain("matching");
expect(phases).toContain("done");
```

With:
```typescript
expect(phases).toEqual(["embedding-questions", "embedding-passages", "matching", "done"]);
```

**Step 2: Run tests**

Run: `pnpm test`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/eval-lib/tests/unit/synthetic-datagen/strategies/real-world-grounded-integration.test.ts
git commit -m "test: verify progress event ordering, not just presence (7.4)"
```

---

### Task 32: Add JSDoc to all public interfaces (4.5)

**Files:**
- Modify: `packages/eval-lib/src/retrievers/retriever.interface.ts`
- Modify: `packages/eval-lib/src/embedders/embedder.interface.ts`
- Modify: `packages/eval-lib/src/vector-stores/vector-store.interface.ts`
- Modify: `packages/eval-lib/src/rerankers/reranker.interface.ts`
- Modify: `packages/eval-lib/src/chunkers/chunker.interface.ts`
- Modify: `packages/eval-lib/src/evaluation/metrics/base.ts`

**Step 1: Add JSDoc to each interface and method**

Brief, useful JSDoc — what the method does, what the params mean, what it returns. Not boilerplate.

**Step 2: Build**

Run: `pnpm build`
Expected: Clean build

**Step 3: Commit**

```bash
git add packages/eval-lib/src/
git commit -m "docs: add JSDoc to all public interfaces (4.5)"
```

---

### Task 33: Add missing test coverage (6.1 + 6.2 — selected high-priority items)

**Files:**
- Create: `packages/eval-lib/tests/unit/retrievers/callback-retriever.test.ts`
- Modify: `packages/eval-lib/tests/unit/vector-stores/in-memory.test.ts` — add edge cases
- Modify: `packages/eval-lib/tests/unit/retrievers/pipeline/search/bm25.test.ts` — add edge cases

**Step 1: Write CallbackRetriever tests**

Test: init/retrieve/cleanup delegation, optional callbacks, error propagation.

**Step 2: Add InMemoryVectorStore edge cases**

- Multiple `add()` calls
- `k > stored chunks`

**Step 3: Add BM25 edge cases**

- `build([])` followed by `search()`
- Two chunks with identical content

**Step 4: Run tests**

Run: `pnpm test`
Expected: All pass, higher count

**Step 5: Commit**

```bash
git add packages/eval-lib/tests/
git commit -m "test: add tests for CallbackRetriever and edge cases for InMemory/BM25 (6.1, 6.2)"
```

---

## Phase 8: Final Verification

### Task 34: Full build + test + typecheck verification

**Step 1: Build everything**

```bash
pnpm build
```

**Step 2: Typecheck everything**

```bash
pnpm typecheck
pnpm typecheck:backend
```

**Step 3: Run all tests**

```bash
pnpm test
pnpm -C packages/backend test
```

**Step 4: Verify no regressions**

Expected: All tests pass, all typechecks clean, zero regressions vs baseline.

---

## Sequencing Notes

- **Tasks 1-5** are independent and can be done in any order (or parallelized)
- **Tasks 6-10** build on dead code removal but are independent of each other
- **Tasks 11-15** are independent code quality improvements
- **Task 16** (LangSmith migration) must be atomic and done after Tasks 1-5 (dead code removal)
- **Tasks 17-22** depend on Task 16 being complete
- **Tasks 23-28** are independent scalability improvements
- **Tasks 29-33** are test improvements, independent of each other
- **Task 34** is the final verification gate
