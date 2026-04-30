# Simulation System Improvements — Design

**Date**: 2026-04-25
**Status**: Approved
**Scope**: Vector search fix, simulation/evaluation split, cancel UI, UX improvements

---

## Problem Statement

The conversation simulation system has several issues:

1. **Vector search waste**: `vectorSearchWithFilter` only filters by `kbId` at the index level, even though the vector index supports `indexConfigHash`. This causes hydration of up to 256 chunks from wrong retrievers, reading 14–16 MB per query (Convex limit: 16 MB). Queries intermittently crash.

2. **No cancel UI**: Running simulations cannot be stopped from the frontend. The backend mutation exists but is unreachable.

3. **Evaluation is coupled to conversation**: The simulation action runs conversations AND evaluators in a single step. Users cannot review conversation transcripts before evaluation runs. PASS/FAIL badges appear on scenarios while conversations are still running.

4. **Poor scenario identification**: All scenarios display as "Scenario" with no distinguishing label.

5. **No progress banner**: Unlike question/scenario generation, running simulations have no top-level progress indicator.

---

## Change 1: Vector Search Filter Fix

### Current behavior

```
vectorSearch("documentChunks", "by_embedding", {
  filter: q.eq("kbId", opts.kbId)       // only kbId
  limit: min(topK * 4, 256)             // 4x over-fetch, cap 256
})
→ hydrate ALL returned chunks            // 14–16 MB reads
→ post-filter by indexConfigHash in JS   // discard wrong-retriever chunks
→ take topK
```

### New behavior

```
vectorSearch("documentChunks", "by_embedding", {
  filter: q.and(
    q.eq("kbId", opts.kbId),
    q.eq("indexConfigHash", opts.indexConfigHash)   // filter at index level
  )
  limit: min(topK * 2, 64)              // 2x over-fetch, cap 64
})
→ hydrate returned chunks               // dramatically fewer reads
→ take topK                             // post-filter no longer needed
```

### Impact

- All 6 callers benefit (agentLoop, agents/actions, retrieverActions, pipelineActions, experiments/actions, experiments/agentActions)
- No caller-side changes — `vectorSearchWithFilter` already receives `indexConfigHash`
- Chunk reads drop from ~256 to ~10–20 per query
- Eliminates the 14–16 MB read warnings and crashes
- Keep the JS post-filter as a defensive no-op (filter by indexConfigHash, but it should already match)

### File

`packages/backend/convex/lib/vectorSearch.ts`

---

## Change 2: Split Simulation into Conversations + Evaluation

### Motivation

Users need to review conversation transcripts before running evaluation. The current system couples both steps, making it impossible to inspect conversations without evaluator results already applied.

### Backend changes

#### 2a. Remove evaluation from `runConversationSim`

**File**: `packages/backend/convex/conversationSim/actions.ts`

The action currently has 4 stages: Setup → Conversation Loop → Evaluate → Save. Remove stage 3 (Evaluate). The action only runs the conversation and saves transcript metadata:

- `status: "completed"`
- `terminationReason`, `turnCount`, `toolCallCount`, `totalTokens`, `latencyMs`
- No `evaluatorResults`, `score`, or `passed` fields

#### 2b. Make `evaluatorSetId` optional in `start` mutation

**File**: `packages/backend/convex/conversationSim/orchestration.ts`

Change `evaluatorSetId` from required (`v.id("evaluatorSets")`) to optional (`v.optional(v.id("evaluatorSets"))`) in both the mutation args AND the schema field on `conversationSimulations`. When not provided, skip evaluator set validation. Also remove `passThreshold` from the simulation record — it moves to evaluation time (read from the evaluator set).

#### 2c. Add evaluation fields to simulation schema

**File**: `packages/backend/convex/schema.ts`

Add to `conversationSimulations`:

```
evaluationStatus: v.optional(v.union(
  v.literal("not_started"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed")
)),
evaluationEvaluatorSetId: v.optional(v.id("evaluatorSets")),
evaluationCompletedRuns: v.optional(v.number()),
evaluationFailedRuns: v.optional(v.number()),
```

