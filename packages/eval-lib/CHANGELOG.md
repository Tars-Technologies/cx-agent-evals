# @tars-inc/eval-lib

## 0.6.0

### Minor Changes

- fa124ca: - Add `runRetrieverEvaluation` — a framework-agnostic retriever evaluation harness that computes span metrics directly, with no LangSmith dependency.
  - Fix ground-truth span assignment silently dropping questions whose excerpts differ from the source only by smart quotes / em-dashes; such excerpts now match, and genuinely unlocatable questions are logged instead of vanishing silently.

## 0.5.0

### Minor Changes

- 263a8d6: Agent responses can now retrieve and show real images/videos from the knowledge base instead of describing them from memory or hallucinating URLs.
  - Images/videos extracted at ingest, embedded (Qdrant), ranked per query, and offered to the agent as a menu; a `get_images` tool lets it see pixels before deciding to include one.
  - Responses go through a whitelist + corrective-retry pass so only real, retrieved media can render — fabricated URLs are stripped.
  - Per-agent `enableMultimodal` toggle, manual per-image context override, and eval-side tracking (`shownImages`, `image_hygiene` checks, vision-capable judge) for scoring image usage.
  - This review pass fixed a chunk-offset desync bug, unified drifted logic across the live/sim/experiment agent paths, added failure observability, and batched a KB-wide reprocess mutation that could exceed Convex's write limits on large KBs.
  - `IMAGE_RE` now supports the optional `"title"` form (`![alt](url "title")`). Previously a titled image failed to match at all, so it was neither recognized as media nor stripped from chunk text — leaking raw markdown into embeddings. `rewriteMarkdownImages` now preserves the title when rewriting.
  - `htmlToMarkdown`'s `[embed:video]`/`[embed:doc]` token generation now escapes `"` in titles and encodes `)` in urls before interpolating them into the token. Previously a title containing a literal quote, or a url containing a literal `)` (e.g. a parenthesized filename), could prematurely close the token and leak stray page text into ingested document content.
  - `@qdrant/js-client-rest` moved from `devDependencies` to `dependencies` — `qdrant-media.ts` imports its types in method signatures, so it was only resolving via workspace hoisting rather than an honest dependency declaration.

## 0.4.2

### Patch Changes

- 4922dd4: `QdrantVectorStore` now refuses HTTP redirects (`redirect: "error"`): fetch does not strip the `api-key` header on cross-origin redirects, so following one could leak it. Qdrant itself never redirects; a setup behind a redirecting proxy now fails fast with a descriptive error instead of leaking. Other providers are unchanged.
- 786fde5: Type Qdrant wire bodies against the official `@qdrant/js-client-rest` OpenAPI schema. Type-only devDependency — the Qdrant client is never instantiated and the HTTP transport is unchanged; collection create bodies, filters, query requests, and response parsing are now schema-checked at compile time.

## 0.4.1

### Patch Changes

- 42f7190: Bump optional dependency `@anthropic-ai/sdk` from `^0.82.0` to `^0.91.1`.

## 0.4.0

### Minor Changes

- a74bb78: Add sparse (BM25) vector search to `VectorStore`. The interface gains a `supportsSparse` flag and a `searchSparse(query, opts)` method, backed by a new BM25 sparse encoder (hashed uint32 indices, doc-side `k1`/`b` values, server-side IDF). The Qdrant adapter gains a `sparse` option that builds a named-hybrid collection (`dense` + `bm25`) and serves keyword/hybrid search server-side; `sparse:false` (default) keeps the existing unnamed-dense behavior unchanged. The stateless retriever routes `bm25`/`hybrid` to `searchSparse` when the store supports it, otherwise falls back to the in-memory MiniSearch path.

  Bump `langsmith` to `^0.6.0` to clear a vulnerability in `<0.6.0`.

## 0.3.0

### Minor Changes

