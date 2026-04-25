# Simulation System Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix vector search waste, split simulation into conversation + evaluation phases, add cancel UI, and improve scenario list UX.

**Architecture:** Backend-first approach. Fix vector search (shared infra), then modify schema + orchestration to decouple conversation from evaluation, add new evaluation action, then update frontend components to reflect the two-phase flow.

**Tech Stack:** Convex (backend), Next.js/React (frontend), Vercel AI SDK, WorkPool component

**Design doc:** `docs/plans/2026-04-25-simulation-improvements-design.md`

---

### Task 1: Vector Search Filter Fix

**Files:**
- Modify: `packages/backend/convex/lib/vectorSearch.ts:22-44`

**Step 1: Update the vector search filter and over-fetch**

In `vectorSearchWithFilter`, change the filter to include `indexConfigHash` and reduce over-fetch:

```typescript
// Line 22 — change over-fetch
const overFetch = Math.min(opts.topK * 2, 64);

// Lines 24-28 — add indexConfigHash to filter
const results = await ctx.vectorSearch("documentChunks", "by_embedding", {
  vector: opts.queryEmbedding,
  limit: overFetch,
  filter: (q: any) =>
    q.and(
      q.eq("kbId", opts.kbId),
      q.eq("indexConfigHash", opts.indexConfigHash),
    ),
});
```

Keep the existing JS post-filter on line 42-44 as a defensive no-op (it will match everything now but costs nothing).

**Step 2: Verify backend type-checks**

Run: `pnpm typecheck:backend`
Expected: PASS

**Step 3: Deploy and verify in dev**

Run: `cd packages/backend && npx convex dev --once`
Expected: `Convex functions ready!` — no errors

**Step 4: Commit**

```bash
git add packages/backend/convex/lib/vectorSearch.ts
git commit -m "fix(vectorSearch): filter by indexConfigHash at index level, reduce over-fetch to 2x"
```

---

### Task 2: Schema Changes for Evaluation Split

**Files:**
- Modify: `packages/backend/convex/schema.ts:852-880`

**Step 1: Update `conversationSimulations` schema**

Make `evaluatorSetId` optional and add evaluation-phase fields:

```typescript
// Line 857 — change from required to optional
evaluatorSetId: v.optional(v.id("evaluatorSets")),

// After line 874 (after workIds), add:
evaluationStatus: v.optional(v.union(
  v.literal("not_started"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
)),
evaluationEvaluatorSetId: v.optional(v.id("evaluatorSets")),
evaluationCompletedRuns: v.optional(v.number()),
evaluationFailedRuns: v.optional(v.number()),
evaluationWorkIds: v.optional(v.array(v.string())),
```

**Step 2: Verify backend type-checks**

Run: `pnpm typecheck:backend`
Expected: PASS (all new fields are optional, existing code still compiles)

**Step 3: Deploy schema**

Run: `cd packages/backend && npx convex dev --once`
Expected: Schema deployed successfully

**Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(schema): add evaluation-phase fields to conversationSimulations"
```

---

### Task 3: Remove Evaluation from `runConversationSim`

**Files:**
- Modify: `packages/backend/convex/conversationSim/actions.ts`

**Step 1: Remove evaluation imports and stage 3**

Remove these imports (lines 10-13):
```typescript
import { runCodeEvaluator } from "./evaluation";
import type { EvalInput } from "./evaluation";
import { runLLMJudge } from "./judge";
import type { JudgeConfig, JudgeContext } from "./judge";
```

Remove the `evalSet` loading in setup (lines 39-43):
```typescript
const evalSet = await ctx.runQuery(
  internal.conversationSim.evaluatorSets.getInternal,
  { id: simulation.evaluatorSetId },
);
if (!evalSet) throw new Error("Evaluator set not found");
```

Remove the entire "3. EVALUATE" section (lines 246-321 approximately — from `// 3. EVALUATE` through the `passed` calculation).

**Step 2: Simplify the "4. SAVE" section**

Replace the save call to remove evaluation fields:

```typescript
// 3. SAVE (was 4. SAVE)
const latencyMs = Date.now() - startTime;
const turnCount = Math.ceil(messages.length / 2);

await ctx.runMutation(internal.conversationSim.runs.updateRun, {
  runId,
  status: "completed",
  terminationReason,
  turnCount,
  toolCallCount,
  totalTokens,
  latencyMs,
});
```

