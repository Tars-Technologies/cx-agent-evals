# Pipeline Retrievers Implementation Plan

A comprehensive plan to expand the pipeline retriever system with new embedders, rerankers, chunkers, pipeline stage strategies, and named presets — enabling hundreds of experiment configurations from composable building blocks.

---

## Table of Contents

1. [Current State](#current-state)
2. [New Embedder Implementations](#new-embedder-implementations)
3. [New Reranker Implementations](#new-reranker-implementations)
4. [New Chunker Implementations](#new-chunker-implementations)
5. [New Index Stage Strategies](#new-index-stage-strategies)
6. [New Query Stage Strategies](#new-query-stage-strategies)
7. [New Refinement Stage Strategies](#new-refinement-stage-strategies)
8. [Pipeline Infrastructure Changes](#pipeline-infrastructure-changes)
9. [Named Retriever Presets](#named-retriever-presets)
10. [Implementation Order](#implementation-order)
11. [File Inventory](#file-inventory)
12. [Reference: Models & Benchmarks](#reference-models--benchmarks)

---

## Current State

### What exists today

```
Pipeline Stages:
  INDEX:      plain (RecursiveCharacterChunker, configurable size/overlap/separators)
  QUERY:      identity (pass-through)
  SEARCH:     dense | bm25 | hybrid (weighted fusion or RRF)
  REFINEMENT: rerank | threshold

Providers:
  Embedders:  OpenAI (text-embedding-3-small, text-embedding-3-large, ada-002)
  Rerankers:  Cohere (rerank-english-v3.0)
  Chunkers:   RecursiveCharacterChunker
  VectorStores: InMemory, Chroma

Named Presets (4):
  baseline-vector-rag  =  plain → identity → dense → (none)
  bm25                 =  plain → identity → bm25  → (none)
  hybrid               =  plain → identity → hybrid(0.7/0.3, weighted) → (none)
  hybrid-reranked      =  plain → identity → hybrid(0.7/0.3, weighted) → rerank
```

### Interfaces to implement against

```typescript
// Embedder — packages/eval-lib/src/embedders/embedder.interface.ts
interface Embedder {
  readonly name: string;
  readonly dimension: number;
  embed(texts: readonly string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}

// Reranker — packages/eval-lib/src/rerankers/reranker.interface.ts
interface Reranker {
  readonly name: string;
  rerank(query: string, chunks: readonly PositionAwareChunk[], topK?: number): Promise<PositionAwareChunk[]>;
}

// PositionAwareChunker — packages/eval-lib/src/chunkers/chunker.interface.ts
interface PositionAwareChunker {
  readonly name: string;
  chunkWithPositions(doc: Document): PositionAwareChunk[];
}

// Retriever — packages/eval-lib/src/retrievers/retriever.interface.ts
interface Retriever {
  readonly name: string;
  init(corpus: Corpus): Promise<void>;
  retrieve(query: string, k: number): Promise<PositionAwareChunk[]>;
  cleanup(): Promise<void>;
}
```

---

## New Embedder Implementations

All new embedders implement the existing `Embedder` interface. Each follows the same pattern as `OpenAIEmbedder`: static `create()` factory, handles batching internally, reads API key from env or constructor.

### Cohere Embedder

**File**: `packages/eval-lib/src/embedders/cohere.ts`

```
Models:
  embed-english-v3.0    — 1024 dims, 512 max tokens, English-only
  embed-multilingual-v3.0 — 1024 dims, 512 max tokens, 100+ languages

API: cohere npm package → POST /v2/embed
Key detail: Requires `input_type` parameter
  - embed() → input_type: "search_document"
  - embedQuery() → input_type: "search_query"

Config:
  { model?: string, apiKey?: string }
  Defaults: model = "embed-english-v3.0"

Dependencies: cohere (npm package)
```

**Why**: Cohere is a tier-1 embedding provider. Their `input_type` distinction between documents and queries is a unique feature that should improve retrieval quality.

### Voyage Embedder

**File**: `packages/eval-lib/src/embedders/voyage.ts`

```
Models:
  voyage-3.5       — 1024 dims, 32K max tokens, best quality/$
  voyage-3.5-lite  — 512 dims, 32K max tokens, budget option
  voyage-3         — 1024 dims, 32K max tokens, general-purpose
  voyage-code-3    — 1024 dims, 32K max tokens, code-optimized

API: REST POST https://api.voyageai.com/v1/embeddings
  OpenAI-compatible format — can use openai npm package with custom baseURL
  Also uses input_type: "document" vs "query"

Config:
  { model?: string, apiKey?: string }
  Defaults: model = "voyage-3.5"

Dependencies: openai (reuse existing, custom baseURL) OR plain fetch
```

**Why**: Voyage-3.5 outperforms OpenAI text-embedding-3-large by 8.26% on retrieval benchmarks. The 32K context window (4x OpenAI) handles longer chunks. Best quality-per-dollar among commercial APIs.

### Jina Embedder

**File**: `packages/eval-lib/src/embedders/jina.ts`

```
Models:
  jina-embeddings-v3 — 1024 dims (Matryoshka down to 32), 8K max tokens

API: REST POST https://api.jina.ai/v1/embeddings
  OpenAI-compatible format
  Unique feature: task parameter selects LoRA adapter
  - embed() → task: "retrieval.passage"
  - embedQuery() → task: "retrieval.query"

Config:
  { model?: string, apiKey?: string, dimensions?: number }
  Defaults: model = "jina-embeddings-v3", dimensions = 1024

Dependencies: plain fetch (or openai with custom baseURL)
```

**Why**: Task-specific LoRA adapters are uniquely suited to a system that calls `embed()` for documents and `embedQuery()` for queries — each gets an optimized adapter. Matryoshka dimensions enable experiments with different dimension trade-offs.

### Embedder Summary

```
Provider  │ Model                     │ Dims  │ Max Tokens │ $/1M tokens │ Unique Feature
──────────┼───────────────────────────┼───────┼────────────┼─────────────┼──────────────────
OpenAI    │ text-embedding-3-small    │ 1536  │ 8,191      │ $0.02       │ Cheapest
OpenAI    │ text-embedding-3-large    │ 3072  │ 8,191      │ $0.13       │ Highest dim
Cohere    │ embed-english-v3.0        │ 1024  │ 512        │ $0.10       │ input_type
Cohere    │ embed-multilingual-v3.0   │ 1024  │ 512        │ $0.10       │ 100+ langs
Voyage    │ voyage-3.5                │ 1024  │ 32,000     │ $0.06       │ Best quality/$
Voyage    │ voyage-3.5-lite           │ 512   │ 32,000     │ $0.02       │ Cheapest quality
Voyage    │ voyage-code-3             │ 1024  │ 32,000     │ $0.06       │ Code-optimized
Jina      │ jina-embeddings-v3        │ 1024  │ 8,192      │ ~$0.02      │ LoRA adapters
```

---

## New Reranker Implementations

All implement the existing `Reranker` interface.

### Update Cohere Reranker

**File**: `packages/eval-lib/src/rerankers/cohere.ts` (modify existing)

```
Add support for model selection:
  rerank-v3.5          — Latest, multilingual, semi-structured data support
  rerank-english-v3.0  — Current default (keep for backwards compatibility)

Changes:
  - Add optional `model` parameter to factory/constructor
  - Default to rerank-v3.5 for new usage
  - Keep rerank-english-v3.0 as fallback
```

### Jina Reranker

**File**: `packages/eval-lib/src/rerankers/jina.ts`

```
Models:
  jina-reranker-v2-base-multilingual — 100+ languages, code-aware, function-call ranking

API: REST POST https://api.jina.ai/v1/rerank
  Request: { model, query, documents: string[], top_n }
  Response: { results: [{ index, relevance_score }] }

Config:
  { model?: string, apiKey?: string }

Implementation:
  1. Extract chunk.content strings → documents array
  2. Call Jina rerank API
  3. Map response indices back to PositionAwareChunk[], sorted by relevance_score descending
  4. Return top topK results

Dependencies: plain fetch
```

**Why**: 15x faster than BGE-reranker-v2-m3, unique code search and function-call ranking capability.

### Voyage Reranker

**File**: `packages/eval-lib/src/rerankers/voyage.ts`

```
Models:
  rerank-2.5      — Latest, instruction-following
  rerank-2        — Stable, multilingual

API: REST POST https://api.voyageai.com/v1/rerank
  Request: { model, query, documents: string[], top_k }
  Response: { data: [{ index, relevance_score }] }

Config:
  { model?: string, apiKey?: string }

Dependencies: plain fetch
```

**Why**: Instruction-following capability in rerank-2.5 allows customizing ranking behavior per use case.

### Reranker Summary

```
Provider │ Model                        │ Unique Feature
─────────┼──────────────────────────────┼──────────────────────────────
Cohere   │ rerank-v3.5                  │ Semi-structured data (JSON/tables)
Cohere   │ rerank-english-v3.0          │ English-optimized (current impl)
Jina     │ jina-reranker-v2             │ Code-aware, function-call ranking
Voyage   │ rerank-2.5                   │ Instruction-following
Voyage   │ rerank-2                     │ Stable multilingual
```

---

## New Chunker Implementations

All must implement `PositionAwareChunker` — the key constraint is that every chunk must track `docId`, `start`, `end` character positions in the source document for span-based evaluation.

### Sentence Chunker

**File**: `packages/eval-lib/src/chunkers/sentence.ts`

```
Approach:
  1. Split text into sentences using regex (handle abbreviations, numbers, etc.)
     Pattern: /(?<=[.!?])\s+(?=[A-Z])/ with special handling for common abbreviations
  2. Group adjacent sentences until total length approaches maxChunkSize
  3. Track character positions: each sentence knows its start/end in the original text
  4. Create PositionAwareChunk from each group: start = first sentence start, end = last sentence end

Config:
  { maxChunkSize?: number, overlapSentences?: number }
  Defaults: maxChunkSize = 1000, overlapSentences = 0

Position tracking:
  When splitting, track character offsets by accumulating lengths.
  Group: start = sentences[0].start, end = sentences[last].end

Trade-offs:
  + Preserves sentence integrity
  + Fast, deterministic
  - Uneven chunk sizes (sentences vary in length)
  - No semantic awareness
```

### Semantic Chunker (Embedding Similarity)

**File**: `packages/eval-lib/src/chunkers/semantic.ts`

```
Approach (Kamradt method / LangChain SemanticChunker):
  1. Split text into sentences
  2. Embed each sentence using provided Embedder
  3. Compute cosine similarity between consecutive sentence embeddings
  4. Compute the Nth percentile of similarities (e.g., 95th)
  5. Place chunk boundaries where similarity drops below the percentile threshold
  6. Merge sentences within each boundary into chunks
  7. If any chunk exceeds maxChunkSize, sub-split with RecursiveCharacterChunker

Config:
  { embedder: Embedder, percentileThreshold?: number, maxChunkSize?: number }
  Defaults: percentileThreshold = 95, maxChunkSize = 2000

Note: chunkWithPositions needs async embedding calls, but the PositionAwareChunker
interface is synchronous. Two options:
  a) Make this a factory that returns a chunker after pre-computing embeddings
  b) Use an AsyncPositionAwareChunker variant
  → Recommended: (a) — factory pattern: SemanticChunker.create(doc, embedder) → chunker

Position tracking:
  Same as sentence chunker — sentences track offsets, chunks inherit from sentence groups.

Trade-offs:
  + Content-aware boundaries
  + No LLM calls, just embedding
  - Requires embedding every sentence at index time
  - Chroma's benchmarks show it underperforms well-tuned RecursiveCharacter at default settings
  - Chunk sizes unpredictable
```

### Cluster Semantic Chunker (Chroma's Approach)

**File**: `packages/eval-lib/src/chunkers/cluster-semantic.ts`

```
Approach:
  1. Split text into micro-segments (~50 tokens each) using RecursiveCharacterChunker
  2. Embed all micro-segments using provided Embedder
  3. Dynamic programming: find the grouping of segments into chunks that maximizes
     average intra-chunk pairwise cosine similarity, subject to maxChunkSize constraint
  4. Each chunk = concatenation of adjacent micro-segments

Algorithm detail (DP):
  Let segments = [s₀, s₁, ..., sₙ]
  dp[i] = max total similarity for segments [0..i]
  For each i, try all valid previous breakpoints j where sum_tokens(s_j..s_i) <= maxChunkSize:
    similarity(j, i) = average pairwise cosine similarity of embeddings in [j..i]
    dp[i] = max(dp[j-1] + similarity(j, i))
  Backtrack to recover optimal chunk boundaries.

Config:
  { embedder: Embedder, maxChunkSize?: number, segmentSize?: number }
  Defaults: maxChunkSize = 400, segmentSize = 50 (in chars, approximate tokens)

Note: Same async issue as SemanticChunker — use factory pattern.

Position tracking:
  Each micro-segment tracks its character offsets.
  Merged chunk: start = first segment start, end = last segment end.

Trade-offs:
  + Global optimization — best precision/IoU in Chroma benchmarks
  + Chunks optimized for the actual embedding model being used
  - O(n²) in number of segments (pairwise similarity)
  - Requires embedding all segments upfront
  - Recomputation needed when documents change

Reference: github.com/brandonstarxel/chunking_evaluation
```

### Token-Based Chunker

**File**: `packages/eval-lib/src/chunkers/token.ts`

```
Approach:
  1. Tokenize the full document text using tiktoken (cl100k_base for OpenAI models)
  2. Group tokens into chunks of maxTokens with overlapTokens overlap
  3. Decode token groups back to text
  4. Track character positions by mapping token boundaries to character offsets

Config:
  { maxTokens?: number, overlapTokens?: number, encoding?: string }
  Defaults: maxTokens = 256, overlapTokens = 0, encoding = "cl100k_base"

Dependencies: js-tiktoken (lightweight, wasm-based tiktoken for JavaScript)

Position tracking:
  tiktoken provides token offsets. Map token boundaries → character offsets.
  Each chunk: start = charOffset(firstToken), end = charOffset(lastToken) + len(lastToken)

Trade-offs:
  + Guarantees chunks fit within model context windows
  + More predictable embedding behavior
  - Requires tiktoken dependency
  - Same semantic limitations as fixed-size character splitting
```

### Markdown/Structure-Aware Chunker

**File**: `packages/eval-lib/src/chunkers/markdown.ts`

```
Approach:
  1. Parse document for Markdown headers (#, ##, ###, etc.)
  2. Split into sections at header boundaries
  3. For each section:
     - If size <= maxChunkSize: keep as single chunk (include header as context)
     - If size > maxChunkSize: sub-split using RecursiveCharacterChunker
  4. Optionally merge small adjacent sections up to maxChunkSize

Config:
  { maxChunkSize?: number, headerLevels?: number[], mergeSmallSections?: boolean }
  Defaults: maxChunkSize = 1000, headerLevels = [1, 2, 3], mergeSmallSections = true

Position tracking:
  Headers and content have known positions in the original document.
  Each section chunk: start = header start, end = section content end.

Trade-offs:
  + Preserves author's information hierarchy
  + Fast, deterministic
  + Often the biggest easy win for structured documents
  - Only works for Markdown/structured text
  - Section sizes vary wildly
```

### LLM Semantic Chunker

**File**: `packages/eval-lib/src/chunkers/llm-semantic.ts`

```
Approach (Chroma's LLMSemanticChunker):
  1. Split text into ~50 token segments using RecursiveCharacterChunker
  2. Wrap each segment in boundary tags: <|start_chunk_N|> ... <|end_chunk_N|>
  3. Batch segments (~800 tokens per batch)
  4. For each batch, prompt LLM:
     "Identify thematic boundaries in the following tagged text.
      Return split points in format: split_after: X, Y"
  5. Validate LLM response (ascending order, minimum chunk requirements)
  6. Merge segments based on identified split points

Config:
  { llm: LLM, segmentSize?: number, batchSize?: number }
  Defaults: segmentSize = 50 (chars), batchSize = 800 (chars)

Note: Requires the pipeline LLM interface (see Pipeline Infrastructure Changes).
Async — use factory pattern like other embedding-dependent chunkers.

Position tracking:
  Segments track their offsets. Merged segments inherit min start / max end.

Trade-offs:
  + Highest recall in Chroma benchmarks (91.9%)
  + Produces the most semantically coherent chunks
  - Very slow (LLM call per batch)
  - Expensive (per-document LLM costs)
  - Non-deterministic
  - Best used for experiments, not production indexing

Reference: github.com/brandonstarxel/chunking_evaluation/blob/main/chunking_evaluation/chunking/llm_semantic_chunker.py
```

### Chunker Summary

```
Chunker              │ Position-Aware │ Dependencies    │ Speed   │ Best For
─────────────────────┼────────────────┼─────────────────┼─────────┼─────────────────
RecursiveCharacter   │ ✓ (existing)   │ none            │ Fast    │ General baseline
Sentence             │ ✓              │ none            │ Fast    │ Sentence-preserving
Semantic             │ ✓              │ Embedder        │ Medium  │ Topic-aware splitting
ClusterSemantic      │ ✓              │ Embedder        │ Medium  │ Best precision/IoU
Token                │ ✓              │ js-tiktoken     │ Fast    │ Token-aligned chunks
Markdown             │ ✓              │ none            │ Fast    │ Structured docs
LLMSemantic          │ ✓              │ LLM             │ Slow    │ Max recall experiments
```

---

## New Index Stage Strategies

Extend the `IndexConfig` type in `packages/eval-lib/src/retrievers/pipeline/config.ts` from a single `{ strategy: "plain" }` to a discriminated union, and implement each strategy in `pipeline-retriever.ts`.

### Contextual Chunking (`strategy: "contextual"`)

```
Based on: Anthropic's Contextual Retrieval (35-67% fewer retrieval failures)

How it works:
  1. Chunk documents normally (using configured chunker)
  2. For each chunk, call LLM with the full document text + the chunk text:
     "Please give a short succinct context to situate this chunk within the
      overall document for the purposes of improving search retrieval of the chunk."
  3. LLM returns ~50-100 tokens of contextual preamble
  4. Prepend context to chunk text ONLY for embedding (the stored chunk and its
     positions remain unchanged)
  5. Embed the context-enriched text
  6. Index normally

Config type:
  interface ContextualIndexConfig {
    readonly strategy: "contextual";
    readonly chunkSize?: number;        // default 1000
    readonly chunkOverlap?: number;     // default 200
    readonly embeddingModel?: string;
    readonly contextPrompt?: string;    // custom prompt template
    readonly concurrency?: number;      // parallel LLM calls, default 5
  }

Position tracking: Positions unchanged — we modify the embedding input, not the chunk.

Dependencies: LLM (from PipelineRetrieverDeps)

Implementation in pipeline-retriever.ts:
  In init(), after chunking:
    for each chunk (in parallel batches of `concurrency`):
      contextText = await llm.complete(contextPrompt + docText + chunkText)
      enrichedText = contextText + "\n\n" + chunk.content
      // Embed enrichedText, store chunk (not enrichedText) in vector store
```

### Summary Indexing (`strategy: "summary"`)

```
How it works:
  1. Chunk documents normally
  2. For each chunk, generate an LLM summary
  3. Embed the summary (not the original chunk)
  4. Store mapping: summary_embedding → original chunk
  5. At search time, search summary embeddings, return original chunks

Config type:
  interface SummaryIndexConfig {
    readonly strategy: "summary";
    readonly chunkSize?: number;
    readonly chunkOverlap?: number;
    readonly embeddingModel?: string;
    readonly summaryPrompt?: string;
    readonly concurrency?: number;
  }

Position tracking: Original chunks retain their positions. Summaries are search intermediaries.

Implementation:
  In init(): chunk → summarize → embed summaries → store (summary_embedding, original_chunk)
  In search: embed query → find nearest summary embeddings → return mapped original chunks
```

### Parent-Child Chunking (`strategy: "parent-child"`)

```
How it works:
  1. Chunk documents at TWO granularities:
     - Child chunks (small, e.g., 200 chars) for precise matching
     - Parent chunks (large, e.g., 1000 chars) for context
  2. Establish parent-child links (each child knows which parent it belongs to)
  3. Embed and index child chunks
  4. At search time:
     - Search child chunks
     - For each matched child, look up its parent
     - Return unique parent chunks (deduplicated)

Config type:
  interface ParentChildIndexConfig {
    readonly strategy: "parent-child";
    readonly childChunkSize?: number;    // default 200
    readonly parentChunkSize?: number;   // default 1000
    readonly childOverlap?: number;      // default 0
    readonly parentOverlap?: number;     // default 100
    readonly embeddingModel?: string;
  }

Position tracking:
  Both parents and children are PositionAwareChunks.
  Parent span = union of child spans (min start, max end for same docId).

Implementation:
  In init():
    parents = chunker.chunkWithPositions(doc, parentSize)
    children = chunker.chunkWithPositions(doc, childSize)
    build parent-child map (child.start >= parent.start && child.end <= parent.end)
    embed children, index children
  In search:
    search children → map to parents → deduplicate parents → return parents
```

### Config type update

```typescript
// packages/eval-lib/src/retrievers/pipeline/config.ts

export interface PlainIndexConfig {
  readonly strategy: "plain";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly separators?: readonly string[];
  readonly embeddingModel?: string;
}

export interface ContextualIndexConfig {
  readonly strategy: "contextual";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly embeddingModel?: string;
  readonly contextPrompt?: string;
  readonly concurrency?: number;
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
  readonly childChunkSize?: number;
  readonly parentChunkSize?: number;
  readonly childOverlap?: number;
  readonly parentOverlap?: number;
  readonly embeddingModel?: string;
}

export type IndexConfig =
  | PlainIndexConfig
  | ContextualIndexConfig
  | SummaryIndexConfig
  | ParentChildIndexConfig;
```

---

## New Query Stage Strategies

Extend the `QueryConfig` union and implement in `pipeline-retriever.ts`. A key design decision is handling strategies that produce multiple queries (multi-query, step-back).

### LLM Interface for Pipeline

**File**: `packages/eval-lib/src/retrievers/pipeline/llm.interface.ts`

```typescript
/**
 * Minimal LLM interface for pipeline stages (query transformation, index enrichment).
 * Provider-agnostic — Convex backend or tests can provide their own implementation.
 */
export interface PipelineLLM {
  /**
   * Generate a text completion from a prompt.
   * Should handle its own retries and error handling.
   */
  complete(prompt: string): Promise<string>;
}
```

This is the only dependency pipeline stages need from an LLM. The backend (Convex) wraps its OpenAI client to implement this. Tests provide a mock that returns canned responses.

### HyDE (`strategy: "hyde"`)

```
How it works:
  1. Given query, prompt LLM: "Write a short passage that would answer: {query}"
  2. LLM generates a hypothetical answer document (100-200 tokens)
  3. Embed the hypothetical document (not the query)
  4. Use that embedding for vector search
  5. Optionally generate multiple hypothetical docs and average their embeddings

Config type:
  interface HydeQueryConfig {
    readonly strategy: "hyde";
    readonly hydePrompt?: string;           // custom prompt template
    readonly numHypotheticalDocs?: number;  // default 1
  }

Output: Single search query (the hypothetical doc text) OR averaged embedding

Implementation in pipeline-retriever.ts:
  In _processQuery():
    hypothetical = await llm.complete(hydePrompt + query)
    return hypothetical  // embed this instead of query

Trade-offs:
  + Bridges query-document embedding gap
  + Zero-shot, no training needed
  - Adds LLM latency to every query
  - Hallucinated content may bias retrieval
```

### Multi-Query (`strategy: "multi-query"`)

```
How it works:
  1. Given query, prompt LLM: "Generate N different search queries that would help
     answer: {query}. Return one per line."
  2. Parse LLM response into N query strings
  3. Run search stage for EACH query
  4. Fuse all result sets using RRF or weighted fusion
  5. Deduplicate

Config type:
  interface MultiQueryConfig {
    readonly strategy: "multi-query";
    readonly numQueries?: number;          // default 3
    readonly generationPrompt?: string;    // custom prompt
    readonly fusionMethod?: "rrf" | "weighted";  // default "rrf"
  }

Output: Array of query strings

Pipeline flow change:
  Query stage returns string[] instead of string.
  Search stage handles string[]: runs search for each, fuses results.
  This is the key infrastructure change (see Pipeline Infrastructure Changes).

Trade-offs:
  + Highest recall improvement among query techniques
  + Captures different semantic aspects
  + Queries run in parallel
  - Multiplies retrieval cost (N queries)
  - Needs dedup in refinement
```

### Step-Back Prompting (`strategy: "step-back"`)

```
How it works:
  1. Given query, prompt LLM: "What is a more general, abstract version of this
     question that would help retrieve relevant background knowledge? {query}"
  2. LLM returns an abstract query
  3. Optionally search both the original query and the abstract query, fuse results

Config type:
  interface StepBackQueryConfig {
    readonly strategy: "step-back";
    readonly stepBackPrompt?: string;
    readonly includeOriginal?: boolean;  // default true — search both queries
  }

Output: string[] (1 or 2 queries)

Trade-offs:
  + Retrieves foundational context that specific queries miss
  + Low overhead (single LLM call)
  - Over-abstraction may retrieve irrelevant broad content
```

### Query Rewriting (`strategy: "rewrite"`)

```
How it works:
  1. Given query, prompt LLM: "Rewrite the following query to be more precise and
     retrieval-friendly: {query}"
  2. LLM returns a rewritten query
  3. Use rewritten query for search

Config type:
  interface RewriteQueryConfig {
    readonly strategy: "rewrite";
    readonly rewritePrompt?: string;
  }

Output: Single rewritten query string

Trade-offs:
  + Bridges gap between casual language and document language
  + Low overhead
  - May alter user intent
```

### Config type update

```typescript
export type QueryConfig =
  | IdentityQueryConfig
  | HydeQueryConfig
  | MultiQueryConfig
  | StepBackQueryConfig
  | RewriteQueryConfig;
```

---

## New Refinement Stage Strategies

Extend the `RefinementStepConfig` union. Refinement steps chain sequentially.

### MMR — Maximal Marginal Relevance (`type: "mmr"`)

**File**: `packages/eval-lib/src/retrievers/pipeline/refinement/mmr.ts`

```
How it works:
  Iteratively builds a result set by selecting the next chunk that maximizes:
    λ * relevance(chunk, query) - (1 - λ) * max_similarity(chunk, selected_chunks)

  Algorithm:
  1. Start with empty selected set S
  2. For each iteration up to topK:
     a. For each candidate c not in S:
        score = λ * sim(c, query) - (1-λ) * max(sim(c, s) for s in S)
     b. Add the highest-scoring candidate to S
  3. Return S

Config:
  { type: "mmr", lambda?: number }
  Defaults: lambda = 0.7 (0 = max diversity, 1 = max relevance)

Implementation:
  Needs chunk embeddings to compute inter-chunk similarity.
  Options:
    a) Re-embed chunks (expensive)
    b) Cache embeddings from the search stage
    c) Use content overlap as a proxy (cheaper but less accurate)
  → Recommended: (b) — extend ScoredChunk to optionally carry embeddings from search stage

Trade-offs:
  + Reduces redundancy in results
  + Particularly useful for broad queries
  - Needs access to embeddings
  - O(k * n) where n = candidates, k = desired results
```

### Deduplication (`type: "dedup"`)

**File**: `packages/eval-lib/src/retrievers/pipeline/refinement/dedup.ts`

```
How it works:
  Remove duplicate or near-duplicate chunks from the result set.

  Methods:
  - "exact": Hash chunk content, remove exact duplicates
  - "overlap": Check character span overlap between chunks from the same document.
    If overlap ratio > threshold, keep the higher-scored one.

Config:
  { type: "dedup", method?: "exact" | "overlap", overlapThreshold?: number }
  Defaults: method = "exact", overlapThreshold = 0.5

Implementation:
  For "exact": Map<hash, ScoredChunk>, keep first (highest scored) occurrence
  For "overlap":
    For each pair of chunks from same docId:
      overlap = computeOverlap(chunk1.start, chunk1.end, chunk2.start, chunk2.end)
      if overlap / min(chunk1.length, chunk2.length) > threshold: remove lower-scored

Trade-offs:
  + Essential for multi-query strategies
  + Fast (exact) or moderate (overlap)
  - Overlap method is O(n²) but n is small (typically < 50 candidates)
```

### Context Expansion (`type: "expand-context"`)

**File**: `packages/eval-lib/src/retrievers/pipeline/refinement/expand-context.ts`

```
How it works:
  For each retrieved chunk, expand its character window by N characters in each direction
  within the source document, creating a wider context window.

Config:
  { type: "expand-context", windowChars?: number }
  Defaults: windowChars = 500

Implementation:
  For each chunk:
    newStart = max(0, chunk.start - windowChars)
    newEnd = min(doc.content.length, chunk.end + windowChars)
    expandedContent = doc.content.slice(newStart, newEnd)
    Return new PositionAwareChunk with expanded span

  Requires access to the corpus (stored during init()).

Trade-offs:
  + Provides richer context for small indexing units (sentences, propositions)
  + Straightforward implementation
  - Increases total retrieved text volume
  - May include irrelevant surrounding text
```

### Config type update

```typescript
export type RefinementStepConfig =
  | RerankRefinementStep
  | ThresholdRefinementStep
  | MmrRefinementStep
  | DedupRefinementStep
  | ExpandContextRefinementStep;

export interface MmrRefinementStep {
  readonly type: "mmr";
  readonly lambda?: number;
}

export interface DedupRefinementStep {
  readonly type: "dedup";
  readonly method?: "exact" | "overlap";
  readonly overlapThreshold?: number;
}

export interface ExpandContextRefinementStep {
  readonly type: "expand-context";
  readonly windowChars?: number;
}
```

---

## Pipeline Infrastructure Changes

### Multi-Query Flow

The current pipeline assumes `retrieve(query, k)` → single query string through all stages. Multi-query, step-back, and query decomposition produce multiple search inputs.

**Design**:

```
Current flow:
  query: string → processQuery() → string → search() → results

New flow:
  query: string → processQuery() → string | string[] → search handles array:
    if string[]:
      results per query = queries.map(q => _search(q, k * candidateMultiplier))
      fuse all result sets (RRF)
    if string:
      results = _search(query, k * candidateMultiplier)

This is contained entirely within pipeline-retriever.ts. The Retriever interface
(query: string, k: number) remains unchanged.
```

### LLM Dependency

Add optional `llm` to `PipelineRetrieverDeps`:

```typescript
export interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker;
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
  readonly llm?: PipelineLLM;  // NEW
}
```

Validation in constructor: if config uses an LLM-requiring strategy (`contextual`, `summary`, `hyde`, `multi-query`, `step-back`, `rewrite`, `llm-semantic` chunker) but `deps.llm` is not provided, throw an error.

### Corpus Reference

Store the `Corpus` during `init()` so refinement steps like `expand-context` can access original document text. The pipeline already stores chunks; we need to also store the corpus documents.

```typescript
private corpus: Corpus | null = null;

async init(corpus: Corpus): Promise<void> {
  this.corpus = corpus;
  // ... rest of init
}
```

### Embedding Cache for MMR

For MMR refinement, we need access to chunk embeddings. Extend the internal pipeline to optionally carry embeddings through from the search stage to the refinement stage.

```typescript
interface ScoredChunkWithEmbedding extends ScoredChunk {
  readonly embedding?: readonly number[];
}
```

The dense search stage already computes embeddings — just thread them through.

---

## Named Retriever Presets

### Preset Registry

Instead of creating 16+ directories (one per preset), consolidate into a registry pattern:

**File**: `packages/eval-lib/src/experiments/presets.ts`

```typescript
import type { PipelineConfig } from "../retrievers/pipeline/config.js";

/** All named pipeline configurations */
export const PIPELINE_PRESETS = {
  // === Existing (kept for reference, actual configs in their directories) ===
  "baseline-vector-rag": { ... },
  "bm25": { ... },
  "hybrid": { ... },
  "hybrid-reranked": { ... },

  // === Dense variants ===
  "dense-reranked": {
    name: "dense-reranked",
    index: { strategy: "plain" },
    search: { strategy: "dense" },
    refinement: [{ type: "rerank" }],
  },

  // === BM25 variants ===
  "bm25-reranked": {
    name: "bm25-reranked",
    index: { strategy: "plain" },
    search: { strategy: "bm25" },
    refinement: [{ type: "rerank" }],
  },

  // === Hybrid variants ===
  "hybrid-rrf": {
    name: "hybrid-rrf",
    index: { strategy: "plain" },
    search: { strategy: "hybrid", fusionMethod: "rrf" },
  },
  "hybrid-rrf-reranked": {
    name: "hybrid-rrf-reranked",
    index: { strategy: "plain" },
    search: { strategy: "hybrid", fusionMethod: "rrf" },
    refinement: [{ type: "rerank" }],
  },

  // === OpenClaw-style ===
  "openclaw-style": {
    name: "openclaw-style",
    index: { strategy: "plain", chunkSize: 400, chunkOverlap: 80 },
    search: {
      strategy: "hybrid",
      denseWeight: 0.7,
      sparseWeight: 0.3,
      fusionMethod: "weighted",
      candidateMultiplier: 4,
    },
    refinement: [{ type: "threshold", minScore: 0.35 }],
  },

  // === HyDE variants ===
  "hyde-dense": {
    name: "hyde-dense",
    index: { strategy: "plain" },
    query: { strategy: "hyde" },
    search: { strategy: "dense" },
  },
  "hyde-hybrid": {
    name: "hyde-hybrid",
    index: { strategy: "plain" },
    query: { strategy: "hyde" },
    search: { strategy: "hybrid" },
  },
  "hyde-hybrid-reranked": {
    name: "hyde-hybrid-reranked",
    index: { strategy: "plain" },
    query: { strategy: "hyde" },
    search: { strategy: "hybrid" },
    refinement: [{ type: "rerank" }],
  },

  // === Multi-Query variants ===
  "multi-query-dense": {
    name: "multi-query-dense",
    index: { strategy: "plain" },
    query: { strategy: "multi-query", numQueries: 3 },
    search: { strategy: "dense" },
    refinement: [{ type: "dedup" }],
  },
  "multi-query-hybrid": {
    name: "multi-query-hybrid",
    index: { strategy: "plain" },
    query: { strategy: "multi-query", numQueries: 3 },
    search: { strategy: "hybrid" },
    refinement: [{ type: "dedup" }, { type: "rerank" }],
  },

  // === Contextual variants (Anthropic's approach) ===
  "contextual-dense": {
    name: "contextual-dense",
    index: { strategy: "contextual" },
    search: { strategy: "dense" },
  },
  "contextual-hybrid": {
    name: "contextual-hybrid",
    index: { strategy: "contextual" },
    search: { strategy: "hybrid" },
  },
  "anthropic-best": {
    name: "anthropic-best",
    index: { strategy: "contextual" },
    search: { strategy: "hybrid" },
    refinement: [{ type: "rerank" }],
  },

  // === Parent-Child ===
  "parent-child-dense": {
    name: "parent-child-dense",
    index: { strategy: "parent-child", childChunkSize: 200, parentChunkSize: 1000 },
    search: { strategy: "dense" },
  },

  // === Diversity-focused ===
  "diverse-hybrid": {
    name: "diverse-hybrid",
    index: { strategy: "plain" },
    search: { strategy: "hybrid" },
    refinement: [{ type: "mmr", lambda: 0.5 }],
  },

  // === Step-Back ===
  "step-back-hybrid": {
    name: "step-back-hybrid",
    index: { strategy: "plain" },
    query: { strategy: "step-back" },
    search: { strategy: "hybrid" },
    refinement: [{ type: "dedup" }, { type: "rerank" }],
  },

  // === Premium (everything) ===
  "premium": {
    name: "premium",
    index: { strategy: "contextual" },
    query: { strategy: "multi-query", numQueries: 3 },
    search: { strategy: "hybrid", candidateMultiplier: 5 },
    refinement: [{ type: "dedup" }, { type: "rerank" }, { type: "threshold", minScore: 0.3 }],
  },
} as const satisfies Record<string, PipelineConfig>;

export type PresetName = keyof typeof PIPELINE_PRESETS;

export function getPresetConfig(name: PresetName): PipelineConfig {
  return PIPELINE_PRESETS[name];
}
```

The existing 4 preset directories (`baseline-vector-rag/`, `bm25/`, `hybrid/`, `hybrid-reranked/`) remain for backwards compatibility. Their factory functions continue to work. New presets are accessed via the registry.

---

## Implementation Order

Execute in dependency order, building from the bottom up:

```
Phase │ What                              │ Depends On │ Parallel?
──────┼───────────────────────────────────┼────────────┼──────────
  1   │ LLM interface                     │ —          │
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
      │  corpus ref, embedding cache)     │            │
  7   │ Index strategies (contextual,     │ 1, 6       │ ✓ parallel
      │  summary, parent-child)           │            │
  8   │ Query strategies (hyde, multi-q,  │ 1, 6       │ ✓ parallel
      │  step-back, rewrite)              │            │
  9   │ Refinement strategies (mmr,       │ 6          │ ✓ parallel
      │  dedup, expand-context)           │            │
  10  │ Named presets registry            │ 5-9        │
  11  │ Tests for all new components      │ Each phase │ ✓ alongside
  12  │ Update index.ts exports           │ All        │
```

---

## File Inventory

### Files to Create

```
packages/eval-lib/src/
├── embedders/
│   ├── cohere.ts                    # Cohere embed-v3 embedder
│   ├── voyage.ts                    # Voyage-3.5 embedder
│   └── jina.ts                      # Jina embeddings-v3 embedder
├── rerankers/
│   ├── jina.ts                      # Jina reranker-v2
│   └── voyage.ts                    # Voyage rerank-2.5
├── chunkers/
│   ├── sentence.ts                  # Sentence-based chunker
│   ├── semantic.ts                  # Embedding-similarity chunker
│   ├── cluster-semantic.ts          # Chroma's cluster semantic chunker
│   ├── token.ts                     # Token-based chunker
│   ├── markdown.ts                  # Structure-aware Markdown chunker
│   └── llm-semantic.ts             # LLM-driven semantic chunker
├── retrievers/pipeline/
│   ├── llm.interface.ts             # PipelineLLM interface
│   └── refinement/
│       ├── mmr.ts                   # Maximal Marginal Relevance
│       ├── dedup.ts                 # Deduplication
│       └── expand-context.ts        # Context window expansion
└── experiments/
    └── presets.ts                   # Named preset registry
```

### Files to Modify

```
packages/eval-lib/src/
├── embedders/index.ts               # Re-export new embedders
├── rerankers/
│   ├── cohere.ts                    # Add model selection
│   └── index.ts                     # Re-export new rerankers
├── chunkers/index.ts                # Re-export new chunkers
├── retrievers/pipeline/
│   ├── config.ts                    # Extend all config unions
│   ├── pipeline-retriever.ts        # New strategies, multi-query flow
│   └── index.ts                     # Re-export new types
└── experiments/index.ts             # Re-export preset registry
```

---

## Reference: Models & Benchmarks

### Embedding Models

```
Provider  │ Model                     │ Dims  │ Max Tokens │ $/1M    │ Best For
──────────┼───────────────────────────┼───────┼────────────┼─────────┼──────────────────
OpenAI    │ text-embedding-3-small    │ 1536  │ 8,191      │ $0.02   │ Cheap default
OpenAI    │ text-embedding-3-large    │ 3072  │ 8,191      │ $0.13   │ High quality
Cohere    │ embed-english-v3.0        │ 1024  │ 512        │ $0.10   │ English, input_type
Cohere    │ embed-multilingual-v3.0   │ 1024  │ 512        │ $0.10   │ 100+ languages
Voyage    │ voyage-3.5                │ 1024  │ 32,000     │ $0.06   │ Best quality/$
Voyage    │ voyage-3.5-lite           │ 512   │ 32,000     │ $0.02   │ Budget quality
Voyage    │ voyage-code-3             │ 1024  │ 32,000     │ $0.06   │ Code retrieval
Jina      │ jina-embeddings-v3        │ 1024  │ 8,192      │ ~$0.02  │ Task-specific LoRA
```

### Reranker Models

```
Provider │ Model                        │ $/1K searches │ Best For
─────────┼──────────────────────────────┼───────────────┼──────────────────────────
Cohere   │ rerank-v3.5                  │ $2.00         │ General, semi-structured
Cohere   │ rerank-english-v3.0          │ $2.00         │ English (current impl)
Jina     │ jina-reranker-v2             │ usage-based   │ Code, function-calls
Voyage   │ rerank-2.5                   │ usage-based   │ Instruction-following
```

### Chunker Benchmarks (Chroma's evaluation, text-embedding-3-large, k=5)

```
Strategy                        │ Chunk Size │ Overlap │ Recall │ Precision │ IoU
────────────────────────────────┼────────────┼─────────┼────────┼───────────┼──────
RecursiveCharacter              │ 200        │ 0       │ 88.1%  │ 7.0%      │ 6.9%
RecursiveCharacter              │ 800        │ 400     │ 85.4%  │ 1.5%      │ 1.5%
ClusterSemantic                 │ 200        │ 0       │ 87.3%  │ 8.0%      │ 8.0%
ClusterSemantic                 │ 400        │ 0       │ 91.3%  │ 4.5%      │ 4.5%
LLMSemantic                     │ N/A        │ 0       │ 91.9%  │ 3.9%      │ 3.9%
KamradtModified (semantic sim)  │ 300        │ 0       │ 87.1%  │ 2.1%      │ 2.1%
```

Key takeaway: Smaller chunks (200 tokens) with zero overlap outperform the conventional 800/400 defaults. ClusterSemantic at 200 achieves the best precision and IoU. LLMSemantic achieves the highest recall but at significant cost. These benchmarks validate that chunk strategy is a high-impact variable worth experimenting with.

### Named Preset Summary

```
Preset Name           │ Index       │ Query       │ Search      │ Refinement
──────────────────────┼─────────────┼─────────────┼─────────────┼──────────────────────
baseline-vector-rag   │ plain       │ identity    │ dense       │ —
bm25                  │ plain       │ identity    │ bm25        │ —
hybrid                │ plain       │ identity    │ hybrid(W)   │ —
hybrid-reranked       │ plain       │ identity    │ hybrid(W)   │ rerank
dense-reranked        │ plain       │ identity    │ dense       │ rerank
bm25-reranked         │ plain       │ identity    │ bm25        │ rerank
hybrid-rrf            │ plain       │ identity    │ hybrid(RRF) │ —
hybrid-rrf-reranked   │ plain       │ identity    │ hybrid(RRF) │ rerank
openclaw-style        │ plain(400)  │ identity    │ hybrid(W)   │ threshold(0.35)
hyde-dense            │ plain       │ hyde        │ dense       │ —
hyde-hybrid           │ plain       │ hyde        │ hybrid      │ —
hyde-hybrid-reranked  │ plain       │ hyde        │ hybrid      │ rerank
multi-query-dense     │ plain       │ multi-q(3)  │ dense       │ dedup
multi-query-hybrid    │ plain       │ multi-q(3)  │ hybrid      │ dedup, rerank
contextual-dense      │ contextual  │ identity    │ dense       │ —
contextual-hybrid     │ contextual  │ identity    │ hybrid      │ —
anthropic-best        │ contextual  │ identity    │ hybrid      │ rerank
parent-child-dense    │ parent-child│ identity    │ dense       │ —
diverse-hybrid        │ plain       │ identity    │ hybrid      │ mmr(0.5)
step-back-hybrid      │ plain       │ step-back   │ hybrid      │ dedup, rerank
premium               │ contextual  │ multi-q(3)  │ hybrid(5x)  │ dedup, rerank, threshold
```
