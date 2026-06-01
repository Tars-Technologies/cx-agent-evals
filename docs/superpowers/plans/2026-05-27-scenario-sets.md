# Scenario Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `scenarioSets` so that every scenario lives in an immutable named batch and the New Simulation modal can run reproducibly against a chosen set.

**Architecture:** A new `scenarioSets` table groups `conversationScenarios` (set is created at generation start, scenarios get a required `scenarioSetId`, set is immutable after generation completes). The simulation start mutation switches from "load all scenarios for agent" to "load all scenarios for the chosen set". The scenarios route becomes a two-level UX (sets list → set detail). Existing conversationSim data is wiped on deploy — no migration code.

**Tech Stack:** Convex (backend + schema), Next.js App Router (frontend), TypeScript strict, convex-test for integration tests, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-27-scenario-sets-design.md`

---

## File map

**Create:**
- `packages/backend/convex/conversationSim/scenarioSets.ts` — public queries (`byAgent`, `get`), public mutation (`remove`), internal mutations (`createInternal`, `patchCount`).
- `packages/backend/convex/conversationSim/wipe.ts` — one-shot internal mutation that clears `conversationScenarios`, `conversationSimulations`, `conversationSimRuns`, `scenarioGenJobs`. Run manually post-deploy.
- `packages/backend/tests/conversationSim/scenarioSets.test.ts` — convex-test integration tests for set CRUD + cascade-on-delete + referential integrity.
- `packages/backend/tests/conversationSim/orchestrationStart.test.ts` — convex-test integration tests for the rewired `start` mutation.
- `packages/frontend/src/app/agents/[id]/evaluate/scenarios/[setId]/page.tsx` — set detail page (scenarios scoped to one set).
- `packages/frontend/src/components/CreateSimulationModal.tsx` — rebuilt simulation modal.

**Modify:**
- `packages/backend/convex/schema.ts` — add `scenarioSets`, add `scenarioSetId` fields, narrow `conversationScenarios.source` union (drop `manual`, widen set source to include `mixed`), add `by_set` index.
- `packages/backend/convex/conversationSim/scenarios.ts` — remove `create`, `remove`, `update` public mutations; add `bySet` query; adjust `byAgent` to still work for impact analysis.
- `packages/backend/convex/conversationSim/generation.ts` — `startGeneration` now creates the set before the job, passes both ids to the action; cancel path deletes the partial set.
- `packages/backend/convex/conversationSim/generationActions.ts` — generation action tags each inserted scenario with `scenarioSetId` and patches `scenarioCount` on completion.
- `packages/backend/convex/conversationSim/orchestration.ts` — `start` takes `scenarioSetId`, validates set, loads scenarios via `by_set`, persists `scenarioSetId` on the simulation row.
- `packages/frontend/src/app/agents/[id]/evaluate/scenarios/page.tsx` — becomes the sets list; remove "+ Add scenario" UI and `ManualScenarioModal`.
- `packages/frontend/src/app/agents/[id]/evaluate/experiments/page.tsx` — drop `ComingSoonModal`, mount `CreateSimulationModal`, gate on set count not scenario count, show set name on each row.
- `packages/frontend/src/app/agents/[id]/evaluate/experiments/[simulationId]/page.tsx` — show "Scenario set: [name]" with link.
- `packages/frontend/src/components/ScenarioGenerationWizard.tsx` — no signature change needed; relies on `startGeneration` returning `{ jobId, scenarioSetId }`.

---

## Phase 1 — Schema & wipe

### Task 1: Add `scenarioSets` table + new fields + narrow source union

**Files:**
- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1: Add the new table and modify existing tables**

In `packages/backend/convex/schema.ts`, add the table and field changes. The full additions/edits:

```ts
// NEW table, added near the other conversationSim tables
scenarioSets: defineTable({
  orgId: v.string(),
  agentId: v.id("agents"),
  name: v.string(),
  source: v.union(
    v.literal("synthetic"),
    v.literal("grounded"),
    v.literal("mixed"),
  ),
  generationConfig: v.object({
    kbId: v.optional(v.id("knowledgeBases")),
    transcriptUploadId: v.optional(v.id("livechatUploads")),
    transcriptConversationIds: v.optional(
      v.array(v.id("livechatConversations")),
    ),
    targetCount: v.number(),
    distribution: v.optional(v.number()),
    fidelity: v.optional(v.number()),
    complexityDistribution: v.optional(
      v.object({ low: v.number(), medium: v.number(), high: v.number() }),
    ),
    model: v.optional(v.string()),
  }),
  scenarioCount: v.number(),
  generationJobId: v.id("scenarioGenJobs"),
  createdAt: v.number(),
})
  .index("by_agent", ["agentId"])
  .index("by_org", ["orgId"]),
```

In `conversationScenarios`:
- Add required field: `scenarioSetId: v.id("scenarioSets"),`
- Narrow `source` union — remove the `{ kind: "manual" }` member. Final union:
  ```ts
  source: v.union(
    v.object({ kind: v.literal("synthetic"), kbId: v.id("knowledgeBases") }),
    v.object({ kind: v.literal("grounded"), transcriptUploadId: v.id("livechatUploads") }),
  ),
  ```
- Add index: `.index("by_set", ["scenarioSetId"])`

In `conversationSimulations`:
- Add required field: `scenarioSetId: v.id("scenarioSets"),`

In `scenarioGenJobs`:
- Add required field: `scenarioSetId: v.id("scenarioSets"),`

- [ ] **Step 2: Typecheck the schema**

Run: `pnpm typecheck:backend`
Expected: PASS. If failures appear in non-schema files, that's fine — Phase 2 will wipe data and later tasks update callers. Schema file itself must typecheck.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add scenarioSets table + scenarioSetId fields"
```