**Step 3: Remove debug logs from earlier session**

Remove all `console.log` lines containing `[SIM DEBUG]` and `[AGENT LOOP DEBUG]` from both `actions.ts` and `packages/backend/convex/lib/agentLoop.ts`.

**Step 4: Verify backend type-checks**

Run: `pnpm typecheck:backend`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/actions.ts packages/backend/convex/lib/agentLoop.ts
git commit -m "refactor(sim): remove evaluation from conversation action, clean up debug logs"
```

---

### Task 4: Update `start` Mutation and `onRunComplete` Callback

**Files:**
- Modify: `packages/backend/convex/conversationSim/orchestration.ts`

**Step 1: Make `evaluatorSetId` optional in `start` mutation**

Change the arg from `v.id("evaluatorSets")` to `v.optional(v.id("evaluatorSets"))`. Remove the evaluator set validation block. Add `evaluationStatus: "not_started"` to the simulation insert. Make `passThreshold` optional in the schema (`v.optional(v.number())`) and stop writing it from the `start` mutation — it will be read from the evaluator set at evaluation time instead.

In the `start` mutation args (around line 23):
```typescript
evaluatorSetId: v.optional(v.id("evaluatorSets")),
```

In the simulation insert (around line 73-91), add:
```typescript
evaluationStatus: "not_started" as const,
```

Remove the evalSet validation (around lines 48-50):
```typescript
// DELETE these lines:
// const evalSet = await ctx.db.get(args.evaluatorSetId);
// if (!evalSet || evalSet.orgId !== orgId)
//   throw new Error("Evaluator set not found");
```

**Step 2: Simplify `onRunComplete` callback**

Remove the `overallPassRate` and `avgScore` computation from the `onRunComplete` callback (lines 162-200). When `totalHandled >= sim.totalRuns`, just set status to completed:

```typescript
if (totalHandled >= sim.totalRuns) {
  await ctx.db.patch(simId, {
    completedRuns,
    failedRuns,
    status: failedRuns === sim.totalRuns ? "failed" : "completed",
    completedAt: Date.now(),
  });
} else {
  await ctx.db.patch(simId, {
    completedRuns,
    failedRuns,
  });
}
```

**Step 3: Verify backend type-checks**

Run: `pnpm typecheck:backend`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/backend/convex/conversationSim/orchestration.ts
git commit -m "refactor(sim): make evaluatorSetId optional, simplify onRunComplete"
```

---

### Task 5: Create `evaluationActions.ts` and `startEvaluation` Mutation

**Files:**
- Create: `packages/backend/convex/conversationSim/evaluationActions.ts`
- Modify: `packages/backend/convex/conversationSim/orchestration.ts`

**Step 1: Create `evaluationActions.ts`**

This is a `"use node"` action file that runs evaluators against completed conversations.

