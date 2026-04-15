# Retriever Experiments Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add experiment run grouping with Olympic podium rankings to the Retrievers page, so users can compare multiple retrievers in a single experiment and instantly see which one wins.

**Architecture:** New `experimentRuns` Convex table groups child `experiments` rows. The Retrievers page gains a Create/Experiment mode toggle in the top row. Experiment mode shows a sidebar of past runs and a main area with podium/table results. A modal handles experiment creation. The existing standalone Experiments page is untouched.

**Tech Stack:** Convex (backend mutations/queries/actions), Next.js 16 App Router, React (useQuery/useMutation hooks), Tailwind CSS v4, TypeScript strict mode.

**Spec:** `docs/superpowers/specs/2026-04-14-retriever-experiments-redesign.md`

---

## File Structure

### New Files

```
packages/backend/convex/
  experimentRuns/
    orchestration.ts          # Public mutations (create), queries (byKb, get), internal mutations (onChildComplete)

packages/frontend/src/
  components/experiments/
    ExperimentSidebar.tsx      # Sidebar list of experiment runs for a KB
    ExperimentResults.tsx      # Orchestrates podium + table + detail placeholder
    PodiumView.tsx             # Olympic podium (3+ retrievers)
    HeadToHeadView.tsx         # 2-retriever comparison
    SoloScoreCard.tsx          # 1-retriever result display
    ResultsTable.tsx           # Full ranked table with View Details
    CreateExperimentModal.tsx  # Modal form for experiment creation
```

### Modified Files

```
packages/backend/convex/
  schema.ts                    # Add experimentRuns table + experimentRunId field on experiments
  experiments/orchestration.ts # Add experimentRunId chain in onExperimentComplete

packages/frontend/src/app/
  retrievers/page.tsx          # Add mode toggle, top row restructure, experiment mode
```

---

## Task 1: Schema — Add `experimentRuns` Table and `experimentRunId` Field

**Files:**
- Modify: `packages/backend/convex/schema.ts` (add table after experiments table ~line 316, add field to experiments table ~line 269)

- [ ] **Step 1: Add `experimentRuns` table to schema**

In `packages/backend/convex/schema.ts`, add the new table definition after the `experiments` table indexes (after line 316):

```typescript
  // ─── Experiment Runs (groups of retriever experiments) ───
  experimentRuns: defineTable({
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    datasetId: v.id("datasets"),
    name: v.string(),
    retrieverIds: v.array(v.id("retrievers")),
    metricNames: v.array(v.string()),
    scoringWeights: v.object({
      recall: v.number(),
      precision: v.number(),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("completed_with_errors"),
      v.literal("failed"),
      v.literal("canceling"),
      v.literal("canceled"),
    ),
    totalRetrievers: v.number(),
    completedRetrievers: v.number(),
    failedRetrievers: v.number(),
    winnerId: v.optional(v.id("retrievers")),
    winnerName: v.optional(v.string()),
    winnerScore: v.optional(v.number()),
    error: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_kb", ["kbId"])
    .index("by_dataset", ["datasetId"]),
```

- [ ] **Step 2: Add `experimentRunId` field to existing `experiments` table**

In the `experiments` table definition (~line 269, after the `retrieverConfig` field), add:

```typescript
    experimentRunId: v.optional(v.id("experimentRuns")),
```

Also add an index for querying child experiments by run. Add this after the existing `.index("by_agent", ["agentId"])` line:

```typescript
    .index("by_run", ["experimentRunId"])
```

- [ ] **Step 3: Deploy schema and verify**

Run: `cd packages/backend && npx convex dev --once`

