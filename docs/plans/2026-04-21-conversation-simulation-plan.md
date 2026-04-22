# Conversation Simulation System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a system for generating, running, and evaluating multi-turn conversation simulations between an LLM user-simulator and internal Convex AI agents.

**Architecture:** New Convex domain `conversationSim/` with 6 new tables (scenarios, simulations, runs, evaluators, evaluatorSets + schema changes to datasets and conversations). A shared `agentLoop.ts` function extracted from existing agent code enables reuse. WorkPool manages concurrent simulation runs. Frontend adds dataset type toggle + agents page experiment mode for simulation results.

**Tech Stack:** Convex (backend), Next.js 16 (frontend), AI SDK (`generateText`), WorkPool (`@convex-dev/workpool`), OpenAI/Anthropic models for user-simulator and LLM judges.

**Spec:** `docs/superpowers/specs/2026-04-21-conversation-simulation-design.md`

---

## Phase 1: Schema & Shared Infrastructure

### Task 1: Add new tables to Convex schema

**Files:**
- Modify: `packages/backend/convex/schema.ts`

**Step 1: Add the 5 new tables + modify 2 existing tables**

Add to schema.ts after the existing table definitions:

```typescript
// === Conversation Simulation ===

conversationScenarios: defineTable({
  datasetId: v.id("datasets"),
  orgId: v.string(),
  persona: v.object({
    type: v.string(),
    traits: v.array(v.string()),
    communicationStyle: v.string(),
    patienceLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  }),
  topic: v.string(),
  intent: v.string(),
  complexity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  reasonForContact: v.string(),
  knownInfo: v.string(),
  unknownInfo: v.string(),
  instruction: v.string(),
  referenceMessages: v.optional(v.array(v.object({
    role: v.literal("user"),
    content: v.string(),
    turnIndex: v.number(),
  }))),
})
  .index("by_dataset", ["datasetId"])
  .index("by_org", ["orgId"]),

evaluators: defineTable({
  orgId: v.string(),
  name: v.string(),
  description: v.string(),
  type: v.union(v.literal("code"), v.literal("llm_judge")),
  scope: v.union(v.literal("session"), v.literal("turn")),
  codeConfig: v.optional(v.object({
    checkType: v.union(
      v.literal("tool_call_match"),
      v.literal("string_contains"),
      v.literal("regex_match"),
      v.literal("response_format"),
    ),
    params: v.any(),
  })),
  judgeConfig: v.optional(v.object({
    rubric: v.string(),
    passExamples: v.array(v.string()),
    failExamples: v.array(v.string()),
    model: v.string(),
    inputContext: v.array(v.union(
      v.literal("transcript"),
      v.literal("tool_calls"),
      v.literal("kb_documents"),
    )),
  })),
  createdFrom: v.union(v.literal("template"), v.literal("error_analysis"), v.literal("manual")),
  tags: v.array(v.string()),
})
  .index("by_org", ["orgId"]),

evaluatorSets: defineTable({
  orgId: v.string(),
  name: v.string(),
  description: v.string(),
  evaluatorIds: v.array(v.id("evaluators")),
  requiredEvaluatorIds: v.array(v.id("evaluators")),
  passThreshold: v.number(),
})
  .index("by_org", ["orgId"]),

conversationSimulations: defineTable({
  orgId: v.string(),
  userId: v.id("users"),
  datasetId: v.id("datasets"),
  agentId: v.id("agents"),
  evaluatorSetId: v.id("evaluatorSets"),
  k: v.number(),
  passThreshold: v.number(),
  concurrency: v.number(),
  maxTurns: v.number(),
  timeoutMs: v.number(),
  userSimModel: v.string(),
  seed: v.optional(v.number()),
  status: v.union(
    v.literal("pending"), v.literal("running"), v.literal("completed"),
    v.literal("failed"), v.literal("cancelled"),
  ),
  totalRuns: v.number(),
  completedRuns: v.number(),
  failedRuns: v.optional(v.number()),
  overallPassRate: v.optional(v.number()),
  avgScore: v.optional(v.number()),
  workIds: v.optional(v.array(v.string())),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
})
  .index("by_org", ["orgId"])
  .index("by_agent", ["agentId"])
  .index("by_dataset", ["datasetId"]),

conversationSimRuns: defineTable({
  simulationId: v.id("conversationSimulations"),
  scenarioId: v.id("conversationScenarios"),
  agentId: v.id("agents"),
  kIndex: v.number(),
  seed: v.number(),
  conversationId: v.optional(v.id("conversations")),
  status: v.union(
    v.literal("pending"), v.literal("running"),
    v.literal("completed"), v.literal("failed"),
  ),
  terminationReason: v.optional(v.union(
    v.literal("user_stop"), v.literal("agent_stop"),
    v.literal("max_turns"), v.literal("timeout"), v.literal("error"),
  )),
  turnCount: v.optional(v.number()),
  evaluatorResults: v.optional(v.array(v.object({
    evaluatorId: v.id("evaluators"),
    evaluatorName: v.string(),
    passed: v.boolean(),
    justification: v.string(),
    required: v.boolean(),
  }))),
  score: v.optional(v.number()),
  passed: v.optional(v.boolean()),
  toolCallCount: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  latencyMs: v.optional(v.number()),
  annotations: v.optional(v.string()),
})
  .index("by_simulation", ["simulationId"])
  .index("by_scenario", ["scenarioId"])
  .index("by_simulation_scenario", ["simulationId", "scenarioId"]),
```

