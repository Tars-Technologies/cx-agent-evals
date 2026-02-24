# KB Indexing Architecture — Convex WorkPool

## Overview

A standalone, production-grade indexing service for processing knowledge base documents (chunk, embed, store) using the Convex WorkPool component. Designed for both evaluation workflows and production inference pipelines.

This service is **independent of the experiment runner**. The experiment runner is a consumer of this service — when it needs indexing as Phase 1, it calls the same `startIndexing` and waits.

### Design Goals

- **Reliability**: Two-phase per-document processing (chunk-first, then embed in batches), retry with exponential backoff, no inconsistent state
- **Scalability**: Parallel processing with configurable concurrency, handles 10K+ documents
- **Observability**: Real-time progress via reactive Convex queries
- **Idempotency**: Skip already-indexed documents, resume partial embeddings, prevent duplicate jobs
- **Maintainability**: ~4 files, zero custom batch processor code — WorkPool handles orchestration

---

## Failure Mode Analysis

| Failure | Type | Recovery |
|---|---|---|
| Embedding API rate limit | Transient | WorkPool retry with exponential backoff |
| Embedding API 500 error | Transient | WorkPool retry with exponential backoff |
| Embedding API key revoked | Terminal | Report to user, per-doc error in dead letter queue |
| Embedding API wrong dimensions | Terminal | Validation error, per-doc error in dead letter queue |
| Embedding API timeout | Transient | WorkPool retry |
| Convex action timeout (10 min) | Transient | WorkPool retry; partial embedding progress is preserved |
| Convex mutation too large | Terminal | Doc has too many chunks (unlikely, limit is 8192 writes) |
| Partial embeddings for a doc | **Resumable** | On retry, only un-embedded chunks are processed |
| Crash between documents | Recoverable | Checkpoint: documentChunks table IS the checkpoint |
| Full restart of KB indexing | Recoverable | Idempotent: skip fully-embedded docs, resume partial docs |
| Concurrent index requests | Prevented | Dedup by (kbId, indexConfigHash) |
| User cancels mid-indexing | Clean | cancelAll() prevents pending work |
| Duplicate chunks on retry | Prevented | Idempotency: chunks inserted atomically, embedding checks before re-embedding |
| Massive KB (10K+ docs) | Handled | Fan-out via WorkPool parallelism |
| Massive doc (1000+ chunks) | Handled | Two-phase: chunk-first (atomic), then embed in batches with per-batch checkpoint |
| Cleanup of huge index | Handled | Paginated deletion in plain action, not collect-all |
| WorkPool main loop stalls | Recoverable | 30-min healthcheck cron force-kicks the pool |
| Convex platform hiccup | Recoverable | WorkPool recovery.ts detects via _scheduled_functions state |

---

## Two-Phase Document Processing

The core insight is that **chunking is pure compute** (never fails) while **embedding is an API call** (the primary failure point). We separate these into two phases within each document action, with the `documentChunks` table itself serving as the checkpoint.

> My Comments: What if we have a very large document with 100s of pages, each having 10+ chunks, so 1000+ chunks. You have to keep all the chunks and embeddings in memory and that can be resource intesive. What could be a better way to do this? One way I can think of is to chunk a document and save all the chunks without embedding in the convex database as mutations. We can do it in one single mutation as well, not an issue, or in batches, whichever we want to do, embedding the chunks in batches and saving it in the corresponding chunks, because the embedding API call is the most likely place that things will fail. Chunking is this pure compute; there is no need for any API call and all, but the embedding API call is much more likely to fail; that is the only place things can fail. So we can do it in this way. Once all the chunking and saving to the database is done, we can do it in one single mutation so that it gets done always. We can pick a batch of chunks, maybe 100, 200, or whatever, and embed it and save it, and then pick another batch. Once it completes, we mark that the document is completed, processed in the documents wherever we're checkpointing it, right. If it is not saved, if the process crashes in between, somehow in between processing a specific document, then it can simply look at the document's first document, at least when it is starting out, and look at whether the embedding field is filled with some data or not. If it is filled, that means that particular chunk is already embedded, and it can skip it. If it is not filled, then those chunks have to be embedded, and we can also do a filtering based on that embedding field, whether it is filled with some value or not.