Default `evaluationStatus` to `"not_started"` when creating a simulation.

#### 2d. New `startEvaluation` mutation + `runEvaluation` action

**File**: `packages/backend/convex/conversationSim/orchestration.ts` (mutation)
**File**: `packages/backend/convex/conversationSim/evaluationActions.ts` (new `"use node"` action file)

**Mutation `startEvaluation`**:
- Args: `simulationId`, `evaluatorSetId`
- Validates simulation status is `"completed"` (all conversations done)
- Validates evaluator set exists and belongs to org
- Sets `evaluationStatus: "running"`, stores `evaluationEvaluatorSetId`
- Resets `evaluationCompletedRuns: 0`, `evaluationFailedRuns: 0`
- Collects all completed runs (`status === "completed"`) for the simulation
- Stores evaluation `workIds` on the simulation (separate from conversation workIds — use `evaluationWorkIds` field)
- Enqueues one WorkPool item per completed run

**Action `runEvaluation`** (must be `"use node"` since it uses LLM judges):
- Args: `runId`, `evaluatorSetId`
- Loads the run record and its conversation messages via `internal.crud.conversations.listMessagesInternal`
- Loads the evaluator set and each evaluator
- For each evaluator: runs code evaluator or LLM judge (reuse existing `runCodeEvaluator` from `evaluation.ts` and `runLLMJudge` from `judge.ts`)
- Computes score and passed flag (same logic as current: all required must pass AND score >= passThreshold from evaluator set)
- Saves `evaluatorResults`, `score`, `passed` on the run record via `runs.updateRun`

**Notes**:
- The existing `evaluation.ts` and `judge.ts` modules are already standalone — they don't depend on the simulation action. They can be imported directly by `evaluationActions.ts`.
- Reuse the existing `conversationSimPool` WorkPool for evaluation items. Evaluation requires conversations to be completed first, so they never compete for slots. The pool's `maxParallelism: 2` is fine for evaluation (LLM judge calls are lighter than multi-turn conversations).

#### 2e. Update `onRunComplete` callback

**File**: `packages/backend/convex/conversationSim/orchestration.ts`

When all runs complete, set simulation `status: "completed"`. Remove the `overallPassRate` and `avgScore` computation from this callback — those move to evaluation completion.

#### 2f. New `onEvaluationRunComplete` callback

**File**: `packages/backend/convex/conversationSim/orchestration.ts`

New internal mutation registered as WorkPool callback for evaluation items. Increments `evaluationCompletedRuns` or `evaluationFailedRuns`. When all evaluation runs are handled, compute `overallPassRate` and `avgScore` from the run records, set `evaluationStatus: "completed"`.

#### 2g. Add `evaluationWorkIds` to schema

**File**: `packages/backend/convex/schema.ts`

Add `evaluationWorkIds: v.optional(v.array(v.string()))` to `conversationSimulations`. Keeps evaluation WorkPool IDs separate from conversation WorkPool IDs so cancel only affects the right phase.

---

## Change 3: Cancel Simulation UI

### Backend

Already exists: `conversationSim/orchestration.cancel` mutation. Sets status to `"cancelled"`, cancels pending WorkPool items. No changes needed.

### Frontend

#### 3a. Add `onCancel` prop to `GenerationBanner`

**File**: `packages/frontend/src/components/GenerationBanner.tsx`

Add optional `onCancel?: () => void` prop. When provided, render a cancel button next to the "View" button. Style: red/destructive text, same size as "View".

#### 3b. Confirmation modal

Clicking cancel opens a confirmation modal (reuse existing dark-theme modal pattern):
- Title: "Cancel Simulation"
- Body: "In-progress conversations will finish, but pending ones will be stopped."
- Buttons: "Keep Running" (secondary) | "Cancel Simulation" (destructive)

#### 3c. Show banner on agents page

**File**: `packages/frontend/src/app/agents/page.tsx`

No dedicated "get active simulation" query exists. Filter from the existing `byAgent` query result on the client: `simulations.find(s => s.status === "running" || s.status === "pending")`.