---

### Task 2: One-shot wipe mutation

**Files:**
- Create: `packages/backend/convex/conversationSim/wipe.ts`

- [ ] **Step 1: Write the wipe mutation**

```ts
import { internalMutation } from "../_generated/server";

// One-shot wipe of all conversationSim data. Run manually via the Convex
// dashboard after deploying the scenarioSets schema change. New schema fields
// are required, so existing rows would fail validation — clear them first.
export const wipeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "conversationSimRuns",
      "conversationSimulations",
      "conversationScenarios",
      "scenarioGenJobs",
    ] as const;
    for (const table of tables) {
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
      }
    }
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck:backend`
Expected: PASS for this file. Other files still failing is OK at this phase.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/conversationSim/wipe.ts
git commit -m "feat(backend): add one-shot wipe mutation for scenarioSets rollout"
```

> **Operational note:** After the rest of the plan is implemented and deployed, run `npx convex run conversationSim/wipe:wipeAll` once against the target deployment before users hit the new schema. Until then, existing rows lacking `scenarioSetId` will fail validation on read.

---

## Phase 2 — Backend `scenarioSets` module

### Task 3: `scenarioSets.ts` — internal create + count patch

**Files:**
- Create: `packages/backend/convex/conversationSim/scenarioSets.ts`
- Test: `packages/backend/tests/conversationSim/scenarioSets.test.ts`

- [ ] **Step 1: Write failing test — set is created and count is patched**

In `packages/backend/tests/conversationSim/scenarioSets.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { internal, api } from "../../convex/_generated/api";
import { setupTest, seedUser, testIdentity } from "../helpers";

describe("scenarioSets", () => {
  test("createInternal inserts a set with count=0; patchCount updates it", async () => {
    const t = convexTest(schema);
    const { orgId } = await setupTest(t);
    const agentId = await t.run(async (ctx) =>
      ctx.db.insert("agents", {
        orgId,
        name: "A",
        status: "ready",
        // Other required agent fields — copy from existing seedAgent helper if present.
      } as any),
    );

    const jobId = await t.run(async (ctx) =>
      ctx.db.insert("scenarioGenJobs", {
        orgId,
        agentId,
        scenarioSetId: "placeholder" as any, // patched after set creation in real flow
        status: "running",
        targetCount: 5,
        generatedCount: 0,
        createdAt: Date.now(),
      } as any),
    );

    const setId = await t.mutation(
      internal.conversationSim.scenarioSets.createInternal,
      {
        orgId,
        agentId,
        name: "Test",
        source: "synthetic",
        generationConfig: { targetCount: 5 },
        generationJobId: jobId,
      },
    );

    const set1 = await t.run((ctx) => ctx.db.get(setId));
    expect(set1?.scenarioCount).toBe(0);

    await t.mutation(internal.conversationSim.scenarioSets.patchCount, {
      id: setId,
      scenarioCount: 5,
    });

    const set2 = await t.run((ctx) => ctx.db.get(setId));
    expect(set2?.scenarioCount).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm -C packages/backend test -- conversationSim/scenarioSets`
Expected: FAIL — function `scenarioSets.createInternal` not found.

- [ ] **Step 3: Implement the module (internal surface)**

In `packages/backend/convex/conversationSim/scenarioSets.ts`:

```ts
import { v } from "convex/values";
import {
  internalMutation,
  query,
  mutation,
} from "../_generated/server";
import { getAuthContext } from "../lib/auth";

const generationConfigValidator = v.object({
  kbId: v.optional(v.id("knowledgeBases")),
  transcriptUploadId: v.optional(v.id("livechatUploads")),
  transcriptConversationIds: v.optional(
    v.array(v.id("livechatConversations")),
  ),
  targetCount: v.number(),
  distribution: v.optional(v.number()),
  fidelity: v.optional(v.number()),
  complexityDistribution: v.optional(
    v.object({ low: v.number(), medium: v.number(), high: v.number() }),
  ),
  model: v.optional(v.string()),
});

const sourceValidator = v.union(
  v.literal("synthetic"),
  v.literal("grounded"),
  v.literal("mixed"),
);

export const createInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentId: v.id("agents"),
    name: v.string(),
    source: sourceValidator,
    generationConfig: generationConfigValidator,
    generationJobId: v.id("scenarioGenJobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("scenarioSets", {
      ...args,
      scenarioCount: 0,
      createdAt: Date.now(),
    });
  },
});

export const patchCount = internalMutation({
  args: {
    id: v.id("scenarioSets"),
    scenarioCount: v.number(),
  },
  handler: async (ctx, { id, scenarioCount }) => {
    await ctx.db.patch(id, { scenarioCount });
  },
});

