# Refactoring Suggestions

> Actionable improvements for backend code health, structure, testability, and maintainability.

[Back to Architecture Overview](./architecture.md)

---

## Table of Contents

1. [File Structure Reorganization](#1-file-structure-reorganization)
2. [Dead Code & Deprecation Cleanup](#2-dead-code--deprecation-cleanup)
3. [Code Duplication](#3-code-duplication)
4. [Type Safety Improvements](#4-type-safety-improvements)
5. [Naming & Readability](#5-naming--readability)
6. [Unused Dependencies](#6-unused-dependencies)
7. [Schema & Validator Improvements](#7-schema--validator-improvements)
8. [Architectural Refinements](#8-architectural-refinements)
9. [Testing](#9-testing)
10. [Priority Roadmap](#10-priority-roadmap)

---

## 1. File Structure Reorganization

### Problem

All 26 source files sit flat in `convex/`. The module boundaries (generation, retrieval, experiments) are implicit — discoverable only by reading the code.

### Current Layout

```
convex/
├── auth.config.ts
├── convex.config.ts
├── crons.ts
├── datasets.ts
├── documents.ts
├── experimentActions.ts
├── experimentResults.ts
├── experiments.ts
├── generation.ts
├── generationActions.ts
├── indexing.ts
├── indexingActions.ts
├── knowledgeBases.ts
├── langsmithRetry.ts
├── langsmithSync.ts
├── langsmithSyncRetry.ts
├── questions.ts
├── rag.ts
├── ragActions.ts
├── retrieverActions.ts
├── retrievers.ts
├── schema.ts
├── testing.ts
├── test.setup.ts
├── users.ts
├── lib/
│   ├── auth.ts
│   └── llm.ts
└── README.md
```

### Proposed Layout

> **Note**: Convex may have constraints on subdirectory-based routing for public functions. Verify that Convex's function routing works with nested paths (e.g., `api.generation.generation.startGeneration` vs `api.generation.startGeneration`) before adopting this structure. If nested routing is awkward, consider prefixed flat files as an alternative (e.g., `generation_orchestration.ts`).

```
convex/
├── schema.ts                        # Keep at root (Convex requirement)
├── auth.config.ts                   # Keep at root (Convex requirement)
├── convex.config.ts                 # Keep at root (Convex requirement)
├── crons.ts                         # Keep at root (Convex requirement)
├── test.setup.ts                    # Keep at root
│
├── lib/                             # Shared infrastructure
│   ├── auth.ts                      # (existing)
│   ├── llm.ts                       # (existing)
│   ├── workpool.ts                  # NEW: shared WorkPool counter/status helpers
│   ├── validators.ts                # NEW: shared validators (spanValidator)
│   └── types.ts                     # NEW: shared type definitions (JobStatus)
│
├── generation/                      # Generation module
│   ├── orchestration.ts             # startGeneration, callbacks, cancel, queries
│   └── actions.ts                   # "use node" strategy actions + GT assignment
│
├── retrieval/                       # Retrieval module
│   ├── indexing.ts                  # Indexing orchestration + callbacks
│   ├── indexingActions.ts           # "use node" two-phase indexing + cleanup
│   ├── retrievers.ts                # Retriever CRUD + status sync
│   ├── retrieverActions.ts          # "use node" create/startIndexing/retrieve
│   └── chunks.ts                    # Chunk CRUD (currently rag.ts)
│
├── experiments/                     # Experiment module
│   ├── orchestration.ts             # Start, enqueue, cancel, onComplete, queries
│   ├── actions.ts                   # "use node" runExperiment + runEvaluation
│   └── results.ts                   # Per-question result mutations/queries
│
├── data/                            # Data layer CRUD
│   ├── knowledgeBases.ts
│   ├── documents.ts
│   ├── datasets.ts
│   ├── questions.ts
│   └── users.ts
│
└── langsmith/                       # LangSmith integration
    ├── sync.ts                      # Dataset sync action
    ├── retry.ts                     # Manual retry mutation
    └── autoRetry.ts                 # Cron-driven auto-retry (action + query)
```

### Benefits

- **Discoverability**: Immediately clear which files belong to which module
- **Reduced cognitive load**: Work within a module folder, not scan 26 files
- **Easier onboarding**: New contributors can focus on one folder
- **Natural colocation**: Mutation + action pairs live together

### Alternative: Prefixed Flat Files

If Convex routing makes subdirectories awkward, use a naming convention:

```
convex/
├── gen_orchestration.ts
├── gen_actions.ts
├── ret_indexing.ts
├── ret_indexingActions.ts
├── ret_retrievers.ts
├── ret_retrieverActions.ts
├── ret_chunks.ts
├── exp_orchestration.ts
├── exp_actions.ts
├── exp_results.ts
├── data_knowledgeBases.ts
├── data_documents.ts
├── ...
```

---

## 2. Dead Code & Deprecation Cleanup

### Items to Remove

| Item | File | Reason |
|------|------|--------|
| `ragActions.ts` (entire file) | `ragActions.ts` | Deprecated. `indexSingleDocument()` replaced by `indexingActions.indexDocument`. No callers remain. |
| `rag.insertChunk` | `rag.ts:147-165` | Deprecated. `insertChunkBatch` is the replacement. No callers in current code. |
| `rag.deleteKbChunks` | `rag.ts:189-202` | Deprecated (OOM risk). `deleteKbConfigChunks` is the paginated replacement. |
| `testing.ts` | `testing.ts` | Empty file — just a comment saying old tests were removed. |
| `README.md` | `README.md` | Default Convex boilerplate. Not project-specific documentation. Replace or remove. |
| `MAX_AUTO_RETRIES` constant | `langsmithSyncRetry.ts:4` | Declared but never used. |
| Legacy path in experiment runner | `experimentActions.ts:83-141` | The `experiment.retrieverConfig` path with polling loop. If no frontend code uses it, remove. |

### Verification Steps

Before removing any of the above:

```bash
# Check for callers of deprecated functions
grep -r "insertChunk\b" packages/backend/convex/ --include="*.ts"
grep -r "deleteKbChunks\b" packages/backend/convex/ --include="*.ts"
grep -r "indexSingleDocument" packages/backend/convex/ --include="*.ts"
grep -r "retrieverConfig" packages/backend/convex/ --include="*.ts"  # Check legacy path usage
```

---

## 3. Code Duplication

### 3.1 `createEmbedder()` — Duplicated 3 Times

The exact same helper function appears in:
- `indexingActions.ts:14-22`
- `retrieverActions.ts:18-26`
- `experimentActions.ts:23-31`

**Fix**: Extract to `lib/embedder.ts`:
```typescript
// lib/embedder.ts
"use node";
export function createEmbedder(model?: string) { ... }
```

### 3.2 `spanValidator` — Duplicated 3 Times

Defined identically in:
- `schema.ts:5-10`
- `questions.ts:5-10`
- `experimentResults.ts:5-10`

**Fix**: Export from a shared validators file:
```typescript
// lib/validators.ts
export const spanValidator = v.object({ ... });
```

### 3.3 `JobStatus` Type — Duplicated 3 Times

Defined locally in:
- `generation.ts:27`
- `indexing.ts:215`
- And used inline in `experiments.ts`

**Fix**: Define once in `lib/types.ts`.

### 3.4 `applyResult` / `counterPatch` Logic

The counter-update pattern in `generation.ts` is structurally identical to the one in `indexing.ts:onDocumentIndexed`, just with different field names (`processedItems` vs `processedDocs`).

**Fix**: Create a generic helper in `lib/workpool.ts`:
```typescript
export function applyWorkResult<T extends { processed: number; failed: number; skipped: number }>(
  counters: T,
  result: RunResult,
): T { ... }
```

### 3.5 Test Helpers — Duplicated Across Test Files

`seedUser`, `seedKB`, `seedDataset`, `setupTest`, `TEST_ORG_ID`, `TEST_CLERK_ID`, `testIdentity` are copy-pasted between `generation.test.ts` and `experiments.test.ts`.

**Fix**: Extract to `tests/helpers.ts`:
```typescript
export const TEST_ORG_ID = "org_test123";
export function setupTest() { ... }
export async function seedUser(t) { ... }
// etc.
```

---

## 4. Type Safety Improvements

### 4.1 Excessive Use of `v.any()`

These fields use `v.any()` which provides no runtime validation:

| Field | Table | Better Type |
|-------|-------|-------------|
| `metadata` | knowledgeBases, documents, datasets, questions, experimentResults | `v.record(v.string(), v.any())` or specific shape |
| `strategyConfig` | datasets | `v.union(simpleConfig, dimensionConfig, rwgConfig)` |
| `retrieverConfig` | retrievers, experiments | Define a `PipelineConfig` validator |
| `scores` | experiments, experimentResults | `v.record(v.string(), v.number())` |
| `indexConfig` | indexingJobs | Define an `IndexConfig` validator |

### 4.2 Type Assertions in Actions

Strategy config is cast with `as Record<string, unknown>` throughout `generationActions.ts` and `experimentActions.ts`. If `strategyConfig` had proper validators, these casts could be replaced with typed access.

### 4.3 `status` Field Uses `v.string()` in Internal Mutations

`experiments.updateStatus` accepts `status: v.string()` — should use the same `v.union(...)` as the schema. Similarly, `retrievers.insertRetriever` and `updateIndexingStatus` accept `status: v.string()` and cast to the union type.

---

## 5. Naming & Readability

### 5.1 Inconsistent Naming Patterns

| Current | Issue | Suggestion |
|---------|-------|------------|
| `rag.ts` | Vague name. Contains chunk CRUD, not RAG logic. | Rename to `chunks.ts` |
| `ragActions.ts` | Deprecated and misnamed. | Remove entirely |
| `generation.ts` / `experiments.ts` | Orchestration + CRUD mixed | Keep, but consider splitting queries into separate file if they grow |
| `knowledgeBases.ts` | Name is fine but inconsistent with patterns | Consider `kbs.ts` for brevity, or keep as-is |

### 5.2 Inconsistent Function Naming

| Pattern | Examples | Issue |
|---------|----------|-------|
| CRUD names | `create`, `get`, `list`, `remove` | Good — consistent across modules |
| Internal variants | `getInternal`, `byDatasetInternal`, `listByKbInternal` | Consistent but verbose — could use `_get`, `_byDataset` convention |
| Callbacks | `onQuestionGenerated`, `onGroundTruthAssigned`, `onDocumentIndexed`, `onExperimentComplete` | Good — descriptive |
| Start functions | `startGeneration`, `experiments.start`, `indexing.startIndexing`, `retrieverActions.startIndexing` | Inconsistent: `startGeneration` (verb+noun) vs `start` (bare verb) |

### 5.3 `getModel` Helper

In `generationActions.ts`, the helper `getModel(strategyConfig)` returns the LLM model string. The name is generic. Consider `resolveModelName` or just inline it.

### 5.4 Comments Reference Change IDs

Throughout the code, comments reference ticket/change IDs like `I1`, `I3`, `I9`, `C1`, `C3`, `S3`:

```typescript
// I9: Guard against stale Phase 1 callbacks after Phase 2 has started
// C1: Cancel only this job's work items, not the entire pool
// I1: Preserve Phase 1 stats before resetting counters
```

These are useful during development but become cryptic over time. **Suggestion**: Expand to self-documenting comments that explain *why* without requiring external reference:

```typescript
// Guard: if Phase 2 has already started, ignore late Phase 1 callbacks
// to prevent counter corruption
```

---

## 6. Unused Dependencies

### `minisearch`

Listed in both `package.json` dependencies and `convex.json` externalPackages, but **not imported anywhere** in the backend code.

```bash
grep -r "minisearch" packages/backend/ --include="*.ts"
# No results
```

**Action**: Remove from both `package.json` and `convex.json`.

---

## 7. Schema & Validator Improvements

### 7.1 Unused Schema Fields

Several fields on the `experiments` table are declared in the schema but never populated by the code:

| Field | Status |
|-------|--------|
| `failedQuestions` | Defined in schema, never written to |
| `skippedQuestions` | Defined in schema, never written to |
| `indexConfigHash` | Defined in schema, never written to from experiments.ts |
| `langsmithExperimentId` | Defined in schema, never written to |
| `langsmithUrl` | Defined in schema, never written to |
| `langsmithSyncStatus` | Defined in schema, never written to |

**Options**:
- Remove them if not planned for future use
- Populate them if they should be populated (e.g., capture LangSmith experiment URL from evaluate() results)

### 7.2 Dangling DocString

In `datasets.ts:75-76`, there's a dangling docstring for "Update dataset question count" that belongs to `updateQuestionCount` but floats above `getInternal`:

```typescript
/**
 * Update dataset question count.
 */
/**
 * Internal query: get a dataset by ID (no auth check).
 */
export const getInternal = internalQuery({ ... });
```

Similarly in `questions.ts:66-67`:
```typescript
/**
 * Update a question's relevant spans (used by ground truth assignment).
 */
/**
 * Internal query: list all questions in a dataset (no auth check).
 */
```

**Fix**: Move/remove the misplaced docstrings.

### 7.3 `indexConfigHash` is Optional on `documentChunks`

```typescript
indexConfigHash: v.optional(v.string()),
```

The `v.optional()` exists for backward compatibility with legacy chunks. If all legacy chunks have been migrated, make it required.

---

## 8. Architectural Refinements

### 8.1 Polling Loop in Experiment Orchestrator

`experimentActions.runExperiment` (legacy path) polls indexing status with a `setTimeout` loop:

```typescript
while (!indexingDone) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const indexJob = await ctx.runQuery(...);
  // check status
}
```

This is fragile — if indexing takes too long, the action itself could timeout. **Better approach**: Split the orchestrator into phases connected by scheduler:

```
runExperiment:
  If indexing needed → start indexing, schedule checkIndexingComplete
  Else → proceed to evaluation

checkIndexingComplete (scheduled, periodic):
  If done → schedule evaluation
  If failed → mark experiment failed
  If still running → reschedule self
```

However, this adds complexity. The current approach works for typical indexing times. **Recommendation**: Keep as-is unless you see timeouts, but document the limitation.

### 8.2 `cancelIndexing` Uses `pool.cancelAll()`

In `indexing.ts:cancelIndexing`, the cancel operation calls `pool.cancelAll(ctx)` which cancels **ALL** items in the indexing pool — not just this job's items:

```typescript
// indexing.ts:349
await pool.cancelAll(ctx);
```

This is inconsistent with generation and experiments, which use selective cancel:

```typescript
// generation.ts:368 — selective
for (const wId of workIds) {
  await pool.cancel(ctx, wId as WorkId);
}
```

**Fix**: Store `workIds` on `indexingJobs` (add to schema) and cancel selectively like other modules do. This prevents one cancel from killing other concurrent indexing jobs.

### 8.3 LangSmith Sync Retry Scans All Datasets

`langsmithSyncRetry.getFailedDatasets` scans **all** datasets to find failed syncs:

```typescript
const allDatasets = await ctx.db.query("datasets").collect();
return allDatasets.filter(d => d.langsmithSyncStatus?.startsWith("failed:"));
```

For production scale, add an index on `langsmithSyncStatus` or use a dedicated "pending retries" table.

### 8.4 `langsmithSyncRetry.ts` Mixes `internalAction` and `internalQuery`

This file has an `import { internalAction }` at the top and then a second `import { internalQuery }` on line 30. While this works, it's unusual to have two import blocks from the same module. Reorganize to have a single import block.

---

## 9. Testing

### Current State

| File | Tests | Focus |
|------|-------|-------|
| `generation.test.ts` | 13 | WorkPool callbacks (Phase 1 + 2), getJob query |
| `experiments.test.ts` | 6 | onExperimentComplete callback, get query |
| **Total** | **19** | |

### Coverage Gaps

#### Critical (should test before refactoring)

| Area | What to Test | Priority |
|------|-------------|----------|
| `indexing.onDocumentIndexed` | Counter updates, completion detection, retriever status sync | HIGH |
| `indexing.startIndexing` | Dedup logic (running/completed), force re-index | HIGH |
| `retrievers.remove` | Cascade delete, shared index protection | HIGH |
| `retrievers.deleteIndex` | Shared index guard, status reset | HIGH |
| `experiments.start` | Validation (retriever ready, KB match), record creation | HIGH |

#### Important (improves confidence)

| Area | What to Test | Priority |
|------|-------------|----------|
| `generation.startGeneration` | Dataset + job creation, strategy dispatch (simple vs dimension-driven) | MEDIUM |
| `generation.cancelGeneration` | Status guard, selective cancel | MEDIUM |
| `datasets.updateSyncStatus` | Partial updates | MEDIUM |
| `questions.insertBatch` | Batch creation | MEDIUM |
| `questions.updateSpans` | Span patching | MEDIUM |
| `rag.insertChunkBatch` | Bulk insert | MEDIUM |
| `rag.patchChunkEmbeddings` | Embedding patching | MEDIUM |
| `rag.deleteKbConfigChunks` | Paginated deletion, hasMore flag | MEDIUM |

#### Nice to Have

| Area | What to Test | Priority |
|------|-------------|----------|
| Auth guards | Every public function rejects unauthenticated/wrong-org calls | LOW |
| `langsmithSyncRetry.getFailedDatasets` | Correctly filters by prefix | LOW |
| `users.getOrCreate` | Create vs return existing | LOW |
| `documents.create` | Content storage, org scoping | LOW |
| `knowledgeBases.create` | Org scoping | LOW |

### Test Infrastructure Improvements

1. **Extract shared helpers** to `tests/helpers.ts` (see [Code Duplication](#35-test-helpers--duplicated-across-test-files))

2. **Add a test for the shared counter logic** — the `applyResult`/`counterPatch` pattern is used in two modules. A unit test of the extracted helper would cover both.

3. **Add integration tests for the full flow** using `convex-test`:
   - Create KB → upload document → start generation → verify questions created
   - Create retriever → start indexing → verify chunks created
   - (These would need action mocking since real LLM/embedding calls can't run in tests)

### Test File Organization

```
tests/
├── helpers.ts              # Shared seeders, test identity, setupTest
├── generation.test.ts      # Generation WorkPool callbacks + queries
├── experiments.test.ts     # Experiment callbacks + queries
├── indexing.test.ts        # NEW: Indexing callbacks + dedup + retriever sync
├── retrievers.test.ts      # NEW: CRUD + shared index protection
├── data.test.ts            # NEW: KB, document, dataset, question CRUD
└── langsmith.test.ts       # NEW: Sync retry logic
```

---

## 10. Priority Roadmap

### Phase 1: Quick Wins (Low Risk, High Impact)

These can be done in a single session with confidence:

- [ ] Remove `ragActions.ts` (deprecated, no callers)
- [ ] Remove `testing.ts` (empty file)
- [ ] Remove `rag.insertChunk` and `rag.deleteKbChunks` (deprecated)
- [ ] Remove `minisearch` from `package.json` and `convex.json`
- [ ] Remove `MAX_AUTO_RETRIES` unused constant
- [ ] Fix dangling docstrings in `datasets.ts` and `questions.ts`
- [ ] Extract `spanValidator` to `lib/validators.ts`
- [ ] Extract `createEmbedder` to `lib/embedder.ts`
- [ ] Extract test helpers to `tests/helpers.ts`
- [ ] Replace boilerplate `README.md` with link to `docs/`

### Phase 2: Type Safety (Medium Risk)

- [ ] Define `JobStatus` type in `lib/types.ts`, use across modules
- [ ] Add proper validators for `strategyConfig`, `retrieverConfig`, `scores`
- [ ] Change `status: v.string()` in internal mutations to use union validators
- [ ] Audit `v.any()` fields — replace with specific validators where possible
- [ ] Make `indexConfigHash` required on `documentChunks` (if legacy data migrated)

### Phase 3: Testing (No Risk to Production)

- [ ] Add `indexing.test.ts` — onDocumentIndexed callbacks, dedup, retriever sync
- [ ] Add `retrievers.test.ts` — CRUD, shared index protection, status transitions
- [ ] Expand `experiments.test.ts` — start mutation validation
- [ ] Expand `generation.test.ts` — startGeneration, cancelGeneration
- [ ] Add `data.test.ts` — basic CRUD for KB, documents, datasets, questions

### Phase 4: Structural (Higher Risk, Plan Carefully)

- [ ] Fix `indexing.cancelIndexing` to use selective cancel (not `cancelAll`)
- [ ] Reorganize files into module subdirectories (or adopt prefix convention)
- [ ] Remove legacy experiment path (`retrieverConfig` without `retrieverId`)
- [ ] Clean up unused experiment schema fields or populate them
- [ ] Consolidate `langsmithSyncRetry.ts` import blocks
- [ ] Expand change ID comments (I1, C1, etc.) into self-documenting form

### Phase 5: Architecture (Long-Term)

- [ ] Add index on `datasets.langsmithSyncStatus` for efficient retry queries
- [ ] Consider replacing experiment orchestrator polling with scheduler-based phases
- [ ] Extract WorkPool counter logic into shared helper (`lib/workpool.ts`)
- [ ] Evaluate whether `rag.ts` chunk queries need pagination for large KBs