Modify existing `datasets` table — add optional `type` and `scenarioCount`:
```typescript
// In datasets table definition, add:
type: v.optional(v.union(v.literal("questions"), v.literal("conversation_sim"))),
scenarioCount: v.optional(v.number()),
```

Modify existing `conversations` table — add optional `source`:
```typescript
// In conversations table definition, add:
source: v.optional(v.union(
  v.literal("playground"), v.literal("simulation"), v.literal("experiment"),
)),
```

**Step 2: Register conversationSimPool in convex.config.ts**

```typescript
// In packages/backend/convex/convex.config.ts, add:
app.use(workpool, { name: "conversationSimPool" });
```

**Step 3: Filter playground queries to exclude simulation conversations**

Modify `packages/backend/convex/agents/orchestration.ts` — in `getOrCreatePlayground` (lines 75-107), add a filter to exclude simulation conversations. The current query finds active conversations for an agent; add a check that `source` is undefined or `"playground"`:

```typescript
// In getOrCreatePlayground, after querying active conversations:
const existing = allActive.find(c =>
  c.agentIds.includes(agentId) && (!c.source || c.source === "playground")
);
```

This prevents simulation conversations from appearing as playground conversations.

**Step 4: Deploy schema**

Run: `cd packages/backend && npx convex dev --once`
Expected: Schema deploys successfully with new tables.

**Step 5: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/convex.config.ts packages/backend/convex/agents/orchestration.ts
git commit -m "feat(backend): add conversation simulation schema — 5 new tables, dataset type, conversation source, playground filter"
```

---

### Task 2: Extract shared agent loop from existing runAgent

**Files:**
- Create: `packages/backend/convex/lib/agentLoop.ts`
- Modify: `packages/backend/convex/agents/actions.ts`

**Step 1: Create agentLoop.ts with the shared function**

Extract the core logic from `agents/actions.ts` lines 88-316 into a reusable function. Key differences from existing code:
- Uses `generateText` instead of `streamText` (no streaming needed)
- Returns structured result instead of writing to DB directly
- Same model resolution (anthropic/openai based on model ID prefix)
- Same tool construction pattern (one tool per retriever)
- Same `maxSteps: 5` for tool use loops

```typescript
// packages/backend/convex/lib/agentLoop.ts
"use node";

import { ActionCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { createEmbedder } from "rag-evaluation-system/llm";
import { vectorSearchWithFilter } from "./vectorSearch";
import { composeSystemPrompt } from "../agents/promptTemplate";

// Types matching existing agent infrastructure
export interface RetrieverInfo {
  id: Id<"retrievers">;
  name: string;
  kbName: string;
  kbId: Id<"knowledgeBases">;
  indexConfigHash: string;
  indexStrategy: string;
  embeddingModel: string;
  defaultK: number;
}

export interface AgentLoopConfig {
  modelId: string;
  systemPrompt: string;
  retrieverInfos: RetrieverInfo[];
}

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  retrieverId?: string;
}

