# Generation Module

> Question generation pipeline: strategies, ground truth assignment, WorkPool orchestration.

[Back to Architecture Overview](./architecture.md)

---

## Files

| File | Lines | Role |
|------|-------|------|
| `generation.ts` | ~424 | Orchestration: start, WorkPool callbacks (Phase 1 + 2), cancel, queries |
| `generationActions.ts` | ~245 | `"use node"` actions: strategy execution, ground truth assignment |

Supporting files touched:
- `questions.ts` — batch insert, span updates
- `datasets.ts` — question count update, LangSmith sync status
- `langsmithSync.ts` — fire-and-forget dataset sync after completion

---

## Pipeline Overview

Generation is a **two-phase WorkPool pipeline**:

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                    startGeneration (mutation)                    │
  │                                                                  │
  │  1. Validate auth + KB ownership                                │
  │  2. Create dataset record                                       │
  │  3. Fetch all KB documents                                      │
  │  4. Create generationJob record (status: running)               │
  │  5. Enqueue WorkPool actions based on strategy                  │
  │  6. Store workIds on job for selective cancellation              │
  └──────────────────────┬───────────────────────────────────────────┘
                         │
          ┌──────────────▼──────────────┐
          │       PHASE 1: Generate     │
          │                             │
          │  Strategy-specific actions  │
          │  enqueued via WorkPool      │
          │                             │
          │  simple: 1 action per doc   │
          │  dimension-driven: 1 action │
          │  real-world-grounded: 1     │
          └──────────────┬──────────────┘
                         │ onComplete callback
          ┌──────────────▼──────────────┐
          │   onQuestionGenerated       │
          │   (internalMutation)        │
          │                             │
          │  • Count success/fail/skip  │
          │  • When all Phase 1 done:   │
          │    - Save phase1Stats       │
          │    - Reset counters         │
          │    - Enqueue Phase 2 items  │
          └──────────────┬──────────────┘
                         │
          ┌──────────────▼──────────────┐
          │    PHASE 2: Ground Truth    │
          │                             │
          │  1 action per question      │
          │  assignGroundTruthForQuestion│
          │  Uses LLM to find spans    │
          └──────────────┬──────────────┘
                         │ onComplete callback
          ┌──────────────▼──────────────┐
          │   onGroundTruthAssigned     │
          │   (internalMutation)        │
          │                             │
          │  • Count success/fail/skip  │
          │  • When all Phase 2 done:   │
          │    - Update dataset count   │
          │    - Determine final status │
          │    - Fire-and-forget sync   │
          │      to LangSmith           │
          └─────────────────────────────┘
```

---

## Strategies

Three question generation strategies are supported, all delegating to `rag-evaluation-system`:

### 1. Simple Strategy (`simple`)

- **Scope**: Per-document (1 WorkPool action per document)
- **Action**: `generationActions.generateForDocument`
- **Config**: `{ queriesPerDoc: number, model: string }`
- **Behavior**: Generates N questions for a single document using `SimpleStrategy` from eval-lib
- **Question ID format**: `{docId}_q{index}`

### 2. Dimension-Driven Strategy (`dimension-driven`)

- **Scope**: Whole-corpus (1 WorkPool action total)
- **Action**: `generationActions.generateDimensionDriven`
- **Config**: `{ dimensions: DimensionInput[], totalQuestions: number, model: string }`
- **Behavior**: Uses `DimensionDrivenStrategy` — discovers dimension combinations, filters, builds relevance matrix, samples, generates
- **Question ID format**: `dd_q{index}`

### 3. Real-World-Grounded Strategy (`real-world-grounded`)

- **Scope**: Whole-corpus (1 WorkPool action total)
- **Action**: `generationActions.generateRealWorldGrounded`
- **Config**: `{ questions: string[], totalSyntheticQuestions: number, matchThreshold?: number, fewShotExamplesPerDoc?: number, embeddingModel?: string, model: string }`
- **Behavior**: Uses `RealWorldGroundedStrategy` — matches provided real-world questions to documents via embedding similarity, generates synthetic variants
- **Question ID format**: `rwg_q{index}`

### Common Pattern

All three actions follow the same flow:
1. Load corpus from KB documents via `loadCorpusFromKb()` helper
2. Create strategy instance with config
3. Call `strategy.generate({ corpus, llmClient, model })`
4. Batch-insert resulting questions via `questions.insertBatch` (batches of 100)
5. Return `{ questionsGenerated: number }`

---

## Ground Truth Assignment

After Phase 1 generates questions (without spans), Phase 2 assigns character-level ground truth:

**Action**: `generationActions.assignGroundTruthForQuestion`

```
Input:  question (queryText, sourceDocId) + corpus
        ↓
        GroundTruthAssigner.assign()  (eval-lib, LLM-powered)
        ↓
