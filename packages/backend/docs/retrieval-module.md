# Retrieval Module

> Document indexing (chunking + embedding), retriever CRUD, vector search, and the RAG pipeline.

[Back to Architecture Overview](./architecture.md)

---

## Files

| File | Lines | Role |
|------|-------|------|
| `indexing.ts` | ~414 | Indexing orchestration: start, WorkPool callbacks, cancel, cleanup, queries |
| `indexingActions.ts` | ~205 | `"use node"` actions: two-phase document indexing, paginated cleanup |
| `retrievers.ts` | ~301 | Retriever CRUD: queries, insert, status sync, remove, delete index |
| `retrieverActions.ts` | ~259 | `"use node"` actions: create (hash computation), start indexing, standalone retrieve |
| `rag.ts` | ~259 | Low-level chunk CRUD: batch insert/patch/delete, queries |
| `ragActions.ts` | ~75 | Legacy single-document indexing (deprecated) |

---

## Concepts

### Retriever vs Index

A **retriever** is a named pipeline configuration (chunking + embedding + search params). An **index** is the materialized set of chunks + embeddings for a specific configuration.

```
Retriever Record
├── retrieverConfig (full pipeline config: name, index settings, etc.)
├── retrieverConfigHash (hash of full config + k)
├── indexConfigHash (hash of just chunking + embedding config)
├── defaultK (top-K for search)
├── status: configuring → indexing → ready
└── indexingJobId → links to indexingJobs table

Multiple retrievers CAN share the same index (same indexConfigHash)
if only their search params (k, reranker, etc.) differ.
```

### Config Hashing

Two levels of hashing prevent duplicate work:

| Hash | Computed From | Purpose |
|------|---------------|---------|
| `indexConfigHash` | `computeIndexConfigHash(config)` — chunking strategy, chunkSize, chunkOverlap, separators, embeddingModel | Dedup indexing: same chunking + embedding = reuse chunks |
| `retrieverConfigHash` | `computeRetrieverConfigHash(config, k)` — all 4 pipeline stages + k | Dedup retrievers: same full config = reuse retriever record |

Both use `stableStringify()` (recursively sorts object keys) → SHA-256 → hex. Two configs with identical settings produce the same hash regardless of property order or `name` field. Both require Node.js `crypto` module, so computation happens in actions (not mutations).

---

## Indexing Pipeline

### Overview

```
retrieverActions.startIndexing (action, public)
    │
    ▼
indexing.startIndexing (internalMutation)
    │  • Dedup: check for running/pending job with same indexConfigHash
    │  • Dedup: check for completed job (skip unless force=true)
    │  • Set tier-based parallelism
    │  • Create indexingJob record
    │  • Fan out: 1 WorkPool action per document
    │
    ▼
indexingActions.indexDocument (internalAction, per-document)
    │
    │  ┌─────────────────────────────────────────────┐
    │  │  PHASE A: Chunk & Store (pure compute)      │
    │  │                                             │
    │  │  1. Idempotency check: existing chunks?     │
    │  │     - All embedded → skip (return skipped)  │
    │  │     - Some exist → skip to Phase B          │
    │  │     - None exist → proceed                  │
    │  │                                             │
    │  │  2. RecursiveCharacterChunker.chunkWithPositions()│
    │  │  3. rag.insertChunkBatch (atomic, no embeddings) │
    │  └─────────────────────────────────────────────┘
    │
    │  ┌─────────────────────────────────────────────┐
    │  │  PHASE B: Embed in Batches (resumable)      │
    │  │                                             │
    │  │  1. Query unembedded chunks                 │
    │  │  2. For each batch of 200:                  │
    │  │     a. embedder.embed(texts)                │
    │  │     b. rag.patchChunkEmbeddings (checkpoint)│
    │  │  3. Count total chunks                      │
    │  └─────────────────────────────────────────────┘
    │
    ▼
indexing.onDocumentIndexed (internalMutation, WorkPool callback)
    │
    │  • Update processedDocs / failedDocs / skippedDocs / totalChunks
    │  • Handle skipped docs (already indexed)
    │  • Check completion (all docs handled?)
    │  • Determine final status
    │  • Sync retriever status if job completed
    │
    ▼
retrievers.syncStatusFromIndexingJob (internalMutation)
    │
    │  • If indexing completed → retriever status = "ready"
    │  • If indexing failed → retriever status = "error"
    │  • If indexing canceled → no-op (resetAfterCancel owns this path)
```