export interface AgentLoopResult {
  text: string;
  toolCalls: ToolCallRecord[];
  usage: { promptTokens: number; completionTokens: number };
  done: boolean;       // true if agent produced empty text (no more to say)
  error?: string;
}

function resolveModel(modelId: string) {
  if (/^(gpt-|o1|o3|o4)/.test(modelId)) return openai(modelId);
  return anthropic(modelId);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 64);
}

export async function runAgentLoop(
  ctx: ActionCtx,
  config: AgentLoopConfig,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<AgentLoopResult> {
  const collectedToolCalls: ToolCallRecord[] = [];

  // Build tools from retriever infos (same pattern as agents/actions.ts)
  const tools: Record<string, any> = {};
  for (const info of config.retrieverInfos) {
    const toolName = slugify(info.name);
    tools[toolName] = tool({
      description: `Search ${info.kbName} knowledge base using ${info.name}`,
      parameters: z.object({
        query: z.string().describe("Search query"),
        k: z.number().optional().describe("Number of results"),
      }),
      execute: async ({ query, k }) => {
        const embedder = createEmbedder(info.embeddingModel);
        const queryEmbedding = await embedder.embedQuery(query); // returns number[] directly
        const { chunks } = await vectorSearchWithFilter(ctx, {
          queryEmbedding,
          kbId: info.kbId,
          indexConfigHash: info.indexConfigHash,
          topK: k ?? info.defaultK,
          indexStrategy: info.indexStrategy as "plain" | "parent-child",
        });
        const result = chunks.map((c: any) => ({
          content: c.content,
          documentId: c.documentId,
          start: c.start,
          end: c.end,
        }));
        collectedToolCalls.push({
          toolName,
          args: { query, k },
          result: JSON.stringify(result),
          retrieverId: info.id as string,
        });
        return result;
      },
    });
  }

  try {
    const result = await generateText({
      model: resolveModel(config.modelId),
      system: config.systemPrompt,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      maxSteps: 5,
    });

    return {
      text: result.text,
      toolCalls: collectedToolCalls,
      usage: {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
      },
      done: !result.text || result.text.trim().length === 0,
    };
  } catch (err: any) {
    return {
      text: "",
      toolCalls: collectedToolCalls,
      usage: { promptTokens: 0, completionTokens: 0 },
      done: false,
      error: err.message ?? String(err),
    };
  }
}
```

**Step 2: Share helper functions, do NOT refactor runAgent's streaming**

The existing `runAgent` uses `streamText` for frontend streaming — it CANNOT use `runAgentLoop` (which uses `generateText`). Instead:

- Move `resolveModel()` and `slugify()` from `agents/actions.ts` to `lib/agentLoop.ts` as named exports
- Move the `RetrieverInfo` type definition to `lib/agentLoop.ts`
- Update `agents/actions.ts` to import these helpers from `lib/agentLoop.ts`
- The tool-building pattern is duplicated (streaming version in `agents/actions.ts`, non-streaming in `runAgentLoop`) — this is acceptable since streaming vs non-streaming tool execution differs in how results are reported

Do NOT change `runAgent`'s behavior. Only extract shared utilities.

**Step 3: Verify existing agent playground still works**

Run: `pnpm dev:backend` and test the agent playground manually.
Expected: Agent conversations work identically.

**Step 4: Commit**

```bash
git add packages/backend/convex/lib/agentLoop.ts packages/backend/convex/agents/actions.ts
git commit -m "feat(backend): extract shared agentLoop for simulation reuse"
```

---

### Task 3: Evaluator & EvaluatorSet CRUD

**Files:**
- Create: `packages/backend/convex/conversationSim/evaluators.ts`
- Create: `packages/backend/convex/conversationSim/evaluatorSets.ts`

**Step 1: Create evaluator CRUD**

```typescript
// packages/backend/convex/conversationSim/evaluators.ts
import { query, mutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

export const byOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    return ctx.db.query("evaluators").withIndex("by_org", q => q.eq("orgId", orgId)).collect();
  },
});

