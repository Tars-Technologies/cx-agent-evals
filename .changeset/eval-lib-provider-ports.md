---
"@tars-inc/eval-lib": minor
---

Add provider-based ingestion, embedding, reranking, and vector storage behind
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
- Add `ChunkSource` and `StatelessQueryRetriever` for query expansion,
  dense/BM25/hybrid search, refinement, and stage-level retrieval traces over
  an existing index.
- Add optional `vectorBackend` and `embeddingProvider` index fields while
  preserving existing hashes when defaults are omitted.
- Make `InMemoryVectorStore.add` accumulate entries across calls.
