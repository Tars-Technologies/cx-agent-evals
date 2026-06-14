# @tars-inc/eval-lib

Composable TypeScript building blocks for evaluating RAG retrieval pipelines and CX (customer experience) agents end-to-end.

**Capabilities:**

- **Span-based RAG evaluation** — character-level recall, precision, IoU, F1 against ground-truth spans (not just chunk IDs)
- **Configurable retrieval pipelines** — mix and match index strategies (Plain / Contextual / Summary / ParentChild), query rewriting (HyDE, MultiQuery, StepBack), search backends (Dense / BM25 / Hybrid), and refinement steps (Rerank / Threshold / Dedup / MMR / ExpandContext)
- **Provider-based retrieval infrastructure** — select embedder, reranker, and vector-store providers behind shared interfaces, including Qdrant-backed indexes
- **Synthetic dataset generation** — three strategies: `SimpleStrategy`, `DimensionDrivenStrategy`, `RealWorldGroundedStrategy`, plus token-level ground-truth assignment
- **Conversation analysis** — transcript parsing, microtopic extraction, message-type classification, agent-level statistics
- **Source ingestion** — configurable in-process or remote scraping/parsing, plus PDF, Markdown, and HTML file processing
- **LangSmith integration** — dataset upload, experiment runner, evaluator factory

## Install

```bash
pnpm add @tars-inc/eval-lib@beta
```

Optional peer dependencies — install whichever providers you use:

```bash
pnpm add openai           # OpenAIEmbedder, OpenRouter embeddings, pipeline LLM client
pnpm add @anthropic-ai/sdk  # Claude-based conversation classification
pnpm add langsmith        # LangSmith dataset / experiment runner
```

Cohere, Jina, and Voyage embedders/rerankers call the provider HTTP APIs directly, so they need no extra package, only the matching API key.

## Quick start: span-based evaluation with a custom retriever

```typescript
import {
  createDocument,
  createCorpus,
  CallbackRetriever,
  computeMetrics,
  recall,
  precision,
  f1,
  PositionAwareChunkId,
  DocumentId,
} from "@tars-inc/eval-lib";

const corpus = createCorpus([
  createDocument({
    id: "faq.md",
    content: "How do I reset my password? Click 'Forgot Password' on the login page.",
  }),
]);

const retriever = new CallbackRetriever({
  name: "keyword-matcher",
  retrieveFn: async (query, k) => [
    {
      id: PositionAwareChunkId("chunk-1"),
      content: "Click 'Forgot Password' on the login page.",
      docId: DocumentId("faq.md"),
      start: 28,
      end: 70,
      metadata: {},
    },
  ],
});

await retriever.init(corpus);

const result = await computeMetrics({
  retriever,
  corpus,
  metrics: [recall, precision, f1],
  examples: [
    {
      inputs: { query: "how do I reset my password" },
      outputs: {
        relevantSpans: [{
          docId: "faq.md",
          start: 28,
          end: 70,
          text: "Click 'Forgot Password' on the login page.",
        }],
      },
      metadata: {},
    },
  ],
});

console.log(result);
await retriever.cleanup();
```

## Using a built-in retriever preset

```typescript
import { createHybridRerankedRetriever } from "@tars-inc/eval-lib";
import { OpenAIEmbedder } from "@tars-inc/eval-lib/embedders/openai";
import { CohereReranker } from "@tars-inc/eval-lib/rerankers/cohere";

const embedder = await OpenAIEmbedder.create({ model: "text-embedding-3-small" });
const reranker = new CohereReranker({ model: "rerank-english-v3.0" });

const retriever = createHybridRerankedRetriever({ embedder, reranker });
await retriever.init(corpus);
const hits = await retriever.retrieve("how do I reset my password", 10);
```

## Generating a synthetic evaluation dataset

