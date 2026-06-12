---
"@tars-inc/eval-lib": minor
---

Unified vector-store providers and a stateless, trace-capable retriever.

- `makeVectorStore({ backend: "native" | "memory" | "qdrant" })` builds a
  `VectorStore` for the selected backend: host-supplied callbacks (native),
  an in-process store (memory), or a Qdrant collection over its REST API
  (qdrant: self-contained payloads, deterministic point ids, any embedding
  dimension).
- The Qdrant store ensures its collection and the keyword payload indexes
  for the filterable fields whenever it connects: it creates them on first
  `add` and backfills them on a collection that already existed without
  them, so filtered search and delete work on strict-mode instances such as
  Qdrant Cloud. Collection creation tolerates concurrent writers racing to
  create the same collection, fails loudly on a dimension mismatch with an
  existing collection, and treats deleting an already-absent collection as
  success so cleanup is safe to retry. Each REST request is bounded by a
  configurable timeout (`timeoutMs`, default 30s) so a hung request cannot
  stall indefinitely.
- The `VectorStore` interface gains scoped search filters, per-document and
  per-knowledge-base deletion, and health checks. `search` now takes an
  options object: `store.search(embedding, { k, filter })`.
- New `StatelessQueryRetriever` runs the query-time pipeline (query
  expansion, dense/BM25/hybrid search, refinement chain) over an existing
  index via `VectorStore` plus the new `ChunkSource` interface, with
  `retrieveWithTrace()` reporting every stage's inputs, outputs, and latency.
- Index configs accept optional `vectorBackend` and `embeddingProvider`
  fields; they affect the index-config hash only when set to non-default
  values, so existing hashes are unchanged.
- Embedder registry model choices now declare their output `dimensions` as
  structured data.
- `OpenAIEmbedder` resolves the output dimension from vendor-prefixed model
  ids (e.g. OpenRouter's `openai/text-embedding-3-large` reports 3072), so
  vector stores are sized correctly for non-default embedding models.
- `InMemoryVectorStore.add` now accumulates across calls instead of
  discarding prior contents.