export const get = query({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => {
    await getAuthContext(ctx);
    return ctx.db.get(id);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    type: v.union(v.literal("code"), v.literal("llm_judge")),
    scope: v.union(v.literal("session"), v.literal("turn")),
    codeConfig: v.optional(v.object({
      checkType: v.union(v.literal("tool_call_match"), v.literal("string_contains"),
        v.literal("regex_match"), v.literal("response_format")),
      params: v.any(),
    })),
    judgeConfig: v.optional(v.object({
      rubric: v.string(),
      passExamples: v.array(v.string()),
      failExamples: v.array(v.string()),
      model: v.string(),
      inputContext: v.array(v.union(v.literal("transcript"), v.literal("tool_calls"), v.literal("kb_documents"))),
    })),
    createdFrom: v.union(v.literal("template"), v.literal("error_analysis"), v.literal("manual")),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return ctx.db.insert("evaluators", { orgId, ...args });
  },
});

export const update = mutation({
  args: { id: v.id("evaluators"), name: v.optional(v.string()), description: v.optional(v.string()),
    // ... all optional fields for partial update
  },
  handler: async (ctx, { id, ...updates }) => {
    await getAuthContext(ctx);
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(id, filtered);
  },
});

export const remove = mutation({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => {
    await getAuthContext(ctx);
    await ctx.db.delete(id);
  },
});

// Internal queries for actions
export const getInternal = internalQuery({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});
```

**Step 2: Create evaluator set CRUD** (similar pattern — `create`, `get`, `byOrg`, `update`, `remove`, `getInternal`)

**Step 3: Create template evaluator seeding function**

A mutation that creates the 6 template evaluators + a default evaluator set for the org if they don't exist yet. Called lazily when user first visits the simulation UI.

**Step 4: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`

**Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/
git commit -m "feat(backend): evaluator and evaluator set CRUD with template seeding"
```

---

### Task 4: Scenario CRUD

**Files:**
- Create: `packages/backend/convex/conversationSim/scenarios.ts`

**Step 1: Create scenario CRUD**

Mutations: `create`, `update`, `remove`, `byDataset` query, `get` query.
Follow the same auth pattern as evaluators (org-scoped via `getAuthContext`).

The `byDataset` query is the primary list query — returns all scenarios for a dataset.

**Step 2: Add dataset type to existing dataset CRUD**

Modify `packages/backend/convex/crud/datasets.ts`:
- `create` mutation: accept optional `type` param (default "questions")
- `byKb` query: add optional `type` filter parameter
- Add `createSimDataset` mutation for creating conversation_sim type datasets

**Step 3: Commit**

```bash
git add packages/backend/convex/conversationSim/scenarios.ts packages/backend/convex/crud/datasets.ts
git commit -m "feat(backend): scenario CRUD and dataset type support"
```

---

### Task 5: Code evaluator runners

**Files:**
- Create: `packages/backend/convex/conversationSim/evaluation.ts`

**Step 1: Implement code evaluator functions**

Pure functions (no Convex dependencies) that receive conversation data and return pass/fail:

```typescript
// packages/backend/convex/conversationSim/evaluation.ts

interface EvalInput {
  messages: Array<{ role: string; content: string }>;
  toolCalls: Array<{ toolName: string; args: Record<string, any>; result: string }>;
}

interface EvalResult {
  passed: boolean;
  justification: string;
}

export function runToolCallMatch(params: { toolName: string; expectedArgs?: Record<string, any>; matchMode: "exact" | "subset" }, input: EvalInput): EvalResult { ... }

export function runStringContains(params: { target: string; caseSensitive?: boolean; searchIn: "agent_messages" | "all_messages" }, input: EvalInput): EvalResult { ... }

export function runRegexMatch(params: { pattern: string; flags?: string; searchIn: "agent_messages" | "all_messages"; shouldMatch: boolean }, input: EvalInput): EvalResult { ... }

