# Backend Architecture Overview

> Convex backend for the RAG Evaluation System. All source lives in `packages/backend/convex/`.

## Quick Navigation

| Document | Scope |
|----------|-------|
| [Generation Module](./generation-module.md) | Question generation pipeline (strategies, ground truth, WorkPool) |
| [Retrieval Module](./retrieval-module.md) | Indexing, chunking, embedding, vector search, retriever CRUD |
| [Experiment Runner](./experiment-runner.md) | Experiment lifecycle, LangSmith integration, evaluation flow |
| [Refactoring Suggestions](./refactoring-suggestions.md) | Code health improvements, file structure, testing, naming |

---

## System Overview

The backend orchestrates three core workflows on top of a Convex database:

```
                     ┌──────────────────────────────────────────────────────┐
                     │                   Frontend (Next.js)                │
                     │   useQuery / useMutation / useAction (real-time)    │
                     └──────────┬───────────────┬──────────────┬──────────┘
                                │               │              │
                     ┌──────────▼──┐   ┌────────▼────┐  ┌─────▼──────────┐
                     │  Generation │   │  Retrieval   │  │  Experiments   │
                     │  Module     │   │  Module      │  │  Module        │
                     │             │   │              │  │                │
                     │ strategies  │   │ indexing     │  │ orchestration  │
                     │ ground truth│   │ retrievers   │  │ LangSmith      │
                     │ LangSmith   │   │ vector search│  │ evaluation     │
                     │ sync        │   │              │  │                │
                     └──────┬──────┘   └──────┬───────┘  └───────┬────────┘
                            │                 │                  │
                     ┌──────▼─────────────────▼──────────────────▼────────┐
                     │                  Shared Infrastructure             │
                     │                                                    │
                     │  Schema · Auth (Clerk) · WorkPool · LLM Client    │
                     │  Users · Knowledge Bases · Documents · Datasets   │
                     └────────────────────────────────────────────────────┘
                            │                 │                  │
                     ┌──────▼─────────────────▼──────────────────▼────────┐
                     │              External Services                     │
                     │  OpenAI (embeddings + LLM) · LangSmith · Clerk    │
                     └────────────────────────────────────────────────────┘
```

---

## File Map

All 26 source files sit flat in `convex/`. Here's how they group logically:

### Core Modules

| File | Role | Convex Type |
|------|------|-------------|
| `generation.ts` | Question generation orchestration, WorkPool callbacks, cancel, queries | mutation / query / internalMutation / internalQuery |
| `generationActions.ts` | Strategy execution (Simple, DimensionDriven, RealWorldGrounded), ground truth assignment | `"use node"` internalAction |
| `indexing.ts` | Indexing orchestration, WorkPool callbacks, cancel, queries | mutation / query / internalMutation / internalQuery |
| `indexingActions.ts` | Two-phase document indexing (chunk + embed), cleanup | `"use node"` internalAction |
| `retrievers.ts` | Retriever CRUD, status sync, index management | mutation / query / internalMutation / internalQuery |
| `retrieverActions.ts` | Retriever creation (hash computation), indexing trigger, standalone retrieve | `"use node"` action |
| `experiments.ts` | Experiment start, WorkPool enqueue, cancel, onComplete, queries | mutation / query / internalMutation / internalQuery |
| `experimentActions.ts` | Experiment orchestrator, LangSmith evaluate() runner (inlined from eval-lib) | `"use node"` internalAction |
| `experimentResults.ts` | Per-question result storage and queries | query / internalMutation / internalQuery |

### Data Layer (CRUD)

| File | Role |
|------|------|
| `schema.ts` | Full Convex schema definition (10 tables, indexes, vector index) |
| `knowledgeBases.ts` | KB create / list / get (org-scoped) |
| `documents.ts` | Document upload, listing, internal queries |
| `datasets.ts` | Dataset list / get, LangSmith sync status updates |
| `questions.ts` | Question queries, batch insert, span updates, LangSmith example linking |
| `rag.ts` | Chunk CRUD (insert batch, patch embeddings, delete, queries) |
| `users.ts` | User sync from Clerk (getOrCreate, getByClerkId, me) |

### LangSmith Integration

> **Note:** LangSmith integration code previously lived in eval-lib under `src/langsmith/`. It has been fully migrated to the Convex backend. The `uploadDataset()` function is inlined in `langsmithSync.ts`, and `runLangSmithExperiment()` is inlined in `experimentActions.ts`. eval-lib is now a pure evaluation library with zero LangSmith dependency.

