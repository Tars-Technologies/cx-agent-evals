## Context

The current KB indexing is a simple for-loop inside `experimentActions.ts` that chunks, embeds, and inserts documents sequentially with no retry, no parallelism, no progress tracking, and no crash recovery. It's tightly coupled to experiment execution and cannot handle large KBs (1000+ documents). The detailed architecture was explored in `packages/eval-lib/docs/kb-indexing-architecture.md`.

The indexing service must be standalone — consumed by both the experiment runner (Phase 1 of experiment execution) and future production retrieval pipelines where users upload documents for inference.

**Current state:**
- `ragActions.ts`: `indexSingleDocument()` helper — chunks + embeds + inserts per document in a for-loop
- `experimentActions.ts`: calls `indexSingleDocument()` sequentially for each document
- `rag.ts`: chunk CRUD mutations — `insertChunk`, `deleteDocumentChunks`, `deleteKbChunks`, `isIndexed`, `fetchChunksWithDocs`
- `schema.ts`: `documentChunks` table has required `embedding` field, only `kbId` in vector index filterFields
- No `convex.config.ts` for component registration

## Goals / Non-Goals

**Goals:**
- Standalone indexing service independent of experiment runner
- Parallel document processing via Convex WorkPool with configurable concurrency
- Two-phase per-document processing: chunk-first (atomic, pure compute), then embed in batches (API calls, resumable)
- Retry with exponential backoff for transient embedding API failures
- Per-document idempotency and resumability via checkpoint in `documentChunks` table
- Real-time progress tracking for frontend (reactive Convex queries)
- Dead letter queue for per-document terminal failures
- Paginated cleanup by `(kbId, indexConfigHash)`
- Multi-config support: same KB can be indexed with different configurations via `indexConfigHash`

**Non-Goals:**
- Per-org parallelism throttling (WorkPool `maxParallelism` is pool-wide; per-org throttling is a future enhancement)
- Incremental re-indexing of individual documents within a KB (full KB re-index only for now)
- Custom chunking strategies beyond RecursiveCharacterChunker (extensible later via IndexConfig.strategy)
- Frontend UI for the indexing service (consumed by existing experiment execution phases UI)
- Migration of existing `documentChunks` data (old chunks without `indexConfigHash` will need re-indexing)

## Decisions

### Decision 1: WorkPool over Workflow for document fan-out

**Choice:** Use `@convex-dev/workpool` (not `@convex-dev/workflow`).

**Rationale:** Each document is an independent unit of work with no inter-document dependencies. This is a textbook fan-out pattern. WorkPool provides exactly what we need: parallel dispatch, retry with backoff, onComplete callbacks, cancelAll. Workflow is designed for multi-step sequential pipelines with a journal — 10,000 documents would produce an 8 MiB journal risk. WorkPool has zero journal overhead.

**Alternatives considered:**
- Workflow: Better for multi-phase orchestration, but journal size risk with 10K+ docs. The experiment runner's orchestration (index → evaluate) happens at a higher level, not within document processing.
- Custom batch processor (existing `batchProcessor.ts`): No parallelism, no exponential backoff, manual watchdog. WorkPool replaces all of this with built-in crash recovery.

### Decision 2: Two-phase per-document processing (chunk-first, then embed in batches)

**Choice:** Phase A inserts all chunks WITHOUT embeddings in one atomic mutation. Phase B embeds in batches of EMBED_BATCH_SIZE (200) and patches embeddings per batch.

**Rationale:** Chunking is pure compute (never fails). Embedding is the only API call and the primary failure point. Separating them means: (1) chunking work is never lost, (2) embedding progress is checkpointed per-batch, (3) on retry, only un-embedded chunks are processed. The `embedding` field becomes optional in the schema — Convex's vector index automatically excludes documents where the vector field is not set.

**Alternatives considered:**
- All-at-once per document: Holds all chunks + embeddings in memory, loses all work on failure. Bad for large documents (1000+ chunks).
- One chunk at a time: Too many mutations, no batching benefit for embedding API (which supports batch input).

### Decision 3: `documentChunks` table as the checkpoint (no separate status table)

**Choice:** The `documentChunks` table IS the checkpoint. No per-document status tracking table.

**Rationale:** The three-way idempotency check (no chunks → full process, all embedded → skip, partial → resume Phase B) derives directly from querying `documentChunks` for `(documentId, indexConfigHash)`. Adding a separate `documentStatus` table would be redundant and create consistency risks between the status table and actual chunk data.

### Decision 4: `indexConfigHash` for multi-config namespacing

**Choice:** Add `indexConfigHash` (SHA-256 of normalized IndexConfig) to `documentChunks` and vector index filterFields.

**Rationale:** The same KB may be indexed with different configurations (chunk size, embedding model) for A/B testing or experiment comparison. The hash creates a namespace: `(kbId, documentId, indexConfigHash)` uniquely identifies a set of chunks. Retrieval and cleanup are both scoped by `(kbId, indexConfigHash)`. The hash function (`computeIndexConfigHash`) already exists in eval-lib.

### Decision 5: Plain action for cleanup (no WorkPool)

**Choice:** Cleanup uses a plain action with a paginated delete loop, not WorkPool.

**Rationale:** Cleanup involves zero external API calls — just DB deletions. No transient failures possible (except Convex being down). Even 200K chunks at 500/batch = 400 mutations × 50ms ≈ 20 seconds. Well within the 10-minute action timeout. WorkPool's retry/parallelism/progress is unnecessary overhead.

