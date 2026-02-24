## Why

The current KB indexing implementation is a simple for-loop inside the experiment runner action (`experimentActions.ts`), with no retry, no parallelism, no progress tracking, and no crash recovery. It cannot handle large KBs (1000+ documents), is tightly coupled to experiment execution, and is unusable as a standalone service for production inference pipelines. We need a standalone, production-grade indexing service that can be consumed by both the experiment runner and future production retrieval systems.

## What Changes

- **New `indexingJobs` table** for tracking indexing job status, progress counts, and per-document error details (dead letter queue)
- **Updated `documentChunks` table** with `indexConfigHash` field for multi-config support and optional `embedding` field for two-phase processing
- **New `indexing.ts`** with mutations/queries: `startIndexing`, `onDocumentIndexed` (WorkPool callback), `getJob`, `cancelIndexing`, `cleanupIndex`, `isIndexed`, plus chunk CRUD (`insertChunkBatch`, `patchChunkEmbeddings`, `deleteChunkBatch`)
- **New `indexingActions.ts`** ("use node") with two-phase `indexDocument` action (chunk-first, then embed in batches) and `cleanupAction` for paginated deletion
- **WorkPool component** (`@convex-dev/workpool`) registered as `indexingPool` for parallel document processing with retry, exponential backoff, and crash recovery
- **Updated vector index** `filterFields` to include `indexConfigHash` for config-scoped retrieval
- **Updated `rag.ts`** queries to be `indexConfigHash`-aware

## Capabilities

### New Capabilities
- `kb-indexing-service`: Standalone indexing service using Convex WorkPool — startIndexing, progress tracking, cancelation, cleanup, and two-phase document processing (chunk + embed) with retry, idempotency, and dead letter queue
- `kb-indexing-workpool-config`: WorkPool component registration and configuration — parallelism tiers, retry behavior, exponential backoff settings

### Modified Capabilities
- `convex-schema`: Add `indexingJobs` table, update `documentChunks` with `indexConfigHash` field, optional `embedding`, and new indexes
- `convex-position-aware-rag`: Update chunk CRUD and vector search to be `indexConfigHash`-aware, replace inline indexing with service calls

## Impact

- **Backend**: New `indexing.ts` and `indexingActions.ts` files; updated `schema.ts`, `rag.ts`; new `@convex-dev/workpool` dependency
- **Experiment runner**: `experimentActions.ts` will delegate indexing to the new service instead of inline for-loop
- **Frontend**: Can subscribe to `indexingJobs` for real-time progress (experiment execution phases UI)
- **Dependencies**: New npm package `@convex-dev/workpool`; `convex.config.ts` updated to register component
- **Data migration**: Existing `documentChunks` without `indexConfigHash` need a default value or re-indexing
