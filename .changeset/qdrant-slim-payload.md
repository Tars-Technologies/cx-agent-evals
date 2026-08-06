---
"@tars-inc/eval-lib": minor
---

QdrantVectorStore: opt-in slim point payloads.

`QdrantVectorStoreConfig` gains `payloadMode?: "full" | "slim"` (default `"full"`)
and `payloadMetadataKeys?: readonly string[]`. In `"slim"` mode a stored point
carries only `chunkId`, `docId`, `kbId`, `indexConfigHash`, `documentId` and the
allowlisted metadata keys — no chunk text, no offsets, no full metadata blob — so
the vector database holds vectors plus opaque ids and the document text can stay
in the consumer's own store of record (a data-residency prerequisite).

Indexing is unchanged: `add` still takes full chunks, and both the dense
embedding and the BM25 sparse vector are still built from the real chunk text.
`search`/`searchSparse` return slim hits with `content: ""` and zero offsets,
which the consumer must hydrate by `chunk.id`. Scoped deletes and `clear` filter
on the same payload scope fields as before.

`"full"` remains the default and is byte-identical to previous releases, so
existing consumers are unaffected.
