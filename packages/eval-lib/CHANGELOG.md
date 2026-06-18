# @tars-inc/eval-lib

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
