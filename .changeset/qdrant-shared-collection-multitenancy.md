---
"@tars-inc/eval-lib": patch
---

Let many tenants share one Qdrant collection through payload partitioning.

- `QdrantVectorStore.deleteByKnowledgeBase` now removes only the matching
  knowledge base's points with a scoped, filtered delete instead of dropping the
  whole collection, so several knowledge bases can safely share one collection.
  It accepts an optional filter to further narrow the delete (for example to a
  single index config) and treats a never-created collection as already deleted.
- `QdrantVectorStore.clear` accepts an optional filter for scoped deletion; with
  no filter it still resets the entire collection.
- The `kbId` payload index is created as a tenant field so Qdrant co-locates each
  knowledge base's points on disk.