```typescript
import {
  SimpleStrategy,
  GroundTruthAssigner,
  RecursiveCharacterChunker,
  openAIClientAdapter,
} from "@tars-inc/eval-lib";
import OpenAI from "openai";

const llm = openAIClientAdapter(new OpenAI());
const strategy = new SimpleStrategy({ queriesPerDoc: 5 });
const chunker = new RecursiveCharacterChunker({ chunkSize: 500, chunkOverlap: 50 });

const queries = await strategy.generate({ corpus, llm, model: "gpt-4o-mini" });
const groundTruth = await new GroundTruthAssigner({ chunker }).assign(queries, corpus);
```

Other strategies:
- `DimensionDrivenStrategy` — generates orthogonal coverage across dimensions you define (task type, difficulty, persona, etc.)
- `RealWorldGroundedStrategy` — matches a list of real user questions to documents via embedding similarity, then synthesizes variants

## Sub-path entry points

Provider-specific code lives in sub-paths so you only pay for what you import:

| Path | Contents |
|---|---|
| `@tars-inc/eval-lib` | Core types, chunkers, retrievers, metrics, synthetic generation, presets |
| `@tars-inc/eval-lib/embedders/openai` | `OpenAIEmbedder` |
| `@tars-inc/eval-lib/embedders/cohere` | `CohereEmbedder` |
| `@tars-inc/eval-lib/embedders/voyage` | `VoyageEmbedder` |
| `@tars-inc/eval-lib/embedders/jina` | `JinaEmbedder` |
| `@tars-inc/eval-lib/embedders/make-embedder` | `makeEmbedder` factory, `EmbedderConfig`, `EmbedderProvider` |
| `@tars-inc/eval-lib/rerankers/cohere` | `CohereReranker` |
| `@tars-inc/eval-lib/rerankers/jina` | `JinaReranker` |
| `@tars-inc/eval-lib/rerankers/voyage` | `VoyageReranker` |
| `@tars-inc/eval-lib/rerankers/make-reranker` | `makeReranker` factory, `RerankerConfig`, `RerankerProvider` |
| `@tars-inc/eval-lib/pipeline/internals` | `BM25SearchIndex`, fusion (`weightedScoreFusion`, `reciprocalRankFusion`), dimension discovery, refinement defaults |
| `@tars-inc/eval-lib/pipeline/llm-openai` | `OpenAIPipelineLLM` for query expansion / rewrite |
| `@tars-inc/eval-lib/llm` | `createLLMClient`, `createEmbedder`, `getModel`, `DEFAULT_MODEL` (Node-only) |
| `@tars-inc/eval-lib/langsmith` | `getLangSmithClient`, `uploadDataset`, `runLangSmithExperiment`, `createLangSmithEvaluator` (Node-only) |
| `@tars-inc/eval-lib/utils` | Hashing, span helpers, retry, concurrency, cosine similarity |
| `@tars-inc/eval-lib/shared` | Constants and shared types (`JobStatus`, `SerializedSpan`, `ExperimentResult`) |
| `@tars-inc/eval-lib/file-processing` | `processFile`, `htmlToMarkdown`, `pdfToMarkdown` |
| `@tars-inc/eval-lib/scraper` | `makeScraper` / `makeParser` factories, `Scraper` / `Parser` interfaces, `ContentScraper`, `assertPublicHttpUrl`, callback signing helpers, `filterLinks`, `normalizeUrl` |
| `@tars-inc/eval-lib/registry` | Component registries for embedders, rerankers, chunkers, strategies, presets |
| `@tars-inc/eval-lib/data-analysis` | `parseTranscript`, `parseBotFlowInput`, `computeBasicStats`, `classifyMessageTypes`, `extractMicrotopics` |

## Embedder and reranker providers

`makeEmbedder` and `makeReranker` build an `Embedder` / `Reranker` behind the unified interfaces, so callers pick a provider via config without depending on the implementation. API keys fall back to each provider's env var; pass `apiKey` to override.

Embedder providers:

| Provider | Selector | Default model | API key env var |
|---|---|---|---|
| OpenAI (default) | `"openai"` (or omit `provider`) | `text-embedding-3-small` | `OPENAI_API_KEY` |
| OpenRouter | `"openrouter"` | pass a vendor-prefixed id, e.g. `openai/text-embedding-3-large` | `OPENROUTER_API_KEY` |
| Cohere | `"cohere"` | `embed-english-v3.0` | `COHERE_API_KEY` |