export function runResponseFormat(params: { requireJson?: boolean; requiredFields?: string[] }, input: EvalInput): EvalResult { ... }
```

**Step 2: Implement LLM judge runner**

In the actions file (needs `"use node"` for LLM calls):

```typescript
export async function runLLMJudge(
  judgeConfig: JudgeConfig,
  context: { transcript: string; toolCalls?: string; kbDocuments?: string },
): Promise<EvalResult> {
  // Build judge prompt from rubric + examples + context
  // Call generateText with judge model
  // Parse binary pass/fail + justification from response
}
```

**Step 3: Write tests for code evaluators**

Run: `pnpm -C packages/backend test`

**Step 4: Commit**

```bash
git add packages/backend/convex/conversationSim/evaluation.ts
git commit -m "feat(backend): code evaluator runners and LLM judge function"
```

---

## Phase 2: Simulation Orchestration

### Task 6: Simulation orchestration (start, cancel, status)

**Files:**
- Create: `packages/backend/convex/conversationSim/orchestration.ts`
- Create: `packages/backend/convex/conversationSim/runs.ts`

**Step 1: Create run CRUD** (`runs.ts`)

Queries: `bySimulation`, `bySimulationScenario`, `get`, `getInternal`
Mutations: `createRun` (internal), `updateRun` (internal), `saveEvaluationResults` (internal)

**Step 2: Create orchestration mutations** (`orchestration.ts`)

```typescript
// start: creates simulation + runs, enqueues via WorkPool
export const start = mutation({ ... })

// cancel: cancels all pending work items
export const cancel = mutation({ ... })

// status: returns simulation with computed stats
export const get = query({ ... })

// list: all simulations for org
export const byOrg = query({ ... })

// byAgent: simulations for a specific agent
export const byAgent = query({ ... })

