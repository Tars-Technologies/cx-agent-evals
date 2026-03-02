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
10. [LangSmith Integration](#10-langsmith-integration)
11. [Experiment Presets](#11-experiment-presets)
12. [Utilities](#12-utilities)
13. [Build & Exports](#13-build--exports)

---

## 1. Package Overview

eval-lib is a self-contained TypeScript library for evaluating RAG retrieval pipelines. It provides:

- **Span-based evaluation** — metrics computed on exact character positions, not fuzzy text matching
- **Pluggable components** — interfaces for chunkers, embedders, vector stores, rerankers, and retrievers
- **Pipeline retriever** — a composable 4-stage retrieval architecture (INDEX → QUERY → SEARCH → REFINEMENT)
- **Synthetic data generation** — three strategies for generating evaluation questions with character-level ground truth
- **LangSmith integration** — dataset upload, experiment execution, and result tracking

### Directory Structure

```
src/
├── types/                  # Branded types, domain interfaces, Zod schemas
├── chunkers/               # Text chunking with position tracking
├── embedders/              # Text → vector embedding
├── vector-stores/          # Vector similarity search backends
├── rerankers/              # Result reranking via external models
├── retrievers/             # Retriever interface + pipeline implementation
│   ├── pipeline/           # 4-stage pipeline retriever
│   │   ├── search/         # BM25 index, fusion algorithms
│   │   └── refinement/     # Threshold filtering
│   ├── baseline-vector-rag/# Legacy standalone retriever
│   └── callback-retriever.ts
├── evaluation/             # Span-based metrics (recall, precision, IoU, F1)
│   └── metrics/            # Individual metric implementations
├── synthetic-datagen/      # Question generation + ground truth assignment
│   ├── strategies/         # Simple, Dimension-Driven, Real-World-Grounded
│   └── ground-truth/       # Character span extraction
├── experiments/            # Preset retriever configurations
├── langsmith/              # LangSmith upload, experiment runner, raw API
└── utils/                  # Hashing, span operations
```

### Key Design Principles

1. **Everything is character-level.** Ground truth is `CharacterSpan[]` (docId + start + end + text). Metrics measure character overlap. Chunks track character offsets.
2. **Interfaces over implementations.** `Chunker`, `Embedder`, `VectorStore`, `Reranker`, `Retriever` — all abstract interfaces. Swap any component.
3. **Branded types for safety.** `DocumentId`, `QueryId`, `PositionAwareChunkId` are branded strings — you can't accidentally pass a query ID where a document ID is expected.
4. **Config-driven pipelines.** The `PipelineRetriever` reads a declarative `PipelineConfig` object to assemble its behavior. No subclassing required.

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

**Factories:** `createDocument()`, `createCorpus()`, `createCorpusFromDocuments()`, `corpusFromFolder(path, glob)`

**Zod schemas:** `DocumentSchema`, `CorpusSchema` for runtime validation.

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

**Chunk IDs:** Generated via `generatePaChunkId(content)` — an FNV-1a hash producing deterministic IDs like `pa_chunk_a1b2c3d4ef12`.

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
  constructor(options: { model?: string; client: any });
  static async create(options?: { model?: string }): Promise<OpenAIEmbedder>;
}
```

**Supported models:**

| Model | Dimensions |
|-------|-----------|
| `text-embedding-3-small` (default) | 1536 |
| `text-embedding-3-large` | 3072 |
| `text-embedding-ada-002` | 1536 |

The constructor takes a pre-instantiated OpenAI client (for dependency injection and testing). The static `create()` factory dynamically imports the `openai` package and creates a client automatically.

Calls `client.embeddings.create({ model, input: texts })` and maps the response to `number[][]`.

---

## 5. Vector Stores

> `src/vector-stores/`

### 5.1 Interface (`vector-store.interface.ts`)

```typescript
interface VectorStore {
  readonly name: string;
  add(chunks: readonly PositionAwareChunk[], embeddings: readonly number[][]): Promise<void>;
  search(queryEmbedding: readonly number[], k?: number): Promise<PositionAwareChunk[]>;
  clear(): Promise<void>;
}
```

`add()` takes parallel arrays of chunks and their embeddings. `search()` returns the top-k most similar chunks.

### 5.2 InMemoryVectorStore (`in-memory.ts`)

Stores chunks and embeddings in arrays. Search computes **cosine similarity** against all stored embeddings:

```
similarity(a, b) = (a · b) / (||a|| × ||b||)
```

Returns top-k by descending similarity. Suitable for evaluation workloads up to ~10K chunks.

### 5.3 ChromaVectorStore (`chroma.ts`)

Wraps the `chromadb` package with a lazy-initialized collection using HNSW index with cosine distance. Uses a static `create()` factory (dynamically imports `chromadb`). Stores chunk positions as Chroma metadata for round-trip fidelity.

Not exported from the main entry point — import directly from `rag-evaluation-system/vector-stores/chroma`.

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

Uses `cohere-ai` package (dynamically imported). Calls `client.rerank({ model, query, documents, topN })`. Maps the API response indices back to the original `PositionAwareChunk` objects, preserving all span metadata.

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

### 7.3 VectorRAGRetriever (`baseline-vector-rag/retriever.ts`)

A simpler, non-pipeline retriever. `init()` chunks + embeds + stores. `retrieve()` embeds query → vector search → optional rerank. Useful as a baseline.

### 7.4 PipelineRetriever — The 4-Stage Pipeline

> `src/retrievers/pipeline/`

This is the centerpiece of the library. A declarative, config-driven retriever with four composable stages.

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌────────────┐
│  INDEX   │ →  │  QUERY  │ →  │ SEARCH  │ →  │ REFINEMENT │ → results
└─────────┘    └─────────┘    └─────────┘    └────────────┘
  (init)        (retrieve)     (retrieve)       (retrieve)
```

#### Dependencies (`pipeline-retriever.ts`)

```typescript
interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;    // Defaults to InMemoryVectorStore
  readonly reranker?: Reranker;          // Required if refinement includes "rerank"
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
// Currently one strategy
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
2. **Embed** chunks in batches of 100 via `embedder.embed()` and store in `vectorStore` (if strategy needs dense search)
3. **Build BM25 index** via `BM25SearchIndex.build(chunks)` (if strategy needs sparse search)

Which indices are built depends on the search strategy:
- `dense` → vector store only
- `bm25` → BM25 index only
- `hybrid` → both

#### Stage 2: QUERY

**Runs at the start of `retrieve(query, k)`.**

```typescript
// Currently one strategy
interface IdentityQueryConfig {
  readonly strategy: "identity";    // Passes query through unchanged
}
```

Currently a passthrough. The plan expands this with HyDE, multi-query, step-back, and rewrite strategies.

#### Stage 3: SEARCH

**Runs during `retrieve()` after query processing.**

Three strategies, selected by `SearchConfig.strategy`:

##### Dense Search (`strategy: "dense"`)

```typescript
interface DenseSearchConfig { readonly strategy: "dense"; }
```

1. Embed query via `embedder.embedQuery(query)`
2. Search vector store for top-k: `vectorStore.search(queryEmbedding, k)`
3. Assign linearly decaying rank scores: first = 1.0, last = 1/count

##### BM25 Search (`strategy: "bm25"`)

```typescript
interface BM25SearchConfig {
  readonly strategy: "bm25";
  readonly k1?: number;    // Default: 1.2 — term frequency saturation
  readonly b?: number;     // Default: 0.75 — field length normalization
}
```

1. Query the pre-built BM25 index (powered by MiniSearch)
2. Scores are normalized: top result = 1.0, rest proportional

**BM25SearchIndex** (`search/bm25.ts`): Wraps MiniSearch with `fields: ["content"]`. Uses BM25+ scoring with configurable k1, b, and delta (0.5) parameters.

##### Hybrid Search (`strategy: "hybrid"`)

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

1. Run dense and BM25 search **in parallel**, each fetching `k × candidateMultiplier` candidates
2. Fuse results using one of two methods:

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
3. Reassign linearly decaying rank scores to the reranked order

Requires a `Reranker` in `PipelineRetrieverDeps` — the constructor validates this.

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

#### Internal Types

```typescript
// Used throughout the pipeline for scored results
interface ScoredChunk {
  readonly chunk: PositionAwareChunk;
  readonly score: number;
}
```

The `assignRankScores()` utility converts a sorted chunk array into scored chunks: `score[i] = (count - i) / count`.

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
    groundTruth: readonly CharacterSpan[]
  ) => number;
}
```

### 8.2 Span Utilities (`metrics/utils.ts`)

Before computing any metric, spans are preprocessed:

**`mergeOverlappingSpans(spans)`** — Groups spans by docId, sorts by start, merges overlapping/adjacent ranges into maximal spans. Prevents double-counting.

**`calculateOverlap(spansA, spansB)`** — Merges both sets, then sums character-level intersection across all pairwise span comparisons (same-doc only).

**`totalSpanLength(spans)`** — Merges spans, then sums `(end - start)` for each.

Low-level helpers in `utils/span.ts`:
- `spanOverlaps(a, b)` — true if same doc and ranges intersect
- `spanOverlapChars(a, b)` — `min(a.end, b.end) - max(a.start, b.start)` (or 0)
- `spanLength(span)` — `end - start`

### 8.3 The Four Metrics

| Metric | Formula | Intuition | Edge Cases |
|--------|---------|-----------|------------|
| **Recall** | `overlap / totalGT` | What fraction of ground truth was retrieved? | Empty GT → 1.0 |
| **Precision** | `overlap / totalRetrieved` | What fraction of retrieved content is relevant? | Empty retrieved → 0.0 |
| **IoU** | `overlap / (totalRet + totalGT - overlap)` | Symmetric overlap quality | Both empty → 1.0; one empty → 0.0 |
| **F1** | `2 × (P × R) / (P + R)` | Harmonic mean of precision & recall | Both 0 → 0.0 |

All scores clamped to [0, 1].

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

// Adapter for OpenAI SDK
function openAIClientAdapter(client): LLMClient;

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

### 9.2 Strategy 1: SimpleStrategy (`strategies/simple/`)

```typescript
class SimpleStrategy implements QuestionStrategy {
  constructor(options: { queriesPerDoc: number });
}
```

For each document: truncate to 8000 chars → prompt LLM → parse N questions from JSON response. Total output: `queriesPerDoc × numDocs`.

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
1. **Filtering** (`filtering.ts`) — Cartesian product of all dimension values → LLM marks unrealistic pairs → filter to plausible combos
2. **Relevance** (`relevance.ts`) — Summarize each doc → LLM assigns combos to docs → builds a relevance matrix
3. **Sampling** (`sampling.ts`) — 3-phase stratified sampling: (a) one combo per doc, (b) each combo at least once, (c) proportional fill to budget
4. **Generation** — For each doc with assigned combos, LLM generates one question per user profile

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

1. **Matching** (`matching.ts`) — Split docs into ~500-char passages, embed all passages + questions, find best matches above threshold
2. **Budget allocation** (`generation.ts`) — Distribute generation quota proportional to match count per doc
3. **Few-shot generation** — Use matched questions as examples, LLM generates new questions in the same style
4. **Output** — Both direct matches (`mode: "direct"`) and generated questions (`mode: "generated"`)

Requires an `Embedder` in the strategy context.

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

Output: `GroundTruth[]` — each binding a query to its character-level spans.

### 9.6 End-to-End Flow (`index.ts`)

```typescript
async function generate(options: GenerateOptions): Promise<GroundTruth[]>;
```

```
Strategy.generate(context) → GeneratedQuery[]
                  ↓
GroundTruthAssigner.assign() → GroundTruth[]
                  ↓
(optional) uploadDataset() → LangSmith
```

---

## 10. LangSmith Integration

> `src/langsmith/`

### 10.1 Dataset Operations

**`upload.ts`** — `uploadDataset(groundTruth, options)`: Converts `GroundTruth[]` to LangSmith examples, batch uploads (default 20, 3 retries), returns dataset URL.

**`client.ts`** — `loadDataset(datasetName)`: Loads a LangSmith dataset back into `GroundTruth[]` format.

**`datasets.ts`** — `listDatasets()`, `listExperiments(datasetId)`, `getCompareUrl(datasetId)`: List and explore datasets/experiments.

### 10.2 Experiment Runner (`experiment-runner.ts`)

```typescript
interface LangSmithExperimentConfig {
  readonly corpus: Corpus;
  readonly retriever: Retriever;
  readonly k: number;
  readonly datasetName: string;
  readonly metrics?: readonly Metric[];     // Default: [recall, precision, iou, f1]
  readonly experimentPrefix?: string;
  readonly metadata?: Record<string, unknown>;
  readonly onResult?: (result: ExperimentResult) => Promise<void>;
}

async function runLangSmithExperiment(config): Promise<void>;
```

**Execution flow:**

1. `retriever.init(corpus)`
2. Define target function: `query → retriever.retrieve(query, k) → { relevantSpans }`
3. Create evaluators via `createLangSmithEvaluators(metrics)` — each deserializes spans and computes a metric
4. If `onResult` provided, add a callback evaluator that fires per question with `{ query, retrievedSpans, scores }`
5. Call LangSmith `evaluate(target, { data, evaluators, experimentPrefix, metadata })`
6. `retriever.cleanup()` in finally block

### 10.3 Evaluator Adapters (`evaluator-adapters.ts`)

```typescript
function deserializeSpans(raw: unknown): CharacterSpan[];
function createLangSmithEvaluator(metric: Metric): LangSmithEvaluatorFn;
function createLangSmithEvaluators(metrics: readonly Metric[]): LangSmithEvaluatorFn[];
```

Bridges eval-lib metrics to LangSmith's evaluator format: extract spans from `outputs`/`referenceOutputs`, compute metric, return `{ key, score }`.

### 10.4 Raw API (`raw-api.ts`)

```typescript
async function createLangSmithExperiment(options): Promise<{ experimentId, experimentUrl }>;
async function logLangSmithResult(options): Promise<void>;
```

Lower-level API for per-question parallel evaluation (used by Convex WorkPool). Creates experiment projects directly and logs individual runs with scores as feedback.

---

## 11. Experiment Presets

> `src/experiments/`

Four named preset configurations, each a directory with `config.ts` and `index.ts`:

| Preset | Search Strategy | Refinement | Key Settings |
|--------|----------------|------------|-------------|
| `baseline-vector-rag` | Dense | — | Default chunking, text-embedding-3-small |
| `bm25` | BM25 | — | k1=1.2, b=0.75 |
| `hybrid` | Hybrid (weighted) | — | 70% dense + 30% BM25, 4x candidates |
| `hybrid-reranked` | Hybrid (weighted) | Rerank | Same as hybrid + Cohere reranking |

Each exports:
- A `PipelineConfig` constant (e.g., `BASELINE_VECTOR_RAG_CONFIG`)
- A factory function (e.g., `createBaselineVectorRagRetriever(deps, overrides?)`)

Factory functions create a `PipelineRetriever` with the preset config, accepting optional overrides.

---

## 12. Utilities

> `src/utils/`

### Hashing (`hashing.ts`)

```typescript
function generatePaChunkId(content: string): PositionAwareChunkId;
```

Uses dual FNV-1a hashing (32-bit, no Node.js crypto dependency) for deterministic chunk IDs. Format: `pa_chunk_{hash1}{hash2_prefix}`.

### Span Operations (`span.ts`)

```typescript
function spanOverlaps(a: SpanRange, b: SpanRange): boolean;
function spanOverlapChars(a: SpanRange, b: SpanRange): number;
function spanLength(span: SpanRange): number;
```

Low-level helpers used by evaluation metrics. All are document-aware (spans on different documents never overlap).

---

## 13. Build & Exports

### tsup Configuration (`tsup.config.ts`)

Six entry points, each producing ESM + CJS + .d.ts:

| Entry | Purpose |
|-------|---------|
| `src/index.ts` | Main barrel — all types, chunkers, embedders, vector stores, retrievers, evaluation, synthetic datagen, utils |
| `src/embedders/openai.ts` | OpenAI embedder (tree-shakeable, avoids pulling `openai` into main bundle) |
| `src/vector-stores/chroma.ts` | Chroma vector store (optional dependency) |
| `src/rerankers/cohere.ts` | Cohere reranker (optional dependency) |
| `src/langsmith/index.ts` | LangSmith utilities (optional dependency) |
| `src/langsmith/experiment-runner.ts` | Experiment runner (kept separate from langsmith/index to avoid pulling all of langsmith) |

### Package Exports (`package.json`)

```json
{
  ".": "Main entry (types, core implementations)",
  "./embedders/openai": "OpenAI embedder",
  "./vector-stores/chroma": "Chroma vector store",
  "./rerankers/cohere": "Cohere reranker",
  "./langsmith": "LangSmith utilities",
  "./langsmith/experiment-runner": "Experiment runner"
}
```

### Dependencies

| Type | Package | Used By |
|------|---------|---------|
| **Required** | `minisearch` | BM25 full-text search |
| **Required** | `zod` | Schema validation |
| **Peer** | `langsmith` | LangSmith integration |
| **Optional** | `openai` | OpenAIEmbedder |
| **Optional** | `cohere-ai` | CohereReranker |
| **Optional** | `chromadb` | ChromaVectorStore |

Optional dependencies use dynamic `import()` with graceful error messages if not installed.

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
 uploadDataset()              →  LangSmith Dataset


                         EXPERIMENT EXECUTION
                         ────────────────────
 PipelineConfig + PipelineRetrieverDeps
   ↓
 PipelineRetriever(config, deps)
   ↓
 .init(corpus)
   ├── Chunk documents         →  PositionAwareChunk[]
   ├── Embed + store vectors   →  VectorStore
   └── Build BM25 index        →  BM25SearchIndex
   ↓
 runLangSmithExperiment({ retriever, datasetName, k, metrics })
   ↓
 For each question in dataset:
   │
   ├── QUERY:  identity(query)         →  processedQuery
   ├── SEARCH: dense/bm25/hybrid       →  ScoredChunk[]
   ├── REFINE: rerank → threshold       →  ScoredChunk[]
   ├── Return top-k PositionAwareChunk[] → CharacterSpan[]
   │
   └── EVALUATE:
       ├── recall(retrieved, groundTruth)    →  0.XX
       ├── precision(retrieved, groundTruth) →  0.XX
       ├── iou(retrieved, groundTruth)       →  0.XX
       └── f1(retrieved, groundTruth)        →  0.XX
   ↓
 Average all per-question scores
   ↓
 Final: { recall: 0.XX, precision: 0.XX, iou: 0.XX, f1: 0.XX }
```