> My Answer: Agreed — this is a strictly better approach. The architecture is now updated to use the two-phase approach you described. **Phase A** inserts all chunks without embeddings in a single atomic mutation (pure compute, can't fail). **Phase B** embeds in batches of `EMBED_BATCH_SIZE` (e.g., 200) and patches each batch's embeddings into the existing chunk records. If embedding crashes after batch 2 of 5, on retry the action sees that 400 chunks already have embeddings and only processes the remaining 600. The `embedding` field is now `optional` in the schema — Convex's vector index automatically excludes chunks where the vector field is not set, so un-embedded chunks won't appear in search results. This gives us per-batch checkpoint granularity within a single document.

```
indexDocument action per-document (two-phase):

  PHASE A — Chunk & Store (pure compute, atomic)
  ──────────────────────────────────────────────
  1. Query existing chunks for (documentId, indexConfigHash)
     → if ALL have embeddings: return { skipped: true }  (fully done)
     → if SOME exist: skip to Phase B                    (resume embedding)
     → if NONE exist: continue to step 2

  2. Load document content

  3. Chunk: RecursiveCharacterChunker.chunkWithPositions(doc)

  4. Insert ALL chunks WITHOUT embeddings in ONE mutation (atomic)
     → This always succeeds (no API calls, just DB writes)
     → Chunks are now safely persisted, embedding field is null

  PHASE B — Embed in Batches (API calls, resumable)
  ──────────────────────────────────────────────────
  5. Query chunks for (documentId, indexConfigHash) WHERE embedding IS NULL

  6. For each batch of EMBED_BATCH_SIZE (e.g., 200) un-embedded chunks:
     a. Call OpenAI embedding API for the batch
        ⚠ This is the failure point — retried by WorkPool
     b. Patch each chunk with its embedding vector (mutation per batch)
        → This batch is now checkpointed

  7. Return { skipped: false, chunksInserted: totalChunks, chunksEmbedded: totalChunks }
```

**Why this is better than all-at-once:**
- Chunking work is never lost (persisted before any API call)
- Embedding progress is preserved per-batch (if batch 3 of 5 fails, batches 1-2 are saved)
- On retry, only un-embedded chunks need processing (no re-chunking, no re-embedding what's done)
- Memory usage is bounded: only one batch of embeddings in memory at a time
- Very large documents (1000+ chunks) are handled gracefully

**Idempotency check** is now three-way:

```
query: chunks for (documentId, indexConfigHash)?
  → none exist:              Phase A + Phase B (full processing)
  → all have embeddings:     skip (already fully indexed)
  → some missing embeddings: Phase B only (resume embedding from where it left off)
```

> My Comments: So just to clarify, the KB ID and the document IDs are unique. There's only one KB document with a KB ID, and within that one KB we have a bunch of documents. Each document is like one Markdown file, and they'll be a separate document object for each of the documents, with a unique document ID. These two things are the same because that is the common, the only thing. For a particular KB with a set of documents in it, we want to index it in a particular configuration, and that is what the index config hash comes in. For any KB which has a bunch of documents, once we set a particular indexing configuration or KB configuration (which is basically KB ID and index config hash for that indexing configuration), it will generate a unique set of document chunks for all the documents within that KB. That is how we are tracking multiple indexing config, multiple indexing method, or indexing work or job for a particular KB which has a bunch of documents on it. Just wanted to clarify this is how it was, so there's a unique KB ID, unique document ID, but document chunks: earlier document chunks only had KB ID and document ID, but now, along with those, we have index config hash as well. The index config hash uniquely identifies not only the KB that the document belongs to and the document ID that is there, from which the documents are only extracted, but also the index config hash, which uniquely identifies the indexing configuration used to index that particular document chunk. I just wanted to confirm if that is a correct understanding.

> My Answer: Yes, that is exactly correct. The hierarchy is: **KB** (unique kbId) → contains N **Documents** (unique documentId each) → each document produces M **Chunks** scoped by `(documentId, indexConfigHash)`. The `indexConfigHash` is the third dimension. Previously `documentChunks` was keyed by `(kbId, documentId)`. Now it's keyed by `(kbId, documentId, indexConfigHash)`. The same KB with the same documents can have completely different chunk sets under different indexConfigHash values — different chunk sizes produce different chunk boundaries, different embedding models produce different vectors, etc. The triple `(kbId, documentId, indexConfigHash)` uniquely identifies a set of chunks for one document under one indexing configuration.

---

## Schema Changes

### documentChunks (updated)

```
documentChunks:
  documentId:      Id<"documents">
  kbId:            Id<"knowledgeBases">
  indexConfigHash: string                    ← NEW
  chunkId:         string
  content:         string
  start:           number
  end:             number
  embedding:       optional float64[]        ← CHANGED: now optional (null during Phase A)
  metadata:        any

  Indexes:
  - by_document:      [documentId]           (keep)
  - by_kb:            [kbId]                 (keep for backward compat)
  - by_kb_config:     [kbId, indexConfigHash] ← NEW
  - by_doc_config:    [documentId, indexConfigHash] ← NEW
  - by_embedding:     vectorIndex
      filterFields: [kbId, indexConfigHash]  ← UPDATED
```

Note: Convex vector indexes automatically exclude documents where the vector field is not set. So chunks inserted in Phase A (without embeddings) are invisible to vector search until Phase B patches in their embeddings. This is exactly the behavior we want — only fully-embedded chunks are searchable.

The `indexConfigHash` creates a namespace within a KB:

```
KB "product-docs" (kbId: abc123)
  │
  ├── indexConfigHash: "a1b2c3..." (recursive-1000/200, 3-small)
  │     ├── doc1: 15 chunks
  │     ├── doc2: 23 chunks
  │     └── doc3: 8 chunks
  │
  └── indexConfigHash: "d4e5f6..." (recursive-500/100, 3-large)
        ├── doc1: 30 chunks
        ├── doc2: 45 chunks
        └── doc3: 16 chunks

retrieval: vectorSearch WHERE kbId=abc123 AND indexConfigHash="a1b2c3..."
cleanup:   DELETE WHERE kbId=abc123 AND indexConfigHash="d4e5f6..."
```

### indexingJobs (new table)

```
indexingJobs:
  orgId:           string
  kbId:            Id<"knowledgeBases">
  indexConfigHash: string
  indexConfig:     any  (serialized IndexConfig for display)
  status:          "pending" | "running" | "completed"
                   | "completed_with_errors" | "failed"
                   | "canceling" | "canceled"
  totalDocs:       number             (count — set once at job creation)
  processedDocs:   number             (count — incremented in onComplete)
  failedDocs:      number             (count — incremented in onComplete)
  skippedDocs:     number             (count — incremented in onComplete)
  totalChunks:     number             (count — accumulated from successful results)
  error?:          string             (job-level error, e.g. "all docs failed")
  failedDocDetails?: array of {       ← UPDATED: now includes per-doc errors
    documentId:  Id<"documents">
    error:       string               (the specific error for this document)
  }
  createdBy:       Id<"users">
  createdAt:       number             (epoch ms — Date.now())
  completedAt?:    number             (epoch ms — Date.now())

  Indexes:
  - by_kb_config: [kbId, indexConfigHash]
  - by_org:       [orgId]
  - by_status:    [orgId, status]
```

> My Comments: I am not clear why the skipped documents are there, and why is that a number, because is that going to be used only when the indexing job is interrupted, or is it always going to be there? What if the indexing job is interrupted multiple times? Not sure how it helps. Also, I want to understand: how are you tracking what all documents are processed in a particular indexing job? For the particular kb, we have multiple documents, and you are trying to process one document at a time in an atomic step, as mentioned earlier. Once the document is processed, where are you saving, or where are you keeping a note of that checkpoint that this document is completed? Next, the other document has to be processed. Is there any order in which you're processing the documents so that it can pick up from there, or are you just going to filter out how many documents are left in the kb to be processed? Can you clarify where exactly you are keeping a track of all the documents that are processed and that are yet to be processed, that are still pending? These total docs, processed docs, failed docs, skipped docs, total chunks: are these just the count of the total number of documents that are there in the KB and that are processed and that are failed? Or is that an array of the document IDs which are processed or failed or skipped or total etc? Just wanted to understand how you are tracking and keeping track of the pending documents in the KB.Also, when it comes to a terminal error, that means there is an error in processing one document. There could be an error in processing one particular document chunk as well, but let's not get into that level. Let's just consider if there is an error in processing one specific document, because there might be some special characters or there might be some issue in that document which is causing a problem in embedding some chunks within a document. There can be one or multiple such documents in a KB. If even after retry and exponential back off we are still not able to process that document properly, all of those such documents should be kept somewhere so that we know, "Okay, these documents should not be processed and they have errors and will require a manual check: what is the problem there?" That is a kind of dead letter queue, similar to that concept, and that will help in debugging. I think you're saving the document IDs as failed document IDs; I think that makes sense. Does it make sense to have corresponding errors for each document? Right now you have only one error field just for the terminal error. Can you elaborate on what is that terminal error? Will that be happening? Will that be one single error for the whole indexing job, or will there be different others? Does it make sense to have different errors for each document ID that they run to process? Also, shouldn't the created_at and completed_at properties be date instead of number? What are you talking about, epoch, Linux epoch time? What is a good and standard way of doing it in TypeScript and also in convex database? What is the most recommended practice to save date? Is this just to save the epoch timestamp, or does it make sense to have it in a specific date and time format?

> My Answer — skippedDocs: `skippedDocs` is a count. It tracks documents that the `indexDocument` action found were **already fully indexed** (all chunks exist with embeddings) and skipped. This happens in two scenarios: (1) A job was interrupted and restarted — previously completed documents are detected and skipped, and (2) Two jobs for the same (kbId, indexConfigHash) overlap briefly before dedup catches it. It's purely informational for the UI — e.g., "87 processed, 15 skipped, 2 failed out of 120" tells the user that 15 were already done from a previous partial run.

> My Answer — checkpoint tracking: The **`documentChunks` table itself IS the checkpoint**. There is no separate per-document status table. Here's how it works: When WorkPool dispatches a document to the `indexDocument` action, the action's first step queries: "do chunks exist for `(documentId, indexConfigHash)`?" If all chunks have embeddings → document is done (skip). If some chunks exist but lack embeddings → resume embedding from where it left off (Phase B only). If no chunks exist → process from scratch (Phase A + B). There is **no ordering**. WorkPool processes documents in any order (that's the nature of parallel fan-out). We don't need ordering because each document is independent. The "which documents are pending" information is derived: WorkPool has N work items enqueued; as each completes, the `onComplete` callback increments the counters. The counts on `indexingJobs` (`totalDocs`, `processedDocs`, `failedDocs`, `skippedDocs`) are **just numbers (counts)**, not arrays of IDs. Storing 10K document IDs in an array on one record would make it huge and cause write conflicts when multiple onComplete callbacks try to update simultaneously. Counts are small and safe for concurrent increments.

> My Answer — dead letter queue / per-document errors: Agreed, this is important. The schema is now updated: `failedDocIds` is replaced with `failedDocDetails`, which is an array of `{ documentId, error }` objects. When WorkPool's onComplete fires with `result.kind === "failed"`, the error string from the failed action is captured alongside the documentId. This serves as the dead letter queue — you can see exactly which documents failed and why (e.g., "OpenAI API error: invalid characters in input", "Embedding dimension mismatch: expected 1536, got 3072"). The job-level `error` field is separate and reserved for job-wide issues (e.g., if the job itself fails to start or all docs fail with the same error). In practice, individual document failures go into `failedDocDetails`, and the job-level `error` is only set if something catastrophic happens at the job orchestration level.

> My Answer — dates (createdAt / completedAt): Using `number` (Unix epoch milliseconds from `Date.now()`) is the **standard and recommended Convex practice**. Convex does not have a native `Date` type in its value system — `v.number()` is the only option. The built-in `_creationTime` system field that Convex adds to every document is also epoch ms. Every example in Convex docs uses `Date.now()`. In TypeScript, `Date.now()` returns epoch ms as a number, and you convert back with `new Date(timestamp)` when displaying in the UI. This is universal across Convex, and consistent with what the rest of the codebase already does (see `jobs.createdAt`, `documents.createdAt`, etc. — all `v.number()` with `Date.now()`).


---

## Why WorkPool (not Workflow)

| Consideration | WorkPool | Workflow |
|---|---|---|
| 10,000 docs parallel | Each is a work item — native | 10,000 steps → 8 MiB journal risk |
| Retry per document | Built-in with backoff | Per-step, but journal grows |
| Progress tracking | onComplete callback | listSteps() — heavy |
| Cancel | cancelAll() | cancel() |
| Complexity | Low — just enqueue + callback | Higher — deterministic handler |
| Overhead | Minimal | Journal management |

Each document is an independent unit of work with no dependencies between documents. This is a perfect fan-out pattern, which is exactly what WorkPool is designed for.

> My Comments: This makes sense. We should definitely, I think, use `workpool` here because all the document processing is done independently, and we can have a lot of parallelism to process this. Can we parameterize the amount of parallelism so that we can control how many resources we want to put in processing a document? For example, for free tier users this can be a less number, and for paid users this could be higher. Even for paid users, there can be different tiers. Is it possible to parameterize the amount of parallel threads that can be used to do the step? Also, what is "Cancel All"? What does it mean? "Cancel All", does it mean it will cancel all the work that has been done by the work pool and delete all the previous data, or cancel all the current ongoing processes? Can you elaborate on what "Cancel All" means and how it is different from this normal "Cancel"? how it is an advantage?

> My Answer — parameterized parallelism: Yes, absolutely. WorkPool's `maxParallelism` can be changed dynamically at runtime via `ctx.runMutation(components.indexingPool.config.update, { maxParallelism: N })`. So at job start, we look up the org's tier and set the parallelism accordingly (Free=3, Pro=10, Enterprise=20). This is covered in the "Dynamic parallelism (per-tier)" section below.

> My Answer — cancel vs cancelAll: Neither `cancel` nor `cancelAll` deletes any data that was already written. They only prevent **future** execution. Here's the difference:
> - **`pool.cancel(ctx, workId)`**: Cancels ONE specific work item by its WorkPool ID. If that work item hasn't started yet, it will never run. If it's already running, it finishes (WorkPool cannot interrupt in-progress actions). The onComplete callback fires with `result.kind === "canceled"`.
> - **`pool.cancelAll()`**: Cancels ALL pending (not-yet-started) work items in the entire pool at once. This is what you'd call when a user clicks "Cancel Indexing" — it prevents all remaining un-started documents from being processed. Already-running documents complete normally. Already-completed documents keep their data.
>
> In both cases: chunks already written to `documentChunks` remain in the database. If you want to undo completed work after canceling, you'd call `cleanupIndex(kbId, indexConfigHash)` separately. The advantage of `cancelAll` over individual `cancel` is that you don't need to track individual workIds for every document — one call stops everything pending in the pool.

---

## WorkPool Crash Recovery & Timeout Handling

A critical question: does WorkPool handle the scenarios we previously built custom infrastructure for — the 10-minute action timeout, crashed/stalled actions, and watchdog recovery? **Yes. WorkPool eliminates all custom crash-detection code.**

### What our custom batchProcessor had to do (and WorkPool replaces)

```
Our custom batchProcessor.ts              WorkPool (built-in)
──────────────────────────────            ──────────────────────────
Manual watchdog scheduled at 11 min       Recovery module (recovery.ts)
  → only marks error, no auto-retry         → checks _scheduled_functions state
                                            → auto-retries with backoff

Manual 8-min time budget                  Not needed
  → break loop, schedule continuation       → each doc is its own action
                                            → no loop to break out of

Manual continuation scheduling            Not needed
  → ctx.scheduler.runAfter(0, ...)          → WorkPool main loop dispatches next

No parallelism (sequential for loop)      maxParallelism built-in
No exponential backoff                    Built-in with jitter
```

### WorkPool's three-layer crash detection

**Layer 1 — Convex scheduler guarantee (platform-level):**
WorkPool dispatches each action via `ctx.scheduler.runAfter(0, action)`. Convex itself tracks every scheduled function in the `_scheduled_functions` system table. If an action fails (throws an error) or times out (killed at 10 minutes), Convex marks it as `"failed"` in this system table. This is a platform-level guarantee — no custom code needed.

**Layer 2 — Main loop completion handling (immediate):**
WorkPool's `loop.ts` runs a `main` mutation that processes completions in three phases: handle completions, handle cancelations, handle new starts. When it sees a completed (or failed) scheduled function, it either retries with backoff (if retries remain) or fires the `onComplete` callback with `result.kind === "failed"`. This is the primary detection mechanism — it runs as part of the normal WorkPool event loop.

**Layer 3 — Periodic healthcheck cron (safety net):**
A cron runs every **30 minutes** (`crons.ts`) that force-kicks the WorkPool if it detects any of:
- Running actions that haven't reported back (stale state)
- Pending completions that haven't been processed
- State mismatches between internal tracking tables
- Scheduled timestamps that are overdue by more than 1 minute

This is the "belt and suspenders" layer — it catches edge cases where the main loop itself might have stalled (e.g., due to a Convex platform hiccup).

### How WorkPool handles the 10-minute action timeout

```
Action hits 10-min Convex hard limit
       │
       ▼
Convex kills the action, marks _scheduled_functions as "failed"
       │
       ▼
WorkPool main loop detects the failure via recovery.ts
       │
       ├── retries remaining? → reschedule with exponential backoff + jitter
       │     (next attempt after: initialBackoffMs × base^attempt + jitter)
       │     Two-phase checkpoint: retry resumes from where it left off
       │
       └── retries exhausted? → fire onComplete with result.kind = "failed"
              → onDocumentIndexed records the failure in failedDocDetails
```

**Key difference from our old approach**: With the custom `batchProcessor`, we had to **prevent** the 10-minute timeout by using an 8-minute budget and self-continuation. With WorkPool, each document is its own independent action, so:
- If one action times out, WorkPool retries just that document
- Other documents continue processing in parallel, unaffected
- The two-phase checkpoint means retries skip already-completed work

### Can a single document actually exceed 10 minutes?

Extremely unlikely, but let's do the math:

```
Phase A — Chunk & Store (pure compute):
  1000-chunk doc: chunking ≈ 100ms–500ms
  Insert 1000 chunks (one mutation): ≈ 50ms
  Phase A total: < 1 second

Phase B — Embed in batches (API calls):
  1000 chunks / EMBED_BATCH_SIZE(200) = 5 batches
  Each OpenAI embedding call: ≈ 1–3 seconds (normal)
  Each patch mutation: ≈ 50ms
  Phase B total: 5 × 3s = ≈ 15 seconds

  Even extreme: 5000 chunks:
  5000 / 200 = 25 batches × 3s = ≈ 75 seconds
```

**Normal case**: well under 2 minutes, even for very large documents.

**Pathological case** (massive doc + very slow embedding API):
```
5000 chunks / 200 = 25 batches × 30s (very slow API) = 750s = 12.5 min
  ← exceeds 10 min!
```

But the two-phase checkpoint makes this self-healing:
```
Attempt 1:
  Phase A: chunks saved (< 1 sec)
  Phase B: batches 1–15 complete, each checkpointed
  Action killed at 10 minutes

Attempt 2 (WorkPool retry):
  Phase A: chunks exist → skip
  Batches 1–15: embeddings exist → skip
  Resume from batch 16 → only 10 batches left
  Completes in ≈ 5 minutes ✓
```

If this edge case is a concern, reducing `EMBED_BATCH_SIZE` (e.g., to 50) gives more checkpoint granularity — each batch completes faster, so more progress is saved before a potential timeout. The tradeoff is more API calls.

### Summary: what we no longer need to build

| Infrastructure | Old (custom batchProcessor) | New (WorkPool) |
|---|---|---|
| Crash detection | Manual 11-min watchdog (`jobs.watchdog`) | Built-in: `recovery.ts` + 30-min healthcheck cron |
| Timeout prevention | 8-min time budget, break loop | Not needed: each doc is its own action |
| Continuation scheduling | `ctx.scheduler.runAfter(0, continuationAction)` | Not needed: WorkPool main loop handles it |
| Retry with backoff | Not implemented | Built-in exponential backoff + jitter |
| Parallelism | None (sequential for loop) | `maxParallelism` config, dynamic at runtime |
| Status tracking | Custom `jobs` + `jobItems` tables | WorkPool internal tables + our `indexingJobs` for UI |
| Code to maintain | ≈ 160 lines (`batchProcessor.ts`) + watchdog | Zero — component handles orchestration |

---

## WorkPool Configuration

```typescript
const indexingPool = new Workpool(components.indexingPool, {
  maxParallelism: 10,       // 10 docs processed concurrently
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 5,         // try up to 5 times
    initialBackoffMs: 2000, // start at 2 seconds
    base: 2,                // 2s → 4s → 8s → 16s
  },
});
```

Retry timeline for a failing document:

```
Attempt 1: immediate
Attempt 2: ~2s  (+ jitter)
Attempt 3: ~4s  (+ jitter)
Attempt 4: ~8s  (+ jitter)
Attempt 5: ~16s (+ jitter)   ← if this fails → TERMINAL
Total max wait: ~30s + jitter
```

For sustained API outages, increase `maxAttempts: 10` and `initialBackoffMs: 5000` → retry over ~85 minutes before terminal failure.

Note: Because of the two-phase approach, retries are efficient even for large documents. If attempt 1 completes Phase A (chunking) but fails in Phase B (embedding batch 3 of 5), attempt 2 skips Phase A entirely and resumes Phase B from batch 3. No work is repeated.

### Dynamic parallelism (per-tier)

```
Free tier:   maxParallelism = 3
Pro tier:    maxParallelism = 10
Enterprise:  maxParallelism = 20
```

Adjusted at job start via:

```typescript
ctx.runMutation(components.indexingPool.config.update, { maxParallelism: tierLimit })
```

Note: this is pool-wide, not per-job. If two orgs index simultaneously, they share the limit. Per-org throttling would need a different approach (future enhancement).

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  USER / EXPERIMENT RUNNER                                               │
│  ────────────────────────                                               │
│                                                                         │
│  startIndexing({                                                        │
│    kbId: "abc123",                                                      │
│    indexConfig: { strategy: "plain", chunkSize: 1000,                  │
│                   chunkOverlap: 200, embeddingModel: "3-small" }       │
│  })                                                                     │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  MUTATION: startIndexing                                        │   │
│  │                                                                 │   │
│  │  1. hash = computeIndexConfigHash(config) → "a1b2c3d4..."     │   │
│  │                                                                 │   │
│  │  2. existingJob = query indexingJobs                            │   │
│  │       WHERE kbId=abc123 AND hash="a1b2c3d4..."                 │   │
│  │       AND status IN ("pending","running")                       │   │
│  │     → found? return existingJob._id (no double-start)          │   │
│  │                                                                 │   │
│  │  3. docs = query documents WHERE kbId=abc123 → [d1,d2,...d120] │   │
│  │                                                                 │   │
│  │  4. job = insert indexingJobs {                                 │   │
│  │       kbId, hash, config, status: "running",                   │   │
│  │       totalDocs: 120, processedDocs: 0, failedDocs: 0,        │   │
│  │       skippedDocs: 0, totalChunks: 0,                          │   │
│  │       createdAt: Date.now()                                     │   │
│  │     }                                                           │   │
│  │                                                                 │   │
│  │  5. for each doc:                                               │   │
│  │       indexingPool.enqueueAction(                               │   │
│  │         internal.indexingActions.indexDocument,                  │   │
│  │         { documentId: doc._id, kbId, indexConfigHash: hash,    │   │
│  │           indexConfig },                                        │   │
│  │         {                                                       │   │
│  │           onComplete: internal.indexing.onDocumentIndexed,      │   │
│  │           context: { jobId: job, documentId: doc._id },        │   │
│  │         }                                                       │   │
│  │       )                                                         │   │
│  │                                                                 │   │
│  │  6. return job._id                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       │  120 actions enqueued to WorkPool                               │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ACTION: indexDocument (× N in parallel, "use node")            │   │
│  │                                                                 │   │
│  │  PHASE A — Chunk & Store                                        │   │
│  │  ─────────────────────────                                      │   │
│  │  1. existingChunks = query documentChunks                       │   │
│  │       WHERE (documentId, indexConfigHash)                       │   │
│  │                                                                 │   │
│  │  2. if existingChunks.length > 0:                               │   │
│  │       allEmbedded = existingChunks.every(c => c.embedding)     │   │
│  │       if allEmbedded: return { skipped: true }                 │   │
│  │       else: skip to Phase B (resume embedding)                  │   │
│  │                                                                 │   │
│  │  3. doc = get document content                                  │   │
│  │                                                                 │   │
│  │  4. chunks = RecursiveCharacterChunker.chunkWithPositions(doc)  │   │
│  │                                                                 │   │
│  │  5. runMutation(insertChunkBatch, {                             │   │
│  │       chunks WITHOUT embeddings                                 │   │
│  │     })  ← ATOMIC: all chunks saved, embedding=null             │   │
│  │                                                                 │   │
│  │  PHASE B — Embed in Batches (resumable)                         │   │
│  │  ──────────────────────────────────────                         │   │
│  │  6. unembedded = query chunks WHERE embedding IS NULL           │   │
│  │       for (documentId, indexConfigHash)                          │   │
│  │                                                                 │   │
│  │  7. for each batch of EMBED_BATCH_SIZE (200):                   │   │
│  │       a. embeddings = OpenAI embed API(batch.texts)             │   │
│  │          ⚠ Failure point — WorkPool retries the whole action,  │   │
│  │            but Phase A is skipped (chunks exist) and completed  │   │
│  │            batches are skipped (embeddings already set)          │   │
│  │       b. runMutation(patchChunkEmbeddings, {                    │   │
│  │            chunkIds + embeddings                                │   │
│  │          })  ← batch checkpoint saved                           │   │
│  │                                                                 │   │
│  │  8. return { skipped: false, chunksInserted: N }                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       │  per-document completion                                        │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  MUTATION: onDocumentIndexed (WorkPool onComplete callback)     │   │
│  │                                                                 │   │
│  │  Input: { workId, context: { jobId, documentId }, result }     │   │
│  │                                                                 │   │
│  │  1. Load indexingJob                                            │   │
│  │                                                                 │   │
│  │  2. switch (result.kind):                                       │   │
│  │       "success":                                                │   │
│  │         if returnValue.skipped:                                 │   │
│  │           patch { skippedDocs: +1 }                             │   │
│  │         else:                                                   │   │
│  │           patch { processedDocs: +1,                            │   │
│  │                   totalChunks: += returnValue.chunksInserted }  │   │
│  │       "failed":                                                 │   │
│  │         patch { failedDocs: +1,                                 │   │
│  │           failedDocDetails: append({                            │   │
│  │             documentId, error: result.error                     │   │
│  │           })                                                    │   │
│  │         }                                                       │   │
│  │       "canceled":                                               │   │
│  │         (no-op, job is being canceled)                          │   │
│  │                                                                 │   │
│  │  3. done = processedDocs + failedDocs + skippedDocs            │   │
│  │     if done === totalDocs:                                      │   │
│  │       if failedDocs > 0:                                        │   │
│  │         status = "completed_with_errors"                        │   │
│  │       else:                                                     │   │
│  │         status = "completed"                                    │   │
│  │       patch { status, completedAt: Date.now() }                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## The Three Operations: init / retrieve / cleanup

Scoped by: `(kbId, indexConfigHash)`

### INIT (startIndexing)

```
Input:  kbId, indexConfig (from PipelineConfig)
Output: indexingJobId

- Computes indexConfigHash from indexConfig
- Creates indexingJob record for progress tracking
- Fans out N document actions via WorkPool
- Idempotent: skips already-indexed documents
- Idempotent: if job already exists for (kb, hash) → returns existing job
- Observable: indexingJob record updates reactively

UI subscribes to:
  useQuery(api.indexing.getJob, { jobId })
  → { status, processedDocs, totalDocs, failedDocs, totalChunks, error }
```

### RETRIEVE (vector search — enhanced)

```
Input:  query, kbId, indexConfigHash, topK
Output: PositionAwareChunk[]

vectorSearch("documentChunks", "by_embedding", {
  vector: queryEmbedding,
  limit: topK,
  filter: kbId AND indexConfigHash  ← now config-aware
})

Note: Only chunks with embeddings appear in vector search results.
Chunks still in Phase A (embedding=null) are automatically excluded
by the Convex vector index.
```

### CLEANUP (cleanupIndex)

```
Input:  kbId, indexConfigHash, options: { deleteDocuments?: boolean }
Output: { chunksDeleted, docsDeleted? }

- Paginated deletion of chunks by (kbId, indexConfigHash)
- Optionally delete source documents from KB
- Deletes associated indexingJob record
- Safe for large KBs (batched, not collect-all)
```

**Why a plain action (not WorkPool) is sufficient for cleanup:**

Cleanup involves zero external API calls — just DB deletions. There is no embedding API, no LLM call, no network dependency that could fail transiently. The only dependency is Convex itself, and if Convex is down, nothing works anyway. The operation is also inherently idempotent (deleting non-existent chunks is a no-op), and the timing math works out easily:

```
Worst case: 50,000 chunks
  At 500 chunks/batch: 100 deletion mutations
  Each mutation: ≈ 50ms
  Total: ≈ 5 seconds

Even 200,000 chunks:
  400 mutations × 50ms = ≈ 20 seconds

Both well within the 10-minute action timeout.
```

WorkPool's value — retry with backoff, parallelism, progress tracking per-item — is unnecessary here. A single action with a paginated loop is the right tool.

Cleanup flow:

```
cleanupIndex({ kbId, indexConfigHash })

ACTION: cleanupAction (plain action, no WorkPool)
  loop:
    batch = query 500 chunks WHERE (kbId, indexConfigHash)
    if batch.length === 0: done
    runMutation(deleteChunkBatch, { ids: batch.map(c => c._id) })
    if more chunks remain: continue loop

  if deleteDocuments:
    docs = query documents WHERE kbId
    for each doc: delete (with storage file cleanup)

  delete indexingJob record
```

Note: For truly massive indexes (millions of chunks approaching the 10-minute limit), the cleanup could be refactored as a scheduled chain (delete batch → schedule next deletion → repeat). But for our target scale (tens of thousands of documents × ≈ 10 chunks each = ≈ 100K chunks max), a single action is sufficient.

---

## Lifecycle State Machine

```
  startIndexing()
       │
       ▼
   ┌────────┐    all docs enqueued    ┌─────────┐
   │PENDING │ ──────────────────────▶ │ RUNNING  │
   └────────┘                         └────┬─────┘
                                           │
                    ┌──────────────────────┬┼──────────────────┐
                    │                      │                    │
                    ▼                      ▼                    ▼
           ┌────────────┐         ┌────────────────┐   ┌────────────┐
           │ COMPLETED  │         │  COMPLETED      │   │   FAILED   │
           │            │         │  WITH_ERRORS    │   │            │
           └────────────┘         └────────────────┘   └────────────┘
           all docs OK            some docs failed     all retries
                                  (partial index)      exhausted

                    user cancels
                        │
                        ▼
               ┌─────────────┐    pending items     ┌───────────┐
               │  CANCELING  │ ──────────────────▶ │ CANCELED   │
               │             │    drained/canceled  │            │
               └─────────────┘                      └───────────┘
```

The `completed_with_errors` state is important. If 97 out of 100 documents succeed but 3 have terminal failures (e.g., document content is empty or malformed), the KB is *mostly* indexed. The user can inspect `failedDocDetails` to see exactly which documents failed and why, then decide whether to retry those specific documents or accept the partial index.

---

## Observability: Frontend Integration

The frontend subscribes to the indexingJob record reactively:

```
useQuery(api.indexing.getJob, { jobId })

Returns (reactive, updates in real-time):
{
  status: "running",
  totalDocs: 120,
  processedDocs: 87,          ← success count
  failedDocs: 2,              ← terminal failures
  skippedDocs: 15,            ← already indexed (idempotent)
  totalChunks: 1543,          ← cumulative chunks inserted
  pendingDocs: 16,            ← computed: 120 - 87 - 2 - 15 = 16
  failedDocDetails: [         ← dead letter queue for debugging
    { documentId: "d42", error: "OpenAI: invalid input characters" },
    { documentId: "d89", error: "Embedding timeout after 5 retries" },
  ],
  error: null,
}
```

UI rendering:

```
┌──────────────────────────────────────────────────────┐
│ ● INDEXING  (87/120 documents)                        │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  72%                │
│                                                       │
│ 1,543 chunks indexed  ·  2 failed  ·  15 skipped     │
└──────────────────────────────────────────────────────┘
```

On completion:

```
┌──────────────────────────────────────────────────────┐
│ ✓ INDEXING COMPLETE (with 2 errors)                   │
│                                                       │
│ 120 documents  ·  1,843 chunks  ·  2 failures        │
│                                                       │
│ View in Convex Dashboard →                           │
│                                                       │
│ ▼ 2 documents failed                                 │
│   d42: OpenAI: invalid input characters              │
│   d89: Embedding timeout after 5 retries             │
└──────────────────────────────────────────────────────┘
```

---

## How the Experiment Runner Consumes This

The experiment runner is a **consumer** of the indexing service, not the owner of indexing logic:

```
experiments.start mutation:
  1. Create experiment record
  2. Compute indexConfigHash from experiment's pipelineConfig
  3. Check: is this (kbId, indexConfigHash) already indexed?
     │
     ├── YES → skip to step 4
     │
     └── NO → call startIndexing(kbId, indexConfig)
            → get indexingJobId
            → WAIT for indexing to complete
            (frontend shows Phase 1 progress from indexingJob)

  4. Run evaluation (Phase 2)
     → vectorSearch with (kbId, indexConfigHash)
```

This separation means:
- A user uploading documents for production use calls the same `startIndexing`
- An experiment that needs indexing calls the same `startIndexing`
- Both get the same reliability, retries, progress tracking
- If two experiments need the same index config, the second one skips (idempotent)

---

## Edge Cases

### Concurrent index requests for same (kbId, indexConfigHash)

```
Request A: startIndexing(kb1, configX)  →  creates job J1
Request B: startIndexing(kb1, configX)  →  finds J1 exists, returns J1
```

The dedup query in `startIndexing`:

```
existingJob = query indexingJobs
  WHERE kbId AND indexConfigHash
  AND status NOT IN ("completed", "failed", "canceled")
→ found? return existingJob._id
→ not found? create new job
```

### Very large documents (1000+ chunks)

With the two-phase approach, large documents are handled gracefully:
- Phase A inserts all chunks without embeddings in one atomic mutation (Convex supports up to 8192 writes per transaction — a 4000-chunk document is fine)
- Phase B embeds in batches of EMBED_BATCH_SIZE (200). For 1000 chunks, that's 5 embedding API calls, each checkpointed
- If the action times out (10 min) after completing 3 of 5 batches, WorkPool retries. The retry skips Phase A (chunks exist) and resumes Phase B from batch 4 (batches 1-3 already have embeddings)
- Memory usage is bounded: only 200 embeddings in memory at a time, not 1000

For embedding, OpenAI's API supports up to 2048 inputs per batch. If a document has 3000+ chunks, the EMBED_BATCH_SIZE (200) keeps each API call well within limits.

Timing analysis (see "Can a single document actually exceed 10 minutes?" in the Crash Recovery section):
- **Normal case** (1000 chunks, normal API speed): ≈ 15 seconds total — well under limit
- **Extreme case** (5000 chunks, 30s/batch API latency): ≈ 12.5 min — exceeds 10 min, but self-heals across 2 WorkPool retry attempts thanks to per-batch checkpointing

### Re-indexing with a new config

User changes chunkSize from 1000 to 500:
- New `indexConfigHash` is computed → different from existing
- `startIndexing` creates a new `indexingJob` and new chunks
- Old chunks (with old hash) are untouched
- User can later call `cleanupIndex(kbId, oldHash)` to remove old chunks
- Or keep both and compare retrieval performance

### Force re-index same config

If the user wants to re-index with the SAME config (e.g., document content was updated):
- `startIndexing(kbId, indexConfig, { force: true })`
- This first calls `cleanupIndex(kbId, hash)` to remove existing chunks
- Then proceeds with normal indexing
- The idempotency check per document is skipped when `force: true`

---

## File Structure

```
packages/backend/convex/
  convex.config.ts          ← register indexingPool component
  indexing.ts               ← mutations/queries (startIndexing, getJob,
                               cancelIndexing, cleanupIndex,
                               onDocumentIndexed callback)
  indexingActions.ts         ← "use node" — indexDocument action
  schema.ts                 ← add indexingJobs table, update documentChunks
```

---

## Open Questions

1. **`startIndexing` as mutation vs action** — It needs N `enqueueAction` calls. If a KB has 10,000 docs, that's 10,000 enqueue calls in a single mutation. May need `enqueueActionBatch` or split across multiple mutations for very large KBs.

2. **Pool-wide vs per-org parallelism** — WorkPool `maxParallelism` is global. If Org A is indexing 5,000 docs and Org B starts, they share the same slots. Per-org throttling needs separate pools or custom semaphore.

3. **Embedding model dimension validation** — If someone indexes with `text-embedding-3-large` (3072 dims) but the vectorIndex is `dimensions: 1536`, inserts fail. Should we validate upfront or support multiple dimension sizes?

4. **Experiment runner "wait for indexing"** — The frontend can subscribe to the indexingJob reactively and orchestrate: show Phase 1 (indexing) → when done, auto-start or manual trigger for Phase 2 (evaluation).

5. **EMBED_BATCH_SIZE tuning** — 200 is a reasonable default. Smaller batches = more frequent checkpoints but more API calls. Larger batches = fewer API calls but more work lost on failure. Should this be configurable?