Expected: Schema deploys successfully with no errors. The new table appears in the Convex dashboard.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add experimentRuns table and experimentRunId field"
```

---

## Task 2: Backend — Experiment Runs Orchestration (Queries + Create Mutation)

**Files:**
- Create: `packages/backend/convex/experimentRuns/orchestration.ts`

- [ ] **Step 1: Create the orchestration file with imports and auth pattern**

Create `packages/backend/convex/experimentRuns/orchestration.ts`:

```typescript
import { mutation, query, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";
import { Id } from "../_generated/dataModel";
```

- [ ] **Step 2: Add `create` public mutation**

This mutation creates the parent run, inserts child experiments, and schedules evaluation for each:

```typescript
export const create = mutation({
  args: {
    name: v.string(),
    kbId: v.id("knowledgeBases"),
    datasetId: v.id("datasets"),
    retrieverIds: v.array(v.id("retrievers")),
    metricNames: v.array(v.string()),
    scoringWeights: v.object({
      recall: v.number(),
      precision: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    // Validate KB belongs to org
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) throw new Error("Knowledge base not found");

    // Validate dataset belongs to KB and org
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset || dataset.orgId !== orgId) throw new Error("Dataset not found");
    if (dataset.kbId !== args.kbId) throw new Error("Dataset does not belong to this KB");

    // Validate weights sum to ~1.0
    const weightSum = args.scoringWeights.recall + args.scoringWeights.precision;
    if (Math.abs(weightSum - 1.0) > 0.01) throw new Error("Scoring weights must sum to 1.0");

    // Validate all retrievers exist, belong to org/KB, and are ready
    for (const retrieverId of args.retrieverIds) {
      const retriever = await ctx.db.get(retrieverId);
      if (!retriever || retriever.orgId !== orgId) throw new Error(`Retriever not found: ${retrieverId}`);
      if (retriever.kbId !== args.kbId) throw new Error(`Retriever ${retriever.name} does not belong to this KB`);
      if (retriever.status !== "ready") throw new Error(`Retriever ${retriever.name} is not ready (status: ${retriever.status})`);
    }

    // Look up user record
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) throw new Error("User not found");

    // Create parent run
    const runId = await ctx.db.insert("experimentRuns", {
      orgId,
      kbId: args.kbId,
      datasetId: args.datasetId,
      name: args.name,
      retrieverIds: args.retrieverIds,
      metricNames: args.metricNames,
      scoringWeights: args.scoringWeights,
      status: "pending",
      totalRetrievers: args.retrieverIds.length,
      completedRetrievers: 0,
      failedRetrievers: 0,
      createdBy: user._id,
      createdAt: Date.now(),
    });

    // Create child experiments and schedule evaluation for each
    for (const retrieverId of args.retrieverIds) {
      const experimentId = await ctx.db.insert("experiments", {
        orgId,
        kbId: args.kbId,
        datasetId: args.datasetId,
        name: `${args.name} — ${(await ctx.db.get(retrieverId))?.name ?? "retriever"}`,
        experimentRunId: runId,
        retrieverId,
        metricNames: args.metricNames,
        status: "pending",
        createdBy: user._id,
        createdAt: Date.now(),
      });

      // Schedule the full existing pipeline for this child
      await ctx.scheduler.runAfter(
        0,
        internal.experiments.actions.runExperiment,
        {
          experimentId,
          datasetId: args.datasetId,
          kbId: args.kbId,
        },
      );
    }

    // Mark run as running
    await ctx.db.patch(runId, { status: "running" });

    return { runId };
  },
});
```

- [ ] **Step 3: Add `byKb` public query**

```typescript
export const byKb = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) throw new Error("Knowledge base not found");

    return await ctx.db
      .query("experimentRuns")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .order("desc")
      .collect();
  },
});
```

- [ ] **Step 4: Add `get` public query**

```typescript
export const get = query({
  args: { id: v.id("experimentRuns") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const run = await ctx.db.get(args.id);
    if (!run || run.orgId !== orgId) return null;
    return run;
  },
});
```

- [ ] **Step 5: Add `getWithScores` public query for experiment detail view**

This returns the run plus all child experiment scores for rendering the podium:

```typescript
export const getWithScores = query({
  args: { id: v.id("experimentRuns") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const run = await ctx.db.get(args.id);
    if (!run || run.orgId !== orgId) return null;

    // Fetch child experiments
    const children = await ctx.db
      .query("experiments")
      .withIndex("by_run", (q) => q.eq("experimentRunId", args.id))
      .collect();

    // Build ranked results
    const results = await Promise.all(
      children.map(async (exp) => {
        const retriever = exp.retrieverId ? await ctx.db.get(exp.retrieverId) : null;
        const scores = (exp.scores ?? {}) as Record<string, number>;
        const recall = scores.recall ?? 0;
        const precision = scores.precision ?? 0;
        const compositeScore = run.scoringWeights.recall * recall + run.scoringWeights.precision * precision;

        return {
          experimentId: exp._id,
          retrieverId: exp.retrieverId,
          retrieverName: retriever?.name ?? "Unknown",
          status: exp.status,
          recall,
          precision,
          f1: scores.f1,
          iou: scores.iou,
          compositeScore,
        };
      }),
    );

    // Sort by composite score descending
    results.sort((a, b) => b.compositeScore - a.compositeScore);

    // Fetch dataset for question count
    const dataset = await ctx.db.get(run.datasetId);

    return {
      ...run,
      questionCount: dataset?.questionCount ?? 0,
      datasetName: dataset?.name ?? "Unknown",
      rankedResults: results,
    };
  },
});
```

- [ ] **Step 6: Add `onChildComplete` internal mutation**

```typescript
export const onChildComplete = internalMutation({
  args: {
    experimentRunId: v.id("experimentRuns"),
    experimentId: v.id("experiments"),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.experimentRunId);
    if (!run) return;

    const completed = run.completedRetrievers + (args.success ? 1 : 0);
    const failed = run.failedRetrievers + (args.success ? 0 : 1);
    const totalHandled = completed + failed;
    const isComplete = totalHandled >= run.totalRetrievers;

    if (!isComplete) {
      await ctx.db.patch(args.experimentRunId, {
        completedRetrievers: completed,
        failedRetrievers: failed,
      });
      return;
    }

    // All children done — compute rankings
    const children = await ctx.db
      .query("experiments")
      .withIndex("by_run", (q) => q.eq("experimentRunId", args.experimentRunId))
      .collect();

    let bestId: Id<"retrievers"> | undefined;
    let bestName: string | undefined;
    let bestScore = -1;

    for (const exp of children) {
      if (exp.status !== "completed" && exp.status !== "completed_with_errors") continue;
      const scores = (exp.scores ?? {}) as Record<string, number>;
      const recall = scores.recall ?? 0;
      const precision = scores.precision ?? 0;
      const composite = run.scoringWeights.recall * recall + run.scoringWeights.precision * precision;

      if (composite > bestScore && exp.retrieverId) {
        bestScore = composite;
        bestId = exp.retrieverId;
        const retriever = await ctx.db.get(exp.retrieverId);
        bestName = retriever?.name;
      }
    }

    const finalStatus = failed > 0 && completed === 0
      ? "failed" as const
      : failed > 0
        ? "completed_with_errors" as const
        : "completed" as const;

    await ctx.db.patch(args.experimentRunId, {
      completedRetrievers: completed,
      failedRetrievers: failed,
      status: finalStatus,
      winnerId: bestId,
      winnerName: bestName,
      winnerScore: bestScore >= 0 ? bestScore : undefined,
      completedAt: Date.now(),
    });
  },
});
```

- [ ] **Step 7: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`