| File | Role |
|------|------|
| `langsmithSync.ts` | Dataset sync to LangSmith (inlined `uploadDataset()` + example ID linking) |
| `langsmithRetry.ts` | Manual retry mutation for failed syncs |
| `langsmithSyncRetry.ts` | Cron-driven auto-retry (finds failed syncs, re-schedules) |
| `crons.ts` | Hourly cron job for LangSmith retry |

### Infrastructure

| File | Role |
|------|------|
| `lib/auth.ts` | `getAuthContext()` — Clerk JWT extraction (userId, orgId, orgRole) |
| `lib/llm.ts` | `createLLMClient()` — OpenAI adapter for eval-lib's `LLMClient` interface |
| `auth.config.ts` | Clerk auth provider configuration |
| `convex.config.ts` | App config — registers 3 WorkPool components (indexing, generation, experiment) |
| `testing.ts` | Test-only functions (currently empty, batch processor tests removed) |
| `test.setup.ts` | Vite module glob for convex-test |

---

## Schema (10 Tables)

```
┌───────────────┐     ┌──────────────┐     ┌──────────────┐
│    users      │     │ knowledgeBases│     │  documents   │
│               │◀────│              │◀────│              │
│ clerkId       │     │ orgId        │     │ kbId         │
│ email, name   │     │ name         │     │ docId, title │
└───────────────┘     │ createdBy ──▶│     │ content      │
                      └──────┬───────┘     │ fileId       │
                             │             └──────┬───────┘
                    ┌────────▼───────┐            │
                    │   datasets     │     ┌──────▼────────┐
                    │                │     │ documentChunks │
                    │ kbId           │     │               │
                    │ strategy       │     │ documentId    │
                    │ langsmith*     │     │ kbId          │
                    └────────┬───────┘     │ indexConfigHash│
                             │             │ embedding (vec)│
                    ┌────────▼───────┐     │ start, end    │
                    │   questions    │     └───────────────┘
                    │                │
                    │ datasetId      │     ┌───────────────┐
                    │ queryText      │     │  retrievers   │
                    │ relevantSpans[]│     │               │
                    └────────┬───────┘     │ kbId          │
                             │             │ retrieverConfig│
                    ┌────────▼───────┐     │ indexConfigHash│
                    │  experiments   │     │ status        │
                    │                │◀────│ indexingJobId │
                    │ datasetId      │     └───────────────┘
                    │ retrieverId    │
                    │ status, scores │     ┌───────────────┐
                    └────────┬───────┘     │ generationJobs│
                             │             │               │
                    ┌────────▼───────┐     │ datasetId     │
                    │experimentResults│    │ phase, status │
                    │                │     │ workIds       │
                    │ experimentId   │     └───────────────┘
                    │ questionId     │
                    │ retrievedSpans │     ┌───────────────┐
                    │ scores         │     │ indexingJobs   │
                    └────────────────┘     │               │
                                           │ kbId          │
                                           │ indexConfigHash│
                                           │ status        │
                                           └───────────────┘
```

### Key Indexes

- **Vector index**: `documentChunks.by_embedding` (1536 dims, filter by kbId + indexConfigHash)
- **Search index**: `documents.search_content` (full-text search, filter by kbId)
- **Dedup indexes**: `retrievers.by_kb_config_hash`, `indexingJobs.by_kb_config`

---

## Convex Patterns Used

### 1. Mutation/Query vs Action Split

Convex enforces a strict split: mutations and queries run in the V8 isolate (no Node.js APIs), while actions run in Node.js. Files with `"use node"` can **only** export actions.

```
generation.ts          ← mutations/queries (WorkPool callbacks, CRUD)
generationActions.ts   ← "use node" actions (strategy execution, LLM calls)
```

This pattern repeats for every module: `indexing.ts` / `indexingActions.ts`, `experiments.ts` / `experimentActions.ts`, `retrievers.ts` / `retrieverActions.ts`.

### 2. WorkPool (Convex Component)

Three WorkPool instances handle async work dispatch:

| Pool | File | Parallelism | Retry | Purpose |
|------|------|-------------|-------|---------|
| `generationPool` | `generation.ts` | 10 | Yes (5 attempts, exponential) | Per-document question generation + per-question ground truth |
| `indexingPool` | `indexing.ts` | 10 (tier-adjustable) | Yes (5 attempts, exponential) | Per-document chunk + embed |
| `experimentPool` | `experiments.ts` | 1 | No | Single evaluate() call |

WorkPool pattern:
1. **Enqueue**: `pool.enqueueAction(ctx, actionRef, args, { context, onComplete })`
2. **Execute**: Action runs in Node.js environment
3. **Complete**: `onComplete` mutation fires with `RunResult` (success/failed/canceled)
4. **Track**: `workIds` stored on job record for selective cancellation

### 3. Auth Pattern