// Internal: WorkPool completion handler
export const onRunComplete = internalMutation({ ... })
```

The `start` mutation:
1. Validates agent is "ready", dataset is type "conversation_sim"
2. Creates `conversationSimulation` record with defaults:
   - `k`: default 1, `passThreshold`: default 0.8, `concurrency`: default 3
   - `maxTurns`: default 20, `timeoutMs`: default 300000
   - `userSimModel`: default "claude-sonnet-4-20250514"
3. Loads all scenarios from dataset
4. Creates `conversationSimRun` records for each scenario × k combination
5. Enqueues `runConversationSimAction` for each run via WorkPool
6. Stores workIds on simulation record

The `onRunComplete` handler:
- Checks `result.kind`: "success" → increment `completedRuns`, "failed" → increment `failedRuns`
- When `completedRuns + failedRuns == totalRuns`:
  - Query all runs for this simulation
  - Compute `overallPassRate` (% of scenarios where ALL k runs passed)
  - Compute `avgScore` (mean of all run scores)
  - Set status to "completed"

**Step 3: Commit**

```bash
git add packages/backend/convex/conversationSim/orchestration.ts packages/backend/convex/conversationSim/runs.ts
git commit -m "feat(backend): simulation orchestration — start, cancel, status, WorkPool integration"
```

---

### Task 7: Simulation action (the core conversation loop)

**Files:**
- Create: `packages/backend/convex/conversationSim/actions.ts`

**Step 1: Implement runConversationSimAction**

This is the single action that runs one full conversation (user-sim ↔ agent) + evaluation. It follows the pseudocode in the spec's "Flow (single action per run)" section.

Key implementation details:
- Load scenario, agent config, evaluator set at start
- Create conversation via internal mutation (source: "simulation")
- Build user-sim system prompt from global template + scenario instruction + reference messages
- Alternate: user-sim `generateText` → save message → agent `runAgentLoop` → save messages
- Check termination after each turn pair
- After loop: run code evaluators + LLM judges
- Save all results via internal mutation

Uses `"use node"` directive. Imports `runAgentLoop` from `../lib/agentLoop`.

**Step 2: Test with a manual scenario**

Create a test scenario in the Convex dashboard, run the action manually, verify conversation is created with messages.

**Step 3: Commit**

```bash
git add packages/backend/convex/conversationSim/actions.ts
git commit -m "feat(backend): conversation simulation action — full loop with evaluation"
```

---

## Phase 3: Scenario Generation

### Task 8: Scenario generation from KB documents (Path A)

**Files:**
- Add generation logic to: `packages/backend/convex/conversationSim/actions.ts`
- Create: `packages/backend/convex/conversationSim/generation.ts` (orchestration mutations)

**Step 1: Implement dimension discovery + scenario generation action**

Single action that:
1. Loads KB documents
2. Calls LLM to discover dimensions (persona types, topics, intents, complexity levels)
3. Generates valid combinations
4. For each combination, generates a full scenario (persona, knownInfo, unknownInfo, instruction)
5. Saves scenarios via internal mutations

**Step 2: Implement generation orchestration**

Mutation to start generation job, track progress, support cancellation. Uses WorkPool (reuse `generationPool` or create dedicated one).

**Step 3: Commit**

```bash
git add packages/backend/convex/conversationSim/
git commit -m "feat(backend): scenario generation from KB documents"
```

---

## Phase 4: Frontend — Dataset Page

### Task 9: Dataset type toggle on dataset page

**Files:**
- Modify: `packages/frontend/src/app/dataset/page.tsx`

**Step 1: Add type toggle state and filtering**

Add `datasetType` state (`"questions" | "conversation_sim"`, default "questions"). Add toggle buttons styled like the Experiment Type toggle on agents page. Filter `kbDatasets` by type before passing to dropdown.

**Step 2: Conditionally render content based on type**

When `datasetType === "questions"`: current behavior (QuestionList + DocumentViewer).
When `datasetType === "conversation_sim"`: ScenarioList + ScenarioDetail (new components, built in next tasks).

**Step 3: Update "+ New Generation" button text**

Shows "+ Generate Scenarios" when conversation_sim is active.

**Step 4: Commit**

```bash
git add packages/frontend/src/app/dataset/page.tsx
git commit -m "feat(frontend): dataset type toggle on dataset page"
```

---

### Task 10: ScenarioList component

**Files:**
- Create: `packages/frontend/src/components/ScenarioList.tsx`

**Step 1: Build scenario list component**

Displays scenarios with: title, persona/topic/complexity tags (colored), evaluator count. Selected state with left border accent. Matches QuestionList visual style.

**Step 2: Commit**

```bash
git add packages/frontend/src/components/ScenarioList.tsx
git commit -m "feat(frontend): ScenarioList component for conversation sim datasets"
```

---

### Task 11: ScenarioDetail component

**Files:**
- Create: `packages/frontend/src/components/ScenarioDetail.tsx`

**Step 1: Build scenario detail panel**

Displays full scenario: persona chips, scenario chips, known/unknown info (side-by-side), instruction (code block), reference messages (indented with role labels), evaluation criteria (typed badges). Edit button placeholder.

**Step 2: Commit**

```bash
git add packages/frontend/src/components/ScenarioDetail.tsx
git commit -m "feat(frontend): ScenarioDetail component with full scenario view"
```

---

### Task 12: Scenario editor modal

**Files:**
- Create: `packages/frontend/src/components/EditScenarioModal.tsx`

**Step 1: Build edit modal**

Split-panel modal (like EditQuestionModal pattern). Editable fields: persona (type, traits, style, patience), topic, intent, complexity, reasonForContact, knownInfo, unknownInfo, instruction (textarea), reference messages (add/remove/reorder). "Regenerate Instruction" button calls LLM to re-synthesize instruction from metadata.

**Step 2: Commit**

```bash
git add packages/frontend/src/components/EditScenarioModal.tsx
git commit -m "feat(frontend): scenario editor modal with instruction regeneration"
```

---

### Task 13: Scenario generation wizard

**Files:**
- Create: `packages/frontend/src/components/ScenarioGenerationWizard.tsx`

**Step 1: Build generation wizard modal**

Config inputs: number of scenarios, complexity distribution, topic focus (optional). Start generation button. Progress tracking (reuses GenerationBanner pattern). Launched from "+ Generate Scenarios" button.

**Step 2: Commit**

```bash
git add packages/frontend/src/components/ScenarioGenerationWizard.tsx
git commit -m "feat(frontend): scenario generation wizard for conversation sim datasets"
```

---

## Phase 5: Frontend — Agents Page Experiment Mode

### Task 14: Create simulation modal

**Files:**
- Create: `packages/frontend/src/components/conversation-sim/CreateSimulationModal.tsx`

**Step 1: Build config modal**

Fields: agent (pre-selected), scenario dataset dropdown (conversation_sim only), evaluator set dropdown, k, pass threshold, concurrency, max turns, timeout. Total runs calculation display. Start Simulation button.

**Step 2: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/
git commit -m "feat(frontend): create simulation modal with config options"
```

---

### Task 15: Simulation results — 3-pane layout

**Files:**
- Create: `packages/frontend/src/components/conversation-sim/SimulationModeLayout.tsx`
- Create: `packages/frontend/src/components/conversation-sim/SimulationsSidebar.tsx`
- Create: `packages/frontend/src/components/conversation-sim/SimScenarioList.tsx`
- Create: `packages/frontend/src/components/conversation-sim/SimRunDetail.tsx`