Expected: All functions deploy successfully.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/convex/experimentRuns/orchestration.ts
git commit -m "feat(backend): add experimentRuns orchestration — create, queries, onChildComplete"
```

---

## Task 3: Backend — Wire `onChildComplete` into Existing Experiment Completion

**Files:**
- Modify: `packages/backend/convex/experiments/orchestration.ts` (~line 361, `onExperimentComplete`)

- [ ] **Step 1: Add `experimentRunId` chain to `onExperimentComplete`**

In `packages/backend/convex/experiments/orchestration.ts`, modify the `onExperimentComplete` handler. After line 378 (the `result.kind === "success"` block), add a call to `onChildComplete`:

Replace the existing `onExperimentComplete` handler logic (lines 372–396) with:

```typescript
  handler: async (ctx, { context, result }: {
    workId: string;
    context: { experimentId: Id<"experiments"> };
    result: RunResult;
  }) => {
    const experiment = await ctx.db.get(context.experimentId);
    if (!experiment) return;

    if (result.kind === "success") {
      // The action itself marks the experiment as completed with scores.
      // If part of a run, notify the parent.
      if (experiment.experimentRunId) {
        await ctx.scheduler.runAfter(0, internal.experimentRuns.orchestration.onChildComplete, {
          experimentRunId: experiment.experimentRunId,
          experimentId: context.experimentId,
          success: true,
        });
      }
      return;
    }

    if (result.kind === "canceled") {
      await ctx.db.patch(context.experimentId, {
        status: "canceled",
        completedAt: Date.now(),
      });
      // Notify parent run (count as failed)
      if (experiment.experimentRunId) {
        await ctx.scheduler.runAfter(0, internal.experimentRuns.orchestration.onChildComplete, {
          experimentRunId: experiment.experimentRunId,
          experimentId: context.experimentId,
          success: false,
        });
      }
      return;
    }

    // result.kind === "failed"
    if (experiment.status !== "failed") {
      await ctx.db.patch(context.experimentId, {
        status: "failed",
        error: result.error ?? "Evaluation action failed",
        completedAt: Date.now(),
      });
    }
    // Notify parent run
    if (experiment.experimentRunId) {
      await ctx.runMutation(internal.experimentRuns.orchestration.onChildComplete, {
        experimentRunId: experiment.experimentRunId,
        experimentId: context.experimentId,
        success: false,
      });
    }
  },
