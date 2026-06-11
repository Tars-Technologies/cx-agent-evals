# CodeRabbit PR #75 Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the verified true-positive findings CodeRabbit raised on PR #75 (Frontend re-haul umbrella), prioritising the org-scoped-auth security gap and the failure-mode data-loss bug.

**Architecture:** Backend fixes harden Convex functions against the repo's own `convex/_generated/ai/guidelines.md` rules (bounded reads, batched deletes, denormalised counts) and add org-scoped auth. Frontend fixes add graceful not-found handling and keyboard accessibility. Type-safety fixes remove `any` casts. Docs fixes satisfy markdownlint MD040.

**Tech Stack:** Convex (queries/mutations/actions, `convex-test` + vitest), Next.js 16 + React (Tailwind v4), TypeScript strict, Biome (`biome check .`, v2.4.10) for lint/format.

---

## Verification Verdict (why each task exists)

| # | Finding | Location | Verdict |
|---|---------|----------|---------|
| 9 | `recluster` public action never calls `getAuthContext` — any authed user can destructively recluster another org's analysis | `errorAnalysis/clustering.ts:76` | **TRUE — security.** Confirmed: no `getAuthContext`, no `orgId` check. Sibling `errorAnalysis/orchestration.ts` and `evaluator/batchApply.ts` both enforce org. |
| 10 | Destructive wipe of `failureModes` happens before the LLM call/parse → transient error leaves analysis empty | `errorAnalysis/clustering.ts:134` | **TRUE.** Wipe at line 135 precedes OpenAI call (162) + `JSON.parse` (200). |
| 4 | `listForOrg` `.collect()`s all org conversations + N+1 message/agent lookups | `crud/conversations.ts:34` | **TRUE.** Backed by `guidelines.md:242` ("always return a bounded collection... use `.take()` or paginate"). |
| 8 | `countByAgentAndSource`/`listByAgentAndSource` `.collect()` whole org + filter in memory; duplicated logic | `crud/conversations.ts:108,125` | **TRUE.** Backed by `guidelines.md:242-243`. Only `by_org` index exists; no `by_org_source`. |
| 7 | `wipeAll` `.collect()` + per-doc delete across 4 tables in one mutation | `conversationSim/wipe.ts:6` | **TRUE.** Backed by `guidelines.md:244-245` (batch with `.take(n)` + scheduler). |
| 5 | `RealConversationDetail` only guards `undefined`; `get`/`listMessages` throw on stale/cross-org id → pane errors | `conversations/RealConversationDetail.tsx:19` | **TRUE.** Both backend queries `throw "Conversation not found"`. |
| 6 | Conversation/transcript rows are `<div onClick>` with no keyboard affordance | `conversations/RealConversationsPane.tsx:59`, `conversations/TranscriptsPane.tsx:144` | **TRUE.** No `role`/`tabIndex`/`onKeyDown`. |
| 11 | `ready as any[]` cast bypasses typing | `evaluator/autoApply.ts:41` | **TRUE.** |
| 12 | `(r: any)`/`(l: any)` casts on typed internal-query rows | `evaluator/batchApply.ts:78,79,96,97` | **TRUE.** The umbrella branch uses **Biome** (`biome check .`), so CodeRabbit's `noExplicitAny` reference is accurate — these block `pnpm lint`. |
| 13 | Widespread `any` in helper signature/body | `evaluator/fewShotForEvaluator.ts:15-44` | **TRUE.** |
| 1,2 | Fenced code blocks missing language (MD040) | `docs/superpowers/specs/2026-05-21-frontend-rehaul-knowledge-base-design.md`, `...umbrella-design.md` | **TRUE — trivial.** |
| 3 | Mobile sidebar removed not collapsed | `shell/EntityDetailLayout.tsx` | **ALREADY ADDRESSED** — CodeRabbit marked "✅ Addressed in commits 24b3556 to 3315de4"; the file now has `ExpandedItem`/`CollapsedItem`/`flattenForCollapsed` collapse behaviour. **No task.** |

**Deferred (out of scope, needs its own migration plan):** CodeRabbit's deeper suggestions to *denormalise* `lastMessageAt`/`lastMessagePreview` onto the conversation doc (#4) and maintain a *denormalised counter* for #8 are real but require a schema migration (`convex-migration-helper` skill). This plan does the bounded/indexed fixes CodeRabbit listed as the "at minimum" bar; denormalisation is flagged as follow-up.

