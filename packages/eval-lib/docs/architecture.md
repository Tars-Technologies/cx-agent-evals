# eval-lib Architecture Guide

> **Package:** `rag-evaluation-system` (v0.1.0)
> **Location:** `packages/eval-lib/`

This document is a comprehensive guide to the eval-lib codebase — the core TypeScript library powering the RAG Evaluation System. It covers every module, interface, algorithm, and data flow so you can navigate the source files with full context.

---

## Table of Contents

1. [Package Overview](#1-package-overview)
2. [Type System](#2-type-system)
3. [Chunkers](#3-chunkers)
4. [Embedders](#4-embedders)
5. [Vector Stores](#5-vector-stores)
6. [Rerankers](#6-rerankers)
7. [Retrievers & The Pipeline](#7-retrievers--the-pipeline)
8. [Evaluation Metrics](#8-evaluation-metrics)
9. [Synthetic Data Generation](#9-synthetic-data-generation)
10. [Experiment Presets](#10-experiment-presets)
11. [Utilities](#11-utilities)
12. [Build & Exports](#12-build--exports)

---

## 1. Package Overview

eval-lib is a self-contained TypeScript library for evaluating RAG retrieval pipelines. It provides:

- **Span-based evaluation** — metrics computed on exact character positions, not fuzzy text matching
- **Pluggable components** — interfaces for chunkers, embedders, vector stores, rerankers, and retrievers
- **Pipeline retriever** — a composable 4-stage retrieval architecture (INDEX → QUERY → SEARCH → REFINEMENT) with a strategy-object pattern for extensibility
- **Synthetic data generation** — three strategies for generating evaluation questions with character-level ground truth
- **Resilient LLM integration** — retry logic, concurrency limits, and safe JSON parsing for LLM calls

> **Note:** LangSmith integration code previously lived in eval-lib under `src/langsmith/`. It has been migrated to the Convex backend (`packages/backend/convex/`). eval-lib is now a pure evaluation library with zero LangSmith dependency.

### Directory Structure

```
src/
├── types/                      # Branded types, domain interfaces, Zod schemas
├── chunkers/                   # Text chunking with position tracking
├── embedders/                  # Text → vector embedding
├── vector-stores/              # Vector similarity search backends
├── rerankers/                  # Result reranking via external models
├── retrievers/                 # Retriever interface + pipeline implementation
│   ├── retriever.interface.ts  # Core Retriever interface
│   ├── callback-retriever.ts   # Adapter for user-provided callbacks
│   ├── vector-rag-retriever.ts # Legacy standalone retriever (@deprecated)
│   └── pipeline/               # 4-stage pipeline retriever
│       ├── types.ts            # Shared ScoredChunk type
│       ├── config.ts           # Config types + hashing
│       ├── pipeline-retriever.ts
│       ├── search/             # Search strategy implementations
│       │   ├── strategy.interface.ts
│       │   ├── dense.ts        # DenseSearchStrategy
│       │   ├── bm25.ts         # BM25SearchStrategy + BM25SearchIndex
│       │   ├── hybrid.ts       # HybridSearchStrategy
│       │   └── fusion.ts       # Weighted + RRF fusion algorithms
│       └── refinement/         # Threshold filtering
│           └── threshold.ts
├── evaluation/                 # Span-based metrics (recall, precision, IoU, F1)
│   ├── evaluator.ts            # computeMetrics with pre-merged span optimization
│   └── metrics/                # Individual metric implementations
├── synthetic-datagen/          # Question generation + ground truth assignment
│   ├── base.ts                 # LLMClient interface + openAIClientAdapter (with retry)
│   ├── strategies/             # Simple, Dimension-Driven, Real-World-Grounded
│   └── ground-truth/           # Character span extraction
├── experiments/                # Preset retriever configurations
│   └── presets.ts              # All configs + generic factory + named wrappers
├── pipeline/                   # Secondary entry point for internal exports
│   └── internals.ts            # Config defaults, BM25, fusion, InMemoryVectorStore
├── utils/                      # Hashing, span ops, similarity, JSON, concurrency, retry
│   ├── hashing.ts              # SHA-256 chunk ID generation
│   ├── span.ts                 # All span geometry (overlap, merge, length)
│   ├── similarity.ts           # Cosine similarity
│   ├── json.ts                 # safeParseLLMResponse
│   ├── concurrency.ts          # mapWithConcurrency
│   └── retry.ts                # withRetry (exponential backoff)
└── index.ts                    # Root barrel export (public API surface)
```

### Key Design Principles

1. **Everything is character-level.** Ground truth is `CharacterSpan[]` (docId + start + end + text). Metrics measure character overlap. Chunks track character offsets.
2. **Interfaces over implementations.** `Chunker`, `Embedder`, `VectorStore`, `Reranker`, `Retriever` — all abstract interfaces. Swap any component.
3. **Branded types for safety.** `DocumentId`, `QueryId`, `PositionAwareChunkId` are branded strings — you can't accidentally pass a query ID where a document ID is expected.
4. **Config-driven pipelines.** The `PipelineRetriever` reads a declarative `PipelineConfig` object to assemble its behavior. No subclassing required.
5. **Strategy objects for extensibility.** Search strategies (`DenseSearchStrategy`, `BM25SearchStrategy`, `HybridSearchStrategy`) implement a `SearchStrategy` interface. Adding a new search approach means adding a new class, not modifying the pipeline retriever.
6. **Pure library, no external system coupling.** eval-lib has no dependency on LangSmith, Convex, or any external service. All integration code lives in the backend.

---

## 2. Type System

> `src/types/`

### 2.1 Branded Types (`brand.ts`, `primitives.ts`)

```typescript
// brand.ts — the branding mechanism
type Brand<K extends string, T> = T & { readonly [__brand]: K };

// primitives.ts — four branded ID/value types
type DocumentId   = Brand<"DocumentId", string>;
type QueryId      = Brand<"QueryId", string>;
type QueryText    = Brand<"QueryText", string>;
type PositionAwareChunkId = Brand<"PositionAwareChunkId", string>;
```

Each type doubles as a factory function: `DocumentId("doc-1")` returns a branded string. This gives compile-time nominal typing with zero runtime overhead.

### 2.2 Documents & Corpus (`documents.ts`)

```typescript
interface Document {
  readonly id: DocumentId;
  readonly content: string;         // Full text of the document
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface Corpus {
  readonly documents: readonly Document[];
  readonly metadata: Readonly<Record<string, unknown>>;
}
```

**Factories:** `createDocument()`, `createCorpus()`, `createCorpusFromDocuments()`

**Zod schemas:** `DocumentSchema`, `CorpusSchema` for runtime validation.

> **Note:** `corpusFromFolder()` and `matchesGlob()` (which used `node:fs/promises`) have been removed. Use `createCorpusFromDocuments()` for environment-agnostic corpus construction.

### 2.3 Chunks & Spans (`chunks.ts`)

```typescript
// A chunk with exact character position in its source document
interface PositionAwareChunk {
  readonly id: PositionAwareChunkId;
  readonly content: string;
  readonly docId: DocumentId;
  readonly start: number;           // 0-based inclusive
  readonly end: number;             // exclusive
  readonly metadata: Readonly<Record<string, unknown>>;
}

// A character range used as ground truth or metric input
interface CharacterSpan {
  readonly docId: DocumentId;
  readonly start: number;
  readonly end: number;
  readonly text: string;            // Invariant: text.length === end - start
}

// Lightweight range (no text) used in metric calculations
interface SpanRange {
  readonly docId: DocumentId;
  readonly start: number;
  readonly end: number;
}
```

`CharacterSpanSchema` (Zod) enforces: `end > start` and `text.length === end - start`.

Conversion: `positionAwareChunkToSpan(chunk)` converts a chunk to a span.

### 2.4 Queries & Ground Truth (`queries.ts`, `ground-truth.ts`)

```typescript
interface Query {
  readonly id: QueryId;
  readonly text: QueryText;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface GroundTruth {
  readonly query: Query;
  readonly relevantSpans: readonly CharacterSpan[];
}

// LangSmith-compatible format
interface DatasetExample {
  readonly inputs: { readonly query: string };
  readonly outputs: { readonly relevantSpans: ReadonlyArray<{...}> };
  readonly metadata: Readonly<Record<string, unknown>>;
}
```

### 2.5 Results (`results.ts`)

```typescript
interface EvaluationResult {
  readonly metrics: Readonly<Record<string, number>>;
  readonly experimentUrl?: string;
  readonly rawResults?: unknown;
}

interface RunOutput {
  readonly relevantSpans: readonly CharacterSpan[];
}
```

---

## 3. Chunkers

> `src/chunkers/`

### 3.1 Interfaces (`chunker.interface.ts`)

```typescript
interface Chunker {
  readonly name: string;
  chunk(text: string): string[];
}

interface PositionAwareChunker {
  readonly name: string;
  chunkWithPositions(doc: Document): PositionAwareChunk[];
}

function isPositionAwareChunker(chunker): chunker is PositionAwareChunker;
```

The key distinction: `Chunker` returns plain text chunks, `PositionAwareChunker` returns chunks with character offsets. The evaluation system requires position-aware chunks to compute span-based metrics.

### 3.2 RecursiveCharacterChunker (`recursive-character.ts`)

Implements both `Chunker` and `PositionAwareChunker`.

```typescript
class RecursiveCharacterChunker {
  constructor(options?: {
    chunkSize?: number;      // Default: 1000
    chunkOverlap?: number;   // Default: 200
    separators?: string[];   // Default: ["\n\n", "\n", ". ", " ", ""]
  })
}
```

**Algorithm — `_splitTextWithPositions(text, separators, baseOffset)`:**

1. **Base case:** If text fits in `chunkSize`, return it as a single chunk with its offset.
2. **Find separator:** Try separators in order (`\n\n` → `\n` → `. ` → ` ` → `""`). Use the first one found in the text.
3. **Split & merge:** Split text by the separator. Accumulate adjacent parts until they exceed `chunkSize`.
4. **Emit chunk:** When accumulated text overflows, emit it as a chunk. If the merged result is still too big, recurse with finer separators.
5. **Overlap:** After emitting, keep trailing parts totaling ≤ `chunkOverlap` characters. This creates overlap between consecutive chunks for context continuity.
6. **Character fallback:** If separator is `""`, slice text into fixed-width windows stepping by `chunkSize - chunkOverlap`.

**Position tracking:** The `baseOffset` parameter accumulates through recursion, ensuring all positions are absolute character offsets in the original document. Trim offsets are calculated via `text.indexOf(trimmed)`.

**Chunk IDs:** Generated via `generatePaChunkId(content, docId, start)` — a SHA-256 hash incorporating content, document ID, and position for collision-free deterministic IDs like `pa_chunk_a1b2c3d4ef123456`.

---

## 4. Embedders

> `src/embedders/`

### 4.1 Interface (`embedder.interface.ts`)

```typescript
interface Embedder {
  readonly name: string;
  readonly dimension: number;
  embed(texts: readonly string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}
```

`embed()` takes a batch of texts and returns a parallel array of vectors. `embedQuery()` is a convenience for single queries.

### 4.2 OpenAIEmbedder (`openai.ts`)

```typescript
class OpenAIEmbedder implements Embedder {
  constructor(options: { model?: string; client: OpenAIEmbeddingsClient });
  static async create(options?: { model?: string }): Promise<OpenAIEmbedder>;
}
```

**Supported models:**

| Model | Dimensions |
|-------|-----------:|
| `text-embedding-3-small` (default) | 1536 |
| `text-embedding-3-large` | 3072 |
| `text-embedding-ada-002` | 1536 |

The constructor takes a client matching the structural `OpenAIEmbeddingsClient` interface (no `any` — the client is duck-typed against the exact surface area used):

```typescript
interface OpenAIEmbeddingsClient {
  embeddings: {
    create(opts: { model: string; input: string[] }): Promise<{
      data: Array<{ embedding: number[] }>;
    }>;
  };
}
```

The static `create()` factory dynamically imports the `openai` package and creates a client automatically.

---

## 5. Vector Stores

> `src/vector-stores/`

### 5.1 Interface (`vector-store.interface.ts`)

```typescript
interface VectorSearchResult {
  readonly chunk: PositionAwareChunk;
  readonly score: number;
}

interface VectorStore {
  readonly name: string;
  add(chunks: readonly PositionAwareChunk[], embeddings: readonly number[][]): Promise<void>;
  search(queryEmbedding: readonly number[], k?: number): Promise<VectorSearchResult[]>;
  clear(): Promise<void>;
}
```

`add()` takes parallel arrays of chunks and their embeddings. `search()` returns the top-k most similar chunks **with their real similarity scores** (not synthetic rank scores). This enables downstream fusion and refinement stages to work with actual similarity values.

### 5.2 InMemoryVectorStore (`in-memory.ts`)

Stores chunks and embeddings in arrays. Search computes **cosine similarity** (via `utils/similarity.ts`) against all stored embeddings:

```
similarity(a, b) = (a · b) / (‖a‖ × ‖b‖)
```

Returns top-k `VectorSearchResult[]` by descending similarity. Suitable for evaluation workloads up to ~10K chunks.

**Deduplication guard:** If `add()` is called when chunks are already stored, it logs a warning and clears existing data before inserting the new batch. This prevents silent data accumulation from repeated `init()` calls.

> **Import note:** `InMemoryVectorStore` is not on the root barrel export. Import from `rag-evaluation-system/pipeline/internals` for direct access.

> **Note:** `ChromaVectorStore` (`chroma.ts`) has been removed as dead code. The Convex backend uses its native `ctx.vectorSearch()` and will never use Chroma. `InMemoryVectorStore` covers local/test use.

---

## 6. Rerankers

> `src/rerankers/`

### 6.1 Interface (`reranker.interface.ts`)

```typescript
interface Reranker {
  readonly name: string;
  rerank(query: string, chunks: readonly PositionAwareChunk[], topK?: number): Promise<PositionAwareChunk[]>;
}
```

Takes a query and chunks, returns chunks reordered by relevance (most relevant first).

### 6.2 CohereReranker (`cohere.ts`)

```typescript
class CohereReranker implements Reranker {
  static async create(options?: { model?: string }): Promise<CohereReranker>;
  // Default model: "rerank-english-v3.0"
}
```

Uses `cohere-ai` package (dynamically imported). Client typed via a structural `CohereRerankClient` interface (no `any`):

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

Maps the API response indices back to the original `PositionAwareChunk` objects, preserving all span metadata.

Import directly from `rag-evaluation-system/rerankers/cohere`.

---

## 7. Retrievers & The Pipeline

> `src/retrievers/`

This is the core of the system. Three retriever implementations serve different needs.

### 7.1 Retriever Interface (`retriever.interface.ts`)

```typescript
interface Retriever {
  readonly name: string;
  init(corpus: Corpus): Promise<void>;
  retrieve(query: string, k: number): Promise<PositionAwareChunk[]>;
  cleanup(): Promise<void>;
}
```

Every retriever follows this lifecycle: `init()` → `retrieve()` (many times) → `cleanup()`.

### 7.2 CallbackRetriever (`callback-retriever.ts`)

Adapter pattern — wraps user-provided functions into the `Retriever` interface:

```typescript
interface CallbackRetrieverConfig {
  readonly name: string;
  readonly retrieveFn: (query: string, k: number) => Promise<PositionAwareChunk[]>;
  readonly initFn?: (corpus: Corpus) => Promise<void>;
  readonly cleanupFn?: () => Promise<void>;
}
```

Used by the Convex backend to plug its own vector search into eval-lib without eval-lib knowing about Convex.

### 7.3 VectorRAGRetriever (`vector-rag-retriever.ts`) — @deprecated

A simpler, non-pipeline retriever. `init()` chunks + embeds + stores. `retrieve()` embeds query → vector search → optional rerank.

> **Deprecated.** Use `createBaselineVectorRagRetriever()` from the experiment presets instead. The pipeline retriever provides the same behavior with config hashing, BM25 support, and composable refinement.

### 7.4 PipelineRetriever — The 4-Stage Pipeline

> `src/retrievers/pipeline/`

This is the centerpiece of the library. A declarative, config-driven retriever with four composable stages, using a **strategy-object pattern** for the search stage.

```
┌─────────┐    ┌─────────┐    ┌──────────────┐    ┌────────────┐
│  INDEX   │ →  │  QUERY  │ →  │    SEARCH    │ →  │ REFINEMENT │ → results
└─────────┘    └─────────┘    │ (strategy)   │    └────────────┘
  (init)        (retrieve)     └──────────────┘       (retrieve)
                                 ↓ delegates to
                   ┌─────────────────────────────┐
                   │ DenseSearchStrategy          │
                   │ BM25SearchStrategy           │
                   │ HybridSearchStrategy         │
                   └─────────────────────────────┘
```

#### Dependencies (`pipeline-retriever.ts`)

```typescript
interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;    // Defaults to InMemoryVectorStore
  readonly reranker?: Reranker;          // Required if refinement includes "rerank"
  readonly embeddingBatchSize?: number;  // Default: 100 — chunks per API call during INDEX
}
```

#### Configuration (`config.ts`)

All configuration uses discriminated unions on `strategy` (or `type` for refinement):

```typescript
interface PipelineConfig {
  readonly name: string;
  readonly index?: IndexConfig;
  readonly query?: QueryConfig;
  readonly search?: SearchConfig;
  readonly refinement?: readonly RefinementStepConfig[];
}
```

#### Stage 1: INDEX

**Runs during `init(corpus)`.**

```typescript
interface IndexConfig {
  readonly strategy: "plain";
  readonly chunkSize?: number;        // Default: 1000
  readonly chunkOverlap?: number;     // Default: 200
  readonly separators?: readonly string[];
  readonly embeddingModel?: string;   // Default: "text-embedding-3-small"
}
```

**What happens:**

1. **Chunk** all documents with position tracking via `chunker.chunkWithPositions(doc)`
2. **Delegate to search strategy** via `searchStrategy.init(chunks, deps)` — the strategy handles index construction internally (embedding/storing for dense, BM25 index for sparse, both for hybrid)

#### Stage 2: QUERY

**Runs at the start of `retrieve(query, k)`.**

```typescript
interface IdentityQueryConfig {
  readonly strategy: "identity";    // Passes query through unchanged
}
```

Currently a passthrough. Extensible to HyDE, multi-query, step-back, and rewrite strategies.

#### Stage 3: SEARCH (Strategy-Object Pattern)

**Runs during `retrieve()` after query processing.**

The search stage uses a **strategy-object pattern**. Each strategy implements:

```typescript
interface SearchStrategy {
  readonly name: string;
  init(chunks: readonly PositionAwareChunk[], deps: SearchStrategyDeps): Promise<void>;
  search(query: string, k: number, deps: SearchStrategyDeps): Promise<ScoredChunk[]>;
  cleanup(deps: SearchStrategyDeps): Promise<void>;
}

interface SearchStrategyDeps {
  readonly embedder: Embedder;
  readonly vectorStore: VectorStore;
}
```

`PipelineRetriever` creates the appropriate strategy at construction time via `createSearchStrategy(config)` and delegates all search operations to it. Adding a new search approach means implementing a new `SearchStrategy` class — no modification to the pipeline retriever required.

Three strategies, selected by `SearchConfig.strategy`:

##### DenseSearchStrategy (`search/dense.ts`)

```typescript
interface DenseSearchConfig { readonly strategy: "dense"; }
```

1. **Init:** Embed chunks in batches (configurable `batchSize`, default 100) and store in vector store
2. **Search:** Embed query via `embedder.embedQuery(query)`, search vector store for top-k. Uses **real similarity scores** from the vector store directly
3. **Cleanup:** No-op (vector store owned by PipelineRetriever)

Also exports `assignRankScores(chunks)` — assigns linearly decaying scores: `score[i] = (count - i) / count`.

##### BM25SearchStrategy (`search/bm25.ts`)

```typescript
interface BM25SearchConfig {
  readonly strategy: "bm25";
  readonly k1?: number;    // Default: 1.2 — term frequency saturation
  readonly b?: number;     // Default: 0.75 — field length normalization
}
```

1. **Init:** Build BM25 index via `BM25SearchIndex.build(chunks)`
2. **Search:** Query the BM25 index via `searchWithScores()`. Scores are normalized: top result = 1.0, rest proportional
3. **Cleanup:** Release BM25 index and chunk map

**BM25SearchIndex** wraps MiniSearch with `fields: ["content"]`. Uses BM25+ scoring with configurable k1, b, and delta (0.5) parameters.

##### HybridSearchStrategy (`search/hybrid.ts`)

```typescript
interface HybridSearchConfig {
  readonly strategy: "hybrid";
  readonly denseWeight?: number;          // Default: 0.7
  readonly sparseWeight?: number;         // Default: 0.3
  readonly fusionMethod?: "weighted" | "rrf";
  readonly candidateMultiplier?: number;  // Default: 4
  readonly rrfK?: number;                 // Default: 60 (RRF smoothing constant)
  readonly k1?: number;                   // BM25 k1
  readonly b?: number;                    // BM25 b
}
```

Composes `DenseSearchStrategy` + `BM25SearchStrategy` internally:

1. **Init:** Initialize both sub-strategies
2. **Search:** Run dense and BM25 search **in parallel**, each fetching `k × candidateMultiplier` candidates, then fuse:

**Weighted Score Fusion** (`search/fusion.ts`):
```
fused_score = denseWeight × denseScore + sparseWeight × sparseScore
```
Chunks appearing in only one list get 0 for the missing score.

**Reciprocal Rank Fusion (RRF)** (`search/fusion.ts`):
```
rrf_score = Σ 1/(k + rank)   for each list where chunk appears
```
Position-based (ignores raw scores), more robust to score distribution differences.

Both methods use `buildEntryMap()` to unify chunks from both lists by a composite key (`docId:start:end`).

3. **Cleanup:** Cleanup both sub-strategies (dense no-op, BM25 releases index)

#### Stage 4: REFINEMENT

**Runs after search, before returning results.**

Refinement steps execute sequentially — the output of each step feeds into the next:

```typescript
type RefinementStepConfig = RerankRefinementStep | ThresholdRefinementStep;
```

##### Rerank (`type: "rerank"`)

```typescript
interface RerankRefinementStep { readonly type: "rerank"; }
```

1. Extract chunks from scored results
2. Call `reranker.rerank(query, chunks, k)`
3. Reassign linearly decaying rank scores to the reranked order via `assignRankScores()`

Requires a `Reranker` in `PipelineRetrieverDeps` — the constructor validates this at construction time.

##### Threshold (`type: "threshold"`)

```typescript
interface ThresholdRefinementStep {
  readonly type: "threshold";
  readonly minScore: number;
}
```

Filters out any result with `score < minScore`. Implemented in `refinement/threshold.ts`:
```typescript
function applyThresholdFilter(results, minScore): ScoredChunk[]
```

#### Config Hashing (`config.ts`)

Two hash functions for deduplication and caching:

```typescript
// Hash of index-relevant fields only (for sharing indices across retrievers)
function computeIndexConfigHash(config: PipelineConfig): string;

// Hash of all 4 stages + k (for full retriever dedup)
function computeRetrieverConfigHash(config: PipelineConfig, k: number): string;
```

Both use `stableStringify()` (recursively sorts all object keys) → SHA-256 → hex string. Two configs with identical settings produce the same hash regardless of property order or `name` field.

#### Internal Types (`pipeline/types.ts`)

```typescript
// Used throughout the pipeline for scored results — single definition, shared everywhere
interface ScoredChunk {
  readonly chunk: PositionAwareChunk;
  readonly score: number;
}
```

---

## 8. Evaluation Metrics

> `src/evaluation/`

All metrics operate on `CharacterSpan[]` and return a score in [0, 1].

### 8.1 Metric Interface (`metrics/base.ts`)

```typescript
interface Metric {
  readonly name: string;
  readonly calculate: (
    retrieved: readonly CharacterSpan[],
    groundTruth: readonly CharacterSpan[],
  ) => number;
  readonly calculatePreMerged?: (
    mergedRetrieved: readonly SpanRange[],
    mergedGroundTruth: readonly SpanRange[],
  ) => number;
}
```

The optional `calculatePreMerged` method accepts pre-merged, non-overlapping spans. When provided, `computeMetrics` calls this instead of `calculate` to avoid redundant sort+merge operations across multiple metrics.

### 8.2 Span Utilities (`utils/span.ts`)

All span geometry functions are consolidated in `utils/span.ts`:

**`mergeOverlappingSpans(spans)`** — Groups spans by docId, sorts by start, merges overlapping/adjacent ranges into maximal spans. Prevents double-counting.

**`calculateOverlap(spansA, spansB)`** — Merges both sets, then sums character-level intersection across all pairwise span comparisons (same-doc only).

**`calculateOverlapPreMerged(mergedA, mergedB)`** — Same as above but skips the merge step (for use with pre-merged inputs).

**`totalSpanLength(spans)`** / **`totalSpanLengthPreMerged(mergedSpans)`** — Merges spans (or skips merge), then sums `(end - start)` for each.

Low-level helpers (also in `utils/span.ts`):
- `spanOverlaps(a, b)` — true if same doc and ranges intersect
- `spanOverlapChars(a, b)` — `min(a.end, b.end) - max(a.start, b.start)` (or 0)
- `spanLength(span)` — `end - start`

> **Note:** `evaluation/metrics/utils.ts` exists for backward compatibility but simply re-exports from `utils/span.ts`.

### 8.3 The Four Metrics

| Metric | Formula | Intuition | Edge Cases |
|--------|---------|-----------|------------|
| **Recall** | `overlap / totalGT` | What fraction of ground truth was retrieved? | Empty GT → 1.0 |
| **Precision** | `overlap / totalRetrieved` | What fraction of retrieved content is relevant? | Empty retrieved → 0.0 |
| **IoU** | `overlap / (totalRet + totalGT - overlap)` | Symmetric overlap quality | Both empty → 1.0; one empty → 0.0 |
| **F1** | `2 × (P × R) / (P + R)` | Harmonic mean of precision & recall | Both 0 → 0.0 |

All scores clamped to [0, 1]. Each metric implements both `calculate` and `calculatePreMerged` for optimal performance.

### 8.4 Orchestrator (`evaluator.ts`)

```typescript
interface ComputeMetricsOptions {
  readonly results: ReadonlyArray<{
    readonly retrieved: readonly CharacterSpan[];
    readonly groundTruth: readonly CharacterSpan[];
  }>;
  readonly metrics: readonly Metric[];
}

function computeMetrics(options): Record<string, number>;
```

**Pre-merge optimization:** Before computing individual metrics, the orchestrator pre-merges overlapping spans once per result via `mergeOverlappingSpans`. If a metric provides `calculatePreMerged`, that variant is called with the pre-merged spans — avoiding redundant sort+merge that would otherwise happen independently in each metric. This is significant for F1, which internally calls both recall and precision.

Computes each metric for each result, then returns **arithmetic mean** per metric across all results.

---

## 9. Synthetic Data Generation

> `src/synthetic-datagen/`

Generates evaluation questions from a corpus, then assigns character-level ground truth spans.

### 9.1 Core Abstractions (`base.ts`, `strategies/types.ts`)

```typescript
// LLM abstraction used by all strategies
interface LLMClient {
  readonly name: string;
  complete(params: {
    model: string;
    messages: ReadonlyArray<{ role: string; content: string }>;
    responseFormat?: "json" | "text";
  }): Promise<string>;
}

// Adapter for OpenAI SDK — with built-in retry logic
function openAIClientAdapter(client): LLMClient;
```

The `openAIClientAdapter` wraps LLM calls in `withRetry()` (3 retries, 1000ms exponential backoff) to handle transient API errors gracefully.

```typescript
// Output of all strategies
interface GeneratedQuery {
  readonly query: string;
  readonly targetDocId: string;
  readonly metadata: Readonly<Record<string, string>>;
}

// Strategy interface
interface QuestionStrategy {
  readonly name: string;
  generate(context: StrategyContext): Promise<GeneratedQuery[]>;
}

interface StrategyContext {
  readonly corpus: Corpus;
  readonly llmClient: LLMClient;
  readonly model: string;
  readonly embedder?: Embedder;  // Only for RealWorldGroundedStrategy
}
```

> **Note:** The `SyntheticDatasetGenerator` abstract class that previously existed in `base.ts` has been removed. It was never extended — all strategies implement `QuestionStrategy` directly.

### 9.2 Strategy 1: SimpleStrategy (`strategies/simple/`)

```typescript
class SimpleStrategy implements QuestionStrategy {
  constructor(options: { queriesPerDoc: number });
}
```

For each document: truncate to configurable max chars → prompt LLM → parse questions from JSON response via `safeParseLLMResponse()`. Total output: `queriesPerDoc × numDocs`.

### 9.3 Strategy 2: DimensionDrivenStrategy (`strategies/dimension-driven/`)

```typescript
class DimensionDrivenStrategy implements QuestionStrategy {
  constructor(options: {
    dimensionsFilePath?: string;
    dimensions?: readonly Dimension[];
    totalQuestions: number;
    onProgress?: ProgressCallback;
  });
}
```

A multi-step pipeline for structured diversity:

```
Load Dimensions → Filter Combos → Summarize Docs → Build Relevance Matrix → Sample → Generate
```

**Dimensions** model axes of variation:
```typescript
interface Dimension {
  readonly name: string;        // e.g., "User Persona"
  readonly description: string;
  readonly values: readonly string[];  // e.g., ["new_user", "power_user", "admin"]
}
```

**Pipeline steps:**
1. **Filtering** (`filtering.ts`) — Cartesian product of all dimension values → LLM marks unrealistic pairs → filter to plausible combos. Uses `mapWithConcurrency()` with a limit of 5 to avoid rate-limiting.
2. **Relevance** (`relevance.ts`) — Summarize each doc → LLM assigns combos to docs → builds a relevance matrix. Uses `mapWithConcurrency()` with a limit of 5.
3. **Sampling** (`sampling.ts`) — 3-phase stratified sampling: (a) one combo per doc, (b) each combo at least once, (c) proportional fill to budget
4. **Generation** — For each doc with assigned combos, LLM generates one question per user profile

All LLM JSON parsing uses `safeParseLLMResponse()` with appropriate fallbacks for resilience.

Supports progress callbacks for UI integration.

**Dimension discovery** (`discovery.ts`) — `discoverDimensions()` can auto-infer dimensions from website content.

### 9.4 Strategy 3: RealWorldGroundedStrategy (`strategies/real-world-grounded/`)

```typescript
class RealWorldGroundedStrategy implements QuestionStrategy {
  constructor(options: {
    questions: readonly string[];
    totalSyntheticQuestions: number;
    matchThreshold?: number;         // Default: 0.35
    fewShotExamplesPerDoc?: number;
  });
}
```

Matches real-world questions to documents via embedding similarity, then generates more questions in the same style:

1. **Matching** (`matching.ts`) — Split docs into ~500-char passages, embed all passages + questions, find best matches above threshold. Uses `cosineSimilarity()` from `utils/similarity.ts`.
2. **Budget allocation** (`few-shot.ts`) — Distribute generation quota proportional to match count per doc
3. **Few-shot generation** (`few-shot.ts`) — Use matched questions as examples, LLM generates new questions in the same style
4. **Output** — Both direct matches (`mode: "direct"`) and generated questions (`mode: "generated"`)

Requires an `Embedder` in the strategy context.

> **Note:** The file `generation.ts` has been renamed to `few-shot.ts` to disambiguate it from `generator.ts` (which contains the `RealWorldGroundedStrategy` class).

### 9.5 Ground Truth Assignment (`ground-truth/`)

```typescript
class GroundTruthAssigner {
  async assign(
    queries: GeneratedQuery[],
    context: GroundTruthAssignerContext
  ): Promise<GroundTruth[]>;
}
```

For each query:
1. Find the target document in the corpus
2. LLM extracts **verbatim passages** from the document that answer the query
3. For each passage, find its exact character position in the document via string search (with whitespace-normalized fallback)
4. Create `CharacterSpan` with precise start/end offsets

LLM JSON parsing uses `safeParseLLMResponse()` for resilience.

Output: `GroundTruth[]` — each binding a query to its character-level spans.

### 9.6 End-to-End Flow (`index.ts`)

```typescript
interface GenerateOptions {
  readonly strategy: QuestionStrategy;
  readonly corpus: Corpus;
  readonly llmClient: LLMClient;
  readonly model?: string;
}

async function generate(options: GenerateOptions): Promise<GroundTruth[]>;
```

```
Strategy.generate(context) → GeneratedQuery[]
                  ↓
 GroundTruthAssigner.assign() → GroundTruth[]
```

> **Note:** The previous `uploadToLangsmith` and `datasetName` options have been removed from `GenerateOptions`. LangSmith dataset upload is now handled entirely by the Convex backend.

---

## 10. Experiment Presets

> `src/experiments/`

All preset configurations are consolidated in a single file: `presets.ts`.

### Shared Dependencies Interface

```typescript
interface PipelinePresetDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
}
```

### Preset Configs

| Preset | Search Strategy | Refinement | Key Settings |
|--------|----------------|------------|-------------|
| `baseline-vector-rag` | Dense | — | Default chunking, text-embedding-3-small |
| `bm25` | BM25 | — | k1=1.2, b=0.75 |
| `hybrid` | Hybrid (weighted) | — | 70% dense + 30% BM25, 4x candidates |
| `hybrid-reranked` | Hybrid (weighted) | Rerank | Same as hybrid + Cohere reranking |

### Generic Factory

```typescript
function createPresetRetriever(
  presetName: "baseline-vector-rag" | "bm25" | "hybrid" | "hybrid-reranked",
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
): PipelineRetriever;
```

### Named Convenience Wrappers

One-liner wrappers for backward compatibility:
- `createBaselineVectorRagRetriever(deps, overrides?)`
- `createBM25Retriever(deps, overrides?)`
- `createHybridRetriever(deps, overrides?)`
- `createHybridRerankedRetriever(deps, overrides?)` — requires `reranker` in deps

Adding a new preset is a single line — one config object + one convenience wrapper.

> **Note:** The previous structure had 4 subdirectories (8 files) under `experiments/`. These have been collapsed into a single `presets.ts` file.

---

## 11. Utilities

> `src/utils/`

Six utility modules, all re-exported from `src/utils/index.ts` and accessible via the `rag-evaluation-system/utils` sub-path.

### Hashing (`hashing.ts`)

```typescript
function generatePaChunkId(
  content: string,
  docId?: string,
  start?: number,
): PositionAwareChunkId;
```

Uses SHA-256 hashing for deterministic chunk IDs. When `docId` and `start` are provided, the input is `${docId}:${start}:${content}`, which eliminates collisions for identical text appearing in different documents or at different positions. Format: `pa_chunk_{hash16}`.

Backward compatible: calling with just `content` still works (hashes content only).

### Span Operations (`span.ts`)

```typescript
function spanOverlaps(a: SpanRange, b: SpanRange): boolean;
function spanOverlapChars(a: SpanRange, b: SpanRange): number;
function spanLength(span: SpanRange): number;
function mergeOverlappingSpans(spans: readonly SpanRange[]): SpanRange[];
function calculateOverlap(spansA: readonly SpanRange[], spansB: readonly SpanRange[]): number;
function calculateOverlapPreMerged(mergedA: readonly SpanRange[], mergedB: readonly SpanRange[]): number;
function totalSpanLength(spans: readonly SpanRange[]): number;
function totalSpanLengthPreMerged(mergedSpans: readonly SpanRange[]): number;
```

All span geometry functions are consolidated here. Low-level helpers are used by evaluation metrics. The `*PreMerged` variants skip the merge step for callers that have already merged (used by `computeMetrics` optimization).

### Cosine Similarity (`similarity.ts`)

```typescript
function cosineSimilarity(a: readonly number[], b: readonly number[]): number;
```

Consolidated implementation used by `InMemoryVectorStore` and `RealWorldGroundedStrategy`'s matching module. Returns 0 if either vector is zero.

### Safe JSON Parsing (`json.ts`)

```typescript
function safeParseLLMResponse<T>(response: string, fallback: T): T;
```

Strips markdown code fences (```` ```json ... ``` ````) if present, parses JSON, and returns the fallback value on failure (with a `console.warn`). Used across all synthetic datagen modules to gracefully handle malformed LLM responses.

### Concurrency Limiter (`concurrency.ts`)

```typescript
function mapWithConcurrency<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit?: number,    // Default: 5
): Promise<R[]>;
```

Worker-pool pattern that processes items with up to `limit` concurrent async workers, preserving input order. Used in dimension-driven strategy for bounded LLM fan-outs (filtering and relevance stages).

### Retry Logic (`retry.ts`)

```typescript
function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; backoffMs?: number },
): Promise<T>;
```

Exponential backoff retry: delay = `backoffMs × 2^attempt`. Defaults: 3 retries, 1000ms base. Used internally by `openAIClientAdapter` to handle transient LLM API errors.

---

## 12. Build & Exports

### tsup Configuration (`tsup.config.ts`)

Five entry points, each producing ESM + CJS + .d.ts:

| Entry | Purpose |
|-------|---------|
| `src/index.ts` | Main barrel — types, core implementations, preset factories |
| `src/embedders/openai.ts` | OpenAI embedder (tree-shakeable, avoids pulling `openai` into main bundle) |
| `src/rerankers/cohere.ts` | Cohere reranker (optional dependency) |
| `src/pipeline/internals.ts` | Internal pipeline utilities (config defaults, BM25, fusion, InMemoryVectorStore, dimension discovery) |
| `src/utils/index.ts` | Utility functions (span ops, similarity, JSON, concurrency, retry) |

### Package Exports (`package.json`)

```json
{
  ".": "Main entry (types, core implementations, preset factories)",
  "./embedders/openai": "OpenAI embedder",
  "./rerankers/cohere": "Cohere reranker",
  "./pipeline/internals": "Internal pipeline utilities, InMemoryVectorStore, dimension discovery",
  "./utils": "Utility functions (span geometry, similarity, JSON parsing, concurrency, retry)"
}
```

### Public API Surface (Root Barrel)

The root barrel (`src/index.ts`) exports the primary public API. Items are organized into tiers:

**Always on root:** Types, branded ID factories, core interfaces, `PipelineRetriever`, preset factories, strategy classes, `computeMetrics`, metrics, `GroundTruthAssigner`, `generate()`, `parseDimensions`, `openAIClientAdapter`, config hash functions, basic span utilities.

**Moved to `./pipeline/internals`:** `InMemoryVectorStore`, `BM25SearchIndex`, `weightedScoreFusion`, `reciprocalRankFusion`, `applyThresholdFilter`, `DEFAULT_INDEX_CONFIG`, `DEFAULT_QUERY_CONFIG`, `DEFAULT_SEARCH_CONFIG`, `discoverDimensions`, `loadDimensions`, `loadDimensionsFromFile`.

**Moved to `./utils`:** `mergeOverlappingSpans`, `calculateOverlap`, `calculateOverlapPreMerged`, `totalSpanLength`, `totalSpanLengthPreMerged`, `cosineSimilarity`, `safeParseLLMResponse`, `mapWithConcurrency`, `withRetry`.

### Dependencies

| Type | Package | Used By |
|------|---------|---------|
| **Required** | `minisearch` | BM25 full-text search |
| **Required** | `zod` | Schema validation |
| **Optional** | `openai` | OpenAIEmbedder |
| **Optional** | `cohere-ai` | CohereReranker |

Optional dependencies use dynamic `import()` with graceful error messages if not installed.

> **Note:** `langsmith` and `chromadb` are no longer dependencies. LangSmith integration lives in the Convex backend. ChromaVectorStore has been removed.

---

## End-to-End Data Flow

Putting it all together — here's how a complete evaluation run flows through the system:

```
                         SYNTHETIC DATA GENERATION
                         ─────────────────────────
 Corpus (Documents[])
   ↓
 QuestionStrategy.generate()  →  GeneratedQuery[] (query + targetDocId)
   ↓
 GroundTruthAssigner.assign() →  GroundTruth[] (query + CharacterSpan[])
   ↓
 (backend uploads to LangSmith)


                         EXPERIMENT EXECUTION
                         ────────────────────
 PipelineConfig + PipelineRetrieverDeps
   ↓
 PipelineRetriever(config, deps)
   ↓
 createSearchStrategy(config) → DenseSearchStrategy | BM25SearchStrategy | HybridSearchStrategy
   ↓
 .init(corpus)
   ├── Chunk documents                    →  PositionAwareChunk[]
   └── searchStrategy.init(chunks, deps)
       ├── Dense: embed batches + store   →  VectorStore
       ├── BM25: build inverted index     →  BM25SearchIndex
       └── Hybrid: both in sequence
   ↓
 (backend runs LangSmith experiment)
   ↓
 For each question in dataset:
   │
   ├── QUERY:  identity(query)                        →  processedQuery
   ├── SEARCH: searchStrategy.search(query, k, deps)  →  ScoredChunk[]
   ├── REFINE: rerank → threshold                      →  ScoredChunk[]
   ├── Return top-k PositionAwareChunk[]               → CharacterSpan[]
   │
   └── EVALUATE:
       ├── Pre-merge spans once per result
       ├── recall(mergedRetrieved, mergedGT)      →  0.XX
       ├── precision(mergedRetrieved, mergedGT)   →  0.XX
       ├── iou(mergedRetrieved, mergedGT)         →  0.XX
       └── f1(mergedRetrieved, mergedGT)          →  0.XX
   ↓
 Average all per-question scores
   ↓
 Final: { recall: 0.XX, precision: 0.XX, iou: 0.XX, f1: 0.XX }
```