```typescript
"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { runCodeEvaluator } from "./evaluation";
import type { EvalInput } from "./evaluation";
import { runLLMJudge } from "./judge";
import type { JudgeConfig, JudgeContext } from "./judge";

export const runEvaluation = internalAction({
  args: {
    runId: v.id("conversationSimRuns"),
    evaluatorSetId: v.id("evaluatorSets"),
  },
  handler: async (ctx, { runId, evaluatorSetId }) => {
    // Load run and its conversation
    const run = await ctx.runQuery(internal.conversationSim.runs.getInternal, { id: runId });
    if (!run || !run.conversationId) throw new Error("Run or conversation not found");

    const messages = await ctx.runQuery(
      internal.crud.conversations.listMessagesInternal,
      { conversationId: run.conversationId },
    );

    // Load evaluator set
    const evalSet = await ctx.runQuery(
      internal.conversationSim.evaluatorSets.getInternal,
      { id: evaluatorSetId },
    );
    if (!evalSet) throw new Error("Evaluator set not found");

    // Build evaluation inputs
    const userAssistantMsgs = messages.filter(
      (m: any) => m.role === "user" || m.role === "assistant",
    );
    const toolCallMsgs = messages.filter((m: any) => m.role === "tool_call");

    const evalInput: EvalInput = {
      messages: userAssistantMsgs.map((m: any) => ({ role: m.role, content: m.content })),
      toolCalls: toolCallMsgs.map((m: any) => ({
        toolName: m.toolCall?.toolName ?? "",
        args: JSON.parse(m.toolCall?.toolArgs ?? "{}"),
        result: "", // tool results are in tool_result messages
      })),
    };

    // Build transcript and context for LLM judges
    const transcript = userAssistantMsgs
      .map((m: any) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const toolCallsStr = toolCallMsgs.length > 0
      ? toolCallMsgs.map((m: any) =>
          `${m.toolCall?.toolName}(${m.toolCall?.toolArgs?.slice(0, 200)})`
        ).join("\n")
      : undefined;

    // Collect KB documents from tool_result messages
    const toolResultMsgs = messages.filter((m: any) => m.role === "tool_result");
    const kbDocs = toolResultMsgs
      .map((m: any) => m.content)
      .join("\n===\n") || undefined;

    // Run each evaluator
    const evaluatorResults: Array<{
      evaluatorId: any;
      evaluatorName: string;
      passed: boolean;
      justification: string;
      required: boolean;
    }> = [];

    for (const evalId of evalSet.evaluatorIds) {
      const evaluator = await ctx.runQuery(
        internal.conversationSim.evaluators.getInternal,
        { id: evalId },
      );
      if (!evaluator) continue;

      const isRequired = evalSet.requiredEvaluatorIds.some(
        (rid: any) => rid.toString() === evalId.toString(),
      );

      let result;
      if (evaluator.type === "code" && evaluator.codeConfig) {
        result = runCodeEvaluator(
          evaluator.codeConfig.checkType,
          evaluator.codeConfig.params,
          evalInput,
        );
      } else if (evaluator.type === "llm_judge" && evaluator.judgeConfig) {
        const judgeConfig: JudgeConfig = {
          rubric: evaluator.judgeConfig.rubric,
          passExamples: evaluator.judgeConfig.passExamples,
          failExamples: evaluator.judgeConfig.failExamples,
          model: evaluator.judgeConfig.model,
          inputContext: evaluator.judgeConfig.inputContext,
        };
        const judgeContext: JudgeContext = {
          transcript,
          toolCalls: toolCallsStr,
          kbDocuments: kbDocs,
        };
        result = await runLLMJudge(judgeConfig, judgeContext);
      } else {
        result = { passed: false, justification: "Invalid evaluator configuration" };
      }

      evaluatorResults.push({
        evaluatorId: evalId,
        evaluatorName: evaluator.name,
        passed: result.passed,
        justification: result.justification,
        required: isRequired,
      });
    }

    // Compute score and pass/fail
    const score = evaluatorResults.length > 0
      ? evaluatorResults.filter(r => r.passed).length / evaluatorResults.length
      : 1;

    const allRequiredPassed = evaluatorResults
      .filter(r => r.required)
      .every(r => r.passed);
    const passed = allRequiredPassed && score >= evalSet.passThreshold;

    // Save results on the run
    await ctx.runMutation(internal.conversationSim.runs.updateRun, {
      runId,
      evaluatorResults,
      score,
      passed,
    });
  },
});
```

**Step 2: Add `startEvaluation` mutation and `onEvaluationRunComplete` callback to orchestration.ts**

Add these after the existing `cancel` mutation:

```typescript
// ─── Start Evaluation ───

export const startEvaluation = mutation({
  args: {
    simulationId: v.id("conversationSimulations"),
    evaluatorSetId: v.id("evaluatorSets"),
  },
  handler: async (ctx, { simulationId, evaluatorSetId }) => {
    const { orgId } = await getAuthContext(ctx);
    const sim = await ctx.db.get(simulationId);
    if (!sim || sim.orgId !== orgId) throw new Error("Simulation not found");
    if (sim.status !== "completed") {
      throw new Error("Cannot evaluate: conversations not yet completed");
    }

    const evalSet = await ctx.db.get(evaluatorSetId);
    if (!evalSet || evalSet.orgId !== orgId) throw new Error("Evaluator set not found");

    // Clear previous evaluation results from runs
    const runs = await ctx.db
      .query("conversationSimRuns")
      .withIndex("by_simulation", (q) => q.eq("simulationId", simulationId))
      .collect();

    const completedRuns = runs.filter(r => r.status === "completed");
    for (const run of completedRuns) {
      await ctx.db.patch(run._id, {
        evaluatorResults: undefined,
        score: undefined,
        passed: undefined,
      });
    }

    // Update simulation with evaluation state
    await ctx.db.patch(simulationId, {
      evaluationStatus: "running",
      evaluationEvaluatorSetId: evaluatorSetId,
      evaluationCompletedRuns: 0,
      evaluationFailedRuns: 0,
      overallPassRate: undefined,
      avgScore: undefined,
    });

    // Enqueue evaluation for each completed run
    const workIds: WorkId[] = [];
    for (const run of completedRuns) {
      const wId = await pool.enqueueAction(
        ctx,
        internal.conversationSim.evaluationActions.runEvaluation,
        { runId: run._id, evaluatorSetId },
        {
          onComplete:
            internal.conversationSim.orchestration.onEvaluationRunComplete,
          context: { simulationId: simulationId.toString(), runId: run._id.toString() },
        },
      );
      workIds.push(wId);
    }

    await ctx.db.patch(simulationId, {
      evaluationWorkIds: workIds.map(String),
    });
  },
});

// ─── On Evaluation Run Complete ───

export const onEvaluationRunComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      simulationId: v.string(),
      runId: v.string(),
    }),
  ),
  handler: async (
    ctx,
    { context, result }: {
      workId: string;
      context: { simulationId: string; runId: string };
      result: RunResult;
    },
  ) => {
    const simId = context.simulationId as Id<"conversationSimulations">;
    const sim = await ctx.db.get(simId);
    if (!sim) return;

    const evalCompleted = (sim.evaluationCompletedRuns ?? 0) + (result.kind === "success" ? 1 : 0);
    const evalFailed = (sim.evaluationFailedRuns ?? 0) + (result.kind === "failed" ? 1 : 0);
    const totalHandled = evalCompleted + evalFailed;

    // Count how many runs were enqueued for evaluation
    const totalEvalRuns = (sim.evaluationWorkIds ?? []).length;

    if (totalHandled >= totalEvalRuns) {
      // All evaluation runs done — compute aggregate stats
      const allRuns = await ctx.db
        .query("conversationSimRuns")
        .withIndex("by_simulation", (q) => q.eq("simulationId", simId))
        .collect();

      const scenarioMap = new Map<string, boolean[]>();
      for (const run of allRuns) {
        const key = run.scenarioId as string;
        if (!scenarioMap.has(key)) scenarioMap.set(key, []);
        scenarioMap.get(key)!.push(run.passed ?? false);
      }

      let scenariosPassed = 0;
      for (const [, passes] of scenarioMap) {
        if (passes.every((p) => p)) scenariosPassed++;
      }
      const overallPassRate = scenarioMap.size > 0 ? scenariosPassed / scenarioMap.size : 0;

      const scores = allRuns.map(r => r.score).filter((s): s is number => s !== undefined);
      const avgScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : undefined;

      await ctx.db.patch(simId, {
        evaluationCompletedRuns: evalCompleted,
        evaluationFailedRuns: evalFailed,
        evaluationStatus: "completed",
        overallPassRate,
        avgScore,
      });
    } else {
      await ctx.db.patch(simId, {
        evaluationCompletedRuns: evalCompleted,
        evaluationFailedRuns: evalFailed,
      });
    }
  },
});
```

**Step 3: Verify backend type-checks**

Run: `pnpm typecheck:backend`
Expected: PASS

**Step 4: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`
Expected: `Convex functions ready!`

**Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/evaluationActions.ts packages/backend/convex/conversationSim/orchestration.ts
git commit -m "feat(sim): add startEvaluation mutation and runEvaluation action"
```

---

### Task 6: Update `CreateSimulationModal` — Remove Evaluator Set

**Files:**
- Modify: `packages/frontend/src/components/conversation-sim/CreateSimulationModal.tsx`

**Step 1: Remove evaluator set UI and logic**

