# eval-lib Refactoring Suggestions

> Scope: `packages/eval-lib/` only. Every suggestion cites specific file paths and line numbers.

---

## Table of Contents

1. [Folder Structure](#1-folder-structure)
2. [Dead Code & Duplication](#2-dead-code--duplication)
3. [Code Quality & Type Safety](#3-code-quality--type-safety)
4. [Readability](#4-readability)
5. [Scalability & Extensibility](#5-scalability--extensibility)
6. [Test Coverage](#6-test-coverage)
7. [Test Quality](#7-test-quality)
8. [Priority Summary](#8-priority-summary)

---

## 1. Folder Structure

### 1.1 Complete the `experiments/` → `retrievers/` Migration

**Problem:** The `experiments/` directory was the original home for retriever code. When `retrievers/` was created as the canonical location, the migration was never completed. Three files remain as byte-for-byte duplicates:

| Stale copy (dead code) | Canonical copy |
|---|---|
| `src/experiments/retriever.interface.ts` | `src/retrievers/retriever.interface.ts` |
| `src/experiments/callback-retriever.ts` | `src/retrievers/callback-retriever.ts` |
| `src/experiments/baseline-vector-rag/retriever.ts` | `src/retrievers/baseline-vector-rag/retriever.ts` |

The stale copies import from each other (e.g., the stale `callback-retriever.ts` imports from the stale `retriever.interface.ts`), forming an orphaned import subgraph that nothing else touches.

**Fix:** Delete all three stale files. `experiments/index.ts` already re-exports from `retrievers/` — so nothing breaks.

### 1.2 Collapse Preset Subdirectories Into a Single Registry File

**Problem:** Four preset subdirectories each contain two near-identical files:

```
src/experiments/
├── baseline-vector-rag/config.ts + index.ts   (8 + 27 lines)
├── bm25/config.ts + index.ts                  (8 + 24 lines)
├── hybrid/config.ts + index.ts                (14 + 24 lines)
└── hybrid-reranked/config.ts + index.ts       (14 + 27 lines)
```

The factory functions are copy-pasted — all four do the same `{ ...CONFIG, ...overrides, name: ... }` merge and `new PipelineRetriever(config, deps)`. The `*PresetDeps` interfaces are identical in three of four cases (only `HybridRerankedPresetDeps` makes `reranker` required).

**Fix:** Replace all 8 files with a single `src/experiments/presets.ts`:

```typescript
// One shared deps interface
export interface PipelinePresetDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
}

// All configs in one map
export const PRESET_CONFIGS = {
  "baseline-vector-rag": { name: "baseline-vector-rag", index: { strategy: "plain" }, search: { strategy: "dense" } },
  "bm25":                { name: "bm25", index: { strategy: "plain" }, search: { strategy: "bm25" } },
  // ... etc
} as const satisfies Record<string, PipelineConfig>;

// One generic factory
export function createPresetRetriever(
  presetName: keyof typeof PRESET_CONFIGS,
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
): PipelineRetriever { ... }

// Named convenience wrappers (one-liners) for backward compat
export const createBaselineVectorRagRetriever = (deps, overrides?) =>
  createPresetRetriever("baseline-vector-rag", deps, overrides);
```

This makes it trivial to add new presets — one line per preset instead of a new directory with two files.

### 1.3 Flatten `retrievers/baseline-vector-rag/` Into a Single File

**Problem:** `src/retrievers/baseline-vector-rag/` has two files: `retriever.ts` (73 lines) and `index.ts` (2 lines that re-export). The subdirectory adds a layer for no structural benefit, inconsistent with `callback-retriever.ts` sitting flat in `retrievers/`.

**Fix:** Move `VectorRAGRetriever` to `src/retrievers/vector-rag-retriever.ts` and delete the subdirectory. Mark it `@deprecated` with a pointer to `createBaselineVectorRagRetriever`.

### 1.4 Extract `ScoredChunk` Into a Shared Types File

**Problem:** `ScoredChunk` is independently declared in three files:
- `src/retrievers/pipeline/search/bm25.ts:7`
- `src/retrievers/pipeline/search/fusion.ts:4`
- `src/retrievers/pipeline/refinement/threshold.ts:3`

All identical: `{ readonly chunk: PositionAwareChunk; readonly score: number }`.

**Fix:** Create `src/retrievers/pipeline/types.ts` with the single definition. Import from there in all three files.

### 1.5 Move Span Geometry Functions to `utils/`

**Problem:** `src/evaluation/metrics/utils.ts` contains `mergeOverlappingSpans`, `calculateOverlap`, and `totalSpanLength`. These are pure span-geometry functions, not metric implementations. They use `spanOverlapChars` from `src/utils/span.ts`. The two files operate on the same `SpanRange` abstraction but live in different directories.

**Fix:** Move `mergeOverlappingSpans`, `calculateOverlap`, and `totalSpanLength` into `src/utils/span.ts`. The metrics files can then import from `../../utils/span.js`.

### 1.6 Move `cosineSimilarity` to `utils/`

**Problem:** Identical `cosineSimilarity` implementations exist in:
- `src/vector-stores/in-memory.ts:4` (private)
- `src/synthetic-datagen/strategies/real-world-grounded/matching.ts:43` (exported)

**Fix:** Create `src/utils/similarity.ts`, export `cosineSimilarity` from there, import in both files.

### 1.7 Remove Dead Abstract Class

**Problem:** `src/synthetic-datagen/base.ts` exports `abstract class SyntheticDatasetGenerator`. It is never extended — `extends SyntheticDatasetGenerator` has zero matches in the codebase. All three strategies implement `QuestionStrategy` directly.

**Fix:** Delete `SyntheticDatasetGenerator` from `base.ts`. Keep `LLMClient` and `openAIClientAdapter` in the same file (or rename to `llm.ts`).

### 1.8 Fix Test Directory Misalignment

**Problem:** Two test files live under `tests/unit/experiments/` but test source files that are not in `src/experiments/`:

| Test file | Actually tests |
|---|---|
| `tests/unit/experiments/runner.test.ts` | `src/langsmith/experiment-runner.ts` |
| `tests/unit/experiments/vector-rag-retriever.test.ts` | `src/retrievers/baseline-vector-rag/retriever.ts` |

**Fix:**
- Move `runner.test.ts` → `tests/unit/langsmith/experiment-runner.test.ts`
- Move `vector-rag-retriever.test.ts` → `tests/unit/retrievers/vector-rag-retriever.test.ts`

### 1.10 Move All LangSmith Code From eval-lib to Backend

**Problem:** The entire `src/langsmith/` directory (8 files) is an integration layer between eval-lib and an external system (LangSmith). Now that the Convex backend handles all LangSmith interaction (dataset sync, experiment execution, retry logic), this code belongs in the backend — not in a pure evaluation library.

**Current state of each file:**

| File | Exports | Used By |
|---|---|---|
| `get-client.ts` | `getLangSmithClient()` | Internal to langsmith module only |
| `upload.ts` | `uploadDataset()` | Backend (`langsmithSync.ts:74`) + dead `generate()` wrapper |
| `experiment-runner.ts` | `runLangSmithExperiment()` | Backend (`experimentActions.ts:293`) |
| `evaluator-adapters.ts` | `createLangSmithEvaluator/s()`, `deserializeSpans()` | Internal (used by `experiment-runner.ts`) |
| `client.ts` | `loadDataset()` | Tests only |
| `datasets.ts` | `listDatasets()`, `listExperiments()`, `getCompareUrl()` | Tests only |
| `raw-api.ts` | `createLangSmithExperiment()`, `logLangSmithResult()` | Dead — nothing imports these |
| `index.ts` | Barrel re-exports | — |

The backend is the only runtime consumer. The frontend never touches LangSmith. The `generate()` wrapper in `synthetic-datagen/index.ts` has an `uploadToLangsmith` option that dynamically imports `uploadDataset` — but no code calls this wrapper (the backend calls `strategy.generate()` directly).

**Fix — four steps:**

**Step 1: Move active code to backend.** The following functions move to `"use node"` action files in `packages/backend/convex/`:

- `uploadDataset()` → inline into `langsmithSync.ts` (already the only caller, just move the implementation)
- `runLangSmithExperiment()` → move to `experimentActions.ts` or a new `langsmithExperiment.ts` action file
- `createLangSmithEvaluator/s()` + `deserializeSpans()` → move alongside `runLangSmithExperiment` (helper functions)
- `getLangSmithClient()` → move as a shared helper in the backend

These functions import eval-lib types (`Metric`, `Retriever`, `CharacterSpan`, `DocumentId`, `Corpus`, `positionAwareChunkToSpan`). After moving, the backend imports these types from `rag-evaluation-system` — which it already does for 23 other items. No circular dependency.

**Step 2: Delete dead code.**

- `raw-api.ts` — `createLangSmithExperiment()` and `logLangSmithResult()` are fully dead (never imported)
- `client.ts` — `loadDataset()` is test-only; delete or rewrite as a backend test helper
- `datasets.ts` — `listDatasets()`, `listExperiments()`, `getCompareUrl()` are test-only; delete or rewrite as backend test helpers

**Step 3: Clean up eval-lib `generate()` wrapper.**

Remove the `uploadToLangsmith` and `datasetName` options from `GenerateOptions` in `synthetic-datagen/index.ts:39-40`, and delete the dynamic import block (lines 56-59). No code calls this wrapper — the backend calls `strategy.generate()` directly.

**Step 4: Remove LangSmith packaging from eval-lib.**

- Delete `src/langsmith/` directory entirely
- Remove all LangSmith exports from `src/index.ts` (lines 147-170)
- Remove sub-path exports (`./langsmith`, `./langsmith/experiment-runner`) from `package.json`
- Remove build entries from `tsup.config.ts` (lines 9-10)
- Remove `langsmith` from `peerDependencies` and `peerDependenciesMeta` in `package.json`
- Remove `langsmith` from `bundledDependencies` in `package.json` (line 45)

**Result:** eval-lib becomes a pure evaluation library — types, chunking, embedding, retrieval, metrics, synthetic datagen. Zero LangSmith dependency. All external system integration lives in the backend where it belongs.

### 1.9 Suggested Final Structure

After all changes, the `src/` tree would look like:

```
src/
├── types/                      # Unchanged
├── utils/
│   ├── hashing.ts
│   ├── span.ts                 # + mergeOverlappingSpans, calculateOverlap, totalSpanLength
│   ├── similarity.ts           # NEW: cosineSimilarity
│   └── index.ts
├── chunkers/                   # Unchanged
├── embedders/                  # Unchanged
├── vector-stores/              # Unchanged (imports from utils/similarity)
├── rerankers/                  # Unchanged
├── retrievers/
│   ├── retriever.interface.ts
│   ├── callback-retriever.ts
│   ├── vector-rag-retriever.ts # Flattened, @deprecated
│   ├── index.ts
│   └── pipeline/
│       ├── types.ts            # NEW: ScoredChunk lives here
│       ├── config.ts
│       ├── pipeline-retriever.ts
│       ├── index.ts
│       ├── search/
│       │   ├── bm25.ts
│       │   ├── fusion.ts
│       │   └── index.ts
│       └── refinement/
│           ├── threshold.ts
│           └── index.ts
├── evaluation/
│   ├── evaluator.ts
│   ├── index.ts
│   └── metrics/
│       ├── base.ts
│       ├── recall.ts, precision.ts, iou.ts, f1.ts
│       ├── utils.ts            # Only metric-specific helpers (or empty/removed)
│       └── index.ts
├── experiments/
│   ├── presets.ts              # NEW: all configs + generic factory + named wrappers
│   └── index.ts                # Re-exports from presets.ts and retrievers/
├── synthetic-datagen/          # Unchanged (minus dead SyntheticDatasetGenerator class, minus uploadToLangsmith option)
└── index.ts                   # Minus all LangSmith exports
```

---

## 2. Dead Code & Duplication

### 2.1 Identical Ternary Branches in `pipeline-retriever.ts`

**File:** `src/retrievers/pipeline/pipeline-retriever.ts:103-107`

```typescript
const bm25Config =
  this._searchConfig.strategy === "bm25"
    ? { k1: this._searchConfig.k1, b: this._searchConfig.b }
    : { k1: this._searchConfig.k1, b: this._searchConfig.b };
```

Both branches are identical. This is a copy-paste artifact.

**Fix:** Replace with `const bm25Config = { k1: this._searchConfig.k1, b: this._searchConfig.b };`

### 2.2 `VectorRAGRetriever` Exported Without Deprecation

**File:** `src/index.ts:62`

`VectorRAGRetriever` is exported as top-level public API despite being superseded by `PipelineRetriever`. It bypasses the pipeline system entirely (no config hashing, no BM25 support, no refinement).

**Fix:** Add `@deprecated Use createBaselineVectorRagRetriever() instead` JSDoc. Consider removing from the public API in a future major version.

### 2.3 `corpusFromFolder` Is Dead Code

**File:** `src/types/documents.ts:54-95`

`corpusFromFolder` reads a corpus from disk using `node:fs/promises` and `node:path`. It was the original entry point for loading documents, but the project moved to Convex file uploads — the backend constructs corpora via `createCorpusFromDocuments()` from DB records instead. The function is:

- **Never called** in any runtime code (backend, frontend, or eval-lib)
- **Never called** in any test file
- **Re-exported** through `src/types/index.ts:15` and `src/index.ts:29`
- **Referenced** only in `README.md` examples and docs

It also pulls in `node:fs/promises` and `node:path` via dynamic imports, which adds unnecessary Node.js coupling to the types module. The helper `matchesGlob` (used only by `corpusFromFolder`) is also dead.

**Fix:** Delete `corpusFromFolder` and `matchesGlob` from `documents.ts`. Remove re-exports from `types/index.ts` and `src/index.ts`. Update `README.md` examples to use `createCorpusFromDocuments()` instead.

### 2.4 Delete `ChromaVectorStore` — Dead Optional Adapter

**File:** `src/vector-stores/chroma.ts` (~90 lines)

`ChromaVectorStore` is a `VectorStore` implementation backed by ChromaDB. It is completely unused:

- **Not exported** from `src/vector-stores/index.ts` or the root barrel `src/index.ts`
- **Not imported** anywhere in backend, frontend, or tests
- **No test coverage** — no test file exists for it

The only traces are build/packaging infrastructure:
- `package.json`: sub-path export (`./vector-stores/chroma`) and `chromadb` optional peer dep
- `tsup.config.ts:7`: separate build entry point
- `frontend/PipelineConfigModal.tsx:338`: disabled dropdown label `chroma (coming soon)`

The backend uses Convex's native `ctx.vectorSearch()` for vector search and will never use Chroma. `InMemoryVectorStore` covers local/test use. Suggestion 3.1 proposes typing Chroma's `any` client — that effort is wasted on dead code. If Chroma is ever needed again, re-implementing a ~90-line adapter against the `VectorStore` interface is trivial.

**Fix:** Delete `src/vector-stores/chroma.ts`. Remove the sub-path export and `chromadb` peer dep from `package.json`. Remove the build entry from `tsup.config.ts`. Optionally remove the disabled dropdown option from `PipelineConfigModal.tsx`.

---

## 3. Code Quality & Type Safety

### 3.1 Replace `any` with Structural Interfaces for SDK Clients

**Problem:** `any` is used for dynamically-imported SDK clients in two files (three if `ChromaVectorStore` is kept — see 2.4):

| File | Field | Should Be |
|---|---|---|
| `src/embedders/openai.ts:7` | `private _client: any` | `{ embeddings: { create(opts): Promise<...> } }` |
| `src/rerankers/cohere.ts:7` | `private _client: any` | `{ rerank(opts): Promise<...> } }` |

This means typos in property names (e.g., `item.embeddings` vs `item.embedding`) cause silent runtime failures.

**Fix:** Define minimal structural interfaces (duck-typed) for each client's used surface area. Example for OpenAI:

```typescript
interface OpenAIEmbeddingsClient {
  embeddings: {
    create(opts: { model: string; input: string[] }): Promise<{
      data: Array<{ embedding: number[] }>;
    }>;
  };
}
```

### 3.2 Replace `any` with Typed LangSmith Client

> **Note:** If 1.10 (move LangSmith to backend) is done first, this suggestion applies to the backend copy of `getLangSmithClient` rather than eval-lib.

**File:** `src/langsmith/get-client.ts:1`

```typescript
export async function getLangSmithClient(): Promise<any>
```

Every function in the langsmith module accesses arbitrary properties on this `any` return: `client.listExamples()`, `project.feedback_stats`, `project.tenant_id`, etc. A typo anywhere fails silently.

**Fix:** Define a structural interface covering the used methods:

```typescript
interface LangSmithClientSurface {
  listExamples(opts: { datasetId: string }): AsyncIterable<LangSmithExample>;
  createDataset(name: string, opts?: { description?: string }): Promise<{ id: string }>;
  createExamples(opts: { inputs: any[]; outputs: any[]; datasetId: string }): Promise<void>;
  // ... etc
}
```

### 3.3 Add `safeParse()` for LLM JSON Responses

**Problem:** Bare `JSON.parse()` is called in 6+ locations across datagen strategies. LLMs can return malformed JSON (prefixed text, truncated output, markdown fences) which crashes the entire generation pipeline.

**Files:**
- `src/synthetic-datagen/strategies/simple/generator.ts:70`
- `src/synthetic-datagen/strategies/dimension-driven/generator.ts:122`
- `src/synthetic-datagen/strategies/dimension-driven/filtering.ts:71`
- `src/synthetic-datagen/strategies/dimension-driven/relevance.ts:56,103`
- `src/synthetic-datagen/strategies/dimension-driven/discovery.ts:74`
- `src/synthetic-datagen/ground-truth/token-level.ts:71`

**Fix:** Create a shared utility:

```typescript
// src/utils/json.ts
export function safeParseLLMResponse<T>(response: string, fallback: T): T {
  try {
    // Strip markdown code fences if present
    const cleaned = response.replace(/^```json?\n?|\n?```$/g, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    console.warn("Failed to parse LLM response:", response.slice(0, 200));
    return fallback;
  }
}
```

Use at each call site: `safeParseLLMResponse(response, { questions: [] })`.

### 3.4 Fix `loadDataset` Using Index-Based Query IDs

> **Note:** If 1.10 (move LangSmith to backend) is done first, `loadDataset` is deleted (test-only code). This fix becomes moot.

**File:** `src/langsmith/client.ts:12-13`

```typescript
id: QueryId(`q_${i}`),
```

Uses the array index `i` instead of the stable LangSmith example UUID. If dataset order changes, IDs shift, breaking any code that relies on stable query identification (e.g., Convex `questions` records linked to LangSmith examples).

**Fix:** Use `QueryId(example.id)` to preserve the LangSmith-assigned UUID.

### 3.5 Fix LangSmith URL Construction Inconsistency

> **Note:** If 1.10 (move LangSmith to backend) is done first, `raw-api.ts` is deleted (dead code). Apply this fix during the migration if `uploadDataset` URL construction is preserved.

**File:** `src/langsmith/raw-api.ts:35`

```typescript
const baseUrl = process.env.LANGSMITH_ENDPOINT ?? "https://smith.langchain.com";
const experimentUrl = `${baseUrl}/projects/p/${project.id}`;
```

Uses `process.env` directly, while `src/langsmith/datasets.ts:74` uses `client.getHostUrl()`. The URL format also differs — `raw-api.ts` omits the org tenant ID slug that `datasets.ts` includes.

**Fix:** Use `client.getHostUrl()` consistently. Align URL format with `datasets.ts`.

### 3.6 Fix `normalizedFind` Off-by-One Risk

**File:** `src/synthetic-datagen/ground-truth/token-level.ts:118-137`

The whitespace-normalization fallback maps positions from normalized text back to the original. The character-walk loop can produce incorrect span offsets with mixed whitespace (tabs, CRLF, non-breaking spaces) because it assumes all whitespace collapses 1:1.

**Fix:** Replace the character walk with a pre-built index array mapping each normalized position to its original position, constructed during the normalization step itself.

### 3.7 Strengthen Chunk ID Hashing

**File:** `src/utils/hashing.ts:17-22`

`generatePaChunkId` uses 48 bits of FNV-1a hash (8 hex chars + 4 hex chars). Collisions become probable at ~16M chunks. Worse, the ID is derived from content only — two identical chunks from different documents (e.g., a repeated header) get the same ID, causing silent overwrites in `BM25SearchIndex._chunkMap`.

**Fix:** Incorporate `docId`, `start`, and `end` into the hash input:

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

### 3.8 Add Concurrency Limits to LLM Fan-Outs

**Files:**
- `src/synthetic-datagen/strategies/dimension-driven/relevance.ts:45` — `Promise.all(corpus.documents.map(...))`
- `src/synthetic-datagen/strategies/dimension-driven/filtering.ts:45` — `Promise.all(tasks.map(...))`

Both fire unbounded concurrent LLM calls. With 20 documents or 10 dimension pairs, this hits rate limits.

**Fix:** Implement a simple semaphore or use a `pLimit`-style concurrency limiter:

```typescript
async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> { ... }
```

Default to 5-10 concurrent calls.

---

## 4. Readability

### 4.1 Slim Down the Root Barrel Export

**File:** `src/index.ts` — 175 lines, ~70 named exports.

Several exports are internal utilities unlikely to be needed by library consumers:
- `mergeOverlappingSpans`, `calculateOverlap`, `totalSpanLength` — internal to metrics
- `computeIndexConfigHash`, `computeRetrieverConfigHash` — pipeline internals (used by the backend, but via direct import)
- `DEFAULT_INDEX_CONFIG`, `DEFAULT_QUERY_CONFIG`, `DEFAULT_SEARCH_CONFIG` — pipeline defaults
- `discoverDimensions`, `loadDimensions`, `loadDimensionsFromFile`, `parseDimensions` — dimension discovery utilities

**Fix:** Move internal exports behind sub-path imports. Only keep the types, primary classes, and factory functions in the root. Backend code that needs hashing or config internals imports from `rag-evaluation-system/pipeline` (or similar sub-path).

### 4.2 Document Silent Truncation in LLM Prompts

**Files:**
- `src/synthetic-datagen/ground-truth/token-level.ts:62` — `docContent.substring(0, 8000)`
- `src/synthetic-datagen/strategies/simple/generator.ts` — similar 6000-8000 char truncation
- `src/synthetic-datagen/strategies/dimension-driven/generator.ts` — similar

The LLM only sees the first 6000-8000 characters of each document. If an answer span is beyond this window, the LLM cannot extract it, and the span is silently dropped with only a `console.warn`. Callers get fewer ground-truth spans than expected with no error signal.

**Fix:** At minimum, add a `maxDocumentChars` option to strategy configs so the truncation is visible and configurable. Emit a progress/warning event when truncation occurs. Consider chunked extraction for long documents.

### 4.3 Rename Confusing `generation.ts` vs `generator.ts`

**Directory:** `src/synthetic-datagen/strategies/real-world-grounded/`

- `generator.ts` — contains the `RealWorldGroundedStrategy` class
- `generation.ts` — contains `generateFewShotQuestions()` and `distributeBudget()` helpers

These two filenames differ by one letter and both contain generation logic. A reader cannot tell which has the class and which has helpers.

**Fix:** Rename `generation.ts` to `few-shot.ts` or `budget.ts` (or merge into `generator.ts` if small enough).

### 4.4 Surface Hidden Hyperparameters

Several important hyperparameters are buried as local constants with no documentation:

| Constant | Location | Value | What It Controls |
|---|---|---|---|
| `PASSAGE_MAX_LENGTH` | `matching.ts:6` | 500 | Max chars per passage for matching |
| `PASSAGE_MERGE_THRESHOLD` | `matching.ts:7` | 100 | Min chars to keep short paragraphs |
| Cosine threshold | `matching.ts:79` | 0.35 | Question-to-passage match cutoff |
| `DEFAULT_BM25_DELTA` | `bm25.ts:5` | 0.5 | BM25+ frequency normalization lower bound |
| `_batchSize` | `pipeline-retriever.ts:70` | 100 | Embedding batch size |
| Doc truncation | `token-level.ts:62` | 8000 | Max doc chars sent to LLM |

**Fix:** Extract these into config objects or named defaults at the top of each module with brief JSDoc comments explaining what they do and how to tune them. For `_batchSize`, add it to `PipelineRetrieverDeps` or `IndexConfig`.

### 4.5 Add JSDoc to All Public Interfaces

The core interfaces (`Retriever`, `Embedder`, `VectorStore`, `Reranker`, `Chunker`, `PositionAwareChunker`, `Metric`) have no JSDoc. Adding brief method-level documentation would make them self-documenting when consumed via IDE hover.

---

## 5. Scalability & Extensibility

### 5.1 Extract Search Strategies Into a Strategy Object Pattern

**Problem:** `PipelineRetriever` is a God object with switch statements for search and refinement. Adding a new search strategy requires editing `config.ts`, `pipeline-retriever.ts` (switch + init logic), possibly a new file, then threading exports through three barrel files.

**Current structure (in `pipeline-retriever.ts`):**

```typescript
// init() — must add if-branch per strategy
if (strategy !== "bm25") { /* embed + store */ }
if (strategy === "bm25" || strategy === "hybrid") { /* build BM25 */ }

// retrieve() — must add case per strategy
switch (this._searchConfig.strategy) {
  case "dense":  return this._searchDense(query, k);
  case "bm25":   return this._searchBM25(query, k);
  case "hybrid":  return this._searchHybrid(query, k);
}
```

At 6-8 strategies, this becomes unmaintainable.

**Fix:** Define a `SearchStrategy` interface:

```typescript
interface SearchStrategy {
  readonly name: string;
  init(chunks: readonly PositionAwareChunk[], deps: { embedder: Embedder; vectorStore: VectorStore }): Promise<void>;
  search(query: string, k: number, deps: { embedder: Embedder; vectorStore: VectorStore }): Promise<ScoredChunk[]>;
  cleanup(): Promise<void>;
}
```

Implement `DenseSearchStrategy`, `BM25SearchStrategy`, `HybridSearchStrategy` as separate classes. `PipelineRetriever` stores a `_searchStrategy: SearchStrategy` and delegates to it. Adding a new strategy means adding a new class, not modifying the retriever. The switch statements disappear.

Do the same for refinement steps:

```typescript
interface RefinementStep {
  apply(query: string, results: ScoredChunk[], k: number): Promise<ScoredChunk[]>;
}
```

### 5.2 Make `VectorStore.search()` Return Scores

**File:** `src/vector-stores/vector-store.interface.ts`

```typescript
search(queryEmbedding: readonly number[], k?: number): Promise<PositionAwareChunk[]>;
```

Returns chunks without scores. The pipeline must then infer scores from rank position via `assignRankScores()`, throwing away real similarity scores that the vector store already computed.

**Fix:** Change the return type to `Promise<ScoredChunk[]>` (or a similar scored wrapper). This gives the fusion and refinement stages real similarity values to work with instead of synthetic rank-based scores.

### 5.3 Add a Document Index for O(1) Lookup

**Problem:** `corpus.documents.find(d => String(d.id) === docId)` is called repeatedly during ground-truth assignment and generation. This is O(N) per call.

**Fix:** Create a `Map<string, Document>` index on the `Corpus` type or build it once at the start of each strategy:

```typescript
const docIndex = new Map(corpus.documents.map(d => [String(d.id), d]));
```

### 5.4 Cache `mergeOverlappingSpans` Results in Metric Computation

**Problem:** When computing F1 on a single result, `mergeOverlappingSpans` is called 6+ times on the same input arrays — twice for recall, twice for precision, and those are called by F1. Each call re-sorts and re-merges.

**Fix:** Compute merged spans once per result in `computeMetrics`, then pass them to all metrics. Or add a memo wrapper for `mergeOverlappingSpans` keyed on input identity.

### 5.5 Add `InMemoryVectorStore` Deduplication Guard

**File:** `src/vector-stores/in-memory.ts`

If `init()` is called twice (e.g., re-indexing), embeddings accumulate without clearing. The second call doubles the stored data.

**Fix:** Call `this._chunks = []; this._embeddings = [];` at the start of `add()` or make `init()` call `clear()` first.

### 5.6 Add Retry Logic to LLM Calls in Strategies

**Problem:** The `LLMClient` interface has no retry semantics, and none of the strategy implementations wrap calls in retry logic. A transient 429 or 500 from the LLM provider during a long generation run throws an unhandled error and loses all progress.

**Fix:** Add a `withRetry()` wrapper utility in `src/utils/`:

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; backoffMs?: number },
): Promise<T> { ... }
```

Apply to each LLM call in the strategies. Alternatively, bake retry into `openAIClientAdapter`.

---

## 6. Test Coverage

### 6.1 Modules With Zero Test Coverage

| Source File | What It Does | Priority |
|---|---|---|
| `src/retrievers/callback-retriever.ts` | Core Convex integration adapter | **Critical** — this is how the backend plugs into eval-lib |
| `src/langsmith/raw-api.ts` | `createLangSmithExperiment`, `logLangSmithResult` | ~~**High**~~ Moot if 1.10 done (dead code, deleted) |
| `src/embedders/openai.ts` | `OpenAIEmbedder` class | **High** — all tests use `mockEmbedder` |
| `src/rerankers/cohere.ts` | `CohereReranker` class | **High** — no `tests/unit/rerankers/` directory exists |
| `src/vector-stores/chroma.ts` | `ChromaVectorStore` class | ~~**Medium**~~ Moot if 2.4 done (deleted) |
| `src/langsmith/get-client.ts` | `getLangSmithClient()` error path | ~~**Medium**~~ Moot if 1.10 done (moves to backend) |
| `src/synthetic-datagen/base.ts` | `openAIClientAdapter`, `callLLM` | **Medium** |
| `src/retrievers/pipeline/config.ts` | `computeRetrieverConfigHash` (only `computeIndexConfigHash` is tested) | **Medium** |
| `src/synthetic-datagen/strategies/real-world-grounded/generation.ts` | `distributeBudget()` — non-trivial allocation with rounding | **Medium** |

**Suggested test implementations:**

For `CallbackRetriever`: test init/retrieve/cleanup delegation, optional callbacks, and error propagation.

For `OpenAIEmbedder` and `CohereReranker`: mock the SDK clients (not the entire package), test dimension lookup for known/unknown models, test the empty-input short-circuits, test the `create()` factory error path when the package is missing.

For `raw-api.ts`: Moot if 1.10 is done (dead code, deleted). Otherwise: mock `getLangSmithClient()`, test `createLangSmithExperiment` creates project and builds correct URL, test `logLangSmithResult` fires correct feedback calls per metric.

### 6.2 Specific Untested Edge Cases in Existing Tests

**RecursiveCharacterChunker** (`tests/unit/chunkers/chunkers.test.ts`):
- Empty document: `createDocument({ id: "x", content: "" })`
- Document content exactly `chunkSize` characters (boundary case)
- Overlap verification: assert adjacent chunks share expected overlap characters
- Unicode/multibyte content: emoji or CJK characters (JS uses UTF-16 code units)

**`computeMetrics`** (`tests/unit/evaluation/evaluator.test.ts`):
- Single result (verify averaging of one equals that result's score)
- Include `f1` in metrics array (currently only tests recall, precision, iou)
- Result where `retrieved` is empty (zero-division handling through orchestrator)

**F1 metric** (`tests/unit/metrics/span-metrics.test.ts`):
- No dedicated `describe("f1")` block exists
- The `recall + precision === 0` guard (returns 0.0) is never exercised

**GroundTruthAssigner** (`tests/unit/synthetic-datagen/ground-truth/assigners.test.ts`):
- `normalizedFind` fallback: test with excerpt that has different whitespace than document
- Multiple excerpts per query
- Query whose `targetDocId` doesn't match any corpus document (the `if (!doc) continue` branch)
- Multiple queries in one `assign()` call

**`stratifiedSample`** (`tests/unit/synthetic-datagen/strategies/relevance-sampling.test.ts`):
- Phase 2 (combo coverage): assignments where Phase 1 covers all docs but leaves combos uncovered
- Phase 3 (proportional fill): verify balanced distribution when budget allows more than one per doc
- Total count invariant: `result.length === min(budget, assignments.length)` regardless of randomness

**`InMemoryVectorStore`** (`tests/unit/vector-stores/in-memory.test.ts`):
- Multiple `add()` calls (verify accumulation not replacement)
- `k > stored chunks` (should return all, not error)
- Dimension mismatch between stored and query embeddings

**`BM25SearchIndex`** (`tests/unit/retrievers/pipeline/search/bm25.test.ts`):
- `build([])` followed by `search()` — should return empty
- Two chunks with identical content (verify `_chunkMap` keying by ID not content)

**Span utilities** (`tests/unit/utils/span.test.ts`):
- `spanOverlaps` with one span fully contained inside another
- `calculateOverlap` and `totalSpanLength` — these functions have zero direct tests despite being called by all four metrics

---

## 7. Test Quality

### 7.1 Hardcoded Temp Paths Break Portability

**Files:**
- `tests/unit/synthetic-datagen/strategies/dimension-driven-integration.test.ts:8`
- `tests/unit/synthetic-datagen/strategies/dimensions.test.ts:8`

```typescript
const tmpDir = "/private/tmp/claude-501/dd-integration-test";
```

This path embeds a specific username (`claude-501`), making the tests fail on any other machine or CI.

**Fix:** Use `import { tmpdir } from "node:os"` and `mkdtemp`:

```typescript
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dd-integration-"));
```

### 7.2 Conditional Assertions That Can Pass Vacuously

**File:** `tests/unit/retrievers/pipeline/pipeline-retriever.test.ts:309-313`

```typescript
if (results.length > 1 && plainResults.length > 1) {
  const rerankedFirst = results[0];
  const plainLast = plainResults[plainResults.length - 1];
  expect(rerankedFirst.id).toBe(plainLast.id);
}
```

If both retrievers return ≤1 result, the assertion is silently skipped. The `mockEmbedder` is deterministic so this should always trigger, but the conditional guard makes the intent opaque.

**Fix:** Assert the precondition unconditionally:

```typescript
expect(results.length).toBeGreaterThan(1);
expect(plainResults.length).toBeGreaterThan(1);
expect(results[0].id).toBe(plainResults[plainResults.length - 1].id);
```

### 7.3 Non-Null Assertions Without Guard

**File:** `tests/unit/experiments/runner.test.ts:187-212`

```typescript
let capturedTarget: Function;
// ... later:
const result = await capturedTarget!({ query: "test query" });
```

The `!` assertion silences TypeScript without verifying the value was set.

**Fix:** Add `expect(capturedTarget).toBeDefined();` before the `!` usage.

### 7.4 Progress Event Ordering Not Verified

**File:** `tests/unit/synthetic-datagen/strategies/real-world-grounded-integration.test.ts:111-114`

```typescript
expect(phases).toContain("embedding-questions");
expect(phases).toContain("embedding-passages");
expect(phases).toContain("matching");
expect(phases).toContain("done");
```

Checks presence but not order. If the strategy emits `"done"` before `"matching"`, the test still passes.

**Fix:** `expect(phases).toEqual(["embedding-questions", "embedding-passages", "matching", "done"]);`

### 7.5 Branded Type Tests Provide No Runtime Value

**File:** `tests/unit/types/core-types.test.ts:14-31`

```typescript
it("should create DocumentId from string", () => {
  const id = DocumentId("test.md");
  expect(String(id)).toBe("test.md");
});
```

Branded types are purely compile-time. At runtime, `DocumentId("test.md")` is just `"test.md"`. These tests verify JavaScript identity, not type safety.

**Fix:** Replace with tests that verify branded types work correctly in the functions that consume them (e.g., `createDocument`, `createCharacterSpan`).

### 7.6 Fragile Mock Client in LangSmith Tests

**File:** `tests/unit/langsmith/langsmith.test.ts:15-44`

The mock's `createExamples` reverse-lookups dataset names from `dataset_${k}`. If the internal ID format ever changes, the mock silently stops storing examples, and assertions fail with misleading messages.

**Fix:** Simplify the mock to store by dataset ID directly instead of reverse-engineering the name.

---

## 8. Priority Summary

### Immediate (low effort, high impact)

| # | Change | Effort | Impact |
|---|---|---|---|
| 2.1 | Fix identical ternary branches | 1 min | Bug fix |
| 1.1 | Delete 3 stale duplicate files | 5 min | Removes confusion |
| 1.4 | Extract `ScoredChunk` to shared types file | 10 min | Removes triple definition |
| 1.6 | Move `cosineSimilarity` to utils | 10 min | Removes duplication |
| 1.7 | Delete dead `SyntheticDatasetGenerator` class | 5 min | Removes dead code |
| 2.3 | Delete dead `corpusFromFolder` + `matchesGlob` | 5 min | Removes dead code + Node.js coupling |
| 2.4 | Delete dead `ChromaVectorStore` + `chromadb` peer dep | 5 min | Removes dead code + build entry + optional dep |
| 3.4 | Fix `loadDataset` query IDs | 5 min | Fixes ID stability |
| 7.1 | Fix hardcoded temp paths in tests | 10 min | Fixes CI portability |

### Short-term (moderate effort, high impact)

| # | Change | Effort | Impact |
|---|---|---|---|
| 1.2 | Collapse preset subdirectories to one file | 1-2 hr | Eliminates boilerplate, unblocks preset expansion |
| 3.3 | Add `safeParseLLMResponse` utility | 30 min | Prevents generation crashes |
| 3.7 | Strengthen chunk ID hashing | 30 min | Fixes collision risk |
| 3.8 | Add concurrency limits to LLM fan-outs | 1 hr | Prevents rate limit failures |
| 6.1 | Write tests for `CallbackRetriever` | 1 hr | Tests core integration point |
| 6.1 | Write tests for `raw-api.ts` | 1 hr | Moot if 1.10 done (dead code) |

### Medium-term (significant effort, structural improvement)

| # | Change | Effort | Impact |
|---|---|---|---|
| 1.10 | Move all LangSmith code to backend | 3-4 hr | eval-lib becomes pure library; removes langsmith peer dep |
| 5.1 | Extract search/refinement strategy objects | 4-6 hr | Makes pipeline extensible without modification |
| 1.3 | Flatten `baseline-vector-rag/` | 30 min | Cleaner structure |
| 1.5 | Move span geometry to `utils/` | 1 hr | Better module boundaries |
| 1.8 | Fix test directory alignment | 30 min | Tests mirror source |
| 3.1 | Replace `any` with structural interfaces | 2-3 hr | Real type safety for SDK clients |
| 5.2 | Make `VectorStore.search()` return scores | 2 hr | Better information flow |
| 6.2 | Add missing edge case tests | 4-6 hr | Comprehensive coverage |

### Long-term (larger effort, future-proofing)

| # | Change | Effort | Impact |
|---|---|---|---|
| 1.9 | Full structure reorganization | 1 day | Clean, navigable codebase |
| 4.1 | Slim root barrel, add sub-path imports | 2-3 hr | Cleaner public API |
| 5.6 | Add retry logic to LLM calls | 2 hr | Resilient generation |
| 4.5 | Add JSDoc to all public interfaces | 2-3 hr | Self-documenting library |

---

## 9. Blast Radius: Impact on Backend, Frontend & Other Packages

> Cross-package impact assessment for each suggestion. Based on a comprehensive search of every import/usage across `packages/backend/`, `packages/frontend/`, and `packages/eval-lib/` tests.

### Key Finding: Frontend Has Zero Direct Imports From eval-lib

The frontend never imports from `rag-evaluation-system`. All data flows through Convex reactive queries. **No refactoring suggestion in this document requires any frontend code change.**

---

### 9.1 Folder Structure Changes (1.1–1.9)

#### 1.1 Delete 3 stale experiment files — ZERO impact

The stale copies (`experiments/retriever.interface.ts`, `experiments/callback-retriever.ts`, `experiments/baseline-vector-rag/retriever.ts`) form an orphaned import subgraph. Nothing in backend, frontend, or tests imports them. `experiments/index.ts` already re-exports from `retrievers/`. Safe to delete.

#### 1.2 Collapse preset subdirectories — LOW impact

**Backend:** Does not import any preset factory (`createBaselineVectorRagRetriever`, `createBM25Retriever`, etc.). Backend uses `CallbackRetriever` and `PipelineRetriever` directly.

**Tests affected:** 1 file — `tests/unit/experiments/presets.test.ts` (lines 3-11) imports from subdirectory paths. Must update to new single-file import.

#### 1.3 Flatten baseline-vector-rag/ — LOW impact

**Backend:** Does not import `VectorRAGRetriever`. Uses `CallbackRetriever` (`experimentActions.ts:8`).

**Tests affected:** 2 files need import path updates:
- `tests/integration/evaluation.test.ts:3`
- `tests/unit/experiments/vector-rag-retriever.test.ts:2`

#### 1.4 Extract ScoredChunk — ZERO external impact

Not imported by backend or frontend. Only used internally in pipeline search/refinement files and 2 test files.

#### 1.5 Move span geometry to utils/ — LOW impact

`mergeOverlappingSpans`, `calculateOverlap`, `totalSpanLength` are exported in the public barrel but **not imported by backend or frontend**. Internal impact: 3 metrics files + 1 test file need import path updates.

#### 1.6 Move cosineSimilarity — ZERO external impact

Not part of the public barrel. Only used internally in `in-memory.ts` (private) and `matching.ts` (exported but not consumed externally). 1 test file needs import path update.

#### 1.7 Delete SyntheticDatasetGenerator — ZERO impact

Never extended. Not in the public barrel. `base.ts` also exports `LLMClient` and `openAIClientAdapter` which are actively used by the backend (`convex/lib/llm.ts:4`), but those stay.

#### 1.8 Fix test directory alignment — ZERO external impact

Test-only reorganization. No code changes.

#### 1.9 Full structure reorganization — MEDIUM impact

Cumulative impact of all above. If public barrel re-exports stay stable, backend imports from `rag-evaluation-system` are unaffected. Risk: if any re-export paths change, backend's 7 import files need updates.

#### 1.10 Move all LangSmith code to backend — HIGH impact (cross-package migration)

This is a cross-package migration, not a simple deletion. The blast radius is contained but touches both packages:

**eval-lib side (removals):**
- Delete entire `src/langsmith/` directory (8 files)
- Remove LangSmith exports from `src/index.ts` (lines 147-170: `getLangSmithClient`, `uploadDataset`, `loadDataset`, `createLangSmithEvaluator`, `createLangSmithEvaluators`, `listDatasets`, `listExperiments`, `getCompareUrl`, + types)
- Remove `uploadToLangsmith`/`datasetName` options from `GenerateOptions` in `synthetic-datagen/index.ts`
- Remove sub-path exports, build entries, peer deps from `package.json` and `tsup.config.ts`
- Delete eval-lib test files: `tests/unit/langsmith/langsmith.test.ts`, `tests/unit/langsmith/evaluator-adapters.test.ts`, `tests/unit/experiments/runner.test.ts` (tests `runLangSmithExperiment`)

**Backend side (additions):**
- `langsmithSync.ts`: inline `uploadDataset` implementation (currently imports it — replace import with local code)
- `experimentActions.ts` (or new file): inline `runLangSmithExperiment`, `createLangSmithEvaluators`, `deserializeSpans`
- New shared helper: `getLangSmithClient()` (tiny function, ~10 lines)
- All moved code imports eval-lib types (`Metric`, `Retriever`, `CharacterSpan`, `DocumentId`, `Corpus`, `positionAwareChunkToSpan`) from `rag-evaluation-system` — these are already in the barrel and already imported by the backend
- Remove `experimentActions.ts` subpath import: `from "rag-evaluation-system/langsmith/experiment-runner"` (line 18) — replace with local import

**Frontend:** Zero impact.

**Existing backend LangSmith tests:** `langsmithSync.ts`, `langsmithRetry.ts`, `langsmithSyncRetry.ts` are unaffected — they don't import from eval-lib's langsmith module (except `uploadDataset` which gets inlined).

**Sequencing:** This should be done atomically — move code to backend and delete from eval-lib in the same change. If done in two steps, there's a window where backend imports break.

---

### 9.2 Code Quality & Type Safety (3.1–3.8)

#### 3.1 Replace `any` with structural interfaces — ZERO breaking impact

Backend passes real SDK clients (`new OpenAI()`) in 5 files:
- `experimentActions.ts:27`, `indexingActions.ts:25`, `generationActions.ts:150`, `ragActions.ts:18`, `retrieverActions.ts:22`

A structural interface describing OpenAI's `.embeddings.create()` surface won't break these — the real SDK already satisfies the interface. `CohereReranker` and `ChromaVectorStore` are not used by backend.

#### 3.2 Replace `any` with typed LangSmith client — Moot if 1.10 done

If 1.10 is done, `getLangSmithClient()` moves to the backend. Apply the typing fix there instead. Otherwise: `getLangSmithClient()` is internal to eval-lib. Backend calls higher-level wrappers which use the client internally. Typing it won't change any external API.

#### 3.3 Add safeParseLLMResponse — ZERO external impact

8 bare `JSON.parse` calls across 6 eval-lib files. Backend does not do its own LLM JSON parsing — it delegates to strategies. Adding a shared utility and updating 8 call sites is entirely within eval-lib.

#### 3.4 Fix loadDataset query IDs — Moot if 1.10 done

If 1.10 is done, `loadDataset` is deleted (test-only code). Otherwise: not used by the backend, only affects eval-lib tests.

#### 3.5 Fix LangSmith URL inconsistency — Moot if 1.10 done

If 1.10 is done, `raw-api.ts` is deleted (dead code). Apply URL consistency fix during the migration if preserving `uploadDataset` URL logic. Otherwise: `raw-api.ts:35` uses `process.env.LANGSMITH_ENDPOINT` instead of `client.getHostUrl()` and omits the org tenant ID from experiment URLs.

#### 3.6 Fix normalizedFind off-by-one — ZERO external impact

Internal to `token-level.ts`. Backend calls `GroundTruthAssigner` which uses this. Fix improves correctness for mixed-whitespace documents. No API changes.

#### 3.7 Strengthen chunk ID hashing — HIGH impact (data migration)

**This is the highest-risk change.** `generatePaChunkId` is called by `RecursiveCharacterChunker` which is used in 4 backend action files. Changing the hash algorithm means:

- **All existing `documentChunks` in Convex become orphaned** — new chunk IDs won't match stored `chunkId` values (`schema.ts:203`)
- **Requires re-indexing** all knowledge bases
- **Backend stores chunk IDs in:** `documentChunks.chunkId` (via `indexingActions.ts:95`, `ragActions.ts:64`)
- **Backend reads chunk IDs in:** `experimentActions.ts:279` (`PositionAwareChunkId(c.chunkId)`)

**Mitigation:** Adding `docId`/`start` parameters without changing the no-arg signature keeps old behavior for existing callers. New callers can pass the additional params. Alternatively, accept re-indexing as a one-time migration.

#### 3.8 Add concurrency limits — PRODUCTION RISK if skipped

Backend calls `DimensionDrivenStrategy` from `generationActions.ts`. With 15+ dimensions or 30+ documents, unbounded `Promise.all` in `filtering.ts:45` and `relevance.ts:45` can fire 100+ concurrent LLM calls, hitting OpenAI rate limits (429 errors). Fix is internal to eval-lib. Backend benefits automatically.

---

### 9.3 Readability (4.1–4.5)

#### 4.1 Slim root barrel — HIGH risk without care

**Backend imports 23 items from `rag-evaluation-system`** across 7 files:

| Backend File | Imports |
|---|---|
| `experimentActions.ts` | `CallbackRetriever`, `computeIndexConfigHash`, `createCorpusFromDocuments`, `createDocument`, `DocumentId`, `PositionAwareChunkId`, `OpenAIEmbedder`, types |
| `generationActions.ts` | `SimpleStrategy`, `DimensionDrivenStrategy`, `RealWorldGroundedStrategy`, `GroundTruthAssigner`, `OpenAIEmbedder`, `createCorpusFromDocuments`, `parseDimensions` |
| `retrieverActions.ts` | `computeIndexConfigHash`, `computeRetrieverConfigHash`, `OpenAIEmbedder`, `PipelineConfig` type |
| `indexingActions.ts` | `RecursiveCharacterChunker`, `OpenAIEmbedder`, `createDocument` |
| `ragActions.ts` | `RecursiveCharacterChunker`, `OpenAIEmbedder`, `createDocument` |
| `langsmithSync.ts` | `QueryId`, `QueryText`, `DocumentId`, types (after 1.10: `uploadDataset` moves to backend) |
| `lib/llm.ts` | `openAIClientAdapter`, `LLMClient` type |

Items safe to remove from barrel (unused by backend): `InMemoryVectorStore`, `VectorRAGRetriever`, `mergeOverlappingSpans`, `calculateOverlap`, `totalSpanLength`, `discoverDimensions`, `loadDimensions`, `loadDimensionsFromFile`, preset factory functions, `DEFAULT_*_CONFIG` constants, all 4 `*PresetDeps` types. After 1.10: all LangSmith exports (`getLangSmithClient`, `uploadDataset`, `loadDataset`, `createLangSmithEvaluator/s`, `listDatasets`, `listExperiments`, `getCompareUrl`, + associated types).

Items that **must stay** in the barrel: everything listed in the table above.

**Recommendation:** If slimming the barrel, move removed items to sub-path exports (e.g., `rag-evaluation-system/pipeline/internals`). Do not delete them — they may be used by external consumers.

#### 4.2 Document silent truncation — PRODUCTION DATA QUALITY

6 truncation points with inconsistent limits (3000–8000 chars) across 5 files. Backend calls all strategies, so documents longer than these limits produce silently incomplete ground truth. No API change needed — this is about adding config options and progress events. Backend benefits automatically once eval-lib is updated.

#### 4.3–4.5 Renaming, surfacing hyperparameters, JSDoc — ZERO external impact

Internal readability improvements. No API changes.

---

### 9.4 Scalability & Extensibility (5.1–5.6)

#### 5.1 Extract search strategy objects — ZERO external impact

Internal refactor of `PipelineRetriever`. Backend constructs `PipelineRetriever(config, deps)` and calls `init()`/`retrieve()`/`cleanup()`. The public interface stays identical. Switch statements become strategy delegation internally.

#### 5.2 Make VectorStore.search() return scores — HIGH internal impact, ZERO backend impact

**Backend does not use the `VectorStore` interface.** It uses `ctx.vectorSearch()` directly. Within eval-lib:
- 2 implementations must change (`InMemoryVectorStore`, `ChromaVectorStore`)
- 2 callers must change (`PipelineRetriever._searchDense`, `VectorRAGRetriever`)
- Tests for both need updating

This is a breaking interface change for any external code implementing `VectorStore`, but backend is unaffected.

#### 5.3 Add document index — ZERO external impact

Build `Map<string, Document>` locally in each strategy. 3–4 call sites across 3 files. Backend benefits from faster ground-truth assignment automatically.

#### 5.4 Cache mergeOverlappingSpans — ZERO external impact

Performance optimization internal to `computeMetrics`.

#### 5.5 InMemoryVectorStore dedup guard — LOW risk

Backend creates fresh `InMemoryVectorStore` instances per retriever. Current usage is safe. The guard prevents future bugs. 1 line change.

#### 5.6 Add retry logic — ZERO external impact

Internal to eval-lib LLM calls. Backend benefits automatically from more resilient generation.

---

### 9.5 Test Changes (6.1–7.6) — ZERO external impact

All test suggestions are confined to `packages/eval-lib/tests/`. No backend or frontend changes.

---

### 9.6 Decision Summary

| Suggestion | Backend Impact | Frontend Impact | Data Migration | Verdict |
|---|---|---|---|---|
| **1.1** Delete stale files | None | None | No | Go ahead |
| **1.2** Collapse presets | None | None | No | Go ahead |
| **1.3** Flatten baseline-vector-rag | None | None | No | Go ahead |
| **1.4** Extract ScoredChunk | None | None | No | Go ahead |
| **1.5** Move span geometry | None | None | No | Go ahead |
| **1.6** Move cosineSimilarity | None | None | No | Go ahead |
| **1.7** Delete dead class | None | None | No | Go ahead |
| **1.8** Fix test dirs | None | None | No | Go ahead |
| **1.9** Full restructure | Low (if barrel stable) | None | No | Go ahead with care |
| **1.10** Move LangSmith to backend | **Backend gains code** | None | No | Go ahead — do atomically |
| **2.1** Fix ternary | None | None | No | Go ahead |
| **2.2** Deprecate VectorRAGRetriever | None | None | No | Go ahead |
| **2.3** Delete dead `corpusFromFolder` | None | None | No | Go ahead |
| **2.4** Delete dead `ChromaVectorStore` | None | None | No | Go ahead |
| **3.1** Type SDK clients | None | None | No | Go ahead |
| **3.2** Type LangSmith client | None | None | No | Moot if 1.10 done; apply in backend instead |
| **3.3** safeParseLLMResponse | None | None | No | Go ahead |
| **3.4** Fix loadDataset IDs | None | None | No | Moot if 1.10 done (deleted) |
| **3.5** Fix LangSmith URLs | Positive (fixes bug) | None | No | Moot if 1.10 done; apply during migration |
| **3.6** Fix normalizedFind | None | None | No | Go ahead |
| **3.7** Strengthen chunk hashing | **Requires re-indexing** | None | **Yes** | Proceed with migration plan |
| **3.8** Concurrency limits | Positive (prevents 429s) | None | No | Go ahead (high priority) |
| **4.1** Slim barrel | **Must preserve 23 items** | None | No | Go ahead with care |
| **4.2** Document truncation | Positive (better quality) | None | No | Go ahead |
| **4.3–4.5** Readability | None | None | No | Go ahead |
| **5.1** Strategy objects | None | None | No | Go ahead |
| **5.2** VectorStore scores | None | None | No | Go ahead |
| **5.3** Document index | None | None | No | Go ahead |
| **5.4** Cache merged spans | None | None | No | Go ahead |
| **5.5** VectorStore dedup | None | None | No | Go ahead |
| **5.6** Retry logic | None | None | No | Go ahead |
| **6.x, 7.x** Test changes | None | None | No | Go ahead |

### 9.7 Items Requiring Extra Caution

1. **3.7 (Chunk ID hashing):** Only suggestion requiring a data migration. All `documentChunks` in Convex must be re-indexed after the change. Plan: make the new params optional with backward-compatible defaults, then re-index KBs incrementally.

2. **4.1 (Slim barrel):** Must not remove the 23 items the backend imports. Safe removals: `InMemoryVectorStore`, `VectorRAGRetriever`, span geometry utils, dimension discovery utils, preset factories/deps types, `DEFAULT_*_CONFIG` constants. Move to sub-path exports rather than deleting.

3. **3.8 (Concurrency limits):** Not dangerous to implement, but high priority — current unbounded fan-outs are a production risk for the backend when running dimension-driven generation with large corpora.

4. **1.10 (LangSmith migration):** Must be done atomically — move code to backend and delete from eval-lib in the same change. The backend's `experimentActions.ts:18` currently imports `runLangSmithExperiment` via a subpath (`rag-evaluation-system/langsmith/experiment-runner`); this import must be replaced with a local import in the same commit. Several other refactor suggestions become moot after this migration: 3.2 (type LangSmith client), 3.4 (fix loadDataset IDs), 3.5 (fix LangSmith URLs) — these fixes should be applied during the migration rather than as separate changes.
