## MODIFIED Requirements

### Requirement: Chunk storage mutations and queries
The system SHALL provide in `convex/rag.ts` (a regular file, NOT `"use node"`):
- `insertChunkBatch` internalMutation — inserts multiple chunks into `documentChunks` in a single atomic transaction, without embedding vectors (embedding field left unset for two-phase indexing)
- `patchChunkEmbeddings` internalMutation — patches embedding vectors onto existing chunk records by their IDs in a single transaction
- `deleteChunkBatch` internalMutation — deletes multiple chunks by their IDs in a single transaction
- `deleteDocumentChunks` internalMutation — deletes all chunks for a document (by `documentId` index)
- `deleteKbConfigChunks` internalMutation — deletes a paginated batch of chunks for a knowledge base and index config (by `by_kb_config` index), returning whether more chunks remain
- `isIndexed` internalQuery — checks if a knowledge base has any fully-embedded chunks for a given `indexConfigHash`
- `fetchChunksWithDocs` internalQuery — takes an array of chunk IDs and returns full chunk records with the parent document's `docId` joined
- `getChunksByDocConfig` internalQuery — returns all chunks for a `(documentId, indexConfigHash)` pair
- `getUnembeddedChunks` internalQuery — returns chunks for a `(documentId, indexConfigHash)` where embedding is not set

These are split into a separate file because `"use node"` files can ONLY contain actions.

#### Scenario: Batch insert chunks without embeddings
- **WHEN** `insertChunkBatch` is called with 200 chunks
- **THEN** all 200 chunks SHALL be inserted atomically with embedding field unset

#### Scenario: Patch embeddings onto existing chunks
- **WHEN** `patchChunkEmbeddings` is called with 200 chunk IDs and embedding vectors
- **THEN** all 200 chunks SHALL have their embedding field updated in a single transaction

#### Scenario: Paginated deletion by KB and config
- **WHEN** `deleteKbConfigChunks` is called for a KB with 5000 chunks
- **THEN** it SHALL delete up to 500 chunks and return `{ deleted: 500, hasMore: true }`

#### Scenario: Check indexed status with config hash
- **WHEN** `isIndexed` is called with `kbId` and `indexConfigHash`
- **THEN** it SHALL return `true` only if chunks with embeddings exist for that combination

#### Scenario: Query un-embedded chunks for resume
- **WHEN** `getUnembeddedChunks` is called for a document that was partially embedded
- **THEN** it SHALL return only chunks where embedding is not set

### Requirement: Vector search for retrieval (config-scoped)
Vector search SHALL be performed inline within Convex actions using `ctx.vectorSearch("documentChunks", "by_embedding", { vector, limit, filter: (q) => q.eq("kbId", kbId) })`. Because Convex's `vectorSearch` filter API only supports `q.eq()` and `q.or()` (no AND/chaining), the `indexConfigHash` filter SHALL be applied as a post-filter in JavaScript after hydrating results. The vector search `limit` SHALL be set to `Math.min(topK * 4, 256)` to over-fetch, compensating for chunks removed by the post-filter. Results SHALL be hydrated via `ctx.runQuery(internal.rag.fetchChunksWithDocs, { ids })`, then filtered by `indexConfigHash` and truncated to `topK`.

#### Scenario: Retrieve top-k chunks scoped by config
- **WHEN** performing vector search with `kbId` filter and `indexConfigHash` post-filter
- **THEN** only chunks from that specific index configuration SHALL be returned, excluding chunks from other configurations of the same KB
- **AND** the over-fetch factor (4x) SHALL ensure sufficient candidates pass the post-filter

#### Scenario: Un-embedded chunks excluded from search
- **WHEN** performing vector search on a KB that has chunks in Phase A (no embeddings yet)
- **THEN** those un-embedded chunks SHALL NOT appear in search results

### Requirement: Position-aware chunking in indexing action
The system SHALL provide an `indexDocument` internalAction in `convex/indexingActions.ts` (a `"use node"` file) that implements two-phase document processing. This replaces the previous `indexSingleDocument` helper in `ragActions.ts`. The action SHALL use eval-lib's `RecursiveCharacterChunker` for chunking and `OpenAIEmbedder` for embedding, with parameters from the `IndexConfig`.

#### Scenario: Document chunked with character positions
- **WHEN** indexing a document with 5000 characters using chunk size 1000 and overlap 200
- **THEN** approximately 6 chunks SHALL be created, each with accurate `start` and `end` character positions

#### Scenario: Chunk content matches document substring
- **WHEN** a chunk is created with `start: 1000` and `end: 1500`
- **THEN** `chunk.content` SHALL equal `document.content.substring(1000, 1500)`

## REMOVED Requirements

### Requirement: Position-aware chunking helper
**Reason**: Replaced by the new two-phase `indexDocument` action in `indexingActions.ts`. The old `indexSingleDocument` helper in `ragActions.ts` is no longer needed — the new action handles chunking, embedding, and storage with proper checkpointing and WorkPool integration.
**Migration**: Use `indexingPool.enqueueAction(internal.indexingActions.indexDocument, ...)` instead of calling `indexSingleDocument()` directly.

### Requirement: Batch document indexing via experiment pipeline
**Reason**: Replaced by the standalone indexing service. The experiment runner SHALL delegate indexing to `startIndexing` instead of running its own batch processing loop with the custom `batchProcessor`.
**Migration**: In `experimentActions.ts`, replace the inline for-loop indexing with a call to `internal.indexing.startIndexing` and wait for the indexing job to complete.