- Remove the `evaluatorSetId` state and the evaluator sets query
- Remove the evaluator set dropdown from the form JSX
- Remove `evaluatorSetId` from the `startSimulation` mutation call
- Remove the "Seed Templates" button and related logic

**Step 2: Verify frontend builds**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/CreateSimulationModal.tsx
git commit -m "refactor(sim): remove evaluator set from create simulation modal"
```

---

### Task 7: Add Cancel UI — `GenerationBanner` + Confirmation Modal

**Files:**
- Modify: `packages/frontend/src/components/GenerationBanner.tsx`
- Modify: `packages/frontend/src/app/agents/page.tsx`

**Step 1: Add `onCancel` and `itemLabel` props to `GenerationBanner`**

Add to the interface:
```typescript
onCancel?: () => void;
itemLabel?: string; // defaults to "questions"
```

Add a cancel button next to the View button (only when `onCancel` is provided). Add confirmation state: `const [showCancelConfirm, setShowCancelConfirm] = useState(false)`. Render a confirmation modal when `showCancelConfirm` is true, using the same dark-theme modal pattern as `CreateSimulationModal`:

- Backdrop: `fixed inset-0 bg-black/60 z-50 flex items-center justify-center`
- Modal: `bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-sm p-6`
- Title: "Cancel Simulation"
- Body text: "In-progress conversations will finish, but pending ones will be stopped."
- Buttons: "Keep Running" (secondary) | "Cancel Simulation" (red/destructive)

Replace hardcoded "questions" label with `itemLabel ?? "questions"`.

**Step 2: Show simulation banner on agents page**

In `packages/frontend/src/app/agents/page.tsx`, query the running simulation for the selected agent. Use the existing `simulations` from `SimulationModeLayout` or add a query in the page.

Since `SimulationModeLayout` manages its own state, the simplest approach is to add the banner query in the agents page itself:

```typescript
const simulations = useQuery(
  api.conversationSim.orchestration.byAgent,
  agentId ? { agentId } : "skip",
) ?? [];
const runningSim = simulations.find(
  s => s.status === "running" || s.status === "pending"
);
```

Add `useMutation` for cancel:
```typescript
const cancelSimulation = useMutation(api.conversationSim.orchestration.cancel);
```

Then render `GenerationBanner` between the top bar and main content when `runningSim && mode === "experiment"`:

```tsx
{runningSim && mode === "experiment" && (
  <GenerationBanner
    strategy="Simulation"
    kbName={agents.find(a => a._id === agentId)?.name ?? "Agent"}
    phase="generating"
    processedItems={(runningSim.completedRuns + (runningSim.failedRuns ?? 0))}
    totalItems={runningSim.totalRuns}
    questionsGenerated={runningSim.completedRuns}
    itemLabel="conversations"
    onView={() => { /* select this sim in sidebar */ }}
    onCancel={() => cancelSimulation({ simulationId: runningSim._id })}
  />
)}
```

**Step 3: Verify frontend builds**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/frontend/src/components/GenerationBanner.tsx packages/frontend/src/app/agents/page.tsx
git commit -m "feat(sim): add cancel UI with confirmation modal and simulation banner"
```

---

### Task 8: Scenario Naming and Topic Display

**Files:**
- Modify: `packages/frontend/src/components/conversation-sim/SimScenarioList.tsx`
- Modify: `packages/backend/convex/conversationSim/runs.ts` (add scenario topic to query response)

**Step 1: Enrich `bySimulation` query to include scenario topic**

In `packages/backend/convex/conversationSim/runs.ts`, update the `bySimulation` query to join scenario data:

```typescript
export const bySimulation = query({
  args: { simulationId: v.id("conversationSimulations") },
  handler: async (ctx, { simulationId }) => {
    const { orgId } = await getAuthContext(ctx);
    const sim = await ctx.db.get(simulationId);
    if (!sim || sim.orgId !== orgId) throw new Error("Simulation not found");
    const runs = await ctx.db
      .query("conversationSimRuns")
      .withIndex("by_simulation", (q) => q.eq("simulationId", simulationId))
      .collect();

    // Batch-load scenario topics
    const scenarioIds = [...new Set(runs.map(r => r.scenarioId))];
    const scenarioMap = new Map<string, string>();
    for (const sid of scenarioIds) {
      const scenario = await ctx.db.get(sid);
      if (scenario) scenarioMap.set(sid.toString(), scenario.topic);
    }

    return runs.map(r => ({
      ...r,
      scenarioTopic: scenarioMap.get(r.scenarioId.toString()) ?? "",
    }));
  },
});
```

