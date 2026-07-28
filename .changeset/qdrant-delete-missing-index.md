---
"@tars-inc/eval-lib": patch
---

Fix `QdrantVectorStore.deleteByDocument()`/`deleteByKnowledgeBase()` throwing on a benign race: `add()` bootstraps a brand-new collection via `ensureCollection()` (create, then three sequential payload-index PUTs for `kbId`/`indexConfigHash`/`documentId`), but the delete methods filter on those same fields without calling `ensureCollection()` first. A concurrent delete landing after a sibling's `add()` has created the collection but before its indexes finish now got a `400 "Index required but not found"` instead of the expected `404`. Both cases mean "nothing here yet to delete" and are now treated the same way. Also fixes `deleteByDocument()` not catching its own 404 at all (only `deleteByKnowledgeBase()` did).