Reranker providers:

| Provider | Selector | Default model | API key env var |
|---|---|---|---|
| Cohere (default) | `"cohere"` (or omit `provider`) | `rerank-english-v3.0` | `COHERE_API_KEY` |
| Jina | `"jina"` | `jina-reranker-v2-base-multilingual` | `JINA_API_KEY` |
| Voyage | `"voyage"` | `rerank-2.5` | `VOYAGE_API_KEY` |

```ts
import { makeEmbedder } from "@tars-inc/eval-lib/embedders/make-embedder"
import { makeReranker } from "@tars-inc/eval-lib/rerankers/make-reranker"

// Defaults: OpenAI embeddings + Cohere reranking, keys from env
const embedder = await makeEmbedder()
const reranker = await makeReranker()

// OpenRouter routes the same models under vendor-prefixed ids
const openrouter = await makeEmbedder({
  provider: "openrouter",
  model: "openai/text-embedding-3-large"
})

// Explicit key instead of the env var
const voyage = await makeReranker({ provider: "voyage", apiKey: "<key>" })
```

Note: Cohere, Jina, and Voyage are called over their plain HTTP APIs with
retry/backoff and a 30-second default request timeout; only `"openai"` and
`"openrouter"` import the `openai` package.

## Scraper / parser providers

`@tars-inc/eval-lib/scraper` exposes `makeScraper` / `makeParser` factories behind unified `Scraper` and `Parser` interfaces, so callers pick a backend via config without depending on the implementation.

Available backends:

| Backend | Selector | What it does |
|---|---|---|
| In-process (default) | `"inprocess"` (or omit `backend`) | Single-page scraping (`scrapePage`) via `ContentScraper`, plus synchronous HTML / PDF / text parsing (`parseFile`). Runs in your process. |
| Remote content service | `"tarser"` | Submits crawl / parse jobs to an external HTTP service and returns results asynchronously via signed callbacks (`startCrawl` / `startParse` / `cancel`). |

```ts
import { makeScraper, makeParser } from "@tars-inc/eval-lib/scraper"

// In-process (default): no config needed
const scraper = makeScraper()
const parser = makeParser()
// equivalently: makeScraper({ backend: "inprocess", userAgent: "my-bot/1.0" })

// Remote content service
const remoteScraper = makeScraper({
  backend: "tarser",
  baseUrl: "https://content.example.com",
  apiToken: "<service token>",
  hmacSecret: "<callback signing secret>"
})
const remoteParser = makeParser({
  backend: "tarser",
  baseUrl: "https://content.example.com",
  apiToken: "<service token>",
  hmacSecret: "<callback signing secret>"
})
```

Notes:

- The factories default to the in-process backend when no config (or no `backend`) is passed.
- The remote backend posts results to a callback URL you supply. Hash the raw callback body with `computeBodyHash`, then verify `serviceJobId`, token, timestamp, nonce, and body hash with `verifyCallbackSignature`. Enforce timestamp freshness and nonce replay protection in the receiving application.
- Remote health, submit, parse, and cancellation requests use a 30-second default timeout. Empty or non-JSON successful responses are rejected with an error that includes the HTTP status and a response-body snippet.
- The in-process scraper enforces an SSRF guard (`assertPublicHttpUrl`): only `http` / `https` to public hosts, redirects re-validated per hop, and responses capped by content type and size.

## Vector store providers

`makeVectorStore` (main barrel) builds a `VectorStore` behind a unified interface, so callers pick a backend via config without depending on the implementation.