export const deleteInternal = internalMutation({
  args: { id: v.id("scenarioSets") },
  handler: async (ctx, { id }) => {
    const scenarios = await ctx.db
      .query("conversationScenarios")
      .withIndex("by_set", (q) => q.eq("scenarioSetId", id))
      .collect();
    for (const s of scenarios) await ctx.db.delete(s._id);
    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pnpm -C packages/backend test -- conversationSim/scenarioSets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/scenarioSets.ts \
        packages/backend/tests/conversationSim/scenarioSets.test.ts
git commit -m "feat(backend): scenarioSets internal create/patch/delete"
```

---

### Task 4: `scenarioSets.ts` — public queries and `remove`

**Files:**
- Modify: `packages/backend/convex/conversationSim/scenarioSets.ts`
- Modify: `packages/backend/tests/conversationSim/scenarioSets.test.ts`

- [ ] **Step 1: Add failing tests — byAgent, get, remove (allowed and blocked)**

Append to `scenarioSets.test.ts`:

```ts
test("byAgent returns org-scoped sets for an agent", async () => {
  const t = convexTest(schema);
  const { orgId, identity } = await setupTest(t);
  // ... seed agent A and B, two sets on A, one on B, then:
  const asUser = t.withIdentity(identity);
  const list = await asUser.query(api.conversationSim.scenarioSets.byAgent, {
    agentId: agentA,
  });
  expect(list).toHaveLength(2);
});

test("remove deletes set + its scenarios when no simulations reference it", async () => {
  // ... seed set + 3 scenarios, call remove, assert set + scenarios gone
});

test("remove throws when a simulation references the set", async () => {
  // ... seed set + simulation pointing at it, call remove, expect throw
});
```

> **Note for engineer:** The test helpers (`seedUser`, `testIdentity`) live in `packages/backend/tests/helpers.ts`. Mirror the seeding patterns from existing tests in that directory.

- [ ] **Step 2: Run tests; confirm failures**

Run: `pnpm -C packages/backend test -- conversationSim/scenarioSets`
Expected: 3 new failing tests.

- [ ] **Step 3: Implement public surface**

Append to `packages/backend/convex/conversationSim/scenarioSets.ts`:

```ts
export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    return ctx.db
      .query("scenarioSets")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("scenarioSets") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const set = await ctx.db.get(id);
    if (!set || set.orgId !== orgId) return null;
    return set;
  },
});