---

## File Structure

- `packages/backend/convex/errorAnalysis/clustering.ts` — add org auth (Task 1); reorder wipe after parse (Task 2).
- `packages/backend/convex/crud/conversations.ts` — bound `listForOrg` (Task 3); index + dedupe `count/listByAgentAndSource` (Task 4).
- `packages/backend/convex/schema.ts` — add `by_org_source` index (Task 4).
- `packages/backend/convex/conversationSim/wipe.ts` — batched delete + self-reschedule (Task 5).
- `packages/frontend/src/components/conversations/RealConversationDetail.tsx` — not-found UI (Task 6).
- `packages/frontend/src/components/conversations/RealConversationsPane.tsx`, `TranscriptsPane.tsx` — keyboard a11y (Task 7).
- `packages/backend/convex/evaluator/{autoApply,batchApply,fewShotForEvaluator}.ts` — remove `any` (Task 8).
- `docs/superpowers/specs/2026-05-21-frontend-rehaul-{knowledge-base,umbrella}-design.md` — MD040 (Task 9).

**Task order** follows the receiving-code-review rule: blocking/security → data-loss → perf → UX → types → docs.

---

### Task 1: Org-scoped auth on `recluster` (security)

**Files:**
- Modify: `packages/backend/convex/errorAnalysis/clustering.ts:20-22,76-83`
- Test: `packages/backend/tests/errorAnalyses.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/backend/tests/errorAnalyses.test.ts` (adapt seed helpers to whatever the file already uses to create an analysis; the key assertion is the cross-org rejection):

```typescript
import { internal } from "../convex/_generated/api";

it("recluster rejects a caller from another org", async () => {
  const t = setupTest();
  await seedUser(t);
  const owner = t.withIdentity(testIdentity);

  // Create an analysis owned by TEST_ORG_ID (use the same path other tests in this file use).
  const agentId = await owner.mutation(api.crud.agents.create, DEFAULT_AGENT_ARGS);
  const analysisId = await owner.mutation(api.errorAnalysis.orchestration.create, {
    agentId,
    name: "A1",
  });

  // A different org must not be able to recluster it.
  const intruder = t.withIdentity({ ...testIdentity, subject: "user_other", org_id: "org_other" });
  await expect(
    intruder.action(api.errorAnalysis.clustering.recluster, { errorAnalysisId: analysisId }),
  ).rejects.toThrow(/not found/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test errorAnalyses`
Expected: FAIL — currently `recluster` ignores the caller's org and proceeds (likely failing later with an OpenAI/parse error instead of the expected "not found").

- [ ] **Step 3: Add the auth import**

In `packages/backend/convex/errorAnalysis/clustering.ts`, add alongside the existing imports (after line 21 `import { v } from "convex/values";`):

```typescript
import { getAuthContext } from "../lib/auth";
```

- [ ] **Step 4: Enforce org ownership at the top of the handler**

Replace the opening of the `recluster` handler (lines 78-83):

```typescript
  handler: async (ctx, { errorAnalysisId }): Promise<{ failureModesCreated: number }> => {
    const analysis = await ctx.runQuery(
      internal.errorAnalysis.orchestration.getInternal,
      { id: errorAnalysisId },
    );
    if (!analysis) throw new Error("Error analysis not found");
```

with:

```typescript
  handler: async (ctx, { errorAnalysisId }): Promise<{ failureModesCreated: number }> => {
    const { orgId } = await getAuthContext(ctx);

    const analysis = await ctx.runQuery(
      internal.errorAnalysis.orchestration.getInternal,
      { id: errorAnalysisId },
    );
    if (!analysis || analysis.orgId !== orgId) {
      throw new Error("Error analysis not found");
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/backend test errorAnalyses`
Expected: PASS — cross-org call now throws "Error analysis not found" before reaching OpenAI.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck:backend`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/errorAnalysis/clustering.ts packages/backend/tests/errorAnalyses.test.ts
git commit -m "fix(backend): enforce org-scoped access on errorAnalysis recluster action"
```

---

### Task 2: Defer destructive `failureModes` wipe until after a successful parse

**Files:**
- Modify: `packages/backend/convex/errorAnalysis/clustering.ts:134-208`

**Why:** Today the wipe (line 135) runs before the OpenAI call and `JSON.parse`. If either throws, the analysis is left with zero failure modes and no replacement. Move the wipe so the non-empty path only deletes after a valid parse. The empty-failing-set branch keeps its wipe-then-placeholder behaviour.