| Backend | Selector | What it does |
|---|---|---|
| Host-backed | `"native"` | The host app supplies the search implementation through callbacks (e.g. a database's built-in vector index). |
| In-process | `"memory"` | `InMemoryVectorStore` for tests and local experiments. |
| Qdrant | `"qdrant"` | An external Qdrant collection over its REST API. Self-contained point payloads, deterministic point ids, any embedding dimension. A single collection can hold many tenants, separated by payload filters. |

```ts
import { makeVectorStore } from "@tars-inc/eval-lib"

// In-process (tests, local experiments)
const memory = makeVectorStore({ backend: "memory" })

// Qdrant (any embedding dimension; one collection can hold many tenants)
const qdrant = makeVectorStore({
  backend: "qdrant",
  url: "https://xyz.cloud.qdrant.io:6333",
  apiKey: process.env.QDRANT_API_KEY,
  collection: "my-index",
  dimension: 1024
})

// Host-backed (the host app supplies the search implementation)
const native = makeVectorStore(
  { backend: "native" },
  { native: { name: "my-db", search: async (embedding, { k }) => [] } }
)
```

Notes on the Qdrant backend:

- Qdrant endpoints must use HTTPS; plain HTTP URLs are rejected.
- The collection and its keyword payload indexes for the filterable fields (`kbId`, `indexConfigHash`, `documentId`) are ensured before the first `add`. The `kbId` index is created as a tenant field so Qdrant co-locates each tenant's points on disk. Existing collections are backfilled so filtered search and delete work on strict-mode instances such as Qdrant Cloud.
- Many tenants and index configs can share one collection: every point carries `kbId`, `indexConfigHash`, and `documentId` in its payload, and `search` filters on whichever of those a caller passes. `deleteByKnowledgeBase` and `deleteByDocument` are scoped, filtered deletes that remove only the matching points, so deleting one tenant or document leaves the rest of the collection untouched.
- `checkHealth()` is a passive collection probe: it returns `false` when the collection is missing and never creates or repairs it. Searching a missing collection returns no results.
- Collection creation tolerates a concurrent create conflict by re-verifying the winner and throws loudly when an existing collection's dimension does not match the configured one.
- Point payloads carry the chunk text and character offsets, so search results need no separate hydration step; upserts are idempotent via point ids derived from the chunk id.
- Each REST request is retried with backoff and bounded by `timeoutMs` (default `30000`) so a hung request cannot stall indefinitely. A scoped delete against a never-created collection, and dropping a collection that is already gone, are both treated as success, so cleanup is safe to retry. `clear()` with no filter drops the whole collection; passing a filter makes it a scoped delete instead.

`StatelessQueryRetriever` runs the query-time pipeline (query expansion, dense/BM25/hybrid search, refinement chain) over an existing index reached through a `VectorStore` plus a `ChunkSource`, with `retrieveWithTrace()` reporting every stage's inputs, outputs, and latency.

## Key concepts

- **`PositionAwareChunker`** — chunkers that preserve `start`/`end` character offsets in the source document. Required for span-based metrics.
- **`Retriever` interface** — `init(corpus)` → `retrieve(query, k)` → `cleanup()`. Returns `PositionAwareChunk[]` with character offsets, enabling span-overlap metrics rather than chunk-ID matching.
- **Span-based metrics** — `recall`, `precision`, `iou`, `f1` operate on `CharacterSpan[]` and compute character-level overlap. `mergeOverlappingSpans` coalesces before comparison.
- **`PipelineRetriever`** — config-driven retriever composed of `IndexConfig` × `QueryConfig` × `SearchConfig` × `RefinementStepConfig[]`. Use the preset factories (`createBaselineVectorRagRetriever`, `createBM25Retriever`, `createHybridRetriever`, `createHybridRerankedRetriever`) for common combinations.

## What this library is not

- Not a vector database: it connects to external stores (Qdrant) and ships `InMemoryVectorStore` for dev/test, but vector storage itself is delegated
- Not an LLM provider — wraps OpenAI / Cohere / Anthropic SDKs
- Not a UI library or deployment platform
- Not a multi-turn chat engine — focused on single-turn retrieval and conversation analysis

## Source

Source, tests, and end-to-end examples: [Tars-Technologies/cx-agent-evals](https://github.com/Tars-Technologies/cx-agent-evals) under `packages/eval-lib/`.

## License

MIT
