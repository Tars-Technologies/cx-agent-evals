---
"@tars-inc/eval-lib": patch
---

Let many tenants share one Qdrant collection through payload partitioning.

- `QdrantVectorStore.deleteByKnowledgeBase` now removes only the matching
  knowledge base's points with a scoped, filtered delete instead of dropping the
  whole collection, so several knowledge bases can safely share one collection.
  It accepts an optional filter to further narrow the delete (for example to a
  single index config) and treats a never-created collection as already deleted.
- `QdrantVectorStore.clear` now performs a scoped, filtered delete and refuses an
  unscoped clear, so it can no longer drop a collection that other tenants share.
  Pass a filter (or use `deleteByKnowledgeBase` / `deleteByDocument`) to delete a
  specific tenant's points.
- The `kbId` payload index is created as a tenant field so Qdrant co-locates each
  knowledge base's points on disk.