- [ ] **Step 1: Remove the unconditional wipe and scope it to the empty branch**

Replace lines 134-151 (the comment + unconditional wipe + empty branch):

```typescript
    // Always wipe old modes first so empty-failing-set leaves the analysis clean.
    await ctx.runMutation(
      internal.errorAnalysis.clusteringHelpers.deleteFailureModesForAnalysisInternal,
      { errorAnalysisId },
    );

    if (failingItems.length === 0) {
      await ctx.runMutation(internal.failureModes.crud.createInternal, {
        orgId: analysis.orgId,
        agentId: analysis.agentId,
        errorAnalysisId,
        name: "No failures detected",
        description:
          "All annotated conversations were rated as passing. No failure patterns to analyze.",
        order: 0,
      });
      return { failureModesCreated: 1 };
    }
```

with (wipe moves into the empty branch only):

```typescript
    if (failingItems.length === 0) {
      // No failing items: safe to wipe and write the placeholder (no LLM dependency).
      await ctx.runMutation(
        internal.errorAnalysis.clusteringHelpers.deleteFailureModesForAnalysisInternal,
        { errorAnalysisId },
      );
      await ctx.runMutation(internal.failureModes.crud.createInternal, {
        orgId: analysis.orgId,
        agentId: analysis.agentId,
        errorAnalysisId,
        name: "No failures detected",
        description:
          "All annotated conversations were rated as passing. No failure patterns to analyze.",
        order: 0,
      });
      return { failureModesCreated: 1 };
    }
```

- [ ] **Step 2: Add the wipe back after a successful parse**

Locate the parse block (lines ~197-208):

```typescript
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response from LLM");

    const parsed = JSON.parse(content) as {
      failureModes: Array<{
        name: string;
        description: string;
        itemIndices: number[];
      }>;
    };

    let created = 0;
```

Insert the wipe between the `parsed` declaration and `let created = 0;`:

```typescript
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response from LLM");

    const parsed = JSON.parse(content) as {
      failureModes: Array<{
        name: string;
        description: string;
        itemIndices: number[];
      }>;
    };

    // Parse succeeded — only now is it safe to replace the existing modes. A
    // transient LLM/parse error above leaves the prior analysis untouched.
    await ctx.runMutation(
      internal.errorAnalysis.clusteringHelpers.deleteFailureModesForAnalysisInternal,
      { errorAnalysisId },
    );

    let created = 0;
```

- [ ] **Step 3: Update the file header comment to match**

In the header docblock (lines 4-18), change step 5 from `5. Wipe existing failure modes for this analysis.` to:

```
 *   5. Wipe existing failure modes (only AFTER a successful parse, so a
 *      transient LLM/parse error doesn't erase prior results).
```

- [ ] **Step 4: Typecheck + run the analysis tests**