### Two-Phase Design Rationale

Phase A (chunking) is pure compute — no API calls, deterministic. If it succeeds, the chunks are persisted atomically.

Phase B (embedding) makes OpenAI API calls that can fail/timeout. By checkpointing after each batch of 200, a retry (via WorkPool) can resume from where it left off:
1. Phase A is skipped (chunks already exist)
2. Only unembedded chunks are processed in Phase B

### Tier-Based Parallelism

```typescript
const TIER_PARALLELISM = {
  free: 3,
  pro: 10,
  enterprise: 20,
};
```

Set via `pool.config.update({ maxParallelism })` at indexing start. Currently the tier parameter is optional and defaults to "free".

---

## Retriever Lifecycle

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  configuring │────▶│   indexing   │────▶│    ready     │
│              │     │              │     │              │
│ Just created,│     │ IndexingJob  │     │ Chunks exist,│
│ no index yet │     │ is running   │     │ can search   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │              cancel│              deleteIndex
       │                    ▼                    │
       │           resetAfterCancel              │
       │              │                          │
       ◀──────────────┘              ┌───────────▼──┐
                                     │    error     │
                                     │              │
                                     │ Indexing     │
                                     │ failed       │
                                     └──────────────┘
```

### Create Flow

```
retrieverActions.create (action)
  1. getAuthContext()
  2. computeIndexConfigHash(config)
  3. computeRetrieverConfigHash(config, k)
  4. Dedup: check retrievers.findByConfigHash
     - Found → return existing retriever
  5. retrievers.insertRetriever (status: "configuring")
  6. Return { retrieverId, existing: false }
```

### Index Management

| Operation | Function | What It Does |
|-----------|----------|--------------|
| Start indexing | `retrieverActions.startIndexing` | Triggers indexing pipeline, updates status to "indexing" or "ready" |
| Delete index | `retrievers.deleteIndex` | Checks for shared indexes, schedules chunk cleanup, resets to "configuring" |
| Reset after cancel | `retrievers.resetAfterCancel` | Resets to "configuring" after indexing cancellation |
| Remove retriever | `retrievers.remove` | Deletes retriever record + cleans up index if not shared |

### Shared Index Protection

Before deleting an index, the system checks if other retrievers share the same `(kbId, indexConfigHash)`:

```typescript
const sharingChunks = allForKb.filter(
  (r) => r._id !== args.id && r.indexConfigHash === retriever.indexConfigHash
);
if (sharingChunks.length > 0) {
  throw new Error("Cannot delete index: other retriever(s) share the same index.");
}
```

---

## Vector Search

### Standalone Retrieve

```
retrieverActions.retrieve (action, public)
  1. Auth + load retriever
  2. Validate status === "ready"
  3. Embed query via OpenAIEmbedder
  4. vectorSearch("documentChunks", "by_embedding", {
       vector: queryEmbedding,
       limit: min(topK * 4, 256),  // over-fetch for post-filtering
       filter: q => q.eq("kbId", retriever.kbId)
     })
  5. Hydrate chunks via rag.fetchChunksWithDocs
  6. Post-filter by indexConfigHash
  7. Take top-K
  8. Return with scores
```

### Why Post-Filter?

Convex vector search only supports filtering by fields listed in the vector index's `filterFields`. The index filters by `kbId` and `indexConfigHash`, but Convex limits filter expressions. The current approach:
- Filters by `kbId` in the vector search itself
- Over-fetches (topK * 4, max 256)
- Post-filters by `indexConfigHash` in application code

### Chunk Hydration

Vector search returns `{ _id, _score }` only. To get full chunk data + parent document info:

```typescript
// rag.fetchChunksWithDocs
for each chunk ID:
  chunk = await ctx.db.get(id)
  doc = await ctx.db.get(chunk.documentId)
  return { ...chunk, docId: doc.docId }