### Decision 6: Progress tracking via `indexingJobs` table (not WorkPool internal state)

**Choice:** Create our own `indexingJobs` table with progress counts, rather than relying on WorkPool's internal status.

**Rationale:** WorkPool's `pool.status(workId)` tracks individual work items (pending/running/finished), but we need aggregate job-level progress (87/120 docs processed, 2 failed, 15 skipped) for the UI. The `indexingJobs` table provides reactive Convex queries for real-time frontend updates and stores the dead letter queue (`failedDocDetails`).

### Decision 7: WorkPool handles crash recovery (no custom watchdog)

**Choice:** Remove the need for custom watchdog and time-budget patterns. WorkPool provides three layers of crash detection: Convex `_scheduled_functions` tracking, main loop completion handling, and a 30-minute healthcheck cron.

**Rationale:** The existing custom `batchProcessor.ts` with 8-minute time budget and 11-minute watchdog was ~160 lines of manual infrastructure. WorkPool replaces all of it with built-in retry, backoff, and crash detection. Each document is its own action — no "break loop and continue" pattern needed.

### Decision 8: VectorSearch single-filter + JS post-filter (Convex API limitation)

**Choice:** Use `ctx.vectorSearch(..., { filter: (q) => q.eq("kbId", kbId) })` with a single filter, then post-filter results in JavaScript by `indexConfigHash`. Over-fetch by 4x (`Math.min(topK * 4, 256)`) to compensate.

**Rationale:** Convex's `vectorSearch` filter API only supports `q.eq()` and `q.or()` — there is no `q.and()` or chaining support. Attempting `q.eq("kbId", kbId).eq("indexConfigHash", hash)` does not work. The workaround is to filter by the higher-cardinality field (`kbId`) in the vector search and apply the `indexConfigHash` filter in JavaScript after hydrating results. The 4x over-fetch ensures sufficient candidates survive the post-filter for most workloads.

**Alternatives considered:**
- `q.or()` wrapping both conditions: Not semantically equivalent — `q.or()` is a union, not an intersection.
- Separate vector indexes per config: Too many indexes, hard-coded dimension constraints.

### Decision 9: `indexConfigHash` persisted on experiments table

**Choice:** The `experiments` table has an optional `indexConfigHash` field (`v.optional(v.string())`).

**Rationale:** During experiment execution, the experiment action computes the `indexConfigHash` from the retriever's pipeline config. This hash needs to be persisted so that the frontend or future tooling can reference which index configuration was used for a given experiment (e.g., for cleanup). The field was added to the schema during implementation and existing DB documents already have it populated, so it must remain as optional for backward compatibility.

### Decision 10: `indexConfigHash` pre-computed by caller (not in `startIndexing`)

**Choice:** `startIndexing` receives `indexConfigHash` as an argument rather than computing it internally.

**Rationale:** `computeIndexConfigHash()` from eval-lib uses Node.js `crypto` module, which is only available in `"use node"` action files. `startIndexing` is an `internalMutation` (not an action), so it cannot access `crypto`. The caller (typically a `"use node"` action like `experimentActions.ts`) must compute the hash and pass it in.

## Risks / Trade-offs

- **[Pool-wide parallelism]** → WorkPool's `maxParallelism` is global, not per-org. If two orgs index simultaneously, they share slots. Mitigation: acceptable for now; per-org pools or custom semaphore is a future enhancement.
- **[Large KB enqueueing]** → `startIndexing` mutation enqueues N actions. For 10K docs, that's 10K `enqueueAction` calls in one mutation. Mitigation: WorkPool may support `enqueueActionBatch`; if not, split across multiple mutations.
- **[Embedding dimension mismatch]** → If config specifies `text-embedding-3-large` (3072 dims) but vectorIndex is 1536 dims, inserts fail. Mitigation: validate upfront in `startIndexing` or support multiple dimension sizes (future).
- **[Schema migration]** → Existing `documentChunks` rows lack `indexConfigHash` and have required `embedding`. Mitigation: making `embedding` optional is backward-compatible. Old rows without `indexConfigHash` will be invisible to the new config-scoped queries — acceptable since re-indexing via the new service creates fresh chunks.
- **[Failed doc accumulation]** → `failedDocDetails` array on `indexingJobs` grows with each failure. For a pathological KB with many bad docs, this array could get large. Mitigation: cap at ~100 entries; the rest are counted but details truncated.

## Resolved Questions

1. **`enqueueActionBatch` support** — WorkPool does NOT provide a batch enqueue API. The implementation enqueues one action at a time in a for-loop within the `startIndexing` mutation. This works fine for typical KB sizes (hundreds to low thousands of documents). For 10K+ docs, the mutation may approach size/time limits — splitting across multiple mutations is a future optimization if needed.
2. **VectorSearch AND filter** — Convex's `vectorSearch` filter API does not support AND/chaining (`q.eq().eq()` doesn't work). Resolved via Decision 8: single `q.eq("kbId")` filter + JS post-filter by `indexConfigHash` with 4x over-fetch.

## Open Questions

1. **Vector index dimension flexibility** — Should we validate embedding dimensions upfront, or support multiple vector indexes with different dimensions? Currently hard-coded to 1536 (text-embedding-3-small).
