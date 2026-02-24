## 1. Dependencies & Component Setup

- [x] 1.1 Install `@convex-dev/workpool` package in `packages/backend/`
- [x] 1.2 Create `packages/backend/convex/convex.config.ts` — register `indexingPool` component with default config (maxParallelism: 10, retryActionsByDefault: true, defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 2000, base: 2 })

## 2. Schema Changes

- [x] 2.1 Update `documentChunks` table in `schema.ts` — add `indexConfigHash` (string) field, make `embedding` optional (`v.optional(v.array(v.float64()))`), add `by_kb_config` index on `["kbId", "indexConfigHash"]`, add `by_doc_config` index on `["documentId", "indexConfigHash"]`, update vector index `by_embedding` filterFields to `["kbId", "indexConfigHash"]`
- [x] 2.2 Add `indexingJobs` table to `schema.ts` — with fields: orgId, kbId, indexConfigHash, indexConfig, status (union of 7 states), totalDocs, processedDocs, failedDocs, skippedDocs, totalChunks, error, failedDocDetails (array of { documentId, error }), createdBy, createdAt, completedAt. Indexes: by_kb_config, by_org, by_status

## 3. Chunk CRUD Mutations (rag.ts)

- [x] 3.1 Add `insertChunkBatch` internalMutation — accepts array of chunk objects (without embedding), inserts all in one transaction
- [x] 3.2 Add `patchChunkEmbeddings` internalMutation — accepts array of { chunkId, embedding }, patches each chunk's embedding field
- [x] 3.3 Add `deleteChunkBatch` internalMutation — accepts array of chunk IDs, deletes all
- [x] 3.4 Add `deleteKbConfigChunks` internalMutation — paginated deletion by (kbId, indexConfigHash), returns { deleted, hasMore }
- [x] 3.5 Add `getChunksByDocConfig` internalQuery — returns all chunks for (documentId, indexConfigHash)
- [x] 3.6 Add `getUnembeddedChunks` internalQuery — returns chunks for (documentId, indexConfigHash) where embedding is not set
- [x] 3.7 Update `isIndexed` internalQuery — accept `indexConfigHash` parameter, check for chunks with embeddings for (kbId, indexConfigHash)
- [x] 3.8 Update `fetchChunksWithDocs` to work with the updated schema (indexConfigHash-aware)

## 4. Indexing Action (indexingActions.ts)

- [x] 4.1 Create `packages/backend/convex/indexingActions.ts` ("use node") with `indexDocument` internalAction — Phase A: check existing chunks, chunk document with RecursiveCharacterChunker, insert chunks without embeddings via `insertChunkBatch`
- [x] 4.2 Implement Phase B in `indexDocument` — query un-embedded chunks via `getUnembeddedChunks`, embed in batches of EMBED_BATCH_SIZE (200) using OpenAIEmbedder, patch each batch via `patchChunkEmbeddings`
- [x] 4.3 Add `cleanupAction` internalAction — paginated deletion loop using `deleteKbConfigChunks`, delete indexingJob record, optionally delete source documents

## 5. Indexing Service (indexing.ts)

- [x] 5.1 Create `packages/backend/convex/indexing.ts` — instantiate WorkPool with `components.indexingPool` and default config
- [x] 5.2 Implement `startIndexing` internalMutation — compute indexConfigHash, dedup check, create indexingJobs record, set tier-based parallelism, enqueue one action per document with onComplete callback
- [x] 5.3 Implement `onDocumentIndexed` internalMutation (WorkPool onComplete callback) — handle success/skipped/failed/canceled results, update progress counts, detect job completion, update status
- [x] 5.4 Implement `getJob` query — return indexingJob record with computed pendingDocs
- [x] 5.5 Implement `cancelIndexing` mutation — set status to "canceling", call pool.cancelAll()
- [x] 5.6 Implement `cleanupIndex` mutation — schedule cleanupAction
- [x] 5.7 Implement `isIndexed` query — check for completed indexingJob by (kbId, indexConfigHash)
- [x] 5.8 Implement `listJobs` query — list indexing jobs for org, ordered by createdAt descending

## 6. Integration & Cleanup

- [x] 6.1 Update experiment runner (`experimentActions.ts`) — replace inline for-loop indexing with call to `startIndexing` from the indexing service
- [x] 6.2 Update vector search in experiment runner — add `indexConfigHash` to the vectorSearch filter
- [x] 6.3 Verify existing `rag.ts` functions that are no longer needed are marked deprecated or removed (old `insertChunk` single-insert, old `deleteKbChunks` collect-all pattern)

## 7. Validation

- [x] 7.1 Deploy schema changes with `npx convex dev --once` and verify no errors
- [x] 7.2 Test end-to-end: start indexing a KB, verify progress tracking, verify chunks are created with indexConfigHash and embeddings
- [x] 7.3 Test idempotency: restart indexing on a partially-indexed KB, verify it resumes without duplicating data
- [x] 7.4 Test cleanup: call cleanupIndex and verify all chunks for that config are deleted
