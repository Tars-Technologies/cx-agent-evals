---
"@tars-inc/eval-lib": minor
---

Add sparse (BM25) vector search to `VectorStore`. The interface gains a `supportsSparse` flag and a `searchSparse(query, opts)` method, backed by a new BM25 sparse encoder (hashed uint32 indices, doc-side `k1`/`b` values, server-side IDF). The Qdrant adapter gains a `sparse` option that builds a named-hybrid collection (`dense` + `bm25`) and serves keyword/hybrid search server-side; `sparse:false` (default) keeps the existing unnamed-dense behavior unchanged. The stateless retriever routes `bm25`/`hybrid` to `searchSparse` when the store supports it, otherwise falls back to the in-memory MiniSearch path.