export const remove = mutation({
  args: { id: v.id("scenarioSets") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const set = await ctx.db.get(id);
    if (!set || set.orgId !== orgId) throw new Error("Set not found");

    const dependentSim = await ctx.db
      .query("conversationSimulations")
      .withIndex("by_agent", (q) => q.eq("agentId", set.agentId))
      .filter((q) => q.eq(q.field("scenarioSetId"), id))
      .first();
    if (dependentSim) {
      throw new Error(
        "Cannot delete a scenario set referenced by a simulation",
      );
    }

    const scenarios = await ctx.db
      .query("conversationScenarios")
      .withIndex("by_set", (q) => q.eq("scenarioSetId", id))
      .collect();
    for (const s of scenarios) await ctx.db.delete(s._id);
    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 4: Run tests; confirm pass**

Run: `pnpm -C packages/backend test -- conversationSim/scenarioSets`
Expected: PASS for all four tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/scenarioSets.ts \
        packages/backend/tests/conversationSim/scenarioSets.test.ts
git commit -m "feat(backend): scenarioSets public byAgent/get/remove with integrity check"
```

---

## Phase 3 — Rewire generation

### Task 5: `generation.startGeneration` creates a set up-front

**Files:**
- Modify: `packages/backend/convex/conversationSim/generation.ts`

- [ ] **Step 1: Update the mutation to create a set, then a job pointing at it**

In `startGeneration`, replace the job-creation section. Insert a set first, then the job referencing the set. Also derive the `source` for the set:

```ts
// Inside startGeneration handler, AFTER input validation and BEFORE inserting the job:

const hasKb = !!args.kbId;
const hasTranscripts =
  !!args.transcriptUploadId &&
  (args.transcriptConversationIds?.length ?? 0) > 0;
const distributionPct = args.distribution ?? (hasTranscripts ? 50 : 0);
const isMixed =
  hasKb && hasTranscripts && distributionPct > 0 && distributionPct < 100;
const source: "synthetic" | "grounded" | "mixed" = isMixed
  ? "mixed"
  : hasTranscripts && distributionPct === 100
    ? "grounded"
    : "synthetic";

const now = new Date();
const setName = `${source[0].toUpperCase()}${source.slice(1)} – ${now.toLocaleString(
  "en-US",
  { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
)}`;

// Create the job first with a placeholder ID, then create the set, then patch
// the job to point at the set. (Convex doesn't support nested-insert refs.)
const jobId = await ctx.db.insert("scenarioGenJobs", {
  orgId,
  agentId: args.agentId,
  scenarioSetId: undefined as unknown as Id<"scenarioSets">, // patched below
  kbId: args.kbId,
  transcriptUploadId: args.transcriptUploadId,
  status: "running",
  targetCount: count,
  generatedCount: 0,
  createdAt: Date.now(),
  transcriptUploadIds,
  transcriptConversationIds: args.transcriptConversationIds,
  distribution: distributionPct,
  fidelity: args.fidelity,
});

const scenarioSetId = await ctx.db.insert("scenarioSets", {
  orgId,
  agentId: args.agentId,
  name: setName,
  source,
  generationConfig: {
    kbId: args.kbId,
    transcriptUploadId: args.transcriptUploadId,
    transcriptConversationIds: args.transcriptConversationIds,
    targetCount: count,
    distribution: distributionPct,
    fidelity: args.fidelity,
    complexityDistribution: args.complexityDistribution,
    model: args.model,
  },
  scenarioCount: 0,
  generationJobId: jobId,
  createdAt: Date.now(),
});

await ctx.db.patch(jobId, { scenarioSetId });
```

Make `scenarioSetId` in `scenarioGenJobs` schema **optional** for the duration of this patch-after-insert pattern, OR (preferred) use `ctx.db.insert("scenarioSets", …)` first with `generationJobId` left to-be-patched in the same shape. Pick the simpler one: **insert the set first, leaving `generationJobId` as a stub, insert the job, patch the set.** Final code:

```ts
// Insert the set first (generationJobId patched after job insert)
const scenarioSetId = await ctx.db.insert("scenarioSets", {
  orgId,
  agentId: args.agentId,
  name: setName,
  source,
  generationConfig: {
    kbId: args.kbId,
    transcriptUploadId: args.transcriptUploadId,
    transcriptConversationIds: args.transcriptConversationIds,
    targetCount: count,
    distribution: distributionPct,
    fidelity: args.fidelity,
    complexityDistribution: args.complexityDistribution,
    model: args.model,
  },
  scenarioCount: 0,
  generationJobId: undefined as unknown as Id<"scenarioGenJobs">,
  createdAt: Date.now(),
});

const jobId = await ctx.db.insert("scenarioGenJobs", {
  orgId,
  agentId: args.agentId,
  scenarioSetId,
  kbId: args.kbId,
  transcriptUploadId: args.transcriptUploadId,
  status: "running",
  targetCount: count,
  generatedCount: 0,
  createdAt: Date.now(),
  transcriptUploadIds,
  transcriptConversationIds: args.transcriptConversationIds,
  distribution: distributionPct,
  fidelity: args.fidelity,
});

await ctx.db.patch(scenarioSetId, { generationJobId: jobId });
```

To make the `undefined as unknown as Id<…>` step work, **`generationJobId` on `scenarioSets` must be optional in the schema**. Update Task 1's schema definition retroactively: change `generationJobId: v.id("scenarioGenJobs")` to `generationJobId: v.optional(v.id("scenarioGenJobs"))`. (If this plan is being implemented strictly in order, fix this now via a small follow-up commit to Task 1's schema edit.)

Then enqueue the existing pool action, passing both ids in the work context:

```ts
const workId = await pool.enqueueAction(
  ctx,
  internal.conversationSim.generationActions.runGeneration,
  { jobId, scenarioSetId },
  {
    context: { jobId, scenarioSetId },
    onComplete: internal.conversationSim.generation.onGenerationComplete,
  },
);
```

Return `{ jobId, scenarioSetId }` instead of just `jobId`.

- [ ] **Step 2: Make `generationJobId` optional in `scenarioSets` schema**

In `packages/backend/convex/schema.ts`, change:

```ts
generationJobId: v.id("scenarioGenJobs"),
```

to:

```ts
generationJobId: v.optional(v.id("scenarioGenJobs")),
```

- [ ] **Step 3: Update the on-complete callback to patch `scenarioCount`**

In the existing `onGenerationComplete` (or equivalent) handler in `generation.ts`, after the job is marked complete, query scenarios for the set and patch the count:

```ts
const count = await ctx.db
  .query("conversationScenarios")
  .withIndex("by_set", (q) => q.eq("scenarioSetId", scenarioSetId))
  .collect()
  .then((s) => s.length);
await ctx.db.patch(scenarioSetId, { scenarioCount: count });
```

If the job failed and produced zero scenarios, also delete the empty set so the UI doesn't show a useless row:

```ts
if (count === 0 && result.kind === "failed") {
  await ctx.db.delete(scenarioSetId);
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck:backend`
Expected: PASS for `generation.ts`. Generation action file (next task) may still fail until updated.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/generation.ts packages/backend/convex/schema.ts
git commit -m "feat(backend): generation creates a scenarioSet and patches count on complete"
```

---

### Task 6: Generation action writes `scenarioSetId` on each scenario

**Files:**
- Modify: `packages/backend/convex/conversationSim/generationActions.ts`
- Modify: `packages/backend/convex/conversationSim/scenarios.ts`

- [ ] **Step 1: Update `scenarios.createInternal` to require `scenarioSetId`**

In `packages/backend/convex/conversationSim/scenarios.ts`, modify `createInternal`'s args:

```ts
export const createInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentId: v.id("agents"),
    scenarioSetId: v.id("scenarioSets"),  // NEW
    source: sourceValidator,
    ...contentFields,
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversationScenarios", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
```

Also narrow the file-local `sourceValidator` to drop the `manual` variant:

```ts
const sourceValidator = v.union(
  v.object({ kind: v.literal("synthetic"), kbId: v.id("knowledgeBases") }),
  v.object({
    kind: v.literal("grounded"),
    transcriptUploadId: v.id("livechatUploads"),
  }),
);
```

- [ ] **Step 2: Update `generationActions.ts` to pass `scenarioSetId` on every scenario insert**

Search the file for calls to `ctx.runMutation(internal.conversationSim.scenarios.createInternal, …)` (or `internal.conversationSim.scenarios.create…`) and add `scenarioSetId` to each call.

The action receives `scenarioSetId` from its args (the enqueue site updated in Task 5). Plumb it through any helper functions in the file.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck:backend`
Expected: PASS for both files. Other backend files may still error — fix in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/conversationSim/generationActions.ts \
        packages/backend/convex/conversationSim/scenarios.ts
git commit -m "feat(backend): tag generated scenarios with scenarioSetId"
```

---

### Task 7: Remove public scenario mutations (manual create / update / remove)

**Files:**
- Modify: `packages/backend/convex/conversationSim/scenarios.ts`

- [ ] **Step 1: Delete the `create`, `update`, and `remove` exports**

In `packages/backend/convex/conversationSim/scenarios.ts`, remove the three public mutations (manual scenario surface is dropped per the spec). Keep `createInternal`, `getInternal`, `get`, `getMaybe`, `byAgent`, `byKb`, `byTranscriptUpload`. Add a new query:

```ts
export const bySet = query({
  args: { scenarioSetId: v.id("scenarioSets") },
  handler: async (ctx, { scenarioSetId }) => {
    const { orgId } = await getAuthContext(ctx);
    const set = await ctx.db.get(scenarioSetId);
    if (!set || set.orgId !== orgId) throw new Error("Set not found");
    return ctx.db
      .query("conversationScenarios")
      .withIndex("by_set", (q) => q.eq("scenarioSetId", scenarioSetId))
      .collect();
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck:backend`
Expected: PASS for this file. The frontend will break (manual modal references `scenarios.create`); we fix it in Phase 5.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/conversationSim/scenarios.ts
git commit -m "feat(backend): drop public scenario mutations; add bySet query"
```

---

## Phase 4 — Rewire orchestration

### Task 8: `orchestration.start` takes `scenarioSetId`

**Files:**
- Modify: `packages/backend/convex/conversationSim/orchestration.ts`
- Create: `packages/backend/tests/conversationSim/orchestrationStart.test.ts`

- [ ] **Step 1: Write failing test — start requires scenarioSetId and loads set scenarios**

In the new test file, write three tests:

```ts
test("start throws when scenarioSetId doesn't belong to the agent", async () => {
  // seed set A on agentA, agentB without sets
  // call start with { agentId: agentB, scenarioSetId: setA }
  // expect throw "Scenario set not found"
});

test("start loads scenarios from the set, not from the agent", async () => {
  // seed agentA with two sets: setX (3 scenarios), setY (2 scenarios)
  // call start({ agentId: agentA, scenarioSetId: setX, k: 1 })
  // assert simulation.totalRuns === 3 (NOT 5)
  // assert simulation.scenarioSetId === setX
});

test("start throws if the set is empty", async () => {
  // seed set with zero scenarios
  // call start; expect throw "Scenario set has no scenarios"
});
```

- [ ] **Step 2: Run tests; confirm failures**

Run: `pnpm -C packages/backend test -- conversationSim/orchestrationStart`
Expected: FAIL — argument mismatch / function behavior.

- [ ] **Step 3: Update the `start` mutation**

In `packages/backend/convex/conversationSim/orchestration.ts`, change the `args` and `handler`:

```ts
export const start = mutation({
  args: {
    agentId: v.id("agents"),
    scenarioSetId: v.id("scenarioSets"),  // NEW required
    k: v.optional(v.number()),
    passThreshold: v.optional(v.number()),
    concurrency: v.optional(v.number()),
    maxTurns: v.optional(v.number()),
    timeoutMs: v.optional(v.number()),
    userSimModel: v.optional(v.string()),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    if (agent.status !== "ready") throw new Error("Agent is not ready");

    const set = await ctx.db.get(args.scenarioSetId);
    if (!set || set.orgId !== orgId || set.agentId !== args.agentId) {
      throw new Error("Scenario set not found");
    }

    const user = await lookupUser(ctx, userId);

    const k = args.k ?? 1;
    const maxTurns = args.maxTurns ?? 5;
    const timeoutMs = args.timeoutMs ?? 120000;
    const concurrency = args.concurrency ?? 2;
    const userSimModel = args.userSimModel ?? "claude-sonnet-4-20250514";

    const scenarios = await ctx.db
      .query("conversationScenarios")
      .withIndex("by_set", (q) => q.eq("scenarioSetId", args.scenarioSetId))
      .collect();
    if (scenarios.length === 0) {
      throw new Error("Scenario set has no scenarios");
    }

    const totalRuns = scenarios.length * k;
    const simulationId = await ctx.db.insert("conversationSimulations", {
      orgId,
      userId: user._id,
      agentId: args.agentId,
      scenarioSetId: args.scenarioSetId,  // NEW
      k,
      concurrency,
      maxTurns,
      timeoutMs,
      userSimModel,
      seed: args.seed,
      status: "running",
      totalRuns,
      completedRuns: 0,
      failedRuns: 0,
      startedAt: Date.now(),
    });

    // Rest of body unchanged: enqueue runs, store workIds, return simulationId
    // ...
  },
});
```

- [ ] **Step 4: Run tests; confirm pass**

Run: `pnpm -C packages/backend test -- conversationSim/orchestrationStart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/conversationSim/orchestration.ts \
        packages/backend/tests/conversationSim/orchestrationStart.test.ts
git commit -m "feat(backend): orchestration.start requires scenarioSetId"
```

---

### Task 9: Backend-wide typecheck

- [ ] **Step 1: Verify backend typechecks end-to-end**

Run: `pnpm typecheck:backend`
Expected: PASS (no errors). If errors remain in `agents/`, `evaluator/`, or other files that referenced removed scenario mutations or the `manual` source variant, fix them inline — they are downstream of the schema narrowing.

- [ ] **Step 2: Run all backend tests**

Run: `pnpm -C packages/backend test`
Expected: PASS.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A
git commit -m "fix(backend): clean up callers after scenario schema narrowing"
```

---

## Phase 5 — Frontend

### Task 10: Sets list page (replaces flat scenarios page)

**Files:**
- Modify: `packages/frontend/src/app/agents/[id]/evaluate/scenarios/page.tsx`

- [ ] **Step 1: Replace the page body with a sets list**

Rewrite the page to render `scenarioSets.byAgent` as cards. Remove `ScenarioCard`, `ManualScenarioModal`, the "+ Add scenario" button, the per-scenario delete confirm, and the `scenarios.byAgent` query usage. Keep the existing `✨ Generate scenarios` button — it still opens `ScenarioGenerationWizard`.

Replacement page structure (full file — preserve imports and route exports as needed by Next.js conventions):

```tsx
"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { ScenarioGenerationWizard } from "@/components/ScenarioGenerationWizard";

type Set = NonNullable<
  ReturnType<typeof useQuery<typeof api.conversationSim.scenarioSets.byAgent>>
>[number];

function SetCard({
  set,
  onClick,
  onDelete,
}: {
  set: Set;
  onClick: () => void;
  onDelete: () => void;
}) {
  const createdDate = new Date(set.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <button
      onClick={onClick}
      className="text-left bg-bg-elevated border border-border rounded-lg p-4 hover:border-accent transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-text truncate">{set.name}</h3>
        <span className="text-[10px] uppercase tracking-wider text-accent">
          {set.source}
        </span>
      </div>
      <div className="text-xs text-text-dim space-y-1">
        <div>{set.scenarioCount} scenarios</div>
        <div>Created {createdDate}</div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="mt-3 text-[10px] text-text-dim hover:text-red-400"
      >
        Delete
      </button>
    </button>
  );
}

export default function ScenariosPage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id as Id<"agents">;
  const router = useRouter();

  const sets = useQuery(api.conversationSim.scenarioSets.byAgent, { agentId });
  const removeSet = useMutation(api.conversationSim.scenarioSets.remove);

  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: Id<"scenarioSets">) {
    if (!confirm("Delete this scenario set and all its scenarios?")) return;
    try {
      await removeSet({ id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-sm font-medium text-text">Scenario sets</h1>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors"
        >
          <span>✨</span> Generate scenarios
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-3 py-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {sets === undefined ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 rounded-lg bg-bg-elevated border border-border animate-pulse"
              />
            ))}
          </div>
        ) : sets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
            <p className="text-sm text-text-dim">No scenario sets yet.</p>
            <p className="text-xs text-text-muted mt-1">
              Click &lsquo;✨ Generate scenarios&rsquo; to create one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sets.map((set) => (
              <SetCard
                key={set._id}
                set={set}
                onClick={() =>
                  router.push(
                    `/agents/${agentId}/evaluate/scenarios/${set._id}`,
                  )
                }
                onDelete={() => handleDelete(set._id)}
              />
            ))}
          </div>
        )}
      </div>

      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowWizard(false)}
          />
          <div
            className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <ScenarioGenerationWizard
              agentId={agentId}
              onGenerated={() => setShowWizard(false)}
              onError={(msg) => {
                setError(msg);
                setShowWizard(false);
              }}
              onCancel={() => setShowWizard(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Frontend typecheck**

Run: `pnpm -C packages/frontend build` (or `pnpm typecheck` if exposed)
Expected: PASS for `scenarios/page.tsx`. Other pages (set detail, experiments) may still fail.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/agents/\[id\]/evaluate/scenarios/page.tsx
git commit -m "feat(frontend): scenarios page becomes sets list"
```

---

### Task 11: Set detail page

**Files:**
- Create: `packages/frontend/src/app/agents/[id]/evaluate/scenarios/[setId]/page.tsx`

- [ ] **Step 1: Create the set detail page**

```tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

type Scenario = NonNullable<
  ReturnType<typeof useQuery<typeof api.conversationSim.scenarios.bySet>>
>[number];

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const summary =
    scenario.instruction.length > 60
      ? scenario.instruction.slice(0, 60) + "…"
      : scenario.instruction;
  const sourceKind = scenario.source.kind;
  return (
    <div className="bg-bg-elevated border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-accent">
          {sourceKind}
        </span>
        <span className="text-[10px] text-text-dim capitalize">
          {scenario.complexity}
        </span>
      </div>
      <p className="text-xs text-text mb-3">{summary}</p>
      <dl className="grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <dt className="text-text-dim">Topic</dt>
          <dd className="text-text">{scenario.topic}</dd>
        </div>
        <div>
          <dt className="text-text-dim">Intent</dt>
          <dd className="text-text">{scenario.intent}</dd>
        </div>
        <div>
          <dt className="text-text-dim">Persona</dt>
          <dd className="text-text">{scenario.persona.type}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function SetDetailPage() {
  const params = useParams<{ id: string; setId: string }>();
  const agentId = params.id as Id<"agents">;
  const setId = params.setId as Id<"scenarioSets">;
  const router = useRouter();

  const set = useQuery(api.conversationSim.scenarioSets.get, { id: setId });
  const scenarios = useQuery(api.conversationSim.scenarios.bySet, {
    scenarioSetId: setId,
  });

  if (set === null) {
    return <div className="p-6 text-sm text-text-dim">Set not found.</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <button
          onClick={() => router.push(`/agents/${agentId}/evaluate/scenarios`)}
          className="text-[10px] text-text-dim hover:text-accent mb-2"
        >
          ← Back to scenario sets
        </button>
        <h1 className="text-sm font-medium text-text">
          {set?.name ?? "Loading…"}
        </h1>
        {set && (
          <div className="flex items-center gap-3 mt-2 text-[10px] text-text-dim">
            <span className="uppercase tracking-wider text-accent">
              {set.source}
            </span>
            <span>{set.scenarioCount} scenarios</span>
            <span>
              Created{" "}
              {new Date(set.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {scenarios === undefined ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-32 rounded-lg bg-bg-elevated border border-border animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {scenarios.map((s) => (
              <ScenarioCard key={s._id} scenario={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Frontend typecheck**

Run: `pnpm -C packages/frontend build`
Expected: PASS for this file.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/agents/\[id\]/evaluate/scenarios/\[setId\]/page.tsx
git commit -m "feat(frontend): set detail page"
```

---

### Task 12: Rebuild `CreateSimulationModal`

**Files:**
- Create: `packages/frontend/src/components/CreateSimulationModal.tsx`

- [ ] **Step 1: Implement the modal**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

export function CreateSimulationModal({
  agentId,
  onClose,
  onStarted,
}: {
  agentId: Id<"agents">;
  onClose: () => void;
  onStarted: (simulationId: Id<"conversationSimulations">) => void;
}) {
  const sets = useQuery(api.conversationSim.scenarioSets.byAgent, { agentId });
  const startSimulation = useMutation(api.conversationSim.orchestration.start);

  const [scenarioSetId, setScenarioSetId] =
    useState<Id<"scenarioSets"> | null>(null);
  const [k, setK] = useState(1);
  const [maxTurns, setMaxTurns] = useState(5);
  const [concurrency, setConcurrency] = useState(2);
  const [timeoutMs, setTimeoutMs] = useState(120000);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const selectedSet = sets?.find((s) => s._id === scenarioSetId) ?? null;
  const totalRuns = selectedSet ? selectedSet.scenarioCount * k : 0;

  async function handleStart() {
    if (!scenarioSetId) return;
    setStarting(true);
    setError(null);
    try {
      const id = await startSimulation({
        agentId,
        scenarioSetId,
        k,
        maxTurns,
        concurrency,
        timeoutMs,
      });
      onStarted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-text">New simulation</h2>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
              Scenario set
            </label>
            {sets === undefined ? (
              <div className="text-[11px] text-text-dim">Loading…</div>
            ) : sets.length === 0 ? (
              <div className="text-[11px] text-text-dim bg-bg-surface border border-border rounded p-2">
                Generate a scenario set first.
              </div>
            ) : (
              <select
                value={scenarioSetId ?? ""}
                onChange={(e) =>
                  setScenarioSetId(
                    e.target.value
                      ? (e.target.value as Id<"scenarioSets">)
                      : null,
                  )
                }
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
              >
                <option value="">Select a set…</option>
                {sets.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name} ({s.scenarioCount} scenarios)
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
                k (runs per scenario)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={k}
                onChange={(e) => setK(Number(e.target.value))}
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
                Max turns
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxTurns}
                onChange={(e) => setMaxTurns(Number(e.target.value))}
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
                Concurrency
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-text-dim uppercase tracking-wider mb-1">
                Timeout (ms)
              </label>
              <input
                type="number"
                min={10000}
                max={600000}
                step={10000}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
                className="w-full bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:border-accent outline-none"
              />
            </div>
          </div>

          {selectedSet && (
            <div className="text-[11px] text-text-dim bg-bg-surface border border-border rounded p-2">
              Total runs: <span className="text-text">{totalRuns}</span> (
              {selectedSet.scenarioCount} scenarios × {k})
            </div>
          )}

          {error && (
            <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-dim border border-border rounded hover:text-text"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!scenarioSetId || starting}
            className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {starting ? "Starting…" : "Start simulation"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Frontend typecheck**

Run: `pnpm -C packages/frontend build`
Expected: PASS for this file.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/CreateSimulationModal.tsx
git commit -m "feat(frontend): CreateSimulationModal driven by scenarioSets"
```

---

### Task 13: Mount `CreateSimulationModal` on experiments page

**Files:**
- Modify: `packages/frontend/src/app/agents/[id]/evaluate/experiments/page.tsx`

- [ ] **Step 1: Replace `ComingSoonModal` with the real modal; gate on set count**

In `packages/frontend/src/app/agents/[id]/evaluate/experiments/page.tsx`:

1. Remove the `ComingSoonModal` function and its render block.
2. Replace the `scenarios = useQuery(api.conversationSim.scenarios.byAgent, …)` line with:
   ```tsx
   const sets = useQuery(api.conversationSim.scenarioSets.byAgent, { agentId });
   const hasSets = (sets?.length ?? 0) > 0;
   ```
3. Remove the `hasScenarios` variable and references; use `hasSets` instead for the disabled/title attributes on the "+ New Simulation" button.
4. Import and render the new modal:
   ```tsx
   import { CreateSimulationModal } from "@/components/CreateSimulationModal";

   // …

   {showModal && (
     <CreateSimulationModal
       agentId={agentId}
       onClose={() => setShowModal(false)}
       onStarted={(simId) => {
         setShowModal(false);
         router.push(`/agents/${agentId}/evaluate/experiments/${simId}`);
       }}
     />
   )}
   ```
   (`router` is already destructured in `SimulationRow` — pull it up to the page component.)
5. In `SimulationRow`, add the set name. Update the `Simulation` type to include `scenarioSetId`, then either:
   - Render the set id as a tooltip (cheap),
   - OR fetch the set in `SimulationRow` via `useQuery(api.conversationSim.scenarioSets.get, { id: sim.scenarioSetId })` and show `set?.name`.
   Prefer the second for clarity. Add this near the row's left text:
   ```tsx
   const set = useQuery(api.conversationSim.scenarioSets.get, {
     id: sim.scenarioSetId,
   });
   // …
   <p className="text-[10px] text-text-dim">
     Set: {set?.name ?? "—"} · {sim.totalRuns} runs
   </p>
   ```

- [ ] **Step 2: Frontend build**

Run: `pnpm -C packages/frontend build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/agents/\[id\]/evaluate/experiments/page.tsx
git commit -m "feat(frontend): mount CreateSimulationModal; gate on scenario sets"
```

---

### Task 14: Simulation detail page shows set name + link

**Files:**
- Modify: `packages/frontend/src/app/agents/[id]/evaluate/experiments/[simulationId]/page.tsx`

- [ ] **Step 1: Add a "Scenario set: [name]" row**

Near the simulation header section, after fetching `sim`, also fetch the set:

```tsx
const set = useQuery(
  api.conversationSim.scenarioSets.get,
  sim ? { id: sim.scenarioSetId } : "skip",
);
```

Add a row in the header metadata:

```tsx
<div className="text-[11px] text-text-dim">
  Scenario set:{" "}
  {set ? (
    <Link
      href={`/agents/${sim.agentId}/evaluate/scenarios/${set._id}`}
      className="text-accent hover:underline"
    >
      {set.name}
    </Link>
  ) : (
    "—"
  )}
</div>
```

- [ ] **Step 2: Build**

Run: `pnpm -C packages/frontend build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/agents/\[id\]/evaluate/experiments/\[simulationId\]/page.tsx
git commit -m "feat(frontend): simulation detail links to its scenario set"
```

---

## Phase 6 — Verification

### Task 15: End-to-end manual verification

- [ ] **Step 1: Apply the wipe**

In a terminal with Convex CLI configured for the target deployment:

```bash
cd packages/backend
npx convex run conversationSim/wipe:wipeAll
```

Expected: no errors. `npx convex dashboard` shows zero rows in the four wiped tables.

- [ ] **Step 2: Start dev servers**

```bash
pnpm dev:backend &
pnpm dev
```

- [ ] **Step 3: Walk the flows**

In a browser at `http://localhost:3000`:

1. Open an agent → Evaluate → Scenarios. Empty state visible.
2. Click "✨ Generate scenarios". Wizard runs end-to-end. A new set card appears, count updates live during generation.
3. Click into the set. Set detail page lists scenarios.
4. Go back. Click Evaluate → Experiments. Click "+ New Simulation". Modal lists the set in the dropdown. Total-runs preview updates with k.
5. Click "Start simulation". Redirected to simulation detail. Header shows "Scenario set: …" linking back.
6. Wait for completion. Active banner clears. Simulation row in the experiments list shows the set name.
7. Try to delete the set from the sets list. Confirm rejection because a simulation references it. Cancel the simulation, retry the delete — succeeds.
8. Try generating a second set. Two cards now visible.

- [ ] **Step 4: Run full test suite**

```bash
pnpm -C packages/backend test
pnpm -C packages/eval-lib test
```

Expected: both PASS.

- [ ] **Step 5: Final commit (if any incidental fixes were needed during E2E)**

```bash
git add -A
git commit -m "chore: post-E2E cleanup"
```

---

## Notes for the implementer

- **Order matters.** Tasks 1–9 build the backend; the frontend (Tasks 10–14) will not compile until the backend is in place because the generated `api.d.ts` shapes change.
- **`api.d.ts` regeneration.** After each backend change that adds/renames a function, run `pnpm dev:backend` (or `npx convex dev --once`) briefly to regenerate `_generated/api.d.ts`. The frontend imports from this file.
- **convex-test seeding.** Existing tests in `packages/backend/tests/` seed users, agents, KBs via `helpers.ts`. Reuse those helpers. If a helper for seeding an agent does not exist, add one in `helpers.ts` rather than inlining the agent shape per test.
- **`Workpool` import name.** The orchestration file already imports `Workpool`, `WorkId`, `vOnCompleteArgs`, `RunResult` — leave those untouched.
- **`scenarioGenJobs` `scenarioSetId`.** Once Task 5 lands, this field is required on new job rows. The wipe in Task 15 clears existing rows. If you re-run the plan against a partially-implemented deployment, re-run the wipe.