Run: `pnpm typecheck:backend && pnpm -C packages/backend test errorAnalyses`
Expected: no type errors; existing tests (incl. Task 1's) PASS. The empty-failing-set path still wipes then inserts the placeholder.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/errorAnalysis/clustering.ts
git commit -m "fix(backend): defer recluster failureModes wipe until after successful LLM parse"
```

---

### Task 3: Bound `listForOrg`

**Files:**
- Modify: `packages/backend/convex/crud/conversations.ts:34-72`
- Test: `packages/backend/tests/conversations-crud.test.ts`

**Why:** `guidelines.md:242` — never `.collect()` an unbounded set; use `.take()`/paginate. The sidebar only needs the most-recent conversations.

- [ ] **Step 1: Write the failing test**

Add to `packages/backend/tests/conversations-crud.test.ts`:

```typescript
it("listForOrg never returns more than the sidebar cap", async () => {
  const t = setupTest();
  await seedUser(t);
  const authed = t.withIdentity(testIdentity);
  const agentId = await authed.mutation(api.crud.agents.create, DEFAULT_AGENT_ARGS);

  // Create CAP + 5 conversations directly via the internal mutation.
  for (let i = 0; i < 105; i++) {
    await t.mutation(internal.crud.conversations.createInternal, {
      orgId: TEST_ORG_ID,
      agentIds: [agentId],
      title: `c${i}`,
      source: "playground",
    });
  }

  const rows = await authed.query(api.crud.conversations.listForOrg, {});
  expect(rows.length).toBeLessThanOrEqual(100);
});
```

(Ensure `internal` and `TEST_ORG_ID` are imported at the top of the test file; `DEFAULT_AGENT_ARGS` mirrors `agents-crud.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test conversations-crud`
Expected: FAIL — `listForOrg` returns all 105.

- [ ] **Step 3: Add a cap constant and apply `.take()`**

In `packages/backend/convex/crud/conversations.ts`, add near the top (after the imports, before `export const create`):

```typescript
// Sidebar list cap. The conversations sidebar shows most-recent first; older
// history is out of scope for this reactive query (guidelines.md: prefer bounded
// reads). Bump or switch to .paginate() if a "load more" affordance is added.
const CONVERSATION_LIST_LIMIT = 100;
```

Then in `listForOrg`, change the query (lines 38-42):

```typescript
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
```

to:

```typescript
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(CONVERSATION_LIST_LIMIT);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test conversations-crud`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/crud/conversations.ts packages/backend/tests/conversations-crud.test.ts
git commit -m "fix(backend): bound conversations.listForOrg to a sidebar cap"
```

---

### Task 4: Index + dedupe `countByAgentAndSource`/`listByAgentAndSource`

**Files:**
- Modify: `packages/backend/convex/schema.ts:690-701` (conversations table)
- Modify: `packages/backend/convex/crud/conversations.ts:108-140`
- Test: `packages/backend/tests/conversations-crud.test.ts`

**Why:** `guidelines.md:242-243`. Both functions `.collect()` the whole org and filter in memory; the logic is duplicated. Add a `by_org_source` index to narrow the scan to the relevant `source` partition, then share one filter helper. (`agentIds` is an array, so it stays an in-memory filter.)

- [ ] **Step 1: Write the failing test**

Add to `packages/backend/tests/conversations-crud.test.ts`:

```typescript
it("count/list by agent+source share a result and respect source", async () => {
  const t = setupTest();
  await seedUser(t);
  const authed = t.withIdentity(testIdentity);
  const agentId = await authed.mutation(api.crud.agents.create, DEFAULT_AGENT_ARGS);

  await t.mutation(internal.crud.conversations.createInternal, {
    orgId: TEST_ORG_ID, agentIds: [agentId], source: "playground",
  });
  await t.mutation(internal.crud.conversations.createInternal, {
    orgId: TEST_ORG_ID, agentIds: [agentId], source: "playground",
  });
  await t.mutation(internal.crud.conversations.createInternal, {
    orgId: TEST_ORG_ID, agentIds: [agentId], source: "simulation",
  });

  const count = await authed.query(api.crud.conversations.countByAgentAndSource, {
    agentId, source: "playground",
  });
  const list = await authed.query(api.crud.conversations.listByAgentAndSource, {
    agentId, source: "playground",
  });
  expect(count).toBe(2);
  expect(list).toHaveLength(2);
  expect(count).toBe(list.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test conversations-crud`
Expected: FAIL — `Index "by_org_source" not found` once Step 3 functions reference it (or assertion mismatch). It must compile first; this test will pass only after Steps 3-4. Run now to confirm it does not already pass.

- [ ] **Step 3: Add the index to the schema**

In `packages/backend/convex/schema.ts`, change the conversations table index (line ~700):

```typescript
  })
    .index("by_org", ["orgId"]),
```

to:

```typescript
  })
    .index("by_org", ["orgId"])
    .index("by_org_source", ["orgId", "source"]),
```

- [ ] **Step 4: Extract a shared filter and use the new index**

In `packages/backend/convex/crud/conversations.ts`, replace both functions (lines 108-140) with:

```typescript
// Shared scan for agent+source lookups. Narrows to the (orgId, source) index
// partition, then filters by agentId in memory (agentIds is an array and not
// directly indexable). Used by both the count and list endpoints below.
async function conversationsByAgentAndSource(
  ctx: QueryCtx,
  orgId: string,
  agentId: Id<"agents">,
  source: "playground" | "simulation",
) {
  const rows = await ctx.db
    .query("conversations")
    .withIndex("by_org_source", (q) => q.eq("orgId", orgId).eq("source", source))
    .collect();
  return rows.filter((c) => c.agentIds.includes(agentId));
}

export const countByAgentAndSource = query({
  args: {
    agentId: v.id("agents"),
    source: v.union(v.literal("playground"), v.literal("simulation")),
  },
  handler: async (ctx, { agentId, source }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await conversationsByAgentAndSource(ctx, orgId, agentId, source);
    return rows.length;
  },
});

export const listByAgentAndSource = query({
  args: {
    agentId: v.id("agents"),
    source: v.union(v.literal("playground"), v.literal("simulation")),
  },
  handler: async (ctx, { agentId, source }) => {
    const { orgId } = await getAuthContext(ctx);
    return conversationsByAgentAndSource(ctx, orgId, agentId, source);
  },
});
```

Add the needed type imports to the top of the file (line 1-3 area):

```typescript
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
```

- [ ] **Step 5: Validate schema + run tests**

Run: `cd packages/backend && npx convex dev --once`
Expected: deploys cleanly — adding an index requires no data migration.
Run: `pnpm -C packages/backend test conversations-crud`
Expected: PASS (count === list.length === 2; simulation excluded).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck:backend`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/crud/conversations.ts packages/backend/tests/conversations-crud.test.ts
git commit -m "fix(backend): add by_org_source index and dedupe agent/source conversation queries"
```

---

### Task 5: Batched, self-rescheduling `wipeAll`

**Files:**
- Modify: `packages/backend/convex/conversationSim/wipe.ts`
- Test: `packages/backend/tests/conversationSim/wipe.test.ts` (create)

**Why:** `guidelines.md:244-245` — a single mutation must not unbounded-`collect()`+delete; read in `.take(n)` batches and `ctx.scheduler.runAfter(0, …)` to continue, staying within per-transaction limits.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/conversationSim/wipe.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { internal } from "../../convex/_generated/api";
import { setupTest } from "../helpers";

describe("conversationSim wipeAll", () => {
  it("deletes all conversationScenarios across reschedules", async () => {
    const t = setupTest();

    // Seed a handful of scenarios (single-pass: below the batch size).
    for (let i = 0; i < 5; i++) {
      await t.run(async (ctx) => {
        await ctx.db.insert("conversationScenarios", {
          // minimal valid doc — match required fields in schema.ts for this table
        } as never);
      });
    }

    await t.mutation(internal.conversationSim.wipe.wipeAll, {});
    await t.finishInProgressScheduledFunctions();

    const remaining = await t.run((ctx) =>
      ctx.db.query("conversationScenarios").collect(),
    );
    expect(remaining).toHaveLength(0);
  });
});
```

NOTE for the implementer: fill the inserted `conversationScenarios` doc with the exact required fields from `schema.ts` (search `conversationScenarios: defineTable`). Keep the seed count below `WIPE_BATCH` so the single-pass path is exercised; the reschedule branch is covered structurally by Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test conversationSim/wipe`
Expected: FAIL — `wipeAll` isn't rescheduling-aware yet (test asserts a function shape that will exist after Step 3; confirm it does not already pass).

- [ ] **Step 3: Rewrite `wipeAll` to batch + self-reschedule**

Replace the entire body of `packages/backend/convex/conversationSim/wipe.ts`:

```typescript
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";

// Max docs deleted per transaction. Convex mutations have per-transaction
// read/write limits (guidelines.md), so we delete in bounded batches and
// reschedule until the tables are empty.
const WIPE_BATCH = 200;

// One-shot wipe of all conversationSim data. Run manually via the Convex
// dashboard after deploying the scenarioSets schema change. New schema fields
// are required, so existing rows would fail validation — clear them first.
// Self-reschedules via ctx.scheduler until every table is drained.
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
      const batch = await ctx.db.query(table).take(WIPE_BATCH);
      for (const doc of batch) {
        await ctx.db.delete(doc._id);
      }
      if (batch.length === WIPE_BATCH) {
        // This table may have more rows than one transaction can delete.
        // Reschedule from the top; already-drained tables are cheap no-ops.
        await ctx.scheduler.runAfter(0, internal.conversationSim.wipe.wipeAll, {});
        return;
      }
    }
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test conversationSim/wipe`
Expected: PASS — all 5 scenarios deleted in a single pass; `finishInProgressScheduledFunctions` drains any reschedule.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck:backend`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/conversationSim/wipe.ts packages/backend/tests/conversationSim/wipe.test.ts
git commit -m "fix(backend): batch conversationSim wipeAll with scheduler reschedule"
```

---

### Task 6: Not-found handling in `RealConversationDetail`

**Files:**
- Modify: `packages/backend/convex/crud/conversations.ts` (`get`, `listMessages`)
- Modify: `packages/frontend/src/components/conversations/RealConversationDetail.tsx:16-21`
- Test: `packages/backend/tests/conversations-crud.test.ts`

**Why:** `get` and `listMessages` `throw "Conversation not found"` for stale/missing/cross-org ids. In a reactive UI those ids occur during navigation, and a thrown query crashes the pane. Returning a graceful empty result is safe: `get` is consumed only by `RealConversationDetail` (verified), and the six `listMessages` consumers all already handle message arrays, so returning `[]` is strictly safer than throwing.

- [ ] **Step 1: Write the failing test**

Add to `packages/backend/tests/conversations-crud.test.ts`:

```typescript
it("get returns null and listMessages returns [] for a cross-org id", async () => {
  const t = setupTest();
  await seedUser(t);
  const owner = t.withIdentity(testIdentity);
  const agentId = await owner.mutation(api.crud.agents.create, DEFAULT_AGENT_ARGS);
  const convId = await owner.mutation(api.crud.conversations.create, { agentIds: [agentId] });

  const intruder = t.withIdentity({ ...testIdentity, subject: "user_other", org_id: "org_other" });
  expect(await intruder.query(api.crud.conversations.get, { id: convId })).toBeNull();
  expect(await intruder.query(api.crud.conversations.listMessages, { conversationId: convId })).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test conversations-crud`
Expected: FAIL — both queries throw "Conversation not found".

- [ ] **Step 3: Soften `get` to return null**

In `packages/backend/convex/crud/conversations.ts`, change `get` (lines 26-30):

```typescript
    const conv = await ctx.db.get(id);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }
    return conv;
```

to:

```typescript
    const conv = await ctx.db.get(id);
    if (!conv || conv.orgId !== orgId) {
      // Stale/cross-org id (common during reactive navigation): return null so
      // the client can render a not-found state instead of crashing the pane.
      return null;
    }
    return conv;
```

- [ ] **Step 4: Soften `listMessages` to return []**

In the same file, change `listMessages` (lines 78-81):

```typescript
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }
```

to:

```typescript
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== orgId) {
      return [];
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/backend test conversations-crud`
Expected: PASS.

- [ ] **Step 6: Render a not-found state in the component**

In `packages/frontend/src/components/conversations/RealConversationDetail.tsx`, replace the guard (lines 19-21):

```typescript
  if (conversation === undefined || messages === undefined) {
    return <div className="p-6 text-xs text-text-dim">Loading conversation…</div>;
  }
```

with:

```typescript
  if (conversation === undefined || messages === undefined) {
    return <div className="p-6 text-xs text-text-dim">Loading conversation…</div>;
  }

  if (conversation === null) {
    return (
      <div className="p-6 text-xs text-text-dim">
        Conversation not found. It may have been deleted.
      </div>
    );
  }
```

- [ ] **Step 7: Verify the frontend builds (types flow through)**

Run: `pnpm -C packages/frontend build`
Expected: build succeeds. `useQuery(get)` is now `Doc | null | undefined`; the new `=== null` branch narrows it so the existing `conversation.title` access stays valid.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/convex/crud/conversations.ts packages/frontend/src/components/conversations/RealConversationDetail.tsx packages/backend/tests/conversations-crud.test.ts
git commit -m "fix(conversations): render not-found state instead of throwing on stale/cross-org id"
```

---

### Task 7: Keyboard accessibility for clickable rows

**Files:**
- Modify: `packages/frontend/src/components/conversations/RealConversationsPane.tsx:59-67`
- Modify: `packages/frontend/src/components/conversations/TranscriptsPane.tsx:144-150`

**Why:** Both rows are `<div onClick>` with no keyboard path — keyboard-only users can't select. Add `role="button"`, `tabIndex={0}`, and an Enter/Space handler.

- [ ] **Step 1: Make the conversation row focusable/activatable**

In `RealConversationsPane.tsx`, change the row `<div>` (lines 59-67):

```tsx
              <div
                key={conv._id}
                onClick={() => select(conv._id)}
                className={`px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
                  isActive
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-bg-hover"
                }`}
              >
```

to:

```tsx
              <div
                key={conv._id}
                role="button"
                tabIndex={0}
                onClick={() => select(conv._id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(conv._id);
                  }
                }}
                className={`px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
                  isActive
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-bg-hover"
                }`}
              >
