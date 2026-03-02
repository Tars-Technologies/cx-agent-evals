# Updated Pipeline Retrievers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the pipeline retriever system with new embedders, rerankers, chunkers, pipeline stage strategies, and named presets — enabling hundreds of experiment configurations from composable building blocks.

**Architecture:** Build on the existing 4-stage `PipelineRetriever` (INDEX → QUERY → SEARCH → REFINEMENT) by extending the discriminated unions in `config.ts`, adding new provider implementations that plug into existing interfaces, and implementing new pipeline strategies. Everything stays within eval-lib — no backend/frontend changes.

**Tech Stack:** TypeScript, Vitest, tsup, pnpm workspace. Provider SDKs: `cohere-ai`, `voyageai`, plain `fetch` for Jina/Voyage REST APIs. `js-tiktoken` for token chunking.

Organized into **6 vertical slices** — each slice unlocks a new set of runnable experiments. Scope: **eval-lib only** (no backend/frontend changes).

**Updated 2026-03-01**: Synced with the eval-lib codebase refactor (PR #24, `va_evallib_refactor`). Major changes: experiments collapsed from 4 subdirectories into single `presets.ts`, `ChromaVectorStore` removed, exports reorganized into 5 entry points, all LangSmith code migrated to backend. See [Impact of Codebase Refactor](#impact-of-codebase-refactor) for details.

---

## Table of Contents

1. [Impact of Codebase Refactor](#impact-of-codebase-refactor)
2. [Design Decisions](#design-decisions)
3. [Slice 1 — Provider Breadth](#slice-1--provider-breadth)
4. [Slice 2 — Sync Chunkers](#slice-2--sync-chunkers)
5. [Slice 3 — Query Stage + LLM Interface](#slice-3--query-stage--llm-interface)
6. [Slice 4 — Index Stage Strategies](#slice-4--index-stage-strategies)
7. [Slice 5 — Refinement + Async Chunkers](#slice-5--refinement--async-chunkers)
8. [Slice 6 — Named Presets](#slice-6--named-presets)
9. [Infrastructure Changes Summary](#infrastructure-changes-summary)
10. [File Inventory](#file-inventory)
11. [Testing Strategy](#testing-strategy)
12. [Reference: Models & Benchmarks](#reference-models--benchmarks)

---

## Impact of Codebase Refactor

The eval-lib package went through two significant refactors that affect this plan:

1. **PR #18 (`va_kb_indexing_management`)** — Retrievers became first-class backend entities separate from experiments.
2. **PR #24 (`va_evallib_refactor`)** — Major codebase cleanup: experiments collapsed, ChromaVectorStore removed, exports reorganized, LangSmith migrated to backend.

### What Changed in PR #24 (Most Recent)

```
BEFORE (pre-refactor):
  experiments/
    ├── baseline-vector-rag/   # 2 files (factory + config)
    ├── bm25/                  # 2 files
    ├── hybrid/                # 2 files
    ├── hybrid-reranked/       # 2 files
    └── index.ts               # Re-exports from all 4 dirs

  vector-stores/
    ├── chroma.ts              # ChromaVectorStore (now removed)
    └── in-memory.ts           # InMemoryVectorStore

  langsmith/                   # LangSmith utilities (now removed — migrated to backend)

AFTER (current state):
  experiments/
    ├── presets.ts             # ALL preset configs + factories in one file
    └── index.ts               # Re-exports

  vector-stores/
    └── in-memory.ts           # InMemoryVectorStore only

  (no langsmith/ directory — all migrated to packages/backend/convex/)
```

### Current Codebase State (Ground Truth)

All references below are verified against the actual source files as of 2026-03-01.

**Interfaces (unchanged — our targets to implement against):**

```typescript
// packages/eval-lib/src/embedders/embedder.interface.ts
interface Embedder {
  readonly name: string;
  readonly dimension: number;
  embed(texts: readonly string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}

// packages/eval-lib/src/rerankers/reranker.interface.ts
interface Reranker {
  readonly name: string;
  rerank(query: string, chunks: readonly PositionAwareChunk[], topK?: number): Promise<PositionAwareChunk[]>;
}

// packages/eval-lib/src/chunkers/chunker.interface.ts
interface PositionAwareChunker {
  readonly name: string;
  chunkWithPositions(doc: Document): PositionAwareChunk[];
}

// packages/eval-lib/src/retrievers/retriever.interface.ts
interface Retriever {
  readonly name: string;
  init(corpus: Corpus): Promise<void>;
  retrieve(query: string, k: number): Promise<PositionAwareChunk[]>;
  cleanup(): Promise<void>;
}
```

**Current Config Types (`config.ts` — exact current state):**

```typescript
// IndexConfig — currently a SINGLE interface, NOT a discriminated union
export interface IndexConfig {
  readonly strategy: "plain";
  readonly chunkSize?: number;       // default 1000
  readonly chunkOverlap?: number;    // default 200
  readonly separators?: readonly string[];
  readonly embeddingModel?: string;  // default "text-embedding-3-small"
}

// QueryConfig — currently only identity
export interface IdentityQueryConfig {
  readonly strategy: "identity";
}
export type QueryConfig = IdentityQueryConfig;

// SearchConfig — discriminated union (3 strategies)
export type SearchConfig = DenseSearchConfig | BM25SearchConfig | HybridSearchConfig;

// RefinementStepConfig — discriminated union (2 types)
export type RefinementStepConfig = RerankRefinementStep | ThresholdRefinementStep;

// PipelineConfig — composes all four stages
export interface PipelineConfig {
  readonly name: string;
  readonly index?: IndexConfig;
  readonly query?: QueryConfig;
  readonly search?: SearchConfig;
  readonly refinement?: readonly RefinementStepConfig[];
}
```

**Current PipelineRetrieverDeps (`pipeline-retriever.ts` — exact current state):**

```typescript
export interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;      // defaults to InMemoryVectorStore
  readonly reranker?: Reranker;
  readonly embeddingBatchSize?: number;    // default 100
}
```

**Current Presets (`experiments/presets.ts` — exact current state):**

```typescript
// Individual config constants
export const BASELINE_VECTOR_RAG_CONFIG: PipelineConfig = { ... };
export const BM25_CONFIG: PipelineConfig = { ... };
export const HYBRID_CONFIG: PipelineConfig = { ... };
export const HYBRID_RERANKED_CONFIG: PipelineConfig = { ... };

// Map of all presets
const PRESET_CONFIGS = {
  "baseline-vector-rag": BASELINE_VECTOR_RAG_CONFIG,
  "bm25": BM25_CONFIG,
  "hybrid": HYBRID_CONFIG,
  "hybrid-reranked": HYBRID_RERANKED_CONFIG,
} as const;

// Generic factory
export function createPresetRetriever(
  presetName: keyof typeof PRESET_CONFIGS,
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
): PipelineRetriever;

// Named convenience wrappers
export const createBaselineVectorRagRetriever = (...) => createPresetRetriever("baseline-vector-rag", ...);
export const createBM25Retriever = (...) => createPresetRetriever("bm25", ...);
export const createHybridRetriever = (...) => createPresetRetriever("hybrid", ...);
export const createHybridRerankedRetriever = (...) => createPresetRetriever("hybrid-reranked", ...);
```

**Current Hash Functions (`config.ts`):**

```typescript
// Uses a concrete IndexHashPayload interface (not strategy-aware yet)
interface IndexHashPayload {
  readonly strategy: string;
  readonly chunkSize: number;
  readonly chunkOverlap: number;
  readonly separators: readonly string[] | undefined;
  readonly embeddingModel: string;
}

export function computeIndexConfigHash(config: PipelineConfig): string;
export function computeRetrieverConfigHash(config: PipelineConfig, k: number): string;
```

**Current Package Dependencies (`package.json`):**

```json
{
  "dependencies": {
    "minisearch": "^7.2.0",
    "zod": "^3.23"
  },
  "optionalDependencies": {
    "cohere-ai": ">=7.0",
    "openai": ">=4.0"
  }
}
```

Note: `chromadb` is **no longer** in optionalDependencies (removed in refactor).

**Current Export Entry Points (`tsup.config.ts`):**

```
src/index.ts                    # Main barrel
src/embedders/openai.ts         # OpenAI embedder (tree-shakeable)
src/rerankers/cohere.ts         # Cohere reranker (optional dep)
src/pipeline/internals.ts       # Config defaults, BM25, fusion, InMemoryVectorStore
src/utils/index.ts              # Utility functions
```

**Current Test Suite:** 24 test files under `packages/eval-lib/tests/`

### Impacts on This Plan

| # | Impact | Affected Slices | Action Required |
|---|--------|-----------------|-----------------|
| 1 | **Experiment presets are now in a single `presets.ts` file** | 6 | The plan's Slice 6 should extend the existing `PRESET_CONFIGS` map and `createPresetRetriever` factory — NOT create a separate `PIPELINE_PRESETS` registry. Merge new presets into the existing pattern. |
| 2 | **ChromaVectorStore removed** | — | Remove all references to Chroma from the plan. `InMemoryVectorStore` is the only vector store. |
| 3 | **`chromadb` not in optionalDependencies** | 1 | Don't add it back. Only add new provider SDKs. |
| 4 | **LangSmith code migrated to backend** | — | No eval-lib LangSmith references needed. |
| 5 | **5 tsup entry points already exist** | 1 | New providers need their own entry points (e.g., `./embedders/voyage`, `./rerankers/jina`) or be added to existing entry points. Each provider that requires an optional dependency should get its own entry point for tree-shaking. |
| 6 | **`IndexConfig` is a single interface, not a discriminated union yet** | 4 | Converting it to a discriminated union is a breaking change. The `DEFAULT_INDEX_CONFIG` constant and `IndexHashPayload` type must be updated simultaneously. |
| 7 | **`computeRetrieverConfigHash` serializes the full config** | 3, 4, 5 | Uses `stableStringify` on the raw config payload. New fields on extended types are included automatically. But `computeIndexConfigHash` uses a concrete `IndexHashPayload` interface that must become strategy-aware. |
| 8 | **Backend `startIndexing` hardcodes `strategy: "plain"`** | 4 | `retrieverActions.ts` line 117 hardcodes this. When we add contextual/summary/parent-child index strategies in eval-lib, the backend will need a separate follow-up PR. Our plan stays eval-lib-only. |
| 9 | **Backend `retrieve` action only does dense vector search** | — | Does NOT use `PipelineRetriever`. The playground only tests dense retrieval today. |
| 10 | **Backend creates embedder with `createEmbedder(model)` — OpenAI only** | 1 | When we add Cohere/Voyage/Jina embedders to eval-lib, the backend will need a provider-aware factory. Out of scope. |
| 11 | **Frontend `pipeline-types.ts` must mirror new config types** | 3, 4, 5 | When we extend eval-lib's discriminated unions, the frontend type mirror must be updated. Out of scope (frontend follow-up). |

### No Breaking Changes to eval-lib Public API

All our plan changes are additive — extending unions, adding new files, adding new exports. The existing 4 preset factories and their config constants remain unchanged. `PipelineConfig` gains new optional members on existing unions.

### Techniques Considered but Not Included

These were evaluated during research (see `retriever-architecture-exploration.md`) and intentionally deferred:

| Technique | Rationale for Deferring |
|-----------|------------------------|
| **Proposition-based indexing** | Requires LLM to decompose text into atomic propositions before chunking. High cost, unclear benefit over contextual indexing for our use case. Reconsider after benchmarking contextual vs. plain. |
| **Query decomposition** | Splits a complex question into sub-questions. Overlaps significantly with multi-query; add as a `"decompose"` query strategy only if multi-query proves insufficient. |
| **Late chunking** | Requires model-specific architecture hooks (embedding at sequence level, then pooling per-chunk). Not feasible with standard embedding API calls. Would need a custom embedding pipeline. |
| **Sentence-window retrieval** | Semantically similar to expand-context refinement step. The `expand-context` step with `windowChars` achieves the same effect without requiring a separate index strategy. |
| **Auto-merging** | Adjacent chunk merging at retrieval time. The parent-child strategy provides a cleaner abstraction. Auto-merge can be added as a refinement step in a future iteration if parent-child proves too coarse. |
| **Distribution-based scoring** | Z-score normalization of scores before fusion. Adds complexity to the scoring pipeline. Can be a follow-up if weighted fusion proves sensitive to score distributions across different search strategies. |

### Follow-Up Work (Not in This Plan)

These are tracked for awareness but explicitly out of scope:

- **Backend provider factory**: Update `retrieverActions.ts` to instantiate the correct embedder/reranker based on `PipelineConfig` fields.
- **Backend index strategy support**: Update `startIndexing` to handle non-plain index strategies.
- **Backend full pipeline retrieval**: Update `retrieve` action to run the full `PipelineRetriever` pipeline.
- **Frontend type sync**: Update `pipeline-types.ts` to mirror new eval-lib config types.
- **Frontend UI for new strategies**: Add dropdowns for embedding model provider, query strategy, etc.
- **Cost/latency tracking**: Add per-stage timing and token-cost tracking to `PipelineRetriever` for experiment analytics. Not required for correctness — pure observability concern.
- **Proposition-based indexing**: If benchmarks show contextual indexing is insufficient, add `"proposition"` as an index strategy.
- **Query decomposition**: Add `"decompose"` query strategy if multi-query proves insufficient for complex questions.

---

## Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Goal | Full matrix sweep | Build breadth across all stages to maximize experiment grid |
| 2 | Embedding providers | All 4 (OpenAI, Cohere, Voyage, Jina) | Maximum coverage, each has unique features |
| 3 | LLM interface | Generic `PipelineLLM` + OpenAI default | Provider-agnostic, eval-lib stays clean |
| 4 | Async chunkers | New `AsyncPositionAwareChunker` interface | Clean separation, no breaking change to sync chunkers |
| 5 | Preset organization | Extend existing `PRESET_CONFIGS` map in `presets.ts` | Consistent with current pattern, avoids duplication |
| 6 | Scope | eval-lib only | Backend integration is a separate follow-up |
| 7 | Phasing | Vertical slices | Each slice unlocks runnable experiments |
| 8 | Provider SDKs | Official SDKs where available, plain `fetch` otherwise | Type-safe, auto-retry, vendor-maintained |
| 9 | Chunker embedder | Same as pipeline's search embedder | Simpler, Chroma research confirms this is optimal |
| 10 | Multi-query fusion | Fusion-of-fusions OK | Standard in multi-query retrieval literature |
| 11 | Testing | Unit tests with mocks only | No real API calls in CI |
| 12 | New provider entry points | One tsup entry point per provider with optional deps | Tree-shakeable, consistent with `embedders/openai` pattern |
| 13 | `k` in PipelineConfig | Keep `k` out of `PipelineConfig` | It's a runtime parameter passed to `retrieve(query, k)`, not a config property |
| 14 | MMR diversity metric | Content overlap ratio (character spans), not embedding cosine | Avoids storing/recomputing embeddings at refinement time; span overlap is already available via `spanOverlapChars()` |
| 15 | Score normalization | No distribution-based scoring (e.g., z-score normalization) in this plan | Adds complexity, can be a follow-up if weighted fusion proves sensitive to score distributions |

---

## Slice 1 — Provider Breadth

**Unlocks**: 4 embedders x 3 rerankers x 3 search strategies = **36 experiment configs**

This slice adds no new pipeline stages — just new providers that plug into the existing interfaces. Highest ROI starting point.

### 1a. Cohere Embedder

**File**: `packages/eval-lib/src/embedders/cohere.ts`

```typescript
// Implements: Embedder interface (from embedder.interface.ts)
// Package: cohere-ai (already in optionalDependencies)
// Pattern: follows OpenAIEmbedder — private constructor + static create() factory

interface CohereEmbedClient {
  embed(opts: {
    model: string;
    texts: string[];
    inputType: string;
    embeddingTypes: string[];
  }): Promise<{
    embeddings: { float: number[][] };
  }>;
}

export class CohereEmbedder implements Embedder {
  readonly name: string;     // "Cohere(embed-english-v3.0)"
  readonly dimension: number; // 1024

  private constructor(client: CohereEmbedClient, model: string);

  static async create(options?: {
    model?: string;  // "embed-english-v3.0" | "embed-multilingual-v3.0"
    apiKey?: string;
  }): Promise<CohereEmbedder>;

  // Key implementation details:
  // embed()      → inputType: "search_document"
  // embedQuery() → inputType: "search_query"
  // Always pass embeddingTypes: ["float"] to get numeric arrays (Cohere also supports int8/ubinary)
}
```

**Models**:
| Model | Dims | Max Tokens | Notes |
|-------|------|------------|-------|
| `embed-english-v3.0` (default) | 1024 | 512 | English-only |
| `embed-multilingual-v3.0` | 1024 | 512 | 100+ languages |

### 1b. Voyage Embedder

**File**: `packages/eval-lib/src/embedders/voyage.ts`

```typescript
// Implements: Embedder interface
// Package: plain fetch to https://api.voyageai.com/v1/embeddings
// Pattern: private constructor + static create() factory

export class VoyageEmbedder implements Embedder {
  readonly name: string;     // "Voyage(voyage-3.5)"
  readonly dimension: number; // 1024 (varies by model)

  static async create(options?: {
    model?: string;  // "voyage-3.5" | "voyage-3.5-lite" | "voyage-3" | "voyage-code-3"
    apiKey?: string; // defaults to process.env.VOYAGE_API_KEY
  }): Promise<VoyageEmbedder>;

  // Key implementation detail:
  // embed()      → input_type: "document"
  // embedQuery() → input_type: "query"
}
```

Uses plain `fetch` — no additional npm dependency required. The Voyage API is OpenAI-compatible with an added `input_type` field.

**Models**:
| Model | Dims | Max Tokens | Notes |
|-------|------|------------|-------|
| `voyage-3.5` (default) | 1024 | 32,000 | Best quality/$ |
| `voyage-3.5-lite` | 512 | 32,000 | Budget option |
| `voyage-3` | 1024 | 32,000 | General-purpose |
| `voyage-code-3` | 1024 | 32,000 | Code-optimized |

### 1c. Jina Embedder

**File**: `packages/eval-lib/src/embedders/jina.ts`

```typescript
// Implements: Embedder interface
// Package: plain fetch to https://api.jina.ai/v1/embeddings
// Pattern: private constructor + static create() factory

export class JinaEmbedder implements Embedder {
  readonly name: string;     // "Jina(jina-embeddings-v3)"
  readonly dimension: number; // 1024

  static async create(options?: {
    model?: string;     // "jina-embeddings-v3"
    apiKey?: string;    // defaults to process.env.JINA_API_KEY
    dimensions?: number; // Matryoshka: 32-1024, default 1024
  }): Promise<JinaEmbedder>;

  // Key implementation detail:
  // embed()      → task: "retrieval.passage"
  // embedQuery() → task: "retrieval.query"
}
```

Uses plain `fetch` — no additional npm dependency required.

### 1d. Update Cohere Reranker

**File**: `packages/eval-lib/src/rerankers/cohere.ts` (modify existing)

The current `CohereReranker.create()` accepts `{ model?: string }` and defaults to `"rerank-english-v3.0"`. Change the default to `"rerank-v3.5"` (latest) and document the supported models.

```typescript
// CHANGE: Default model from "rerank-english-v3.0" to "rerank-v3.5"
static async create(options?: {
  model?: string;  // "rerank-v3.5" (NEW default) | "rerank-english-v3.0" (old default)
}): Promise<CohereReranker>;
```

**Note**: This is a minor behavior change. If backward compatibility is critical, keep `"rerank-english-v3.0"` as default and just add documentation for the newer model. The factory already accepts any model string.

### 1e. Jina Reranker

**File**: `packages/eval-lib/src/rerankers/jina.ts`

```typescript
// Implements: Reranker interface (from reranker.interface.ts)
// Package: plain fetch to https://api.jina.ai/v1/rerank
// Pattern: follows CohereReranker — private constructor + static create() factory

export class JinaReranker implements Reranker {
  readonly name: string; // "Jina(jina-reranker-v2-base-multilingual)"

  static async create(options?: {
    model?: string;  // "jina-reranker-v2-base-multilingual"
    apiKey?: string; // defaults to process.env.JINA_API_KEY
  }): Promise<JinaReranker>;

  // API: POST https://api.jina.ai/v1/rerank
  // Request: { model, query, documents: string[], top_n }
  // Response: { results: [{ index, relevance_score }] }
  // Map response indices back to PositionAwareChunk[]
}
```

### 1f. Voyage Reranker

**File**: `packages/eval-lib/src/rerankers/voyage.ts`

```typescript
// Implements: Reranker interface
// Package: plain fetch to https://api.voyageai.com/v1/rerank
// Pattern: follows CohereReranker — private constructor + static create() factory

export class VoyageReranker implements Reranker {
  readonly name: string; // "Voyage(rerank-2.5)"

  static async create(options?: {
    model?: string;  // "rerank-2.5" | "rerank-2"
    apiKey?: string; // defaults to process.env.VOYAGE_API_KEY
  }): Promise<VoyageReranker>;

  // API: POST https://api.voyageai.com/v1/rerank
  // Request: { model, query, documents: string[], top_k }
  // Response: { data: [{ index, relevance_score }] }
}
```

### 1g. Package.json Changes

```json
{
  "optionalDependencies": {
    "cohere-ai": ">=7.0",
    "openai": ">=4.0"
  }
}
```

**No new npm dependencies.** Voyage and Jina use plain `fetch` (Node 18+ built-in). Cohere embedder reuses the existing `cohere-ai` optional dependency.

### 1h. tsup Entry Points

Add new entry points for each provider that has an optional dependency, following the existing `embedders/openai` and `rerankers/cohere` pattern:

```typescript
// tsup.config.ts — add to entry array:
"src/embedders/cohere.ts",                   // uses cohere-ai (already optional dep)
"src/embedders/voyage.ts",                   // uses plain fetch (no optional dep needed)
"src/embedders/jina.ts",                     // uses plain fetch (no optional dep needed)
"src/rerankers/jina.ts",                     // uses plain fetch
"src/rerankers/voyage.ts",                   // uses plain fetch
"src/retrievers/pipeline/llm-openai.ts",     // Slice 3 — uses openai (already optional dep)
```

And corresponding package.json exports:

```json
{
  "exports": {
    "./embedders/cohere": { "import": "...", "types": "..." },
    "./embedders/voyage": { "import": "...", "types": "..." },
    "./embedders/jina":   { "import": "...", "types": "..." },
    "./rerankers/jina":   { "import": "...", "types": "..." },
    "./rerankers/voyage": { "import": "...", "types": "..." },
    "./pipeline/llm-openai": { "import": "...", "types": "..." }
  }
}
```

**Design note**: Even though Voyage and Jina use plain `fetch` (no optional deps), separate entry points keep the main bundle lean and maintain the pattern for consistency.

### 1i. Index Exports

**File**: `packages/eval-lib/src/embedders/index.ts` — re-export `CohereEmbedder`, `VoyageEmbedder`, `JinaEmbedder`

**File**: `packages/eval-lib/src/rerankers/index.ts` — re-export `JinaReranker`, `VoyageReranker`

**File**: `packages/eval-lib/src/index.ts` — add to the existing Embedder and Reranker sections:

```typescript
// Embedder
export type { Embedder } from "./embedders/index.js";
export { OpenAIEmbedder, CohereEmbedder, VoyageEmbedder, JinaEmbedder } from "./embedders/index.js";

// Reranker
export type { Reranker } from "./rerankers/index.js";
export { JinaReranker, VoyageReranker } from "./rerankers/index.js";
// CohereReranker remains at "rag-evaluation-system/rerankers/cohere" for backward compat
```

---

## Slice 2 — Sync Chunkers

**Unlocks**: Previous 36 configs x 4 chunkers = **144 experiment configs**

All implement the existing `PositionAwareChunker` interface (synchronous). No new dependencies except `js-tiktoken` for the token chunker.

### 2a. Sentence Chunker

**File**: `packages/eval-lib/src/chunkers/sentence.ts`

```typescript
export interface SentenceChunkerOptions {
  maxChunkSize?: number;       // default 1000
  overlapSentences?: number;   // default 0
}

export class SentenceChunker implements PositionAwareChunker {
  readonly name: string; // "Sentence(size=1000)"

  constructor(options?: SentenceChunkerOptions);

  chunkWithPositions(doc: Document): PositionAwareChunk[];

  // Algorithm:
  // 1. Split text into sentences using regex
  //    Pattern: /(?<=[.!?])\s+(?=[A-Z])/ with abbreviation handling
  //    Track character offset of each sentence
  // 2. Group adjacent sentences until total length approaches maxChunkSize
  // 3. If overlapSentences > 0, keep last N sentences as overlap for next chunk
  // 4. Each chunk: start = first sentence start, end = last sentence end
  // 5. Generate chunk ID via generatePaChunkId(content, docId, start) — same as RecursiveCharacterChunker
}
```

### 2b. Token Chunker

**File**: `packages/eval-lib/src/chunkers/token.ts`

```typescript
export interface TokenChunkerOptions {
  maxTokens?: number;      // default 256
  overlapTokens?: number;  // default 0
  encoding?: string;       // default "cl100k_base"
}

export class TokenChunker implements PositionAwareChunker {
  readonly name: string; // "Token(tokens=256)"

  constructor(options?: TokenChunkerOptions);

  chunkWithPositions(doc: Document): PositionAwareChunk[];

  // Algorithm:
  // 1. Tokenize full text with js-tiktoken
  // 2. Group tokens into chunks of maxTokens with overlapTokens overlap
  // 3. Decode each group back to text
  // 4. Map token boundaries to character offsets for position tracking
  //    start = charOffset(firstToken), end = charOffset(lastToken) + lastTokenLength
  // 5. Generate chunk ID via generatePaChunkId(content, docId, start)
}
```

**New dependency**: `js-tiktoken` (add to `dependencies`, not optional — it's lightweight and wasm-based)

```json
{
  "dependencies": {
    "js-tiktoken": "^1.0",
    "minisearch": "^7.2.0",
    "zod": "^3.23"
  }
}
```

### 2c. Markdown Chunker

**File**: `packages/eval-lib/src/chunkers/markdown.ts`

```typescript
export interface MarkdownChunkerOptions {
  maxChunkSize?: number;          // default 1000
  headerLevels?: number[];        // default [1, 2, 3] (# ## ###)
  mergeSmallSections?: boolean;   // default true
}

export class MarkdownChunker implements PositionAwareChunker {
  readonly name: string; // "Markdown(size=1000)"

  constructor(options?: MarkdownChunkerOptions);

  chunkWithPositions(doc: Document): PositionAwareChunk[];

  // Algorithm:
  // 1. Scan text for header lines matching configured levels
  //    Pattern: /^(#{1,6})\s+(.+)$/gm
  // 2. Split into sections at header boundaries
  // 3. Each section includes its header as first line
  // 4. If mergeSmallSections: merge adjacent sections under maxChunkSize
  // 5. If section > maxChunkSize: sub-split with RecursiveCharacterChunker
  // 6. Position tracking: each section's start/end from regex match positions
  // 7. Generate chunk ID via generatePaChunkId(content, docId, start)
}
```

### 2d. Chunker Index Exports

**File**: `packages/eval-lib/src/chunkers/index.ts` — re-export all new chunkers:

```typescript
// Add to existing exports:
export { SentenceChunker } from "./sentence.js";
export type { SentenceChunkerOptions } from "./sentence.js";
export { TokenChunker } from "./token.js";
export type { TokenChunkerOptions } from "./token.js";
export { MarkdownChunker } from "./markdown.js";
export type { MarkdownChunkerOptions } from "./markdown.js";
```

**File**: `packages/eval-lib/src/index.ts` — add to Chunkers section:

```typescript
export type { ..., SentenceChunkerOptions, TokenChunkerOptions, MarkdownChunkerOptions } from "./chunkers/index.js";
export { ..., SentenceChunker, TokenChunker, MarkdownChunker } from "./chunkers/index.js";
```

---

## Slice 3 — Query Stage + LLM Interface

**Unlocks**: 144 configs x 5 query strategies = **720 experiment configs** (not all valid, ~400 interesting)

### 3a. PipelineLLM Interface

**File**: `packages/eval-lib/src/retrievers/pipeline/llm.interface.ts`

```typescript
/**
 * Minimal LLM interface for pipeline stages.
 * Provider-agnostic — callers provide their own implementation.
 */
export interface PipelineLLM {
  complete(prompt: string): Promise<string>;
}
```

### 3b. OpenAI LLM Implementation

**File**: `packages/eval-lib/src/retrievers/pipeline/llm-openai.ts`

```typescript
import type { PipelineLLM } from "./llm.interface.js";

// Structural typing — duck-typed against exactly the OpenAI surface area we use
// Follows the same pattern as OpenAIEmbedder and CohereReranker
interface OpenAIChatClient {
  chat: {
    completions: {
      create(opts: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
      }): Promise<{
        choices: Array<{ message: { content: string | null } }>;
      }>;
    };
  };
}

export class OpenAIPipelineLLM implements PipelineLLM {
  readonly name: string; // "OpenAI(gpt-4o-mini)"

  private constructor(client: OpenAIChatClient, model: string, temperature: number);

  static async create(options?: {
    model?: string;       // default "gpt-4o-mini"
    temperature?: number; // default 0.2
    apiKey?: string;
  }): Promise<OpenAIPipelineLLM>;

  complete(prompt: string): Promise<string>;
  // Uses: client.chat.completions.create({ model, messages: [{ role: "user", content: prompt }], temperature })
}
```

### 3c. PipelineRetrieverDeps Update

**File**: `packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts`

```typescript
export interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker;           // unchanged
  readonly embedder: Embedder;                       // unchanged
  readonly vectorStore?: VectorStore;                // unchanged
  readonly reranker?: Reranker;                      // unchanged
  readonly embeddingBatchSize?: number;              // unchanged
  readonly llm?: PipelineLLM;                        // NEW — required for hyde, multi-query, step-back, rewrite
}
```

Constructor validates: if config uses an LLM-requiring query strategy but no `llm` provided, throw:

```typescript
const llmStrategies = ["hyde", "multi-query", "step-back", "rewrite"];
if (llmStrategies.includes(queryConfig.strategy) && !deps.llm) {
  throw new Error(
    `PipelineRetriever: query strategy "${queryConfig.strategy}" requires an LLM but none was provided in deps.`
  );
}
```

### 3d. Query Stage Config Types

**File**: `packages/eval-lib/src/retrievers/pipeline/config.ts` — extend QueryConfig union:

```typescript
// EXISTING — keep as-is
export interface IdentityQueryConfig {
  readonly strategy: "identity";
}

// NEW
export interface HydeQueryConfig {
  readonly strategy: "hyde";
  readonly hydePrompt?: string;
  readonly numHypotheticalDocs?: number; // default 1
}

export interface MultiQueryConfig {
  readonly strategy: "multi-query";
  readonly numQueries?: number;           // default 3
  readonly generationPrompt?: string;
  readonly fusionMethod?: "rrf" | "weighted"; // default "rrf"
}

export interface StepBackQueryConfig {
  readonly strategy: "step-back";
  readonly stepBackPrompt?: string;
  readonly includeOriginal?: boolean;     // default true
}

export interface RewriteQueryConfig {
  readonly strategy: "rewrite";
  readonly rewritePrompt?: string;
}

// UPDATED — extend the union
export type QueryConfig =
  | IdentityQueryConfig
  | HydeQueryConfig
  | MultiQueryConfig
  | StepBackQueryConfig
  | RewriteQueryConfig;
```

### 3e. Multi-Query Pipeline Flow

The `retrieve()` method in `pipeline-retriever.ts` changes to handle multiple queries:

```typescript
async retrieve(query: string, k: number): Promise<PositionAwareChunk[]> {
  if (!this._initialized) {
    throw new Error("PipelineRetriever not initialized. Call init() first.");
  }

  // QUERY stage — always returns string[]
  const queries = await this._processQuery(query);

  // SEARCH stage — search for each query, fuse across queries
  let scoredResults: ScoredChunk[];
  if (queries.length === 1) {
    scoredResults = await this._searchStrategy.search(
      queries[0], k, this._searchStrategyDeps,
    );
  } else {
    // Run search for each query in parallel
    const perQueryResults = await Promise.all(
      queries.map(q => this._searchStrategy.search(q, k * 2, this._searchStrategyDeps))
    );
    // Fuse across queries using RRF
    scoredResults = this._fuseAcrossQueries(perQueryResults);
  }

  // REFINEMENT stage — unchanged
  scoredResults = await this._applyRefinements(query, scoredResults, k);
  return scoredResults.slice(0, k).map(({ chunk }) => chunk);
}

private async _processQuery(query: string): Promise<string[]> {
  const config = this._queryConfig;
  switch (config.strategy) {
    case "identity":
      return [query];
    case "hyde": {
      const prompt = config.hydePrompt ?? DEFAULT_HYDE_PROMPT;
      const n = config.numHypotheticalDocs ?? 1;
      if (n === 1) {
        const hypothetical = await this._llm!.complete(prompt + query);
        return [hypothetical];
      }
      // Multiple hypothetical docs: generate n, search each, fuse results
      const hypotheticals = await Promise.all(
        Array.from({ length: n }, () => this._llm!.complete(prompt + query))
      );
      return hypotheticals;
    }
    case "multi-query": {
      const n = config.numQueries ?? 3;
      const prompt = (config.generationPrompt ?? DEFAULT_MULTI_QUERY_PROMPT).replace("{n}", String(n));
      const variants = await this._llm!.complete(prompt + query);
      return parseVariants(variants, n); // parse newline-separated queries
    }
    case "step-back": {
      const prompt = config.stepBackPrompt ?? DEFAULT_STEP_BACK_PROMPT;
      const abstract = await this._llm!.complete(prompt + query);
      return config.includeOriginal !== false ? [query, abstract] : [abstract];
    }
    case "rewrite": {
      const prompt = config.rewritePrompt ?? DEFAULT_REWRITE_PROMPT;
      const rewritten = await this._llm!.complete(prompt + query);
      return [rewritten];
    }
  }
}

/** Fuse results from multiple queries using RRF. */
private _fuseAcrossQueries(perQueryResults: ScoredChunk[][]): ScoredChunk[] {
  // Reuse reciprocalRankFusion from search/fusion.ts
  // Each query's results are treated as a ranked list
  // RRF combines them: score = Σ 1/(60 + rank_in_list_i)
  // ...
}
```

### 3f. Default Prompts

**File**: `packages/eval-lib/src/retrievers/pipeline/query/prompts.ts`

```typescript
export const DEFAULT_HYDE_PROMPT =
  `Write a short passage (100-200 words) that would answer the following question. Do not include the question itself, just the answer passage.\n\nQuestion: `;

export const DEFAULT_MULTI_QUERY_PROMPT =
  `Generate {n} different search queries that would help find information to answer the following question. Return one query per line, no numbering.\n\nQuestion: `;

export const DEFAULT_STEP_BACK_PROMPT =
  `Given the following question, generate a more general, abstract version that would retrieve broader background knowledge. Return only the abstract question.\n\nOriginal question: `;

export const DEFAULT_REWRITE_PROMPT =
  `Rewrite the following question to be more precise and optimized for document retrieval. Return only the rewritten question.\n\nOriginal question: `;

// Used by Summary index strategy (Slice 4)
export const DEFAULT_SUMMARY_PROMPT =
  `Write a concise summary (2-3 sentences) of the following text passage. Focus on the key information that would help someone decide if this passage is relevant to their question.\n\nPassage: `;

// Used by Contextual index strategy (Slice 4)
export const DEFAULT_CONTEXT_PROMPT =
  `<document>\n{doc.content}\n</document>\n\nHere is the chunk we want to situate within the whole document:\n<chunk>\n{chunk.content}\n</chunk>\n\nPlease give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;
```

**Note**: `DEFAULT_CONTEXT_PROMPT` and `DEFAULT_SUMMARY_PROMPT` are referenced in section 4b (`computeIndexConfigHash`) and 4d/4e (index strategy implementations). They MUST be defined before those sections are implemented.

### 3g. Index Exports for Slice 3

**File**: `packages/eval-lib/src/retrievers/pipeline/query/index.ts` — new barrel:

```typescript
export { DEFAULT_HYDE_PROMPT, DEFAULT_MULTI_QUERY_PROMPT, DEFAULT_STEP_BACK_PROMPT, DEFAULT_REWRITE_PROMPT, DEFAULT_SUMMARY_PROMPT, DEFAULT_CONTEXT_PROMPT } from "./prompts.js";
```

**File**: `packages/eval-lib/src/retrievers/pipeline/index.ts` — add:

```typescript
export type { PipelineLLM } from "./llm.interface.js";
export { OpenAIPipelineLLM } from "./llm-openai.js";
export type {
  HydeQueryConfig,
  MultiQueryConfig,
  StepBackQueryConfig,
  RewriteQueryConfig,
} from "./config.js";
```

**File**: `packages/eval-lib/src/index.ts` — add to Pipeline Retriever section:

```typescript
export type {
  ...,
  PipelineLLM,
  HydeQueryConfig,
  MultiQueryConfig,
  StepBackQueryConfig,
  RewriteQueryConfig,
} from "./retrievers/index.js";
export {
  ...,
  OpenAIPipelineLLM,
} from "./retrievers/index.js";
```

---

## Slice 4 — Index Stage Strategies

**Unlocks**: Contextual + Summary + Parent-Child indexing. Multiplies experiment grid by ~4x index strategies.

### 4a. Index Config Types

**File**: `packages/eval-lib/src/retrievers/pipeline/config.ts` — convert `IndexConfig` from a single interface to a discriminated union:

```typescript
// RENAME existing to PlainIndexConfig
export interface PlainIndexConfig {
  readonly strategy: "plain";
  readonly chunkSize?: number;          // default 1000
  readonly chunkOverlap?: number;       // default 200
  readonly separators?: readonly string[];
  readonly embeddingModel?: string;
}

// NEW
export interface ContextualIndexConfig {
  readonly strategy: "contextual";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly embeddingModel?: string;
  readonly contextPrompt?: string;      // custom prompt for situating context
  readonly concurrency?: number;        // parallel LLM calls, default 5
}

export interface SummaryIndexConfig {
  readonly strategy: "summary";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly embeddingModel?: string;
  readonly summaryPrompt?: string;
  readonly concurrency?: number;
}

export interface ParentChildIndexConfig {
  readonly strategy: "parent-child";
  readonly childChunkSize?: number;     // default 200
  readonly parentChunkSize?: number;    // default 1000
  readonly childOverlap?: number;       // default 0
  readonly parentOverlap?: number;      // default 100
  readonly embeddingModel?: string;
}

// UPDATED — now a discriminated union
export type IndexConfig =
  | PlainIndexConfig
  | ContextualIndexConfig
  | SummaryIndexConfig
  | ParentChildIndexConfig;

// DEFAULT unchanged — still "plain"
export const DEFAULT_INDEX_CONFIG: PlainIndexConfig = {
  strategy: "plain",
  chunkSize: 1000,
  chunkOverlap: 200,
  embeddingModel: "text-embedding-3-small",
} as const;
```

**Breaking change note**: `IndexConfig` was `{ strategy: "plain"; ... }` — code that pattern-matched on `config.index.strategy === "plain"` still works. Code that assumed `IndexConfig` always has `chunkSize` etc. will need a discriminated switch.

### 4b. Update computeIndexConfigHash

**File**: `packages/eval-lib/src/retrievers/pipeline/config.ts`

Replace the concrete `IndexHashPayload` interface with strategy-aware hashing:

```typescript
// REMOVE:
// interface IndexHashPayload { ... }

// REPLACE computeIndexConfigHash with:
export function computeIndexConfigHash(config: PipelineConfig): string {
  const index = config.index ?? DEFAULT_INDEX_CONFIG;

  let payload: Record<string, unknown>;

  switch (index.strategy) {
    case "plain":
      payload = {
        strategy: "plain",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        separators: index.separators,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
      };
      break;
    case "contextual":
      payload = {
        strategy: "contextual",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
        contextPrompt: index.contextPrompt ?? DEFAULT_CONTEXT_PROMPT,
        // concurrency does NOT affect output — excluded from hash
      };
      break;
    case "summary":
      payload = {
        strategy: "summary",
        chunkSize: index.chunkSize ?? 1000,
        chunkOverlap: index.chunkOverlap ?? 200,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
        summaryPrompt: index.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT,
      };
      break;
    case "parent-child":
      payload = {
        strategy: "parent-child",
        childChunkSize: index.childChunkSize ?? 200,
        parentChunkSize: index.parentChunkSize ?? 1000,
        childOverlap: index.childOverlap ?? 0,
        parentOverlap: index.parentOverlap ?? 100,
        embeddingModel: index.embeddingModel ?? "text-embedding-3-small",
      };
      break;
  }

  const json = stableStringify(payload);
  return createHash("sha256").update(json).digest("hex");
}
```

**Key principle**: Fields that affect output (prompts, sizes, models) go in the hash. Fields that affect performance but not output (concurrency, batchSize) do NOT.

### 4c. Update computeRetrieverConfigHash

The existing `computeRetrieverConfigHash` resolves defaults for the index portion using `DEFAULT_INDEX_CONFIG`. When `IndexConfig` becomes a union, the index portion of the hash payload must use the same resolved values as `computeIndexConfigHash`:

```typescript
export function computeRetrieverConfigHash(config: PipelineConfig, k: number): string {
  const query = config.query ?? DEFAULT_QUERY_CONFIG;
  const search = config.search ?? DEFAULT_SEARCH_CONFIG;
  const refinement = config.refinement ?? [];

  // Reuse computeIndexConfigHash for the index portion to stay consistent
  const indexHash = computeIndexConfigHash(config);

  const payload = {
    indexHash,
    k,
    query,
    refinement,
    search,
  };

  const json = stableStringify(payload);
  return createHash("sha256").update(json).digest("hex");
}
```

### 4d. Contextual Indexing Implementation

In `pipeline-retriever.ts`, within `init()`:

```
Algorithm:
  1. Chunk all documents normally (using configured chunker)
  2. For each chunk, in parallel batches of `concurrency`:
     a. Send to LLM: contextPrompt + full document text + chunk text
     b. LLM returns ~50-100 tokens of situating context
     c. Create enriched text: context + "\n\n" + chunk.content
  3. Embed the enriched text (not the raw chunk)
  4. Store in vector store: (enriched_embedding, original_chunk)
  5. The stored chunk retains its original content and positions
```

Default context prompt:

```
"<document>\n{doc.content}\n</document>\n\nHere is the chunk we want to situate within the whole document:\n<chunk>\n{chunk.content}\n</chunk>\n\nPlease give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else."
```

Uses `mapWithConcurrency` from `utils/concurrency.ts` (already exists in the codebase) to limit parallel LLM calls.

### 4e. Summary Indexing Implementation

```
Algorithm:
  1. Chunk all documents normally
  2. For each chunk, in parallel batches:
     a. Send to LLM: summaryPrompt + chunk text
     b. LLM returns a concise summary
  3. Embed the summaries
  4. Store mapping: Map<chunkId, { summaryEmbedding, originalChunk }>
  5. At search time:
     a. Embed query
     b. Search summary embeddings
     c. Return the original chunks (with original positions)
```

**Instance state**: `_summaryToChunkMap: Map<string, PositionAwareChunk>` — maps summary vector store entries back to original chunks.

### 4f. Parent-Child Indexing Implementation

```
Algorithm:
  1. Chunk documents at parent granularity (parentChunkSize, parentOverlap)
  2. Chunk documents at child granularity (childChunkSize, childOverlap)
  3. Build parent-child relationships:
     For each child, find the parent where child.start >= parent.start && child.end <= parent.end
  4. Embed and index child chunks only
  5. At search time:
     a. Search child chunks
     b. For each matched child, look up its parent
     c. Deduplicate parents
     d. Return unique parent chunks

  Position tracking: Parents are PositionAwareChunks with their own start/end.
```

**Instance state**: `_childToParent: Map<PositionAwareChunkId, PositionAwareChunk>`

### 4g. LLM Validation for Index Strategies

Constructor must validate LLM requirement for index strategies too:

```typescript
const llmIndexStrategies = ["contextual", "summary"];
const indexStrategy = (config.index ?? DEFAULT_INDEX_CONFIG).strategy;
if (llmIndexStrategies.includes(indexStrategy) && !deps.llm) {
  throw new Error(
    `PipelineRetriever: index strategy "${indexStrategy}" requires an LLM but none was provided in deps.`
  );
}
```

---

## Slice 5 — Refinement + Async Chunkers

### 5a. New Refinement Steps

#### Dedup (`type: "dedup"`)

**File**: `packages/eval-lib/src/retrievers/pipeline/refinement/dedup.ts`

```typescript
export interface DedupRefinementStep {
  readonly type: "dedup";
  readonly method?: "exact" | "overlap";    // default "exact"
  readonly overlapThreshold?: number;       // default 0.5, for "overlap" method
}

export function applyDedup(
  results: readonly ScoredChunk[],
  method: "exact" | "overlap",
  overlapThreshold: number,
): ScoredChunk[];

// "exact": hash chunk.content, keep first (highest-scored) occurrence
// "overlap": for chunks from same docId, compute character span overlap ratio.
//   If overlap / min(chunk1.length, chunk2.length) > threshold, keep higher-scored.
```

#### MMR (`type: "mmr"`)

**File**: `packages/eval-lib/src/retrievers/pipeline/refinement/mmr.ts`

```typescript
export interface MmrRefinementStep {
  readonly type: "mmr";
  readonly lambda?: number; // 0-1, default 0.7 (0=max diversity, 1=max relevance)
}

export function applyMmr(
  results: readonly ScoredChunk[],
  k: number,
  lambda: number,
): ScoredChunk[];

// Algorithm:
// 1. Start with empty selected set S
// 2. For each iteration up to k:
//    For each candidate c not in S:
//      relevance = c.score (from search stage)
//      maxSimilarity = max content overlap ratio between c and any chunk in S
//      mmrScore = lambda * relevance - (1-lambda) * maxSimilarity
//    Add highest mmrScore candidate to S
// 3. Return S
//
// Uses content overlap as diversity proxy (not embeddings).
// Content overlap ratio = |intersection of character spans| / min(len(a), len(b))
// For chunks from different documents, overlap = 0 (always diverse).
// Reuses spanOverlapChars() from utils/span.ts.
```

#### Expand-Context (`type: "expand-context"`)

**File**: `packages/eval-lib/src/retrievers/pipeline/refinement/expand-context.ts`

```typescript
export interface ExpandContextRefinementStep {
  readonly type: "expand-context";
  readonly windowChars?: number; // default 500
}

export function applyExpandContext(
  results: readonly ScoredChunk[],
  corpus: Corpus,
  windowChars: number,
): ScoredChunk[];

// For each chunk:
//   Find the source document in corpus by docId
//   newStart = max(0, chunk.start - windowChars)
//   newEnd = min(doc.content.length, chunk.end + windowChars)
//   Return new PositionAwareChunk with expanded span and content
//
// Requires corpus reference (stored during init()).
```

**Pipeline change**: Store `this._corpus = corpus` during `init()`. The expand-context refinement step receives it.

```typescript
// In pipeline-retriever.ts:
private _corpus: Corpus | null = null;

async init(corpus: Corpus): Promise<void> {
  this._corpus = corpus;
  // ... rest of init
}
```

#### Config Type Update

```typescript
export type RefinementStepConfig =
  | RerankRefinementStep       // existing
  | ThresholdRefinementStep    // existing
  | DedupRefinementStep        // new
  | MmrRefinementStep          // new
  | ExpandContextRefinementStep; // new
```

#### Update _applyRefinements in pipeline-retriever.ts

```typescript
private async _applyRefinements(
  query: string,
  results: ScoredChunk[],
  k: number,
): Promise<ScoredChunk[]> {
  let current = results;

  for (const step of this._refinementSteps) {
    switch (step.type) {
      case "rerank": {
        // existing — unchanged
        const chunks = current.map(({ chunk }) => chunk);
        const reranked = await this._reranker!.rerank(query, chunks, k);
        current = assignRankScores(reranked);
        break;
      }
      case "threshold": {
        // existing — unchanged
        current = applyThresholdFilter(current, step.minScore);
        break;
      }
      case "dedup": {
        current = applyDedup(current, step.method ?? "exact", step.overlapThreshold ?? 0.5);
        break;
      }
      case "mmr": {
        current = applyMmr(current, k, step.lambda ?? 0.7);
        break;
      }
      case "expand-context": {
        if (!this._corpus) throw new Error("expand-context requires corpus");
        current = applyExpandContext(current, this._corpus, step.windowChars ?? 500);
        break;
      }
      default:
        throw new Error(`Unknown refinement step type: ${(step as any).type}`);
    }
  }

  return current;
}
```

### 5b. AsyncPositionAwareChunker Interface

**File**: `packages/eval-lib/src/chunkers/chunker.interface.ts` — add:

```typescript
/**
 * Async variant of PositionAwareChunker for chunkers that need
 * async operations (embedding, LLM calls) during chunking.
 */
export interface AsyncPositionAwareChunker {
  readonly name: string;
  chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]>;
}

/** Type guard for async chunkers. */
export function isAsyncPositionAwareChunker(
  chunker: PositionAwareChunker | AsyncPositionAwareChunker,
): chunker is AsyncPositionAwareChunker {
  // Test by invoking with a minimal doc and checking if result is a Promise
  // OR: use a discriminator property
  return "async" in chunker && (chunker as any).async === true;
}
```

**Pipeline change**: In `pipeline-retriever.ts`, `init()` must handle both sync and async chunkers:

```typescript
// PipelineRetrieverDeps updated:
export interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker | AsyncPositionAwareChunker;  // UPDATED
  // ... rest unchanged
}

// In init():
for (const doc of corpus.documents) {
  const docChunks = isAsyncPositionAwareChunker(this._chunker)
    ? await this._chunker.chunkWithPositions(doc)
    : this._chunker.chunkWithPositions(doc);
  chunks.push(...docChunks);
}
```

### 5c. Semantic Chunker

**File**: `packages/eval-lib/src/chunkers/semantic.ts`

```typescript
export interface SemanticChunkerOptions {
  percentileThreshold?: number; // default 95 (split where similarity < 95th percentile)
  maxChunkSize?: number;        // default 2000
}

export class SemanticChunker implements AsyncPositionAwareChunker {
  readonly name: string; // "Semantic(threshold=95)"
  readonly async = true as const; // discriminator for isAsyncPositionAwareChunker

  constructor(embedder: Embedder, options?: SemanticChunkerOptions);

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]>;

  // Algorithm (Kamradt method):
  // 1. Split text into sentences (reuse regex from SentenceChunker)
  // 2. Embed all sentences via this.embedder.embed(sentences)
  // 3. Compute cosine similarity between consecutive sentence embeddings
  //    Uses cosineSimilarity() from utils/similarity.ts (NEW — see below)
  // 4. Find Nth percentile of all similarities
  // 5. Place chunk boundaries where similarity < percentile threshold
  // 6. Merge sentences within boundaries into chunks
  // 7. If any chunk > maxChunkSize, sub-split with RecursiveCharacterChunker
  // 8. Track positions from sentence offsets
}
```

### 5d. Cluster Semantic Chunker

**File**: `packages/eval-lib/src/chunkers/cluster-semantic.ts`

```typescript
export interface ClusterSemanticChunkerOptions {
  maxChunkSize?: number;  // default 400
  segmentSize?: number;   // default 50 (chars per micro-segment)
}

export class ClusterSemanticChunker implements AsyncPositionAwareChunker {
  readonly name: string; // "ClusterSemantic(size=400)"
  readonly async = true as const;

  constructor(embedder: Embedder, options?: ClusterSemanticChunkerOptions);

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]>;

  // Algorithm (dynamic programming — Chroma's approach):
  // 1. Split text into micro-segments of ~segmentSize chars
  //    Track each segment's character offset
  // 2. Embed all segments via this.embedder.embed(segments)
  // 3. Compute pairwise cosine similarity matrix
  // 4. DP: dp[i] = max total intra-chunk similarity for segments[0..i]
  //    For each i, try all valid previous breakpoints j where
  //    sum of segment lengths in [j..i] <= maxChunkSize:
  //      similarity(j, i) = avg pairwise cosine of embeddings[j..i]
  //      dp[i] = max(dp[j-1] + similarity(j, i))
  // 5. Backtrack to find optimal chunk boundaries
  // 6. Each chunk = concatenation of adjacent segments
  //    start = first segment start, end = last segment end
  //
  // Complexity: O(n²) where n = number of segments. Acceptable for
  // typical documents (e.g., 10K chars / 50 = 200 segments).
  //
  // Reference: github.com/brandonstarxel/chunking_evaluation
}
```

### 5e. cosineSimilarity Utility

**File**: `packages/eval-lib/src/utils/similarity.ts`

```typescript
/**
 * Compute cosine similarity between two vectors of the same length.
 * Returns a value in [-1, 1].
 */
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

Re-export from `packages/eval-lib/src/utils/index.ts`. Used by `SemanticChunker` (5c) and `ClusterSemanticChunker` (5d).

### 5f. LLM Semantic Chunker

**File**: `packages/eval-lib/src/chunkers/llm-semantic.ts`

```typescript
export interface LLMSemanticChunkerOptions {
  segmentSize?: number;  // default 50 (chars per segment)
  batchSize?: number;    // default 800 (chars per LLM batch)
}

export class LLMSemanticChunker implements AsyncPositionAwareChunker {
  readonly name: string; // "LLMSemantic"
  readonly async = true as const;

  constructor(llm: PipelineLLM, options?: LLMSemanticChunkerOptions);

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]>;

  // Algorithm (based on Chroma's LLMSemanticChunker):
  // 1. Split text into ~segmentSize char segments
  //    Track each segment's character offset
  // 2. Wrap each segment: <|start_chunk_N|> ... <|end_chunk_N|>
  // 3. Group wrapped segments into batches of ~batchSize total chars
  // 4. For each batch, prompt LLM:
  //    "Identify thematic boundaries in the following tagged text.
  //     Return split points in format: split_after: X, Y"
  // 5. Validate response (ascending order, within range)
  // 6. Merge segments based on split points
  // 7. Position tracking from segment offsets
  //
  // Note: Slow and expensive. Best for small-corpus experiments.
  // Reference: github.com/brandonstarxel/chunking_evaluation
}
```

---

## Slice 6 — Named Presets

**File**: `packages/eval-lib/src/experiments/presets.ts` — extend the existing pattern.

The current file has individual config constants + a `PRESET_CONFIGS` map + `createPresetRetriever` factory. We extend this by:

1. Adding new config constants
2. Adding them to the `PRESET_CONFIGS` map
3. Widening the factory's `presetName` union type

```typescript
// === EXISTING (keep exactly as-is) ===

export const BASELINE_VECTOR_RAG_CONFIG: PipelineConfig = {
  name: "baseline-vector-rag",
  index: { strategy: "plain" },
  search: { strategy: "dense" },
};

export const BM25_CONFIG: PipelineConfig = { ... };
export const HYBRID_CONFIG: PipelineConfig = { ... };
export const HYBRID_RERANKED_CONFIG: PipelineConfig = { ... };

// === NEW PRESET CONFIGS ===

export const DENSE_RERANKED_CONFIG: PipelineConfig = {
  name: "dense-reranked",
  index: { strategy: "plain" },
  search: { strategy: "dense" },
  refinement: [{ type: "rerank" }],
};

export const BM25_RERANKED_CONFIG: PipelineConfig = {
  name: "bm25-reranked",
  index: { strategy: "plain" },
  search: { strategy: "bm25" },
  refinement: [{ type: "rerank" }],
};

export const HYBRID_RRF_CONFIG: PipelineConfig = {
  name: "hybrid-rrf",
  index: { strategy: "plain" },
  search: { strategy: "hybrid", fusionMethod: "rrf", candidateMultiplier: 4 },
};

export const HYBRID_RRF_RERANKED_CONFIG: PipelineConfig = {
  name: "hybrid-rrf-reranked",
  index: { strategy: "plain" },
  search: { strategy: "hybrid", fusionMethod: "rrf", candidateMultiplier: 4 },
  refinement: [{ type: "rerank" }],
};

export const OPENCLAW_STYLE_CONFIG: PipelineConfig = {
  name: "openclaw-style",
  index: { strategy: "plain", chunkSize: 400, chunkOverlap: 80 },
  search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, fusionMethod: "weighted", candidateMultiplier: 4 },
  refinement: [{ type: "threshold", minScore: 0.35 }],
};

export const HYDE_DENSE_CONFIG: PipelineConfig = {
  name: "hyde-dense",
  index: { strategy: "plain" },
  query: { strategy: "hyde" },
  search: { strategy: "dense" },
};

export const HYDE_HYBRID_CONFIG: PipelineConfig = {
  name: "hyde-hybrid",
  index: { strategy: "plain" },
  query: { strategy: "hyde" },
  search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
};

export const HYDE_HYBRID_RERANKED_CONFIG: PipelineConfig = {
  name: "hyde-hybrid-reranked",
  index: { strategy: "plain" },
  query: { strategy: "hyde" },
  search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
  refinement: [{ type: "rerank" }],
};

export const MULTI_QUERY_DENSE_CONFIG: PipelineConfig = {
  name: "multi-query-dense",
  index: { strategy: "plain" },
  query: { strategy: "multi-query", numQueries: 3 },
  search: { strategy: "dense" },
  refinement: [{ type: "dedup" }],
};

export const MULTI_QUERY_HYBRID_CONFIG: PipelineConfig = {
  name: "multi-query-hybrid",
  index: { strategy: "plain" },
  query: { strategy: "multi-query", numQueries: 3 },
  search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
  refinement: [{ type: "dedup" }, { type: "rerank" }],
};

export const CONTEXTUAL_DENSE_CONFIG: PipelineConfig = {
  name: "contextual-dense",
  index: { strategy: "contextual" },
  search: { strategy: "dense" },
};

export const CONTEXTUAL_HYBRID_CONFIG: PipelineConfig = {
  name: "contextual-hybrid",
  index: { strategy: "contextual" },
  search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
};

export const ANTHROPIC_BEST_CONFIG: PipelineConfig = {
  name: "anthropic-best",
  index: { strategy: "contextual" },
  search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
  refinement: [{ type: "rerank" }],
};

export const PARENT_CHILD_DENSE_CONFIG: PipelineConfig = {
  name: "parent-child-dense",
  index: { strategy: "parent-child", childChunkSize: 200, parentChunkSize: 1000 },
  search: { strategy: "dense" },
};

export const DIVERSE_HYBRID_CONFIG: PipelineConfig = {
  name: "diverse-hybrid",
  index: { strategy: "plain" },
  search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
  refinement: [{ type: "mmr", lambda: 0.5 }],
};

export const STEP_BACK_HYBRID_CONFIG: PipelineConfig = {
  name: "step-back-hybrid",
  index: { strategy: "plain" },
  query: { strategy: "step-back", includeOriginal: true },
  search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
  refinement: [{ type: "dedup" }, { type: "rerank" }],
};

export const PREMIUM_CONFIG: PipelineConfig = {
  name: "premium",
  index: { strategy: "contextual" },
  query: { strategy: "multi-query", numQueries: 3 },
  search: { strategy: "hybrid", candidateMultiplier: 5 },
  refinement: [{ type: "dedup" }, { type: "rerank" }, { type: "threshold", minScore: 0.3 }],
};

export const SUMMARY_DENSE_CONFIG: PipelineConfig = {
  name: "summary-dense",
  index: { strategy: "summary" },
  search: { strategy: "dense" },
};

export const REWRITE_HYBRID_CONFIG: PipelineConfig = {
  name: "rewrite-hybrid",
  index: { strategy: "plain" },
  query: { strategy: "rewrite" },
  search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
};

export const REWRITE_HYBRID_RERANKED_CONFIG: PipelineConfig = {
  name: "rewrite-hybrid-reranked",
  index: { strategy: "plain" },
  query: { strategy: "rewrite" },
  search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
  refinement: [{ type: "rerank" }],
};

// === UPDATED PRESET MAP ===

const PRESET_CONFIGS = {
  // Existing
  "baseline-vector-rag": BASELINE_VECTOR_RAG_CONFIG,
  "bm25": BM25_CONFIG,
  "hybrid": HYBRID_CONFIG,
  "hybrid-reranked": HYBRID_RERANKED_CONFIG,
  // New — Dense variants
  "dense-reranked": DENSE_RERANKED_CONFIG,
  // New — BM25 variants
  "bm25-reranked": BM25_RERANKED_CONFIG,
  // New — Hybrid variants
  "hybrid-rrf": HYBRID_RRF_CONFIG,
  "hybrid-rrf-reranked": HYBRID_RRF_RERANKED_CONFIG,
  // New — OpenClaw-style
  "openclaw-style": OPENCLAW_STYLE_CONFIG,
  // New — HyDE variants
  "hyde-dense": HYDE_DENSE_CONFIG,
  "hyde-hybrid": HYDE_HYBRID_CONFIG,
  "hyde-hybrid-reranked": HYDE_HYBRID_RERANKED_CONFIG,
  // New — Multi-Query variants
  "multi-query-dense": MULTI_QUERY_DENSE_CONFIG,
  "multi-query-hybrid": MULTI_QUERY_HYBRID_CONFIG,
  // New — Contextual variants (Anthropic's approach)
  "contextual-dense": CONTEXTUAL_DENSE_CONFIG,
  "contextual-hybrid": CONTEXTUAL_HYBRID_CONFIG,
  "anthropic-best": ANTHROPIC_BEST_CONFIG,
  // New — Parent-Child
  "parent-child-dense": PARENT_CHILD_DENSE_CONFIG,
  // New — Diversity-focused
  "diverse-hybrid": DIVERSE_HYBRID_CONFIG,
  // New — Step-Back
  "step-back-hybrid": STEP_BACK_HYBRID_CONFIG,
  // New — Rewrite variants
  "rewrite-hybrid": REWRITE_HYBRID_CONFIG,
  "rewrite-hybrid-reranked": REWRITE_HYBRID_RERANKED_CONFIG,
  // New — Summary index
  "summary-dense": SUMMARY_DENSE_CONFIG,
  // New — Premium (everything)
  "premium": PREMIUM_CONFIG,
} as const;

export type PresetName = keyof typeof PRESET_CONFIGS;

// createPresetRetriever signature UPDATED to accept wider union:
export function createPresetRetriever(
  presetName: PresetName,
  deps: PipelinePresetDeps,
  overrides?: Partial<PipelineConfig>,
): PipelineRetriever;
```

**Note on PipelinePresetDeps**: Presets that require LLM (hyde-*, multi-query-*, step-back-*, contextual-*, anthropic-best, premium) need the caller to also provide `llm` in deps. The `PipelinePresetDeps` interface should be extended:

```typescript
export interface PipelinePresetDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
  readonly llm?: PipelineLLM;  // NEW — required for LLM-based strategies
}
```

The constructor validation in `PipelineRetriever` catches the missing `llm` case.

---

## Infrastructure Changes Summary

All infrastructure changes needed across slices, consolidated.

### Note on `k` and PipelineConfig

The eval-lib `PipelineConfig` intentionally does NOT include `k` — it's a runtime parameter passed to `retrieve(query, k)`, not a pipeline config property. The backend stores `k` as `defaultK` on the retriever entity. The `computeRetrieverConfigHash(config, k)` function accepts `k` as a separate parameter.

### pipeline-retriever.ts Changes

| Change | Slice | Description |
|--------|-------|-------------|
| `PipelineRetrieverDeps.llm` | 3 | Optional `PipelineLLM` field |
| `PipelineRetrieverDeps.chunker` type | 5 | Accept `PositionAwareChunker \| AsyncPositionAwareChunker` |
| `_processQuery()` returns `string[]` | 3 | Always array, identity returns `[query]` |
| Multi-query search flow | 3 | Search each query, fuse across with RRF |
| `_corpus` stored during `init()` | 5 | For expand-context refinement |
| Index stage switch on strategy | 4 | Contextual, summary, parent-child |
| Summary→chunk mapping | 4 | Instance state for summary indexing |
| Child→parent mapping | 4 | Instance state for parent-child indexing |
| New refinement step handling | 5 | dedup, mmr, expand-context |
| LLM validation in constructor | 3, 4 | Throw if LLM-requiring strategy has no llm |

### config.ts Changes

| Change | Slice | Description |
|--------|-------|-------------|
| `PlainIndexConfig` extracted | 4 | Renamed from `IndexConfig` |
| `IndexConfig` discriminated union | 4 | Plain \| Contextual \| Summary \| ParentChild |
| `QueryConfig` union extension | 3 | + Hyde \| MultiQuery \| StepBack \| Rewrite |
| `RefinementStepConfig` union extension | 5 | + Dedup \| Mmr \| ExpandContext |
| `IndexHashPayload` removed | 4 | Replaced by strategy-aware hashing |
| `computeIndexConfigHash` rewrite | 4 | Strategy-aware with discriminated switch |
| `computeRetrieverConfigHash` update | 4 | Delegates to `computeIndexConfigHash` for consistency |

### presets.ts Changes

| Change | Slice | Description |
|--------|-------|-------------|
| `PipelinePresetDeps.llm` | 6 | Optional `PipelineLLM` field |
| 20 new config constants | 6 | One per new preset |
| `PRESET_CONFIGS` map expanded | 6 | 4 → 24 entries |
| `PresetName` type exported | 6 | Union of all preset keys |

---

## File Inventory

### New Files

```
packages/eval-lib/src/
├── embedders/
│   ├── cohere.ts                         # Slice 1
│   ├── voyage.ts                         # Slice 1
│   └── jina.ts                           # Slice 1
├── rerankers/
│   ├── jina.ts                           # Slice 1
│   └── voyage.ts                         # Slice 1
├── chunkers/
│   ├── sentence.ts                       # Slice 2
│   ├── token.ts                          # Slice 2
│   ├── markdown.ts                       # Slice 2
│   ├── semantic.ts                       # Slice 5
│   ├── cluster-semantic.ts               # Slice 5
│   └── llm-semantic.ts                   # Slice 5
├── utils/
│   └── similarity.ts                     # Slice 5 — cosineSimilarity()
├── retrievers/pipeline/
│   ├── llm.interface.ts                  # Slice 3
│   ├── llm-openai.ts                     # Slice 3
│   ├── query/
│   │   ├── prompts.ts                    # Slice 3
│   │   └── index.ts                      # Slice 3 — barrel re-exports
│   └── refinement/
│       ├── dedup.ts                      # Slice 5
│       ├── mmr.ts                        # Slice 5
│       └── expand-context.ts             # Slice 5
```

### New Test Files

```
packages/eval-lib/tests/
├── unit/embedders/
│   ├── cohere.test.ts                    # Slice 1
│   ├── voyage.test.ts                    # Slice 1
│   └── jina.test.ts                      # Slice 1
├── unit/rerankers/
│   ├── jina.test.ts                      # Slice 1
│   └── voyage.test.ts                    # Slice 1
├── unit/chunkers/
│   ├── sentence.test.ts                  # Slice 2
│   ├── token.test.ts                     # Slice 2
│   ├── markdown.test.ts                  # Slice 2
│   ├── semantic.test.ts                  # Slice 5
│   ├── cluster-semantic.test.ts          # Slice 5
│   └── llm-semantic.test.ts              # Slice 5
├── unit/retrievers/pipeline/
│   ├── query-strategies.test.ts          # Slice 3
│   ├── index-strategies.test.ts          # Slice 4
│   └── refinement/
│       ├── dedup.test.ts                 # Slice 5
│       ├── mmr.test.ts                   # Slice 5
│       └── expand-context.test.ts        # Slice 5
├── unit/utils/
│   └── similarity.test.ts               # Slice 5 — cosineSimilarity
├── unit/retrievers/pipeline/
│   └── config-hash.test.ts              # Slice 4 — hash stability tests
└── unit/experiments/
    └── presets.test.ts                   # Slice 6 (extends existing)
```

### Modified Files

```
packages/eval-lib/src/
├── embedders/index.ts                    # Re-exports (Slice 1)
├── rerankers/
│   ├── cohere.ts                         # Model default update (Slice 1)
│   └── index.ts                          # Re-exports (Slice 1)
├── chunkers/
│   ├── chunker.interface.ts              # AsyncPositionAwareChunker (Slice 5)
│   └── index.ts                          # Re-exports (Slice 2, 5)
├── retrievers/pipeline/
│   ├── config.ts                         # Type unions, hash functions (Slice 3, 4, 5)
│   ├── pipeline-retriever.ts             # Core pipeline (Slice 3, 4, 5)
│   ├── index.ts                          # Re-exports (Slice 3, 4, 5)
│   ├── query/
│   │   └── index.ts                      # Barrel re-exports (Slice 3)
│   └── refinement/
│       └── index.ts                      # Re-exports dedup, mmr, expand-context (Slice 5)
├── utils/
│   └── index.ts                          # Re-export cosineSimilarity (Slice 5)
├── experiments/
│   ├── presets.ts                        # New preset configs (Slice 6)
│   └── index.ts                          # Re-exports (Slice 6)
└── index.ts                              # Root barrel exports (Slice 1-6)

packages/eval-lib/
├── package.json                          # New dependencies (Slice 2)
└── tsup.config.ts                        # New entry points (Slice 1)
```

---

## Testing Strategy

**Approach**: Unit tests with mocks only. No real API calls in tests. Follow existing patterns from the 24 test files already in the repo.

### Provider Tests (Embedders + Rerankers)

```typescript
// Pattern: mock the SDK client/fetch, verify correct API calls
// Follow the existing CohereReranker and OpenAIEmbedder test patterns

// Example: CohereEmbedder test
describe("CohereEmbedder", () => {
  it("should call embed with inputType search_document for embed()", async () => {
    const mockClient = {
      embed: vi.fn().mockResolvedValue({
        embeddings: { float: [[0.1, 0.2, ...]] },
      }),
    };
    const embedder = new CohereEmbedder(mockClient, "embed-english-v3.0");

    await embedder.embed(["test text"]);

    expect(mockClient.embed).toHaveBeenCalledWith(
      expect.objectContaining({ inputType: "search_document" })
    );
  });

  it("should call embed with inputType search_query for embedQuery()", async () => {
    // ... inputType: "search_query"
  });
});
```

### Chunker Tests

```typescript
// Pattern: verify positions match source text, chunk sizes respect limits
// Follow the existing chunkers.test.ts pattern

describe("SentenceChunker", () => {
  it("should produce chunks whose start/end positions match source text", () => {
    const doc = createDocument({
      id: DocumentId("d1"),
      content: "First sentence. Second sentence. Third sentence.",
      metadata: {},
    });
    const chunker = new SentenceChunker({ maxChunkSize: 50 });
    const chunks = chunker.chunkWithPositions(doc);

    for (const chunk of chunks) {
      expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
    }
  });

  it("should not exceed maxChunkSize", () => {
    // ... verify all chunks <= maxChunkSize
  });
});
```

### Pipeline Strategy Tests

```typescript
// Pattern: mock LLM, mock embedder, verify pipeline stages execute correctly
// Follow the existing pipeline-retriever.test.ts pattern

describe("Query strategies", () => {
  it("HyDE should call LLM and embed the hypothetical doc", async () => {
    const mockLlm = { complete: vi.fn().mockResolvedValue("hypothetical answer") };
    const mockEmbedder = createMockEmbedder();

    const retriever = new PipelineRetriever(
      { name: "test", query: { strategy: "hyde" }, search: { strategy: "dense" } },
      { chunker: mockChunker, embedder: mockEmbedder, llm: mockLlm }
    );

    await retriever.init(testCorpus);
    await retriever.retrieve("test query", 5);

    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
    expect(mockEmbedder.embedQuery).toHaveBeenCalledWith("hypothetical answer");
  });

  it("multi-query should generate multiple queries and fuse results", async () => {
    const mockLlm = {
      complete: vi.fn().mockResolvedValue("query 1\nquery 2\nquery 3"),
    };
    // ... verify 3 search calls and fusion
  });

  it("cross-query fusion should deduplicate and rank across queries", async () => {
    // ... verify _fuseAcrossQueries produces correct merged ranking via RRF
    // Include test with overlapping results across queries
  });

  it("should throw if LLM-requiring query strategy has no llm", () => {
    expect(() => new PipelineRetriever(
      { name: "test", query: { strategy: "hyde" } },
      { chunker: mockChunker, embedder: mockEmbedder /* no llm */ }
    )).toThrow(/requires an LLM/);
  });
});

describe("Index strategies", () => {
  it("contextual should enrich chunks with LLM context before embedding", async () => {
    // ... verify LLM called for each chunk, enriched text embedded
  });

  it("parent-child should search children and return parents", async () => {
    // ... verify child-parent mapping and dedup
  });

  it("should throw if LLM-requiring index strategy has no llm", () => {
    expect(() => new PipelineRetriever(
      { name: "test", index: { strategy: "contextual" } },
      { chunker: mockChunker, embedder: mockEmbedder /* no llm */ }
    )).toThrow(/requires an LLM/);
  });
});

describe("Config hash stability", () => {
  it("computeIndexConfigHash should be stable across identical plain configs", () => {
    const config1: PipelineConfig = { name: "a", index: { strategy: "plain", chunkSize: 1000 } };
    const config2: PipelineConfig = { name: "b", index: { strategy: "plain", chunkSize: 1000 } };
    expect(computeIndexConfigHash(config1)).toBe(computeIndexConfigHash(config2));
  });

  it("computeIndexConfigHash should differ for different strategies", () => {
    const plain: PipelineConfig = { name: "a", index: { strategy: "plain" } };
    const contextual: PipelineConfig = { name: "b", index: { strategy: "contextual" } };
    expect(computeIndexConfigHash(plain)).not.toBe(computeIndexConfigHash(contextual));
  });

  it("concurrency should NOT affect index config hash", () => {
    const a: PipelineConfig = { name: "a", index: { strategy: "contextual", concurrency: 5 } };
    const b: PipelineConfig = { name: "b", index: { strategy: "contextual", concurrency: 10 } };
    expect(computeIndexConfigHash(a)).toBe(computeIndexConfigHash(b));
  });
});

describe("AsyncPositionAwareChunker type guard", () => {
  it("isAsyncPositionAwareChunker returns true for async chunker", () => {
    const chunker = { name: "test", async: true, chunkWithPositions: vi.fn() };
    expect(isAsyncPositionAwareChunker(chunker)).toBe(true);
  });

  it("isAsyncPositionAwareChunker returns false for sync chunker", () => {
    const chunker = { name: "test", chunkWithPositions: vi.fn() };
    expect(isAsyncPositionAwareChunker(chunker)).toBe(false);
  });
});
```

### Verification Checklist

After each slice:
1. `pnpm -C packages/eval-lib build` — TypeScript compiles
2. `pnpm -C packages/eval-lib test` — all tests pass (existing 24 files + new)
3. `pnpm typecheck` — no type errors across workspace

---

## Implementation Order

Execute in dependency order, building from the bottom up:

```
Phase │ What                              │ Depends On │ Parallel?
──────┼───────────────────────────────────┼────────────┼──────────
  1   │ PipelineLLM interface             │ —          │
  2a  │ Cohere Embedder                   │ —          │ ✓ parallel
  2b  │ Voyage Embedder                   │ —          │ ✓ with 2a, 2c
  2c  │ Jina Embedder                     │ —          │ ✓ with 2a, 2b
  3a  │ Jina Reranker                     │ —          │ ✓ parallel
  3b  │ Voyage Reranker                   │ —          │ ✓ with 3a
  3c  │ Update Cohere Reranker            │ —          │ ✓ with 3a, 3b
  4a  │ Sentence Chunker                  │ —          │ ✓ parallel
  4b  │ Token Chunker                     │ —          │ ✓ with 4a-4f
  4c  │ Markdown Chunker                  │ —          │ ✓
  4d  │ Semantic Chunker                  │ Embedder   │ ✓
  4e  │ Cluster Semantic Chunker          │ Embedder   │ ✓
  4f  │ LLM Semantic Chunker             │ LLM iface  │ ✓
  5   │ Config types (extend unions)      │ 1          │
  6   │ Pipeline infrastructure           │ 5          │
      │ (multi-query flow, LLM dep,       │            │
      │  corpus ref)                      │            │
  7   │ Index strategies (contextual,     │ 1, 6       │ ✓ parallel
      │  summary, parent-child)           │            │
  8   │ Query strategies (hyde, multi-q,  │ 1, 6       │ ✓ parallel
      │  step-back, rewrite)              │            │
  9   │ Refinement strategies (mmr,       │ 6          │ ✓ parallel
      │  dedup, expand-context)           │            │
  10  │ Named presets                     │ 5-9        │
  11  │ Tests for all new components      │ Each phase │ ✓ alongside
  12  │ Update index.ts exports           │ All        │
```

---

## Reference: Models & Benchmarks

### Embedding Models

| Provider | Model | Dims | Max Tokens | $/1M tokens | Best For |
|----------|-------|------|------------|-------------|----------|
| OpenAI | text-embedding-3-small | 1536 | 8,191 | $0.02 | Cheap default |
| OpenAI | text-embedding-3-large | 3072 | 8,191 | $0.13 | High quality |
| Cohere | embed-english-v3.0 | 1024 | 512 | $0.10 | English, input_type |
| Cohere | embed-multilingual-v3.0 | 1024 | 512 | $0.10 | 100+ languages |
| Voyage | voyage-3.5 | 1024 | 32,000 | $0.06 | Best quality/$ |
| Voyage | voyage-3.5-lite | 512 | 32,000 | $0.02 | Budget quality |
| Voyage | voyage-code-3 | 1024 | 32,000 | $0.06 | Code retrieval |
| Jina | jina-embeddings-v3 | 1024 | 8,192 | ~$0.02 | Task-specific LoRA |

### Reranker Models

| Provider | Model | Best For |
|----------|-------|----------|
| Cohere | rerank-v3.5 | General, semi-structured |
| Cohere | rerank-english-v3.0 | English (current default) |
| Jina | jina-reranker-v2 | Code, function-calls |
| Voyage | rerank-2.5 | Instruction-following |

### Chunker Benchmarks (Chroma's evaluation, text-embedding-3-large, k=5)

| Strategy | Chunk Size | Overlap | Recall | Precision | IoU |
|----------|-----------|---------|--------|-----------|-----|
| RecursiveCharacter | 200 | 0 | 88.1% | 7.0% | 6.9% |
| RecursiveCharacter | 800 | 400 | 85.4% | 1.5% | 1.5% |
| ClusterSemantic | 200 | 0 | 87.3% | **8.0%** | **8.0%** |
| ClusterSemantic | 400 | 0 | **91.3%** | 4.5% | 4.5% |
| LLMSemantic | N/A | 0 | **91.9%** | 3.9% | 3.9% |
| KamradtModified | 300 | 0 | 87.1% | 2.1% | 2.1% |

### Experiment Grid Growth Per Slice

| After Slice | Embedders | Chunkers | Query | Search | Refinement | Approx Configs |
|-------------|-----------|----------|-------|--------|------------|----------------|
| Current | 1 | 1 | 1 | 3 | 2 | 4 presets |
| 1 (Providers) | 4 | 1 | 1 | 3 | 2 | ~36 |
| 2 (Sync chunkers) | 4 | 4 | 1 | 3 | 2 | ~144 |
| 3 (Query stage) | 4 | 4 | 5 | 3 | 2 | ~400* |
| 4 (Index stage) | 4 | 4 | 5 | 3 | 2+4 index | ~600* |
| 5 (Refinement + async) | 4 | 7 | 5 | 3 | 5 | ~1000+* |
| 6 (Presets) | — | — | — | — | — | 24 named presets |

*Not all combinations are valid or interesting. Named presets capture the best ones.

### Named Preset Summary

| Preset | Index | Query | Search | Refinement |
|--------|-------|-------|--------|------------|
| baseline-vector-rag | plain | identity | dense | — |
| dense-reranked | plain | identity | dense | rerank |
| bm25 | plain | identity | bm25 | — |
| bm25-reranked | plain | identity | bm25 | rerank |
| hybrid | plain | identity | hybrid(W) | — |
| hybrid-reranked | plain | identity | hybrid(W) | rerank |
| hybrid-rrf | plain | identity | hybrid(RRF) | — |
| hybrid-rrf-reranked | plain | identity | hybrid(RRF) | rerank |
| openclaw-style | plain(400) | identity | hybrid(W) | threshold(0.35) |
| hyde-dense | plain | hyde | dense | — |
| hyde-hybrid | plain | hyde | hybrid | — |
| hyde-hybrid-reranked | plain | hyde | hybrid | rerank |
| multi-query-dense | plain | multi-q(3) | dense | dedup |
| multi-query-hybrid | plain | multi-q(3) | hybrid | dedup, rerank |
| contextual-dense | contextual | identity | dense | — |
| contextual-hybrid | contextual | identity | hybrid | — |
| anthropic-best | contextual | identity | hybrid | rerank |
| parent-child-dense | parent-child | identity | dense | — |
| diverse-hybrid | plain | identity | hybrid | mmr(0.5) |
| step-back-hybrid | plain | step-back | hybrid | dedup, rerank |
| rewrite-hybrid | plain | rewrite | hybrid | — |
| rewrite-hybrid-reranked | plain | rewrite | hybrid | rerank |
| summary-dense | summary | identity | dense | — |
| premium | contextual | multi-q(3) | hybrid(5x) | dedup, rerank, threshold |