**Step 2: Update `SimScenarioList` to show SCE-NNN and topic**

In the grouped entries map, replace the "Scenario" label with a sequential ID and topic:

```tsx
{[...grouped.entries()].map(([scenarioId, scenarioRuns], scenarioIndex) => {
  const scenarioLabel = `SCE-${String(scenarioIndex + 1).padStart(3, "0")}`;
  const topic = scenarioRuns[0]?.scenarioTopic;
  // ...
  <span className="text-xs text-text font-medium truncate">
    {scenarioLabel}
  </span>
  {topic && (
    <div className="text-[10px] text-text-dim truncate mt-0.5">
      {topic}
    </div>
  )}
```

**Step 3: Verify both frontend and backend build**

Run: `pnpm typecheck:backend && pnpm -C packages/frontend build`
Expected: Both pass

**Step 4: Commit**

```bash
git add packages/backend/convex/conversationSim/runs.ts packages/frontend/src/components/conversation-sim/SimScenarioList.tsx
git commit -m "feat(sim): add scenario naming (SCE-001) with topic display"
```

---

### Task 9: Two-Phase Scenario List — Conversations Tab

**Files:**
- Modify: `packages/frontend/src/components/conversation-sim/SimScenarioList.tsx`
- Modify: `packages/frontend/src/components/conversation-sim/SimulationModeLayout.tsx`

**Step 1: Add phase tab state to `SimulationModeLayout`**

Add a `phase` state: `const [phase, setPhase] = useState<"conversations" | "evaluation">("conversations")`. Pass it to `SimScenarioList` along with `setPhase` and the simulation record.

Query the simulation record in the layout:
```typescript
const simulation = useQuery(
  api.conversationSim.orchestration.get,
  selectedSimId ? { id: selectedSimId } : "skip",
);
```

Pass to `SimScenarioList`:
```tsx
<SimScenarioList
  simulationId={selectedSimId}
  simulation={simulation}
  selectedRunId={selectedRunId}
  onSelectRun={setSelectedRunId}
  phase={phase}
  onPhaseChange={setPhase}
/>
```

**Step 2: Add tab toggle to `SimScenarioList`**

Add a tab toggle at the top of the scenario list header:

```tsx
<div className="px-3 py-2 border-b border-border bg-bg-elevated/50">
  <div className="flex rounded-md border border-border overflow-hidden">
    <button
      onClick={() => onPhaseChange("conversations")}
      className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${
        phase === "conversations" ? "bg-accent/10 text-accent" : "text-text-dim hover:text-text"
      }`}
    >
      Conversations
    </button>
    <button
      onClick={() => onPhaseChange("evaluation")}
      disabled={simulation?.status !== "completed"}
      className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors ${
        phase === "evaluation" ? "bg-accent/10 text-accent" : "text-text-dim hover:text-text"
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      Evaluation
    </button>
  </div>
</div>
```

**Step 3: Update scenario badges based on phase**

In the Conversations phase, replace the PASS/FAIL badge with a conversation status badge:

```tsx
const allConversationsComplete = scenarioRuns.every(r => r.status === "completed" || r.status === "failed");
const isRunning = scenarioRuns.some(r => r.status === "running");

// Badge in conversations phase:
{phase === "conversations" ? (
  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
    allConversationsComplete
      ? "bg-green-500/15 text-green-400"
      : isRunning
        ? "bg-accent/15 text-accent"
        : "bg-yellow-500/15 text-yellow-400"
  }`}>
    {allConversationsComplete ? "DONE" : isRunning ? "RUNNING" : "PENDING"}
  </span>
) : (
  // Evaluation phase badge (PASS/FAIL) — only show if evaluation has run
  ...existing allPassed logic...
)}
```

**Step 4: Verify frontend builds**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/SimScenarioList.tsx packages/frontend/src/components/conversation-sim/SimulationModeLayout.tsx
git commit -m "feat(sim): add Conversations/Evaluation phase tabs to scenario list"
```

---

### Task 10: Two-Phase Scenario List — Evaluation Tab

**Files:**
- Modify: `packages/frontend/src/components/conversation-sim/SimScenarioList.tsx`

**Step 1: Add evaluation state rendering**

When `phase === "evaluation"`, check `simulation.evaluationStatus`:

- `undefined` or `"not_started"`: Show an "Evaluate" button and empty state
- `"running"`: Show progress dots per scenario
- `"completed"`: Show PASS/FAIL badges with scores (existing logic)

For the "not_started" state, render an evaluate prompt:

```tsx
{phase === "evaluation" && (!simulation?.evaluationStatus || simulation.evaluationStatus === "not_started") && (
  <div className="p-4 text-center space-y-3">
    <p className="text-xs text-text-dim">Conversations complete. Run evaluation to score them.</p>
    <button
      onClick={() => setShowEvalModal(true)}
      className="px-4 py-2 rounded-md text-xs font-semibold bg-accent text-bg-elevated hover:bg-accent/90 transition-colors"
    >
      Evaluate
    </button>
  </div>
)}
```

**Step 2: Add evaluate modal**

Add a small modal (same pattern as confirmation modal) with:
- Evaluator set dropdown (query `api.conversationSim.evaluatorSets.byOrg`)
- "Run Evaluation" button → calls `api.conversationSim.orchestration.startEvaluation`

**Step 3: Show PASS/FAIL badges only in evaluation phase when evaluation is complete**

Move the existing PASS/FAIL badge rendering to only show when `phase === "evaluation" && simulation?.evaluationStatus === "completed"`.

**Step 4: Verify frontend builds**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/SimScenarioList.tsx
git commit -m "feat(sim): add evaluation tab with evaluator set selection modal"
```

---

### Task 11: Update Simulation Sidebar Status Display

**Files:**
- Modify: `packages/frontend/src/components/conversation-sim/SimulationsSidebar.tsx`

**Step 1: Update status display to show two-line status**

Replace the single pass rate display with two lines:

```tsx
<div className="text-[10px] text-text-dim mt-0.5 space-y-0.5">
  <div>
    {sim.status === "completed"
      ? `✓ ${sim.totalRuns} convos`
      : sim.status === "running"
        ? `${sim.completedRuns + (sim.failedRuns ?? 0)}/${sim.totalRuns} convos`
        : sim.status === "cancelled"
          ? `Cancelled · ${sim.completedRuns} convos`
          : `${sim.totalRuns} runs`
    }
  </div>
  <div className="text-text-dim">
    {sim.evaluationStatus === "completed"
      ? `${sim.overallPassRate != null ? `${(sim.overallPassRate * 100).toFixed(0)}% passed` : "Evaluated"}`
      : sim.evaluationStatus === "running"
        ? `Evaluating ${sim.evaluationCompletedRuns ?? 0}/${sim.totalRuns}`
        : "Not evaluated"
    }
  </div>
</div>
```

Also remove the old passRate/isRunning display logic.

**Step 2: Verify frontend builds**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/SimulationsSidebar.tsx
git commit -m "feat(sim): update sidebar to show conversation + evaluation status"
```

---

### Task 12: Final Integration Verification

**Step 1: Full backend type-check**

Run: `pnpm typecheck:backend`
Expected: PASS

**Step 2: Full frontend build**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds

**Step 3: Deploy backend**

Run: `cd packages/backend && npx convex dev --once`
Expected: `Convex functions ready!`

**Step 4: Manual smoke test**

1. Start frontend dev server: `pnpm dev`
2. Go to Agents → Experiment mode
3. Create new simulation (should NOT ask for evaluator set)
4. Verify banner appears with cancel button during simulation run
5. Verify scenario list shows "SCE-001" with topics
6. Verify Conversations tab shows DONE/RUNNING/PENDING badges (not PASS/FAIL)
7. After conversations complete, switch to Evaluation tab
8. Click "Evaluate", select evaluator set, confirm evaluation runs
9. Verify PASS/FAIL badges appear only after evaluation completes
10. Verify sidebar shows two-line status

**Step 5: Final commit if any fixes needed**

```bash
git commit -m "fix: integration fixes from smoke test"
```