```

- [ ] **Step 2: Make the transcript upload row focusable/activatable**

In `TranscriptsPane.tsx`, change the row `<div>` (lines 144-150):

```tsx
              <div
                key={upload._id}
                onClick={() => select(upload._id)}
                className={`group flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
                  isActive
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-bg-hover"
                }`}
              >
```

to:

```tsx
              <div
                key={upload._id}
                role="button"
                tabIndex={0}
                onClick={() => select(upload._id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select(upload._id);
                  }
                }}
                className={`group flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
                  isActive
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-bg-hover"
                }`}
              >
```

NOTE: `select` in `TranscriptsPane.tsx` may take the upload id with a different signature — keep whatever argument the existing `onClick` passes. If the row contains nested interactive controls (e.g. a delete button), confirm `e.stopPropagation()` is already on those so Space/Enter on the row doesn't double-fire; do not change their behaviour.

- [ ] **Step 3: Verify the frontend builds**

Run: `pnpm -C packages/frontend build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/conversations/RealConversationsPane.tsx packages/frontend/src/components/conversations/TranscriptsPane.tsx
git commit -m "fix(a11y): make conversation and transcript rows keyboard-activatable"
```

---

### Task 8: Remove `any` casts in evaluator actions/helper

**Files:**
- Modify: `packages/backend/convex/evaluator/autoApply.ts:6,41`
- Modify: `packages/backend/convex/evaluator/batchApply.ts:77-98`
- Modify: `packages/backend/convex/evaluator/fewShotForEvaluator.ts:1-44`

**Why:** Findings #11/#12/#13 — `any` defeats type safety and is flagged by Biome's `noExplicitAny` (this branch lints with `biome check .`). The rows already come from typed internal queries, so proper types are available. (No behaviour change — the existing evaluator tests are the regression guard.)

- [ ] **Step 1: Type `fewShotForEvaluator` helper**

Replace the signature and body of `packages/backend/convex/evaluator/fewShotForEvaluator.ts` (lines 1-2 imports and 15-44):

Imports (lines 1-2) become:

```typescript
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { selectFewShot, renderFewShotBlock, type FewShotExample } from "./fewShot";
```

Signature + body (lines 15-44) become:

```typescript
export async function buildFewShotForEvaluator(
  ctx: ActionCtx,
  evaluator: Pick<Doc<"evaluators">, "_id" | "type" | "splitSeed">,
  labels?: Doc<"evaluatorLabels">[],
): Promise<string> {
  if (evaluator.type !== "llm_judge") return "";

  const rows =
    labels ??
    (await ctx.runQuery(internal.evaluator.labels.byEvaluatorInternal, {
      evaluatorId: evaluator._id,
    }));

  const train = rows.filter((l) => l.splitAssignment === "train");
  const byId = new Map<string, Doc<"evaluatorLabels">>(
    train.map((l) => [l._id, l]),
  );
  const ids = selectFewShot(
    train.filter((l) => l.humanLabel === "pass").map((l) => l._id),
    train.filter((l) => l.humanLabel === "fail").map((l) => l._id),
    FEWSHOT_TARGET,
    evaluator.splitSeed ?? 42,
  );

  const examples: FewShotExample[] = [];
  for (const id of ids) {
    const lbl = byId.get(id);
    if (!lbl) continue;
    const messages = await ctx.runQuery(
      internal.evaluator.sources.getMessagesForSource,
      { source: lbl.source },
    );
    examples.push({ label: lbl.humanLabel, messages });
  }
  return renderFewShotBlock(examples);
}
```

NOTE: if `selectFewShot` is declared to accept `string[]` rather than `Id<"evaluatorLabels">[]`, the `.map((l) => l._id)` calls still satisfy it (branded ids are assignable to `string`). If TypeScript complains that `selectFewShot`'s return type doesn't key `byId`, widen the map key to `string` (already done above). If `FewShotExample.label` is a narrower union than `humanLabel`, align the types in `./fewShot` rather than re-introducing `any`.

- [ ] **Step 2: Type the loop in `autoApply.ts`**

In `packages/backend/convex/evaluator/autoApply.ts`, add `Doc` to the dataModel import (line 6):

```typescript
import type { Doc, Id } from "../_generated/dataModel";
```

Then change line 41:

```typescript
    for (const ev of ready as any[]) {
```

to:

```typescript
    for (const ev of ready as Array<Doc<"evaluators">>) {
```

(If `pnpm typecheck:backend` shows `ready` is already `Doc<"evaluators">[]`, drop the cast entirely: `for (const ev of ready) {`.)

- [ ] **Step 3: Drop the `any` casts in `batchApply.ts`**

In `packages/backend/convex/evaluator/batchApply.ts`, remove the four `: any` annotations:

- Lines 78-79:

```typescript
    let cohortConvIds = runsRows
      .filter((r) => r.status === "completed" && r.conversationId)
      .map((r) => r.conversationId as Id<"conversations">);
```

- Lines 95-98:

```typescript
      const labeledConvIds = new Set(
        labels
          .filter((l) => l.source.kind === "conversation")
          .map((l) => l.source.conversationId as string),
      );
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck:backend`
Expected: no errors. If a residual error appears, fix it with the correct generated type (`Doc<...>`/`Id<...>`) — never reinstate `any`.

- [ ] **Step 5: Run the evaluator regression tests**

Run: `pnpm -C packages/backend test autoApply evaluatorBatchApply evaluatorFewShot`
Expected: all PASS (no behaviour change).

- [ ] **Step 6: Lint the changed files**

Run: `pnpm -C packages/backend lint` (runs `biome check .`)
Expected: no Biome `noExplicitAny` (lint/suspicious/noExplicitAny) errors on these files.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/evaluator/autoApply.ts packages/backend/convex/evaluator/batchApply.ts packages/backend/convex/evaluator/fewShotForEvaluator.ts
git commit -m "refactor(backend): replace any casts in evaluator actions with generated types"
```

---

### Task 9: Add languages to fenced code blocks (MD040)

**Files:**
- Modify: `docs/superpowers/specs/2026-05-21-frontend-rehaul-knowledge-base-design.md`
- Modify: `docs/superpowers/specs/2026-05-21-frontend-rehaul-umbrella-design.md`

**Why:** markdownlint MD040 — fenced blocks need a language. These are plain layout/route diagrams, so `text` is correct.

- [ ] **Step 1: Annotate the KB design doc**

In `docs/superpowers/specs/2026-05-21-frontend-rehaul-knowledge-base-design.md`, find each bare opening fence (a line that is exactly ```` ``` ````, e.g. the Routes block near line 13) and change it to ```` ```text ````. Leave closing fences unchanged.

- [ ] **Step 2: Annotate the umbrella design doc**

In `docs/superpowers/specs/2026-05-21-frontend-rehaul-umbrella-design.md`, change the bare opening fences at the nav block (~line 22), the tree block (~line 29), and the routes block (~line 68) from ```` ``` ```` to ```` ```text ````.

- [ ] **Step 3: Verify**

Run (if markdownlint is available): `npx markdownlint-cli2 "docs/superpowers/specs/2026-05-21-frontend-rehaul-*.md"`
Expected: no MD040 warnings. If the tool isn't installed, visually confirm every opening fence now has a language tag.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-21-frontend-rehaul-knowledge-base-design.md docs/superpowers/specs/2026-05-21-frontend-rehaul-umbrella-design.md
git commit -m "docs: add language to fenced code blocks (MD040)"
```

---

## Final Verification (after all tasks)

- [ ] `pnpm typecheck:backend` — clean
- [ ] `pnpm -C packages/backend test` — all green (46 existing + new tests)
- [ ] `pnpm -C packages/frontend build` — succeeds
- [ ] `cd packages/backend && npx convex dev --once` — schema deploys (new `by_org_source` index)
- [ ] Re-read each CodeRabbit thread; reply in-thread (`gh api repos/{owner}/{repo}/pulls/75/comments/{id}/replies`) noting the fix or, for the deferred denormalisation items, that they're tracked as follow-up.

## Self-Review Notes

- **Spec coverage:** every TRUE finding (1,2,4,5,6,7,8,9,10,11,12,13) maps to a task; #3 is already addressed (no task) — documented.
- **Type consistency:** `conversationsByAgentAndSource` named identically in helper + both callers; `CONVERSATION_LIST_LIMIT`, `WIPE_BATCH`, `buildFewShotForEvaluator` signatures consistent across tasks.
- **Deferred work is explicit:** denormalised `lastMessageAt`/preview (#4) and denormalised counter (#8) are called out as follow-up requiring `convex-migration-helper`, not silently dropped.