When found, render `GenerationBanner` between the top bar and the main content:
- Strategy: "Simulation"
- KB name: agent name
- Phase: "generating" (simulations don't have a preparing phase)
- processedItems: `(sim.completedRuns + (sim.failedRuns ?? 0))`
- totalItems: `sim.totalRuns`
- questionsGenerated: `sim.completedRuns` (repurpose this field for "completed" count)
- `onCancel`: calls `api.conversationSim.orchestration.cancel` after confirmation
- `onView`: selects that simulation in the sidebar

Note: `GenerationBanner` currently requires `questionsGenerated` which shows as "X questions". For simulations this label doesn't fit. We need to add an optional `itemLabel` prop (default "questions", override to "conversations" for simulations) or hide that section when the caller doesn't need it.

---

## Change 4: Scenario Naming

### Current

All scenarios display as "Scenario" in the middle panel.

### New

Display as "SCE-001", "SCE-002", etc. Derived from the scenario's position in the grouped list (1-indexed, zero-padded to 3 digits). Show the scenario's `topic` as a subtitle below the ID if available.

**File**: `packages/frontend/src/components/conversation-sim/SimScenarioList.tsx`

```
SCE-001                    COMPLETED
Topic: Account access      ● Run 1
```

During evaluation phase, the PASS/FAIL badge appears. During conversation phase, show status (completed/running/pending) instead.

---

## Change 5: Two-Phase Scenario List

### Middle panel changes

**File**: `packages/frontend/src/components/conversation-sim/SimScenarioList.tsx`

Add a tab/toggle at the top of the scenario list: **Conversations** | **Evaluation**

**Conversations tab** (default):
- Shows each scenario with conversation status (pending/running/completed dot)
- No PASS/FAIL badges
- Run dots show conversation status only
- Clicking a scenario shows the transcript in the detail panel

**Evaluation tab**:
- Greyed out / disabled until simulation `status === "completed"`
- When `evaluationStatus` is `"not_started"` or absent: show "Not evaluated" state with an "Evaluate" button
- "Evaluate" button opens a small modal to select an evaluator set (dropdown of org's evaluator sets), then triggers `startEvaluation`
- When `evaluationStatus === "running"`: show progress per scenario (completed/pending dots)
- When `evaluationStatus === "completed"`: show PASS/FAIL badges and scores per scenario
- Clicking a scenario shows evaluation results in the detail panel
- Re-evaluation: if evaluation already completed, allow re-running with a different evaluator set (clears previous results)

### Detail panel changes

**File**: `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx`

Always show the conversation transcript. After evaluation, append the evaluator results section below the transcript (current behavior, but only after evaluation runs).

### Simulation sidebar changes

**File**: `packages/frontend/src/components/conversation-sim/SimulationsSidebar.tsx`

Show two-line status:
- Line 1: Conversation progress — "12/20 convos" or "✓ 20 convos"
- Line 2: Evaluation status — "Not evaluated" or "Evaluating 5/20" or "8/20 passed"

---

## Change 6: `CreateSimulationModal` Simplification

**File**: `packages/frontend/src/components/conversation-sim/CreateSimulationModal.tsx`

Remove the evaluator set selection from the modal. The modal only collects:
- Scenario dataset
- k (passes per scenario)
- Concurrency
- Max turns
- Timeout

Evaluator set selection moves to the "Evaluate" action triggered after conversations complete.

---

## Schema Migration Notes

The schema changes (new optional fields on `conversationSimulations`) are additive — all new fields are `v.optional()`. No migration needed for existing documents. Existing simulations will show `evaluationStatus` as undefined, which the frontend treats the same as `"not_started"`.

The `evaluatorSetId` field changes from required to optional. Existing documents already have this field populated, so no backfill needed. The `passThreshold` field remains on the record for existing simulations but is no longer written by new ones.

---

## Out of Scope

- Creating new evaluators or evaluator sets (future work)
- Per-scenario evaluation triggers (batch only for now)
- Changes to the evaluator logic itself (same 6 default evaluators)
- Changes to `maxSteps` in agentLoop (agent should use tools freely)
- Collapsible simulation sidebar (current 3-pane layout works)
- Cancel evaluation in progress (only conversation cancel for now)