Every public function starts with:
```typescript
const { orgId, userId } = await getAuthContext(ctx);
```

This extracts Clerk JWT claims and enforces:
- User is authenticated
- User has an active organization selected
- All data access is scoped to that org

Internal functions (`internalQuery`, `internalMutation`, `internalAction`) skip auth — they're only callable from other Convex functions.

### 4. Internal vs Public Functions

| Type | Auth | Callable From |
|------|------|---------------|
| `query` / `mutation` / `action` | Yes (getAuthContext) | Frontend + other functions |
| `internalQuery` / `internalMutation` / `internalAction` | No | Only other Convex functions |

### 5. Config Hash Deduplication

Both indexing and retriever creation use deterministic hashing:

- `indexConfigHash` = hash of chunking + embedding config → prevents re-indexing same config
- `retrieverConfigHash` = hash of full pipeline config + k → prevents duplicate retrievers

Hash computation requires Node.js `crypto` module, so it happens in actions, not mutations.

---

## Data Flow: End-to-End

```
1. Upload Documents
   Frontend → documents.create → documents table

2. Generate Questions
   Frontend → generation.startGeneration
     → creates dataset + generationJob
     → enqueues WorkPool actions (per-doc or whole-corpus)
     → generationActions.generate* → questions.insertBatch
     → onQuestionGenerated callback → Phase 2: ground truth
     → generationActions.assignGroundTruthForQuestion
     → onGroundTruthAssigned → marks complete
     → langsmithSync.syncDataset (fire-and-forget)

3. Create Retriever + Index
   Frontend → retrieverActions.create (compute hashes, dedup)
   Frontend → retrieverActions.startIndexing
     → indexing.startIndexing (dedup, fan out)
     → indexingActions.indexDocument (per-doc, two-phase)
       Phase A: chunk + store (no embeddings)
       Phase B: embed in batches + patch
     → indexing.onDocumentIndexed → sync retriever status

4. Run Experiment
   Frontend → experiments.start
     → experimentActions.runExperiment (orchestrator)
       Step 0: Initialize
       Step 1: Ensure indexed (wait or skip)
       Step 2: Ensure LangSmith dataset synced
       Step 3: Count questions
       Step 4: Enqueue evaluation
     → experimentActions.runEvaluation
       → CallbackRetriever + vectorSearch
       → runLangSmithExperiment (inlined, calls evaluate())
       → onResult → experimentResults.insert
       → aggregate scores → mark complete
```

---

## External Dependencies

| Dependency | Used For | Where |
|------------|----------|-------|
| `rag-evaluation-system` | Chunkers, embedders, strategies, metrics, types, config hashing | generationActions, experimentActions, indexingActions, retrieverActions, ragActions, langsmithSync, lib/llm.ts |
| `openai` | OpenAI API client (embeddings, LLM) | lib/llm.ts, generationActions, indexingActions, retrieverActions, experimentActions |
| `langsmith` + `@langchain/core` | LangSmith SDK (dataset upload, evaluate()) — used directly by backend (no longer via eval-lib) | langsmithSync, experimentActions |
| `@convex-dev/workpool` | Async work dispatch with retry/cancel | generation, indexing, experiments |

> **Note:** eval-lib no longer depends on or exports LangSmith utilities. The backend imports `langsmith` and `@langchain/core` directly. eval-lib provides only pure evaluation types, strategies, metrics, chunkers, embedders, and config hashing.

---

## Error Handling & Status Model

All long-running jobs use a consistent status state machine:

```
pending → running → completed
                  → completed_with_errors
                  → failed
         canceling → canceled
```

- **pending**: Created but not yet started
- **running**: Active processing
- **canceling**: Cancel requested, waiting for in-flight work to drain
- **canceled**: All work drained after cancel
- **completed**: All items succeeded
- **completed_with_errors**: Some items failed, some succeeded
- **failed**: All items failed (or critical error)

---

## Testing

Two test files exist in `packages/backend/tests/`:

| File | Tests | Coverage |
|------|-------|----------|
| `generation.test.ts` | 13 tests | `onQuestionGenerated` (Phase 1 callbacks), `onGroundTruthAssigned` (Phase 2 callbacks), `getJob` query |
| `experiments.test.ts` | 6 tests | `onExperimentComplete` (success/fail/cancel), `get` query (org scoping) |

Tests use `convex-test` with `@convex-dev/workpool/test` for WorkPool mocking. Shared test helpers (`seedUser`, `seedKB`, `seedDataset`, etc.) are duplicated across both files.

**Notable gaps**: No tests for indexing callbacks, retriever CRUD, LangSmith sync, document operations, or cancel flows. See [Refactoring Suggestions](./refactoring-suggestions.md#testing) for details.
