## ADDED Requirements

### Requirement: Start indexing mutation
The system SHALL provide a `startIndexing` internalMutation that accepts `kbId`, `indexConfigHash` (pre-computed by the caller, since `computeIndexConfigHash` requires Node.js `crypto` which is only available in `"use node"` actions, not in mutations), `indexConfig` (IndexConfig object), `orgId`, `createdBy`, optional `tier` (string), and optional `force` (boolean). It SHALL check for an existing active job for the same `(kbId, indexConfigHash)` and return it if found (dedup), query all documents in the KB, set tier-based parallelism on the WorkPool (free: 3, pro: 10, enterprise: 20), create an `indexingJobs` record with status `"running"` and `totalDocs` set to the document count, enqueue one WorkPool action per document via `pool.enqueueAction` with an `onComplete` callback, and return the job ID.

#### Scenario: Start indexing a KB with 120 documents
- **WHEN** `startIndexing` is called with a valid kbId and indexConfig
- **THEN** an `indexingJobs` record SHALL be created with `totalDocs: 120`, `processedDocs: 0`, `status: "running"`, and 120 actions SHALL be enqueued to the WorkPool

#### Scenario: Dedup prevents double-start
- **WHEN** `startIndexing` is called for a `(kbId, indexConfigHash)` that already has a running or pending job
- **THEN** the existing job ID SHALL be returned without creating a new job or enqueueing new actions

#### Scenario: Force re-index with same config
- **WHEN** `startIndexing` is called with `force: true` for a `(kbId, indexConfigHash)` that has a completed indexing job
- **THEN** the old completed job record SHALL be deleted and a new indexing job SHALL be created
- **NOTE** existing chunks are NOT deleted — the `indexDocument` action's idempotency logic skips already-embedded docs, so only failed/missing docs are reprocessed. For a full re-index, call `cleanupIndex` first then `startIndexing`.

### Requirement: Two-phase document indexing action
The system SHALL provide an `indexDocument` internalAction ("use node") that processes a single document in two phases. **Phase A**: query existing chunks for `(documentId, indexConfigHash)` — if all have embeddings, return `{ skipped: true }`; if some exist without embeddings, skip to Phase B; if none exist, load the document, chunk it with `RecursiveCharacterChunker`, and insert ALL chunks WITHOUT embeddings in one atomic mutation. **Phase B**: query un-embedded chunks for `(documentId, indexConfigHash)`, embed them in batches of `EMBED_BATCH_SIZE` (default 200) using OpenAI's embedding API, and patch each batch's embeddings via mutation. Return `{ skipped: false, chunksInserted, chunksEmbedded }`.

#### Scenario: Full processing of a new document
- **WHEN** `indexDocument` is called for a document with no existing chunks
- **THEN** Phase A SHALL chunk the document and insert all chunks without embeddings, then Phase B SHALL embed all chunks in batches and patch their embeddings

#### Scenario: Skip fully-indexed document
- **WHEN** `indexDocument` is called for a document where all chunks already have embeddings
- **THEN** the action SHALL return `{ skipped: true }` without any mutations

#### Scenario: Resume partial embeddings
- **WHEN** `indexDocument` is called for a document where chunks exist but some lack embeddings (e.g., after a crash mid-Phase B)
- **THEN** Phase A SHALL be skipped, and Phase B SHALL only embed and patch the un-embedded chunks

#### Scenario: Embedding batch checkpoint
- **WHEN** Phase B completes embedding batch 3 of 5 and the action crashes
- **THEN** on retry, batches 1-3 SHALL be skipped (embeddings already set) and processing SHALL resume from batch 4

### Requirement: Document completion callback
The system SHALL provide an `onDocumentIndexed` internalMutation registered as the WorkPool `onComplete` callback. It SHALL receive the `jobId`, `documentId`, and result from WorkPool. On success, it SHALL increment `processedDocs` (or `skippedDocs` if the result indicates the document was already indexed) and accumulate `totalChunks`. On failure, it SHALL increment `failedDocs` and append to `failedDocDetails` with the document ID and error message. When `processedDocs + failedDocs + skippedDocs === totalDocs`, it SHALL set the job status to `"completed"` (if no failures) or `"completed_with_errors"` (if any failures) and set `completedAt`.

#### Scenario: Successful document completion
- **WHEN** WorkPool fires onComplete with `result.kind === "success"` and `returnValue.skipped === false`
- **THEN** `processedDocs` SHALL be incremented by 1 and `totalChunks` SHALL be increased by `returnValue.chunksInserted`

#### Scenario: Skipped document completion
- **WHEN** WorkPool fires onComplete with `result.kind === "success"` and `returnValue.skipped === true`
- **THEN** `skippedDocs` SHALL be incremented by 1

#### Scenario: Failed document completion
- **WHEN** WorkPool fires onComplete with `result.kind === "failed"`
- **THEN** `failedDocs` SHALL be incremented by 1 and `failedDocDetails` SHALL have `{ documentId, error }` appended