```

---

## Chunk Storage (rag.ts)

Low-level CRUD for the `documentChunks` table:

### Current (Two-Phase) Mutations

| Function | Purpose |
|----------|---------|
| `insertChunkBatch` | Insert multiple chunks WITHOUT embeddings (Phase A) |
| `patchChunkEmbeddings` | Patch embedding vectors onto existing chunks (Phase B) |
| `deleteChunkBatch` | Delete multiple chunks by ID |
| `deleteKbConfigChunks` | Paginated deletion by (kbId, indexConfigHash) |

### Queries

| Function | Purpose |
|----------|---------|
| `getChunksByDocConfig` | Get chunks for (documentId, indexConfigHash) |
| `getUnembeddedChunks` | Get chunks missing embeddings (for Phase B resume) |
| `isIndexed` | Check if KB has indexed chunks (with or without config hash) |
| `fetchChunksWithDocs` | Hydrate chunk IDs with full data + parent document's docId |

### Legacy (Deprecated)

| Function | Status | Replacement |
|----------|--------|-------------|
| `insertChunk` | Deprecated | `insertChunkBatch` |
| `deleteKbChunks` | Deprecated (OOM risk) | `deleteKbConfigChunks` (paginated) |
| `deleteDocumentChunks` | Active | Used by cleanup |

### ragActions.ts (Deprecated)

`indexSingleDocument()` — the original single-document indexing function. Chunks + embeds + inserts in a single pass (no two-phase, no batching). Deprecated in favor of `indexingActions.indexDocument`.

---

## Cleanup

```
indexingActions.cleanupAction (internalAction)
  1. Paginated chunk deletion (batches of 500)
     Loop: deleteKbConfigChunks until hasMore === false
  2. Optionally delete source document chunks
  3. Delete associated indexingJob record
```

Triggered by:
- `retrievers.remove` (when deleting a retriever with no shared index)
- `retrievers.deleteIndex` (when resetting a retriever)
- `indexing.cleanupIndex` (public mutation, manual cleanup)

---

## Database Records

### retrievers

| Field | Type | Notes |
|-------|------|-------|
| `orgId` | string | Org scope |
| `kbId` | Id<"knowledgeBases"> | Parent KB |
| `name` | string | Display name (auto-generated if not provided) |
| `retrieverConfig` | any | Full pipeline config (PipelineConfig from eval-lib) |
| `indexConfigHash` | string | Hash of chunking + embedding config |
| `retrieverConfigHash` | string | Hash of full config + k |
| `defaultK` | number | Default top-K for search |
| `indexingJobId` | Id<"indexingJobs">? | Link to current/completed indexing job |
| `status` | union | configuring / indexing / ready / error |
| `chunkCount` | number? | Total chunks when ready |
| `error` | string? | Error message if status === "error" |

### indexingJobs

| Field | Type | Notes |
|-------|------|-------|
| `orgId` | string | Org scope |
| `kbId` | Id<"knowledgeBases"> | Target KB |
| `indexConfigHash` | string | Config fingerprint for dedup |
| `indexConfig` | any | Full index configuration |
| `status` | union | pending / running / completed / completed_with_errors / failed / canceling / canceled |
| `totalDocs` | number | Documents to index |
| `processedDocs` | number | Successfully indexed |
| `failedDocs` | number | Failed to index |
| `skippedDocs` | number | Skipped (already indexed or canceled) |
| `totalChunks` | number | Total chunks created across all docs |
| `failedDocDetails` | array? | `[{ documentId, error }]` |

### documentChunks

| Field | Type | Notes |
|-------|------|-------|
| `documentId` | Id<"documents"> | Parent document |
| `kbId` | Id<"knowledgeBases"> | Parent KB (denormalized for vector search filter) |
| `indexConfigHash` | string? | Config fingerprint |
| `chunkId` | string | Eval-lib chunk ID |
| `content` | string | Chunk text |
| `start` | number | Character offset start in source document |
| `end` | number | Character offset end in source document |
| `embedding` | float64[]? | 1536-dim vector (null during Phase A) |
| `metadata` | any | Chunk metadata |

---

## Test Coverage

**No dedicated tests exist for the retrieval module.**

The indexing callbacks (`onDocumentIndexed`), retriever CRUD operations, vector search flow, cleanup actions, and deduplication logic are all untested. See [Refactoring Suggestions](./refactoring-suggestions.md#testing) for recommended test additions.