- 5f1d6a4: Add provider-based ingestion, embedding, reranking, and vector storage behind
  the eval-lib interfaces.

  ### Scraper and parser providers
  - Add `makeScraper` and `makeParser` factories with in-process and remote
    content-service implementations.
  - Add single-page scraping and HTML, PDF, and text parsing to the shared
    `Scraper` and `Parser` interfaces.
  - Harden in-process scraping against SSRF by restricting requests to public
    HTTP(S) hosts, validating redirects, resolving hosts through DNS-aware
    guards, and enforcing response-size limits.
  - Add body-bound callback HMAC helpers using the service job ID, callback
    token, timestamp, nonce, and SHA-256 body hash.
  - Bound remote provider requests with timeouts and clearer response errors.

  ### Embedder and reranker providers
  - Add `makeEmbedder` for OpenAI, OpenRouter, and Cohere, and `makeReranker` for
    Cohere, Jina, and Voyage.
  - Move Cohere embedding and reranking to its HTTP API, removing the
    `cohere-ai` SDK requirement.
  - Add provider and model fields to rerank refinement configuration.
  - Validate provider result indexes and bounds so returned vectors and reranked
    chunks remain aligned with their inputs.
  - Add structured embedding dimensions to registry model choices and resolve
    vendor-prefixed OpenAI model dimensions correctly.

  ### Vector stores and stateless retrieval
  - Extend `VectorStore` with scoped filters, deletion, and health capabilities,
    and add callback, in-memory, and Qdrant implementations behind
    `makeVectorStore`.
  - Add a Qdrant REST store with deterministic point IDs, self-contained chunk
    payloads, collection dimension checks, payload indexes, request timeouts,
    and idempotent collection cleanup.
  - Let many tenants share one Qdrant collection through payload partitioning:
    `deleteByKnowledgeBase` removes only the matching knowledge base's points with
    a scoped, filtered delete (accepting an optional filter to further narrow the
    delete, and treating a never-created collection as already deleted) instead of
    dropping the whole collection, and the `kbId` payload index is created as a
    tenant field so Qdrant co-locates each knowledge base's points on disk.
  - Add `ChunkSource` and `StatelessQueryRetriever` for query expansion,
    dense/BM25/hybrid search, refinement, and stage-level retrieval traces over
    an existing index.
  - Add optional `vectorBackend` and `embeddingProvider` index fields while
    preserving existing hashes when defaults are omitted.
  - Make `InMemoryVectorStore.add` accumulate entries across calls.

  ### Correctness and resilience
  - Correct recursive chunk offsets when sections begin with whitespace so chunk
    content remains aligned with its source span.
  - Reject empty citations and invalid retrieved spans, map normalized
    ground-truth matches to their original boundaries, and refine fuzzy citation
    matching.
  - Keep retrieval usable when query transforms return no valid strings, preserve
    score ordering through deduplication and context expansion, and merge expanded
    spans that overlap or touch.
  - Apply a default timeout to provider HTTP requests, reject zero-dimension
    embeddings, and warn when malformed reranker indexes truncate results.
  - Make Qdrant health checks passive, return no search results when a collection
    is not yet provisioned, and require HTTPS endpoints.
  - Make `QdrantVectorStore.clear` perform a scoped, filtered delete and refuse an
    unscoped clear, so it can no longer drop a collection that other tenants share;
    pass a filter (or use `deleteByKnowledgeBase` / `deleteByDocument`) to delete a
    specific tenant's points.

## 0.2.0

### Minor Changes

- 11b017e: Add an optional `maxConcurrency` to `runLangSmithExperiment`, forwarded to LangSmith `evaluate()`. When omitted, behavior is unchanged (sequential). This lets callers parallelize per-example retrieval to buy headroom against long-running evaluation limits.

## 0.1.2

### Patch Changes

- 999af58: Fix `embedInBatches` to use controlled concurrency instead of unbounded parallelism.

  Large corpora could trigger OpenAI rate-limit errors during embedding, causing
  generation to fail silently. Embedding batches are now processed with a concurrency
  limit of 3, preventing rate-limit bursts while keeping latency practical.

## 0.1.1

### Patch Changes

- e6b3638: Rewrite the readme to accurately reflect package scope and exports