#### Scenario: Job completes with all documents processed
- **WHEN** the sum of `processedDocs + failedDocs + skippedDocs` equals `totalDocs`
- **THEN** the job status SHALL be set to `"completed"` or `"completed_with_errors"` and `completedAt` SHALL be set

### Requirement: Indexing job query
The system SHALL provide a `getJob` query that accepts a job ID and returns the full `indexingJobs` record. The query SHALL compute `pendingDocs` as `totalDocs - processedDocs - failedDocs - skippedDocs` for frontend convenience. This query SHALL be reactive for real-time UI updates.

#### Scenario: Frontend subscribes to job progress
- **WHEN** the frontend calls `useQuery(api.indexing.getJob, { jobId })`
- **THEN** the query SHALL return the current job state including all progress counts, and SHALL reactively update as documents complete

### Requirement: Cancel indexing
The system SHALL provide a `cancelIndexing` mutation that accepts a job ID, sets the job status to `"canceling"`, and calls `pool.cancelAll()` on the WorkPool to prevent pending documents from being processed. Already-running documents SHALL complete normally. The job status SHALL transition to `"canceled"` when all in-progress documents finish.

#### Scenario: User cancels indexing mid-progress
- **WHEN** `cancelIndexing` is called while 50 of 120 documents are still pending
- **THEN** the 50 pending documents SHALL NOT be processed, currently running documents SHALL complete, and the job status SHALL eventually become `"canceled"`

### Requirement: Check if indexed
The system SHALL provide an `isIndexed` query that accepts `kbId` and `indexConfigHash` and returns `true` if there exists a completed indexing job for that combination (status `"completed"` or `"completed_with_errors"`).

#### Scenario: KB is fully indexed
- **WHEN** `isIndexed` is called for a `(kbId, indexConfigHash)` with a completed job
- **THEN** the query SHALL return `true`

#### Scenario: KB is not indexed
- **WHEN** `isIndexed` is called for a `(kbId, indexConfigHash)` with no job or a running job
- **THEN** the query SHALL return `false`

### Requirement: Cleanup index
The system SHALL provide a `cleanupIndex` mutation that accepts `kbId`, `indexConfigHash`, and an optional `deleteDocuments` flag. It SHALL schedule a `cleanupAction` that performs paginated deletion of all chunks matching `(kbId, indexConfigHash)` in batches of 500, optionally deletes source documents, and deletes the associated `indexingJobs` record. The cleanup SHALL use a plain action (not WorkPool).

#### Scenario: Clean up chunks for one index config
- **WHEN** `cleanupIndex` is called with `kbId` and `indexConfigHash`
- **THEN** all `documentChunks` matching that `(kbId, indexConfigHash)` SHALL be deleted in paginated batches and the associated `indexingJobs` record SHALL be deleted

#### Scenario: Clean up with document deletion
- **WHEN** `cleanupIndex` is called with `deleteDocuments: true`
- **THEN** all chunks SHALL be deleted AND all documents in the KB SHALL be deleted with their storage files

#### Scenario: Clean up large index
- **WHEN** cleaning up an index with 50,000 chunks
- **THEN** deletion SHALL be performed in batches of 500 (100 mutations) without exceeding the 10-minute action timeout

### Requirement: Chunk CRUD mutations
The system SHALL provide internal mutations: `insertChunkBatch` (inserts multiple chunks in one atomic mutation, without embeddings), `patchChunkEmbeddings` (patches embedding vectors onto existing chunk records by ID), and `deleteChunkBatch` (deletes multiple chunks by ID). These SHALL be internalMutations in a non-"use node" file.

#### Scenario: Atomic chunk insertion
- **WHEN** `insertChunkBatch` is called with 200 chunks for a document
- **THEN** all 200 chunks SHALL be inserted in a single transaction with `embedding` unset

#### Scenario: Batch embedding patch
- **WHEN** `patchChunkEmbeddings` is called with 200 chunk IDs and their corresponding embedding vectors
- **THEN** all 200 chunks SHALL have their `embedding` field patched in a single transaction

### Requirement: List indexing jobs for org
The system SHALL provide a `listJobs` query that accepts an optional `kbId` filter. The `orgId` SHALL be extracted from the authenticated user's context via `getAuthContext(ctx)`. Jobs SHALL be returned ordered by creation date descending. If `kbId` is provided, results SHALL be filtered to that knowledge base.

#### Scenario: List all indexing jobs for an org
- **WHEN** `listJobs` is called by an authenticated user
- **THEN** all indexing jobs for the user's org SHALL be returned, most recent first

#### Scenario: List indexing jobs filtered by KB
- **WHEN** `listJobs` is called with a `kbId`
- **THEN** only indexing jobs for that specific knowledge base SHALL be returned