```

- [ ] **Step 2: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`

Expected: Deploys with no errors. Existing standalone experiments still work (they have no `experimentRunId`, so the new `if` blocks are skipped).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/experiments/orchestration.ts
git commit -m "feat(backend): chain onChildComplete from onExperimentComplete for grouped runs"
```

---

## Task 4: Frontend — Create Experiment Modal

**Files:**
- Create: `packages/frontend/src/components/experiments/CreateExperimentModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `packages/frontend/src/components/experiments/CreateExperimentModal.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";

interface CreateExperimentModalProps {
  open: boolean;
  onClose: () => void;
  kbId: Id<"knowledgeBases">;
  onCreated: (runId: Id<"experimentRuns">) => void;
}

export function CreateExperimentModal({
  open,
  onClose,
  kbId,
  onCreated,
}: CreateExperimentModalProps) {
  const [name, setName] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<Id<"datasets"> | null>(null);
  const [selectedRetrieverIds, setSelectedRetrieverIds] = useState<Set<Id<"retrievers">>>(new Set());
  const [metrics, setMetrics] = useState({ recall: true, precision: true, f1: false, iou: false });
  const [recallWeight, setRecallWeight] = useState(0.7);
  const [precisionWeight, setPrecisionWeight] = useState(0.3);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const datasets = useQuery(api.crud.datasets.byKb, { kbId });
  const retrievers = useQuery(api.crud.retrievers.byKb, { kbId });
  const readyRetrievers = (retrievers ?? []).filter((r) => r.status === "ready");
  const createRun = useMutation(api.experimentRuns.orchestration.create);

  if (!open) return null;

  const toggleRetriever = (id: Id<"retrievers">) => {
    setSelectedRetrieverIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit =
    name.trim() &&
    selectedDatasetId &&
    selectedRetrieverIds.size > 0 &&
    (metrics.recall || metrics.precision) &&
    Math.abs(recallWeight + precisionWeight - 1.0) < 0.01 &&
    !creating;

  async function handleCreate() {
    if (!canSubmit || !selectedDatasetId) return;
    setError(null);
    setCreating(true);
    try {
      const metricNames = Object.entries(metrics)
        .filter(([, v]) => v)
        .map(([k]) => k);

      const result = await createRun({
        name: name.trim(),
        kbId,
        datasetId: selectedDatasetId,
        retrieverIds: Array.from(selectedRetrieverIds),
        metricNames,
        scoringWeights: { recall: recallWeight, precision: precisionWeight },
      });
      onCreated(result.runId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create experiment");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-bg-elevated border border-border rounded-xl shadow-2xl w-[560px] max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text">Create Experiment</h2>
          <button onClick={onClose} className="text-text-dim hover:text-text text-lg px-2">&times;</button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Experiment Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Full Comparison - Support KB"
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
            />
          </div>

          {/* Dataset */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Dataset
            </label>
            <select
              value={selectedDatasetId ?? ""}
              onChange={(e) => setSelectedDatasetId(e.target.value ? (e.target.value as Id<"datasets">) : null)}
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text focus:border-accent outline-none appearance-none"
            >
              <option value="">Select a dataset...</option>
              {(datasets ?? []).map((ds) => (
                <option key={ds._id} value={ds._id}>
                  {ds.name} ({ds.questionCount} questions)
                </option>
              ))}
            </select>
          </div>

          {/* Retrievers */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Retrievers
            </label>
            <div className="border border-border rounded-md max-h-44 overflow-y-auto p-1.5 space-y-1">
              {readyRetrievers.length === 0 ? (
                <div className="text-xs text-text-dim p-2">No ready retrievers for this KB.</div>
              ) : (
                readyRetrievers.map((r) => (
                  <label
                    key={r._id}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded cursor-pointer transition-colors ${
                      selectedRetrieverIds.has(r._id)
                        ? "bg-accent/8 border border-accent/20"
                        : "hover:bg-bg-hover border border-transparent"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedRetrieverIds.has(r._id)}
                      onChange={() => toggleRetriever(r._id)}
                      className="w-3.5 h-3.5 rounded accent-accent"
                    />
                    <div>
                      <div className="text-xs text-text">{r.name}</div>
                      <div className="text-[10px] text-text-dim">
                        {r.chunkCount ?? "?"} chunks, k={r.defaultK}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="text-[10px] text-text-dim mt-1">
              {selectedRetrieverIds.size} selected
            </div>
          </div>

          {/* Metrics */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Metrics
            </label>
            <div className="flex gap-4">
              {(["recall", "precision", "f1", "iou"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5 cursor-pointer text-xs text-text-muted">
                  <input
                    type="checkbox"
                    checked={metrics[m]}
                    onChange={(e) => setMetrics({ ...metrics, [m]: e.target.checked })}
                    className="w-3.5 h-3.5 rounded accent-accent"
                  />
                  {m === "iou" ? "IoU" : m === "f1" ? "F1" : m.charAt(0).toUpperCase() + m.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {/* Ranking Formula */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-dim mb-1.5">
              Ranking Formula
            </label>
            <div className="flex items-center gap-2 text-xs text-text-dim">
              <input
                type="number"
                value={recallWeight}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setRecallWeight(val);
                  setPrecisionWeight(Math.round((1.0 - val) * 100) / 100);
                }}
                min={0}
                max={1}
                step={0.1}
                className="w-14 bg-bg border border-border rounded px-2 py-1 text-center text-text text-xs"
              />
              <span>&times; Recall +</span>
              <input
                type="number"
                value={precisionWeight}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setPrecisionWeight(val);
                  setRecallWeight(Math.round((1.0 - val) * 100) / 100);
                }}
                min={0}
                max={1}
                step={0.1}
                className="w-14 bg-bg border border-border rounded px-2 py-1 text-center text-text text-xs"
              />
              <span>&times; Precision</span>
            </div>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs border border-border rounded-md text-text-muted hover:text-text"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!canSubmit}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors ${
              canSubmit
                ? "bg-accent text-bg-elevated hover:bg-accent/90 cursor-pointer"
                : "bg-border text-text-dim cursor-not-allowed"
            }`}
          >
            {creating ? "Creating..." : "Create Experiment"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/experiments/CreateExperimentModal.tsx
git commit -m "feat(frontend): add CreateExperimentModal component"
```

---

## Task 5: Frontend — Podium, Head-to-Head, and Solo Score Components

**Files:**
- Create: `packages/frontend/src/components/experiments/PodiumView.tsx`
- Create: `packages/frontend/src/components/experiments/HeadToHeadView.tsx`
- Create: `packages/frontend/src/components/experiments/SoloScoreCard.tsx`
- Create: `packages/frontend/src/components/experiments/ResultsTable.tsx`

- [ ] **Step 1: Create `PodiumView.tsx`**

Create `packages/frontend/src/components/experiments/PodiumView.tsx`. This renders the Olympic podium for 3+ retrievers. Each slot receives: medal position, retriever name, composite score, recall, precision. Uses gold (#fbbf24), silver (#94a3b8), bronze (#d97706) coloring. Center slot (1st) is tallest pedestal, left (2nd) medium, right (3rd) shortest. Reference the locked mockup at `.superpowers/brainstorm/94708-1776151909/podium-states.html` for exact styling.

Props interface:

```typescript
interface RankedResult {
  retrieverId: string | null;
  retrieverName: string;
  compositeScore: number;
  recall: number;
  precision: number;
  status: string;
}

interface PodiumViewProps {
  results: RankedResult[]; // already sorted by compositeScore desc
  formula: string; // e.g., "0.7 × Recall + 0.3 × Precision"
}
```

- [ ] **Step 2: Create `HeadToHeadView.tsx`**

Create `packages/frontend/src/components/experiments/HeadToHeadView.tsx`. Two-retriever comparison: winner (left) with accent border + "+X% ahead" delta badge, loser (right) with muted styling, "vs" divider in the middle.

Props interface:

```typescript
interface HeadToHeadViewProps {
  winner: RankedResult;
  loser: RankedResult;
  formula: string;
}
```

- [ ] **Step 3: Create `SoloScoreCard.tsx`**

Create `packages/frontend/src/components/experiments/SoloScoreCard.tsx`. Single retriever centered card — no ranking needed. Shows retriever name, composite score, recall, precision.

Props interface:

```typescript
interface SoloScoreCardProps {
  result: RankedResult;
  formula: string;
}
```

- [ ] **Step 4: Create `ResultsTable.tsx`**

Create `packages/frontend/src/components/experiments/ResultsTable.tsx`. Full ranked table showing ALL retrievers. Columns: Rank, Retriever, Recall, Precision, Score, View Details. Row #1 gets accent highlight. View Details button toggles a placeholder panel below the table.

Props interface:

```typescript
interface ResultsTableProps {
  results: RankedResult[];
  metricNames: string[]; // which optional columns to show (f1, iou)
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/experiments/
git commit -m "feat(frontend): add PodiumView, HeadToHeadView, SoloScoreCard, ResultsTable"
```

---

## Task 6: Frontend — Experiment Sidebar and Results Container

**Files:**
- Create: `packages/frontend/src/components/experiments/ExperimentSidebar.tsx`
- Create: `packages/frontend/src/components/experiments/ExperimentResults.tsx`

- [ ] **Step 1: Create `ExperimentSidebar.tsx`**

List of experiment runs for a KB. Each entry shows: name, retriever count, question count (from dataset), date, winner name + score, status dot (green for completed, blue for running). Clicking an entry calls `onSelect(runId)`.

Props interface:

```typescript
interface ExperimentSidebarProps {
  kbId: Id<"knowledgeBases">;
  selectedRunId: Id<"experimentRuns"> | null;
  onSelect: (runId: Id<"experimentRuns">) => void;
}
```

Uses `useQuery(api.experimentRuns.orchestration.byKb, { kbId })` to fetch runs.

- [ ] **Step 2: Create `ExperimentResults.tsx`**

Orchestrates the results display. Fetches `getWithScores` for the selected run, then renders the appropriate visualization based on retriever count:
- 0 or no selection: empty state
- 1: `SoloScoreCard`
- 2: `HeadToHeadView`
- 3+: `PodiumView`
- Always: `ResultsTable` below with all results

Props interface:

```typescript
interface ExperimentResultsProps {
  runId: Id<"experimentRuns"> | null;
}
```

Uses `useQuery(api.experimentRuns.orchestration.getWithScores, runId ? { id: runId } : "skip")`.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/experiments/ExperimentSidebar.tsx packages/frontend/src/components/experiments/ExperimentResults.tsx
git commit -m "feat(frontend): add ExperimentSidebar and ExperimentResults container"
```

---

## Task 7: Frontend — Restructure Retrievers Page with Create/Experiment Modes

**Files:**
- Modify: `packages/frontend/src/app/retrievers/page.tsx`

- [ ] **Step 1: Add mode state and imports**

At the top of `RetrieversPageContent`, add:

```typescript
import { CreateExperimentModal } from "@/components/experiments/CreateExperimentModal";
import { ExperimentSidebar } from "@/components/experiments/ExperimentSidebar";
import { ExperimentResults } from "@/components/experiments/ExperimentResults";

// Inside the component:
const [pageMode, setPageMode] = useState<"create" | "experiment">("create");
const [showExperimentModal, setShowExperimentModal] = useState(false);
const [selectedRunId, setSelectedRunId] = useState<Id<"experimentRuns"> | null>(null);
```

- [ ] **Step 2: Replace the sidebar + main layout with the new top row + modes**

Remove the `RetrieverSidebar` from the layout. Replace the two-column layout with:

1. **Top row** (below Header): mode toggle (far left) → separator → KB dropdown → (create mode: retriever dropdown) → spacer → primary button (far right)
2. **Create mode**: existing tab bar + full-width tab content (same as current but no sidebar)
3. **Experiment mode**: ExperimentSidebar (280px left) + ExperimentResults (flex-1 right)

The top row should follow the same styling pattern as the generate page top bar — `border-b border-border bg-bg-elevated px-6 py-2.5`.

- [ ] **Step 3: Add retriever dropdown for create mode**

In create mode, add a `<select>` dropdown populated from `useQuery(api.crud.retrievers.byKb, selectedKbId ? { kbId: selectedKbId } : "skip")`. When a retriever is selected, it sets `selectedRetrieverId` and the tabs below show that retriever's details.

- [ ] **Step 4: Wire up "Create Experiment" button and modal**

When `pageMode === "experiment"`, the primary button says "Create Experiment" and opens the `CreateExperimentModal`. When a run is created, set `selectedRunId` to the new run ID.

- [ ] **Step 5: Wire experiment mode layout**

When `pageMode === "experiment"`, render `ExperimentSidebar` on the left and `ExperimentResults` on the right, passing `selectedRunId` and `setSelectedRunId`.

- [ ] **Step 6: Test the full flow manually**

1. Navigate to /retrievers
2. Verify "Create" mode shows KB dropdown + retriever dropdown + tabs (same as before minus sidebar)
3. Switch to "Experiment" mode
4. Verify sidebar shows past runs (or empty state)
5. Click "Create Experiment" — verify modal opens with dataset/retriever selection
6. Create an experiment with 2-3 retrievers
7. Verify experiment appears in sidebar, results show podium when complete

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/app/retrievers/page.tsx
git commit -m "feat(frontend): restructure Retrievers page with Create/Experiment modes"
```

---

## Task 8: Integration Testing

**Files:**
- Create: `packages/backend/tests/experimentRuns.test.ts`

- [ ] **Step 1: Write integration tests for experimentRuns.create**

Using the existing test patterns from `packages/backend/tests/helpers.ts`:

```typescript
import { expect, test, describe } from "vitest";
import { setupTest, seedUser, seedKB, seedDataset, testIdentity } from "./helpers";

describe("experimentRuns", () => {
  test("create inserts parent run and child experiments", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const datasetId = await seedDataset(t, userId, kbId);

    // Need to create at least 2 ready retrievers
    // ... seed retrievers with status "ready"

    const result = await t.mutation(
      api.experimentRuns.orchestration.create,
      {
        name: "Test Run",
        kbId,
        datasetId,
        retrieverIds: [retriever1Id, retriever2Id],
        metricNames: ["recall", "precision"],
        scoringWeights: { recall: 0.7, precision: 0.3 },
      },
      { identity: testIdentity },
    );

    expect(result.runId).toBeDefined();

    // Verify parent run was created
    const run = await t.query(
      api.experimentRuns.orchestration.get,
      { id: result.runId },
      { identity: testIdentity },
    );
    expect(run).not.toBeNull();
    expect(run!.status).toBe("running");
    expect(run!.totalRetrievers).toBe(2);
  });

  test("rejects if weights don't sum to 1.0", async () => {
    // ... setup ...
    await expect(
      t.mutation(api.experimentRuns.orchestration.create, {
        // ... valid fields but scoringWeights: { recall: 0.5, precision: 0.3 }
      }, { identity: testIdentity }),
    ).rejects.toThrow("Scoring weights must sum to 1.0");
  });

  test("rejects if retriever not ready", async () => {
    // ... setup with retriever in "configuring" status ...
    await expect(
      t.mutation(api.experimentRuns.orchestration.create, {
        // ... with non-ready retriever
      }, { identity: testIdentity }),
    ).rejects.toThrow("not ready");
  });
});
```

- [ ] **Step 2: Write test for onChildComplete**

Test that when all children complete, the run status transitions to "completed" and winner is set.

- [ ] **Step 3: Run tests**

Run: `cd packages/backend && pnpm test`

Expected: All new tests pass. Existing tests unaffected.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/tests/experimentRuns.test.ts
git commit -m "test(backend): add experimentRuns integration tests"
```

---

## Task 9: Final Verification and Cleanup

- [ ] **Step 1: Run full backend test suite**

Run: `cd packages/backend && pnpm test`

Expected: All tests pass (existing + new).

- [ ] **Step 2: Run frontend TypeScript check**

Run: `pnpm -C packages/frontend build`

Expected: No TypeScript errors.

- [ ] **Step 3: Deploy backend**

Run: `cd packages/backend && npx convex dev --once`

Expected: All functions deploy successfully.

- [ ] **Step 4: Manual smoke test**

1. Open the app, navigate to Retrievers page
2. Verify Create mode works as before (KB dropdown → retriever dropdown → tabs)
3. Switch to Experiment mode
4. Create an experiment with 2+ retrievers
5. Watch it run (sidebar shows running status)
6. When complete, verify podium displays correctly
7. Verify the standalone /experiments page still works for agent experiments

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for retriever experiments redesign"
```