Output: CharacterSpan[] → patched onto question record
```

Each question gets its own WorkPool action (parallelism = 10, retries = 5).

---

## WorkPool Configuration

```typescript
const pool = new Workpool(components.generationPool, {
  maxParallelism: 10,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 5,
    initialBackoffMs: 2000,
    base: 2,  // exponential backoff: 2s, 4s, 8s, 16s, 32s
  },
});
```

---

## Callback Counter Logic

Both `onQuestionGenerated` and `onGroundTruthAssigned` share the same pattern via `applyResult()` and `counterPatch()`:

```typescript
// applyResult: increment the right counter based on RunResult.kind
success  → processedItems++
failed   → failedItems++, push to failedItemDetails
canceled → skippedItems++

// Completion check
totalHandled = processedItems + failedItems + skippedItems
isComplete = totalHandled >= job.totalItems
```

### Phase Transition Guards

- **I9 guard**: `onQuestionGenerated` returns early if `job.phase === "ground-truth"` (prevents stale Phase 1 callbacks from corrupting Phase 2 counters)
- **Cancel guard**: Both callbacks return early if `job.status === "canceled"`
- **Canceling finalization**: If `job.status === "canceling"` and `isComplete`, transition to `"canceled"`

### Phase 1 → Phase 2 Transition (I1)

When Phase 1 completes:
1. Save `phase1Stats` (preserves Phase 1 success/fail/skip counts)
2. Set `phase = "ground-truth"`
3. Reset counters to 0 for Phase 2
4. Set `totalItems` = number of questions generated
5. Enqueue one GT action per question
6. Replace `workIds` with Phase 2 work IDs

### Final Status Determination (I1)

When Phase 2 completes, both Phase 1 and Phase 2 failures are considered:
```typescript
const totalFailures = phase2Failures + (phase1Stats?.failedItems ?? 0);
if (totalFailures === 0) → "completed"
else if (phase2Failures === totalItems) → "failed"
else → "completed_with_errors"
```

---

## Cancellation (C1)

```typescript
cancelGeneration(jobId):
  1. Validate auth + job ownership
  2. Guard: only "running" or "pending" jobs can be canceled
  3. Set status to "canceling" (I3: status first, so callbacks see it)
  4. Cancel only this job's workIds (C1: selective, not pool.cancelAll)
```

The callbacks handle the "canceling" → "canceled" transition when all in-flight work drains.

---

## LangSmith Sync

After Phase 2 completes successfully, a fire-and-forget sync is scheduled:

```typescript
await ctx.scheduler.runAfter(0, internal.langsmithSync.syncDataset, {
  datasetId: job.datasetId,
});
```

This converts questions to `GroundTruth[]` format and uploads to LangSmith. If sync fails, the hourly cron (`langsmithSyncRetry.retryFailed`) will retry automatically.

---

## Database Records

### generationJobs

| Field | Type | Notes |
|-------|------|-------|
| `orgId` | string | Org scope |
| `kbId` | Id<"knowledgeBases"> | Source KB |
| `datasetId` | Id<"datasets"> | Target dataset |
| `strategy` | string | "simple" / "dimension-driven" / "real-world-grounded" |
| `status` | union | pending / running / completed / completed_with_errors / failed / canceling / canceled |
| `phase` | string | "generating" or "ground-truth" |
| `totalItems` | number | Total work items (docs in Phase 1, questions in Phase 2) |
| `processedItems` | number | Successfully completed items |
| `failedItems` | number | Failed items |
| `skippedItems` | number | Canceled/skipped items |
| `failedItemDetails` | array? | `[{ itemKey, error }]` for debugging |
| `workIds` | string[]? | Current phase's WorkPool IDs for selective cancel |
| `phase1Stats` | object? | Preserved Phase 1 counters `{ processedItems, failedItems, skippedItems }` |

### questions

| Field | Type | Notes |
|-------|------|-------|
| `datasetId` | Id<"datasets"> | Parent dataset |
| `queryId` | string | Unique ID within dataset (e.g. "doc1_q0") |
| `queryText` | string | The generated question text |
| `sourceDocId` | string | Document this question targets |
| `relevantSpans` | CharacterSpan[] | Ground truth spans (empty until Phase 2) |
| `langsmithExampleId` | string? | Linked LangSmith example ID (set during sync) |

---

## Queries

| Function | Type | Auth | Purpose |
|----------|------|------|---------|
| `getJob` | query | Yes | Get job with computed `pendingItems` |
| `listJobs` | query | Yes | List jobs filtered by KB or dataset |
| `getJobInternal` | internalQuery | No | Get job for internal use (experiment runner) |

---

## Test Coverage

**File**: `tests/generation.test.ts` (13 tests)

Covered:
- `onQuestionGenerated`: success/fail/cancel counter increments, Phase 1→2 transition, final status when no questions, cancel finalization, stale callback guard (I9), already-canceled guard
- `onGroundTruthAssigned`: counter increments, completion (success, with Phase 1 errors, cancel)
- `getJob`: pendingItems computation, org scoping

Not covered:
- `startGeneration` mutation (requires WorkPool mocking for enqueue)
- `cancelGeneration` mutation
- `listJobs` query
- Strategy action execution (would need LLM mocking)
