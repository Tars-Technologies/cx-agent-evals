# Updated Pipeline Retrievers Implementation Plan

Refined from the original plan after design review. Organized into **6 vertical slices** — each slice unlocks a new set of runnable experiments. Scope: **eval-lib only** (no backend/frontend changes).

**Updated 2026-02-27**: Incorporated changes from the KB indexing management refactor (PR #18, merged from `va_kb_indexing_management`). Retrievers are now first-class backend entities separate from experiments. See [Impact of Retriever Module Refactor](#impact-of-retriever-module-refactor) for details.

---

## Table of Contents

1. [Impact of Retriever Module Refactor](#impact-of-retriever-module-refactor)
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

## Impact of Retriever Module Refactor

PR #18 (`va_kb_indexing_management`) split experiments into two separate modules: **retrievers** (KB indexing lifecycle) and **experiments** (evaluation runs). This affects our plan in several concrete ways.

### What Changed

```
BEFORE (experiments owned everything):
  Experiment = retrieverConfig + datasetId + k
  experimentActions.runExperiment:
    1. Read inline retrieverConfig
    2. Compute indexConfigHash
    3. Start/wait for indexing
    4. Run evaluation

AFTER (retrievers are first-class):
  Retriever = kbId + retrieverConfig + indexConfigHash + retrieverConfigHash + defaultK
    ├── retrieverActions.create      → create retriever record (dedup by config hash)
    ├── retrieverActions.startIndexing → trigger indexing pipeline
    └── retrieverActions.retrieve    → standalone retrieval (playground/production)

  Experiment = retrieverId + datasetId
    └── experimentActions.runExperiment → uses retriever's config, skips indexing
```

**New schema entity** — `retrievers` table with lifecycle: `configuring → indexing → ready → error`

**New eval-lib export** — `computeRetrieverConfigHash(config, k)` hashes all 4 pipeline stages + k for dedup. This is separate from `computeIndexConfigHash` which only hashes index-relevant fields.

**Frontend type mirror** — `packages/frontend/src/lib/pipeline-types.ts` mirrors eval-lib config types (without Node.js deps) and adds `k?: number` to its `PipelineConfig`. The eval-lib `PipelineConfig` does NOT have `k` — it's a runtime parameter. The frontend wraps it for UI convenience.

### Impacts on This Plan

| # | Impact | Affected Slices | Action Required |
|---|--------|-----------------|-----------------|
| 1 | **`computeRetrieverConfigHash` must handle new config types** | 3, 4, 5 | When we extend IndexConfig, QueryConfig, and RefinementStepConfig unions, the hash function serializes the full config object — new fields will be included automatically. But the **IndexHashPayload** in `computeIndexConfigHash` must be updated to include strategy-specific fields (contextual prompt, parent-child sizes, etc.). |
| 2 | **Backend `startIndexing` hardcodes `strategy: "plain"`** | 4 | `retrieverActions.ts:startIndexing` line 117 hardcodes `strategy: "plain" as const`. When we add contextual/summary/parent-child index strategies in eval-lib, the backend will need a separate follow-up PR to support them. Our plan stays eval-lib-only — just flagging this for awareness. |
| 3 | **Backend `retrieve` action only does dense vector search** | — | `retrieverActions.ts:retrieve` calls `ctx.vectorSearch()` directly (dense only, no BM25, no hybrid, no refinement). It does NOT use `PipelineRetriever`. This is fine — the backend retrieval path is separate from eval-lib pipeline evaluation. But it means the playground only tests dense retrieval today. |
| 4 | **Backend creates embedder with `createEmbedder(model)` — OpenAI only** | 1 | When we add Cohere/Voyage/Jina embedders to eval-lib, the backend will need a provider-aware factory. Out of scope for this plan but noted for backend follow-up. |
| 5 | **Frontend `pipeline-types.ts` must mirror new config types** | 3, 4, 5 | When we extend eval-lib's discriminated unions, the frontend type mirror must be updated. Out of scope for this plan (frontend follow-up). |
| 6 | **`computeIndexConfigHash` needs strategy-aware hashing** | 4 | Currently hashes: `{ strategy, chunkSize, chunkOverlap, separators, embeddingModel }`. For contextual strategy, must also hash: `contextPrompt`. For parent-child: `childChunkSize, parentChunkSize`. The `IndexHashPayload` type must become a union or the hash function must inspect `strategy` and include the relevant fields. |

### No Breaking Changes to eval-lib API

The refactor added `computeRetrieverConfigHash` as a new export but didn't change any existing interfaces. Our plan's eval-lib changes are fully additive — extending unions, adding new files. The backend and frontend follow-ups are separate PRs.

### Follow-Up Work (Not in This Plan)

These are tracked here for awareness but explicitly out of scope:

- **Backend provider factory**: Update `retrieverActions.ts` to instantiate the correct embedder/reranker based on `PipelineConfig` fields (e.g., `embeddingModel: "voyage-3.5"` → create VoyageEmbedder).
- **Backend index strategy support**: Update `startIndexing` to handle non-plain index strategies.
- **Backend full pipeline retrieval**: Update `retrieve` action to run the full `PipelineRetriever` pipeline (BM25, hybrid, refinement) instead of just dense vector search.
- **Frontend type sync**: Update `pipeline-types.ts` to mirror new eval-lib config types.
- **Frontend UI for new strategies**: Add dropdowns for embedding model provider, query strategy, index strategy, chunker selection.

---

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Goal | Full matrix sweep | Build breadth across all stages to maximize experiment grid |
| 2 | Embedding providers | All 4 (OpenAI, Cohere, Voyage, Jina) | Maximum coverage, each has unique features |
| 3 | LLM interface | Generic `PipelineLLM` + OpenAI default | Provider-agnostic, eval-lib stays clean |
| 4 | Async chunkers | New `AsyncPositionAwareChunker` interface | Clean separation, no breaking change to sync chunkers |
| 5 | Preset organization | Single registry file | Scalable, avoids 21+ boilerplate directories |
| 6 | Scope | eval-lib only | Backend integration is a separate follow-up |
| 7 | Phasing | Vertical slices | Each slice unlocks runnable experiments |
| 8 | Provider SDKs | Official SDKs for each | Type-safe, auto-retry, vendor-maintained |
| 9 | Chunker embedder | Same as pipeline's search embedder | Simpler, Chroma research confirms this is optimal |
| 10 | Multi-query fusion | Fusion-of-fusions OK | Standard in multi-query retrieval literature |
| 11 | Cost tracking | Basic token counting via callbacks | Lightweight, optional, doesn't change core API |
| 12 | Testing | Unit tests with mocks only | No real API calls in CI |

---

## Slice 1 — Provider Breadth

**Unlocks**: 4 embedders x 3 rerankers x 3 search strategies = **36 experiment configs**

This slice adds no new pipeline stages — just new providers that plug into the existing pipeline. Highest ROI starting point.

### 1a. Cohere Embedder

**File**: `packages/eval-lib/src/embedders/cohere.ts`

```typescript
// Implements: Embedder interface
// Package: cohere-ai (already in optionalDependencies)

export class CohereEmbedder implements Embedder {
  readonly name: string;     // "Cohere(embed-english-v3.0)"
  readonly dimension: number; // 1024

  static async create(options?: {
    model?: string;  // "embed-english-v3.0" | "embed-multilingual-v3.0"
    apiKey?: string;
  }): Promise<CohereEmbedder>;

  // Key implementation detail:
  // embed()      → input_type: "search_document"
  // embedQuery() → input_type: "search_query"
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
// Package: voyageai (new optionalDependency)

export class VoyageEmbedder implements Embedder {
  readonly name: string;     // "Voyage(voyage-3.5)"
  readonly dimension: number; // 1024 (varies by model)

  static async create(options?: {
    model?: string;  // "voyage-3.5" | "voyage-3.5-lite" | "voyage-3" | "voyage-code-3"
    apiKey?: string;
  }): Promise<VoyageEmbedder>;

  // Key implementation detail:
  // embed()      → input_type: "document"
  // embedQuery() → input_type: "query"
}
```

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
// Package: @jina-ai/embeddings (new optionalDependency)

export class JinaEmbedder implements Embedder {
  readonly name: string;     // "Jina(jina-embeddings-v3)"
  readonly dimension: number; // 1024

  static async create(options?: {
    model?: string;     // "jina-embeddings-v3"
    apiKey?: string;
    dimensions?: number; // Matryoshka: 32-1024, default 1024
  }): Promise<JinaEmbedder>;

  // Key implementation detail:
  // embed()      → task: "retrieval.passage"
  // embedQuery() → task: "retrieval.query"
}
```

### 1d. Update Cohere Reranker

**File**: `packages/eval-lib/src/rerankers/cohere.ts` (modify existing)

```typescript
// Change: make model configurable, upgrade default
static async create(options?: {
  model?: string;  // "rerank-v3.5" (NEW default) | "rerank-english-v3.0" (old default)
}): Promise<CohereReranker>;
```

### 1e. Jina Reranker

**File**: `packages/eval-lib/src/rerankers/jina.ts`

```typescript
// Implements: Reranker interface
// Package: @jina-ai/reranker or plain fetch to https://api.jina.ai/v1/rerank

export class JinaReranker implements Reranker {
  readonly name: string; // "Jina(jina-reranker-v2-base-multilingual)"

  static async create(options?: {
    model?: string;  // "jina-reranker-v2-base-multilingual"
    apiKey?: string;
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
// Package: voyageai (shared with VoyageEmbedder)

export class VoyageReranker implements Reranker {
  readonly name: string; // "Voyage(rerank-2.5)"

  static async create(options?: {
    model?: string;  // "rerank-2.5" | "rerank-2"
    apiKey?: string;
  }): Promise<VoyageReranker>;

  // API: POST https://api.voyageai.com/v1/rerank
  // Request: { model, query, documents: string[], top_k }
  // Response: { data: [{ index, relevance_score }] }
}
```

### 1g. Token Counting Callback

Add an optional callback to track token usage across all providers:

```typescript
// packages/eval-lib/src/embedders/embedder.interface.ts
export interface EmbedderOptions {
  readonly onTokensUsed?: (count: number, provider: string) => void;
}

// packages/eval-lib/src/rerankers/reranker.interface.ts — similar pattern
```

Each provider implementation calls `onTokensUsed` after API calls if the callback is provided. Callers can aggregate token counts for cost estimation. This is strictly optional and does not affect the core interface signatures.

### 1h. Package.json Changes

```json
{
  "optionalDependencies": {
    "chromadb": ">=1.8",
    "cohere-ai": ">=7.0",
    "openai": ">=4.0",
    "voyageai": ">=0.1",           // NEW
    "@jina-ai/embeddings": ">=1.0"  // NEW
  }
}
```

### 1i. Index Exports

**File**: `packages/eval-lib/src/embedders/index.ts` — re-export CohereEmbedder, VoyageEmbedder, JinaEmbedder
**File**: `packages/eval-lib/src/rerankers/index.ts` — re-export JinaReranker, VoyageReranker

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

  // Algorithm:
  // 1. Split text into sentences using regex
  //    Pattern: /(?<=[.!?])\s+(?=[A-Z])/ with abbreviation handling
  //    Track character offset of each sentence
  // 2. Group adjacent sentences until total length approaches maxChunkSize
  // 3. If overlapSentences > 0, keep last N sentences as overlap for next chunk
  // 4. Each chunk: start = first sentence start, end = last sentence end
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

  // Algorithm:
  // 1. Tokenize full text with js-tiktoken
  // 2. Group tokens into chunks of maxTokens with overlapTokens overlap
  // 3. Decode each group back to text
  // 4. Map token boundaries to character offsets for position tracking
  //    start = charOffset(firstToken), end = charOffset(lastToken) + lastTokenLength
}
```

**New dependency**: `js-tiktoken` (add to dependencies, not optional — it's lightweight and wasm-based)

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

  // Algorithm:
  // 1. Scan text for header lines matching configured levels
  //    Pattern: /^(#{1,6})\s+(.+)$/gm
  // 2. Split into sections at header boundaries
  // 3. Each section includes its header as first line
  // 4. If mergeSmallSections: merge adjacent sections under maxChunkSize
  // 5. If section > maxChunkSize: sub-split with RecursiveCharacterChunker
  // 6. Position tracking: each section's start/end from regex match positions
}
```

### 2d. Chunker Index Exports

**File**: `packages/eval-lib/src/chunkers/index.ts` — re-export all new chunkers

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

/**
 * Optional token tracking callback.
 */
export interface PipelineLLMOptions {
  readonly onTokensUsed?: (count: number, model: string) => void;
}
```

### 3b. OpenAI LLM Implementation

**File**: `packages/eval-lib/src/retrievers/pipeline/llm-openai.ts`

```typescript
export class OpenAIPipelineLLM implements PipelineLLM {
  static async create(options?: {
    model?: string;       // default "gpt-4o-mini"
    temperature?: number; // default 0.2
    apiKey?: string;
    onTokensUsed?: (count: number, model: string) => void;
  }): Promise<OpenAIPipelineLLM>;

  complete(prompt: string): Promise<string>;
  // Uses: openai.chat.completions.create({ model, messages: [{ role: "user", content: prompt }] })
  // Calls onTokensUsed with usage.total_tokens after each call
}
```

### 3c. PipelineRetrieverDeps Update

```typescript
// packages/eval-lib/src/retrievers/pipeline/pipeline-retriever.ts

export interface PipelineRetrieverDeps {
  readonly chunker: PositionAwareChunker | AsyncPositionAwareChunker;  // UPDATED
  readonly embedder: Embedder;
  readonly vectorStore?: VectorStore;
  readonly reranker?: Reranker;
  readonly llm?: PipelineLLM;  // NEW
}
```

Constructor validates: if config uses an LLM-requiring strategy but no `llm` provided, throw.

### 3d. Query Stage Config Types

**File**: `packages/eval-lib/src/retrievers/pipeline/config.ts` — extend QueryConfig union:

```typescript
export interface IdentityQueryConfig {
  readonly strategy: "identity";
}

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

export type QueryConfig =
  | IdentityQueryConfig
  | HydeQueryConfig
  | MultiQueryConfig
  | StepBackQueryConfig
  | RewriteQueryConfig;
```

### 3e. Multi-Query Pipeline Flow

The `retrieve()` method changes to always work with an array of queries:

```typescript
async retrieve(query: string, k: number): Promise<PositionAwareChunk[]> {
  // QUERY stage — always returns string[]
  const queries = await this._processQuery(query);

  // SEARCH stage — search for each query, fuse across queries
  let scoredResults: ScoredChunk[];
  if (queries.length === 1) {
    scoredResults = await this._searchSingle(queries[0], k);
  } else {
    // Run search for each query in parallel
    const perQueryResults = await Promise.all(
      queries.map(q => this._searchSingle(q, k * 2)) // over-fetch per query
    );
    // Fuse across queries using RRF
    scoredResults = this._fuseAcrossQueries(perQueryResults);
  }

  // REFINEMENT stage — unchanged
  scoredResults = await this._applyRefinements(query, scoredResults, k);
  return scoredResults.slice(0, k).map(({ chunk }) => chunk);
}

private async _processQuery(query: string): Promise<string[]> {
  switch (this._queryConfig.strategy) {
    case "identity":
      return [query];
    case "hyde":
      const hypothetical = await this._llm!.complete(hydePrompt(query));
      return [hypothetical];
    case "multi-query":
      const variants = await this._llm!.complete(multiQueryPrompt(query, numQueries));
      return parseVariants(variants); // parse newline-separated queries
    case "step-back":
      const abstract = await this._llm!.complete(stepBackPrompt(query));
      return config.includeOriginal ? [query, abstract] : [abstract];
    case "rewrite":
      const rewritten = await this._llm!.complete(rewritePrompt(query));
      return [rewritten];
  }
}
```

### 3f. Default Prompts

**File**: `packages/eval-lib/src/retrievers/pipeline/query/prompts.ts`

Store default prompts for each query strategy. Each can be overridden via config. Keep prompts concise and generic:

```typescript
export const DEFAULT_HYDE_PROMPT = `Write a short passage (100-200 words) that would answer the following question. Do not include the question itself, just the answer passage.\n\nQuestion: `;

export const DEFAULT_MULTI_QUERY_PROMPT = `Generate {n} different search queries that would help find information to answer the following question. Return one query per line, no numbering.\n\nQuestion: `;

export const DEFAULT_STEP_BACK_PROMPT = `Given the following question, generate a more general, abstract version that would retrieve broader background knowledge. Return only the abstract question.\n\nOriginal question: `;

export const DEFAULT_REWRITE_PROMPT = `Rewrite the following question to be more precise and optimized for document retrieval. Return only the rewritten question.\n\nOriginal question: `;
```

---

## Slice 4 — Index Stage Strategies

**Unlocks**: Contextual + Summary + Parent-Child indexing. Multiplies experiment grid by ~4x index strategies.

### 4a. Index Config Types

**File**: `packages/eval-lib/src/retrievers/pipeline/config.ts` — extend IndexConfig to discriminated union:

```typescript
export interface PlainIndexConfig {
  readonly strategy: "plain";
  readonly chunkSize?: number;          // default 1000
  readonly chunkOverlap?: number;       // default 200
  readonly separators?: readonly string[];
  readonly embeddingModel?: string;
}

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

export type IndexConfig =
  | PlainIndexConfig
  | ContextualIndexConfig
  | SummaryIndexConfig
  | ParentChildIndexConfig;
```

### 4b. Contextual Indexing Implementation

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

### 4c. Summary Indexing Implementation

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

### 4d. Parent-Child Indexing Implementation

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

### 4e. Update computeIndexConfigHash and computeRetrieverConfigHash

Both hash functions in `config.ts` must handle the new index strategies.

**`computeIndexConfigHash`** — Currently uses a fixed `IndexHashPayload` type. Must become strategy-aware:

```typescript
function computeIndexConfigHash(config: PipelineConfig): string {
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
        // Note: concurrency does NOT affect output, so exclude from hash
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

  const json = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash("sha256").update(json).digest("hex");
}
```

**`computeRetrieverConfigHash`** — Already serializes the full config (including `index`, `query`, `search`, `refinement`). Since it uses `JSON.stringify` on the raw config objects, new fields on extended types will be included automatically. However, we should ensure default values are applied before hashing (e.g., if `contextPrompt` is omitted, use the default). The implementation should call `computeIndexConfigHash` for the index portion and compose the full hash from resolved values.

**Key principle**: Two configs that produce identical retrieval behavior should hash identically. Fields that affect output (prompts, sizes, models) go in the hash. Fields that affect performance but not output (concurrency, batchSize) do NOT.

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
```

#### Expand-Context (`type: "expand-context"`)

**File**: `packages/eval-lib/src/retrievers/pipeline/refinement/expand-context.ts`

```typescript
export interface ExpandContextRefinementStep {
  readonly type: "expand-context";
  readonly windowChars?: number; // default 500
}

// For each chunk:
//   newStart = max(0, chunk.start - windowChars)
//   newEnd = min(doc.content.length, chunk.end + windowChars)
//   Return new PositionAwareChunk with expanded span and content
//
// Requires corpus reference (stored during init()).
```

**Pipeline change**: Store `this._corpus = corpus` during `init()`. The expand-context refinement step receives it.

#### Config Type Update

```typescript
export type RefinementStepConfig =
  | RerankRefinementStep
  | ThresholdRefinementStep
  | DedupRefinementStep
  | MmrRefinementStep
  | ExpandContextRefinementStep;
```

### 5b. AsyncPositionAwareChunker Interface

**File**: `packages/eval-lib/src/chunkers/chunker.interface.ts` — add:

```typescript
export interface AsyncPositionAwareChunker {
  readonly name: string;
  chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]>;
}

export function isAsyncPositionAwareChunker(
  chunker: PositionAwareChunker | AsyncPositionAwareChunker
): chunker is AsyncPositionAwareChunker {
  // Detect by checking if return value is thenable
  // OR: use a discriminator property like `readonly async: true`
}
```

**Pipeline change**: In `pipeline-retriever.ts`, `init()` checks the chunker type:
```typescript
const rawChunks = isAsyncPositionAwareChunker(this._chunker)
  ? await this._chunker.chunkWithPositions(doc)
  : this._chunker.chunkWithPositions(doc);
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

  constructor(embedder: Embedder, options?: SemanticChunkerOptions);

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]>;

  // Algorithm:
  // 1. Split text into sentences (reuse regex from SentenceChunker)
  // 2. Embed all sentences via this.embedder.embed(sentences)
  // 3. Compute cosine similarity between consecutive sentence embeddings
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

  constructor(embedder: Embedder, options?: ClusterSemanticChunkerOptions);

  async chunkWithPositions(doc: Document): Promise<PositionAwareChunk[]>;

  // Algorithm (dynamic programming):
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

### 5e. LLM Semantic Chunker

**File**: `packages/eval-lib/src/chunkers/llm-semantic.ts`

```typescript
export interface LLMSemanticChunkerOptions {
  segmentSize?: number;  // default 50 (chars per segment)
  batchSize?: number;    // default 800 (chars per LLM batch)
}

export class LLMSemanticChunker implements AsyncPositionAwareChunker {
  readonly name: string; // "LLMSemantic"

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

**File**: `packages/eval-lib/src/experiments/presets.ts`

```typescript
import type { PipelineConfig } from "../retrievers/pipeline/config.js";
import type { PipelineRetrieverDeps } from "../retrievers/pipeline/pipeline-retriever.js";
import { PipelineRetriever } from "../retrievers/pipeline/pipeline-retriever.js";

// ─── Preset Configs ───────────────────────────────────────────────────────

export const PIPELINE_PRESETS = {

  // === Dense variants ===
  "baseline-vector-rag": {
    name: "baseline-vector-rag",
    index: { strategy: "plain" },
    search: { strategy: "dense" },
  },
  "dense-reranked": {
    name: "dense-reranked",
    index: { strategy: "plain" },
    search: { strategy: "dense" },
    refinement: [{ type: "rerank" }],
  },

  // === BM25 variants ===
  "bm25": {
    name: "bm25",
    index: { strategy: "plain" },
    search: { strategy: "bm25" },
  },
  "bm25-reranked": {
    name: "bm25-reranked",
    index: { strategy: "plain" },
    search: { strategy: "bm25" },
    refinement: [{ type: "rerank" }],
  },

  // === Hybrid variants ===
  "hybrid": {
    name: "hybrid",
    index: { strategy: "plain" },
    search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, fusionMethod: "weighted", candidateMultiplier: 4 },
  },
  "hybrid-reranked": {
    name: "hybrid-reranked",
    index: { strategy: "plain" },
    search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, fusionMethod: "weighted", candidateMultiplier: 4 },
    refinement: [{ type: "rerank" }],
  },
  "hybrid-rrf": {
    name: "hybrid-rrf",
    index: { strategy: "plain" },
    search: { strategy: "hybrid", fusionMethod: "rrf", candidateMultiplier: 4 },
  },
  "hybrid-rrf-reranked": {
    name: "hybrid-rrf-reranked",
    index: { strategy: "plain" },
    search: { strategy: "hybrid", fusionMethod: "rrf", candidateMultiplier: 4 },
    refinement: [{ type: "rerank" }],
  },

  // === OpenClaw-style ===
  "openclaw-style": {
    name: "openclaw-style",
    index: { strategy: "plain", chunkSize: 400, chunkOverlap: 80 },
    search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, fusionMethod: "weighted", candidateMultiplier: 4 },
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
    search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
  },
  "hyde-hybrid-reranked": {
    name: "hyde-hybrid-reranked",
    index: { strategy: "plain" },
    query: { strategy: "hyde" },
    search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
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
    search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
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
    search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
  },
  "anthropic-best": {
    name: "anthropic-best",
    index: { strategy: "contextual" },
    search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
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
    search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
    refinement: [{ type: "mmr", lambda: 0.5 }],
  },

  // === Step-Back ===
  "step-back-hybrid": {
    name: "step-back-hybrid",
    index: { strategy: "plain" },
    query: { strategy: "step-back", includeOriginal: true },
    search: { strategy: "hybrid", denseWeight: 0.7, sparseWeight: 0.3, candidateMultiplier: 4 },
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

// ─── Factory ───────────────────────────────────────────────────────────────

export function getPresetConfig(name: PresetName): PipelineConfig {
  return PIPELINE_PRESETS[name];
}

export function createPresetRetriever(
  name: PresetName,
  deps: PipelineRetrieverDeps,
  overrides?: Partial<PipelineConfig>,
): PipelineRetriever {
  const baseConfig = PIPELINE_PRESETS[name];
  const config: PipelineConfig = {
    ...baseConfig,
    ...overrides,
    name: overrides?.name ?? baseConfig.name,
  };
  return new PipelineRetriever(config, deps);
}
```

Existing 4 preset directories (`baseline-vector-rag/`, `bm25/`, `hybrid/`, `hybrid-reranked/`) remain for backwards compatibility. Their factory functions continue to work.

---

## Infrastructure Changes Summary

All infrastructure changes needed across slices, consolidated.

### Note on `k` and PipelineConfig

The frontend's `pipeline-types.ts` added `k?: number` to its `PipelineConfig` copy. The eval-lib `PipelineConfig` intentionally does NOT include `k` — it's a runtime parameter passed to `retrieve(query, k)`, not a pipeline config property. The backend stores `k` as `defaultK` on the retriever entity.

**Decision**: Keep `k` out of eval-lib's `PipelineConfig`. The frontend wraps it for UI convenience. The `computeRetrieverConfigHash(config, k)` function already accepts `k` as a separate parameter, which is the correct pattern.

### Note on config type mirroring

`packages/frontend/src/lib/pipeline-types.ts` manually mirrors the eval-lib config types without Node.js deps. When we extend the discriminated unions in eval-lib (IndexConfig, QueryConfig, RefinementStepConfig), the frontend types must be updated in a separate follow-up PR. To minimize drift, the plan should use the same interface names and field names in eval-lib as the frontend expects.

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

### config.ts Changes

| Change | Slice | Description |
|--------|-------|-------------|
| `IndexConfig` discriminated union | 4 | Plain \| Contextual \| Summary \| ParentChild |
| `QueryConfig` union extension | 3 | + Hyde \| MultiQuery \| StepBack \| Rewrite |
| `RefinementStepConfig` union extension | 5 | + Dedup \| Mmr \| ExpandContext |
| `computeIndexConfigHash` update | 4 | Include strategy-specific fields |

---

## File Inventory

### New Files (22)

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
├── retrievers/pipeline/
│   ├── llm.interface.ts                  # Slice 3
│   ├── llm-openai.ts                     # Slice 3
│   ├── query/
│   │   └── prompts.ts                    # Slice 3
│   └── refinement/
│       ├── dedup.ts                      # Slice 5
│       ├── mmr.ts                        # Slice 5
│       └── expand-context.ts             # Slice 5
└── experiments/
    └── presets.ts                         # Slice 6

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
└── unit/experiments/
    └── presets.test.ts                   # Slice 6
```

### Modified Files (8)

```
packages/eval-lib/src/
├── embedders/index.ts                    # Re-exports (Slice 1)
├── rerankers/
│   ├── cohere.ts                         # Model selection (Slice 1)
│   └── index.ts                          # Re-exports (Slice 1)
├── chunkers/
│   ├── chunker.interface.ts              # AsyncPositionAwareChunker (Slice 5)
│   └── index.ts                          # Re-exports (Slice 2, 5)
├── retrievers/pipeline/
│   ├── config.ts                         # Type unions (Slice 3, 4, 5)
│   ├── pipeline-retriever.ts             # Core pipeline (Slice 3, 4, 5)
│   └── index.ts                          # Re-exports (Slice 3, 4, 5)
└── experiments/index.ts                  # Re-exports (Slice 6)

packages/eval-lib/package.json            # New dependencies (Slice 1, 2)
```

---

## Testing Strategy

**Approach**: Unit tests with mocks only. No real API calls in tests.

### Provider Tests (Embedders + Rerankers)

```typescript
// Pattern: mock the SDK client, verify correct API calls

// Example: CohereEmbedder test
it("should call embed with input_type search_document for embed()", async () => {
  const mockClient = { embed: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }) };
  const embedder = new CohereEmbedder({ client: mockClient, model: "embed-english-v3.0" });

  await embedder.embed(["test text"]);

  expect(mockClient.embed).toHaveBeenCalledWith(
    expect.objectContaining({ input_type: "search_document" })
  );
});

it("should call embed with input_type search_query for embedQuery()", async () => {
  // ... input_type: "search_query"
});
```

### Chunker Tests

```typescript
// Pattern: verify positions match source text, chunk sizes respect limits

it("should produce chunks whose start/end positions match source text", () => {
  const doc = { id: "d1", content: "Full document text...", metadata: {} };
  const chunks = chunker.chunkWithPositions(doc);

  for (const chunk of chunks) {
    expect(doc.content.slice(chunk.start, chunk.end)).toBe(chunk.content);
  }
});

it("should not exceed maxChunkSize", () => {
  // ... verify all chunks <= maxChunkSize
});
```

### Pipeline Strategy Tests

```typescript
// Pattern: mock LLM, mock embedder, verify pipeline stages execute correctly

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
```

### Verification Checklist

After each slice:
1. `pnpm -C packages/eval-lib build` — TypeScript compiles
2. `pnpm -C packages/eval-lib test` — all tests pass (existing 133 + new)
3. `pnpm typecheck` — no type errors across workspace

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
| 6 (Presets) | — | — | — | — | — | 21 named presets |

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
| premium | contextual | multi-q(3) | hybrid(5x) | dedup, rerank, threshold |