**Step 1: Build SimulationsSidebar**

Lists past simulations for the agent. Shows: dataset name, date, k value, pass rate (colored). Selected state.

**Step 2: Build SimScenarioList**

Lists scenarios for selected simulation. Shows: title, persona/topic tags, pass@k badge, per-run score dots (colored circles). Selected state.

**Step 3: Build SimRunDetail**

Right pane showing: run tabs (Run 1, Run 2, Run 3 with scores), conversation transcript (user/agent messages with tool calls), evaluation breakdown (per-evaluator pass/fail with justification), overall score.

**Step 4: Build SimulationModeLayout**

Composes the 3 panes with resizable dividers. Handles loading states, empty states. Progress banner for running simulations.

**Step 5: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/
git commit -m "feat(frontend): simulation results 3-pane layout with transcript and evaluation"
```

---

### Task 16: Wire simulation mode into agents page

**Files:**
- Modify: `packages/frontend/src/app/agents/page.tsx`

**Step 1: Replace ExperimentModeLayout with SimulationModeLayout**

When mode === "experiment", render SimulationModeLayout instead of (or alongside) ExperimentModeLayout. Change "+ New Experiment" button to "+ New Simulation".

Note: We may want to keep the existing agent experiment UI temporarily. Decide at implementation time based on user's guidance. The simplest approach: replace entirely with simulation mode.

**Step 2: Commit**

```bash
git add packages/frontend/src/app/agents/page.tsx
git commit -m "feat(frontend): wire simulation mode into agents page experiment tab"
```

---

## Phase 6: Integration & Polish

### Task 17: Evaluator management UI

**Files:**
- Create: `packages/frontend/src/components/conversation-sim/EvaluatorManager.tsx`

**Step 1: Build evaluator list + create/edit UI**

Simple list of evaluators with create button. Form for creating code evaluators (select check type, configure params) and LLM judge evaluators (write rubric, add examples, select model). Evaluator set management (select evaluators, mark required).

Accessible from the simulation config modal or a dedicated section.

**Step 2: Commit**

```bash
git add packages/frontend/src/components/conversation-sim/EvaluatorManager.tsx
git commit -m "feat(frontend): evaluator and evaluator set management UI"
```

---

### Task 18: End-to-end test

**Step 1: Full manual test flow**

1. Go to Dataset page → switch to Conversation Sim
2. Generate scenarios from KB documents
3. Review/edit scenarios
4. Go to Agents page → Experiment mode
5. Create new simulation (select dataset, evaluator set, k=2)
6. Watch progress, verify results
7. Drill into failed scenario, review transcript + evaluation

**Step 2: Fix any issues found**

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: end-to-end polish for conversation simulation system"
```

---

### Task 19: Retrievers page — filter to questions datasets only

**Files:**
- Modify: `packages/frontend/src/app/experiments/page.tsx` (if retriever experiments reference datasets)
- Modify: `packages/frontend/src/app/retrievers/page.tsx` (if experiment mode references datasets)

**Step 1: Ensure retriever experiment dataset selectors only show questions-type datasets**

Add a filter: `datasets.filter(d => !d.type || d.type === "questions")` in any dataset dropdown used for retriever experiments. This ensures conversation_sim datasets don't appear where they shouldn't.

**Step 2: Commit**

```bash
git add packages/frontend/src/app/
git commit -m "fix(frontend): filter retriever experiment datasets to questions type only"
```

---

## Implementation Order & Dependencies

```
Phase 1 (schema + infra):     Task 1 → Task 2 → Task 3 → Task 4 → Task 5
Phase 2 (orchestration):      Task 6 → Task 7
Phase 3 (generation):         Task 8
Phase 4 (frontend dataset):   Task 9 → Task 10 → Task 11 → Task 12 → Task 13
Phase 5 (frontend agents):    Task 14 → Task 15 → Task 16
Phase 6 (polish):             Task 17 → Task 18 → Task 19

Parallelizable:
- Phase 3 can run in parallel with Phase 4
- Phase 4 and Phase 5 frontend code can be built in parallel
  (but Phase 5 cannot be TESTED until Phase 2 backend is done)
- Task 17 can run in parallel with Task 16
```
