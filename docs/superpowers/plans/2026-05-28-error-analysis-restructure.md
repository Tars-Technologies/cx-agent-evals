# Error Analysis Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-run open-coding / axial-coding UI with a top-level **Error analysis** section. Annotations and failure modes live inside containers (`errorAnalyses`). Pencil opens an `AnnotationSidePanel` reused everywhere; sim-run sub-sidebar is removed.

**Architecture:** Two new Convex tables (`errorAnalyses`, `errorAnalysisMembers`); existing `annotations` and `failureModes` gain `errorAnalysisId`; `evaluators.source.error_analysis` records both `failureModeId` and `errorAnalysisId`. Frontend gets one new top-level route tree under `/agents/[id]/evaluate/error-analysis`, one shared `AnnotationSidePanel`, two creation modals, and a stripped-down run viewer.

**Tech Stack:** Convex (TypeScript + convex-test), Next.js 16 app router, Tailwind v4, Clerk auth.

**Spec:** `docs/superpowers/specs/2026-05-28-error-analysis-restructure-design.md`

---

## File Structure

### Convex (new)
- `packages/backend/convex/errorAnalysis/orchestration.ts` — CRUD + import flows (mutations + queries)
- `packages/backend/convex/errorAnalysis/members.ts` — internal helpers for member upsert + container resolution
- `packages/backend/convex/errorAnalysis/clustering.ts` — `"use node"` action that calls existing clustering LLM
- `packages/backend/convex/errorAnalysis/evaluatorSpawn.ts` — mutation: spawn judge from failure mode with label inheritance

### Convex (modified)
- `packages/backend/convex/schema.ts` — add `errorAnalyses`, `errorAnalysisMembers`; add `errorAnalysisId` to `annotations`, `failureModes`; extend `evaluators.source.error_analysis`
- `packages/backend/convex/annotations/crud.ts` — replace `upsert` with `upsertWithAutoContainer`
- `packages/backend/convex/failureModes/crud.ts` — accept + return `errorAnalysisId`; add `byAnalysis` query
- `packages/backend/convex/failureModes/memberships.ts` — no schema change; index lookups must still work
- `packages/backend/convex/evaluator/create.ts` (or equivalent) — `fromFailureMode` mutation

### Convex (tests)
- `packages/backend/tests/errorAnalyses.test.ts`
- `packages/backend/tests/annotationsCrud.test.ts` — extend
- `packages/backend/tests/evaluatorSpawn.test.ts`

### Frontend (new)
- `packages/frontend/src/components/annotations/AnnotationSidePanel.tsx`
- `packages/frontend/src/components/errorAnalysis/ErrorAnalysisCard.tsx`
- `packages/frontend/src/components/errorAnalysis/CreateCustomCohortModal.tsx`
- `packages/frontend/src/components/errorAnalysis/ImportMoreModal.tsx`
- `packages/frontend/src/components/errorAnalysis/FailureModeCard.tsx`
- `packages/frontend/src/components/evaluators/FromFailureModeModal.tsx`
- `packages/frontend/src/app/agents/[id]/evaluate/error-analysis/page.tsx`
- `packages/frontend/src/app/agents/[id]/evaluate/error-analysis/[analysisId]/page.tsx` (redirects to /annotate)
- `packages/frontend/src/app/agents/[id]/evaluate/error-analysis/[analysisId]/annotate/page.tsx`
- `packages/frontend/src/app/agents/[id]/evaluate/error-analysis/[analysisId]/failure-modes/page.tsx`

### Frontend (modified)
- `packages/frontend/src/components/shell/sidebars.tsx` — add "Error analysis" to `agentSidebar`; **remove** `agentRunSidebar`
- `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/layout.tsx` — **delete file** (no sidebar swap)
- `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/page.tsx` — flat conversation viewer with `AnnotationSidePanel` + "View as error analysis →" link
- `packages/frontend/src/app/agents/[id]/configure/page.tsx` (or playground sub-component) — add pencil to playground conv viewer
- Transcript viewer (livechat section) — add pencil
- `packages/frontend/src/app/agents/[id]/evaluate/evaluators/page.tsx` — extend "+ New Evaluator" menu with "From failure mode"

### Frontend (deleted)
- `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/open-coding/` (entire route folder)
- `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/axial-coding/` (entire route folder)
- Any `ExperimentNavSidebar` or `agentRunSidebar` export

---

## Phase 1 — Schema

### Task 1: Add `errorAnalyses` and `errorAnalysisMembers` tables

**Files:**
- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1.1: Add table definitions to `schema.ts`**

Insert after the existing `failureModes` block:

```ts
  // ─── Error Analyses (containers for annotation + axial coding work) ───
  errorAnalyses: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    name: v.string(),
    origin: v.union(
      v.object({ kind: v.literal("simulation"), simulationId: v.id("conversationSimulations") }),
      v.object({ kind: v.literal("upload"),     uploadId:     v.id("livechatUploads") }),
      v.object({ kind: v.literal("playground") }),
      v.object({ kind: v.literal("custom") }),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_agent", ["agentId"])
    .index("by_agent_origin_simulation", ["agentId", "origin.simulationId"])
    .index("by_agent_origin_upload",     ["agentId", "origin.uploadId"]),

  errorAnalysisMembers: defineTable({
    orgId: v.string(),
    errorAnalysisId: v.id("errorAnalyses"),
    source: v.union(
      v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
      v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
    ),
    addedVia: v.union(v.literal("annotation"), v.literal("import")),
    addedAt: v.number(),
  })
    .index("by_analysis", ["errorAnalysisId"])
    .index("by_analysis_conversation", ["errorAnalysisId", "source.conversationId"])
    .index("by_analysis_transcript",   ["errorAnalysisId", "source.transcriptId"]),
```

- [ ] **Step 1.2: Add `errorAnalysisId` (required) to `annotations` block**

```ts
  annotations: defineTable({
    orgId: v.string(),
    errorAnalysisId: v.id("errorAnalyses"),
    source: /* existing */,
    rating: /* existing */,
    comment: v.optional(v.string()),
    tags: v.array(v.string()),
    ratedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_analysis", ["errorAnalysisId"])
    .index("by_conversation", ["source.conversationId"])
    .index("by_transcript",   ["source.transcriptId"]),
```

- [ ] **Step 1.3: Add `errorAnalysisId` to `failureModes`**

```ts
  failureModes: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    errorAnalysisId: v.id("errorAnalyses"),
    name: v.string(),
    description: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_agent", ["agentId"])
    .index("by_analysis", ["errorAnalysisId"]),
```

- [ ] **Step 1.4: Extend `evaluators.source` discriminator**

In the `evaluators` table definition, change the `error_analysis` arm to:

```ts
v.object({
  kind: v.literal("error_analysis"),
  failureModeId: v.id("failureModes"),
  errorAnalysisId: v.id("errorAnalyses"),
}),
```

- [ ] **Step 1.5: Wipe dev data so the schema change applies cleanly**

Since the org is pre-production and the spec says no migration:

```bash
cd packages/backend && npx convex dev --once
# If schema validation fails on existing rows, wipe:
# npx convex dashboard → Data → clear annotations/failureModes/evaluators
```

- [ ] **Step 1.6: Verify schema deploys**

```bash
cd packages/backend && pnpm typecheck && npx convex dev --once
```
Expected: no errors; new tables visible in dashboard.

- [ ] **Step 1.7: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add errorAnalyses + errorAnalysisMembers tables; require errorAnalysisId on annotations & failureModes"
```

---

## Phase 2 — Container helpers (server)

### Task 2: Internal helper for container resolution

**Files:**
- Create: `packages/backend/convex/errorAnalysis/members.ts`
- Test:  `packages/backend/tests/errorAnalyses.test.ts`

- [ ] **Step 2.1: Write the failing test**

`packages/backend/tests/errorAnalyses.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { setupTest, seedUser, seedAgent } from "./helpers";

describe("errorAnalysis/members.resolveContainer", () => {
  it("creates a sim-origin container on first call and reuses it on second", async () => {
    const t = convexTest(schema);
    const { user, orgId } = await setupTest(t);
    const agentId = await seedAgent(t, orgId, user);
    const simulationId = await t.run(async (ctx) =>
      await ctx.db.insert("conversationSimulations", { /* minimal fields */ }),
    );

    const id1 = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId,
      agentId,
      hint: { kind: "simulation", simulationId },
    });
    const id2 = await t.mutation(internal.errorAnalysis.members.resolveContainerInternal, {
      orgId,
      agentId,
      hint: { kind: "simulation", simulationId },
    });
    expect(id1).toBe(id2);
  });
});
```

- [ ] **Step 2.2: Run to confirm failure**

```bash
cd packages/backend && pnpm test errorAnalyses
```
Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement the helper**

`packages/backend/convex/errorAnalysis/members.ts`:

```ts
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

const hintValidator = v.union(
  v.object({ kind: v.literal("simulation"), simulationId: v.id("conversationSimulations") }),
  v.object({ kind: v.literal("upload"),     uploadId:     v.id("livechatUploads") }),
  v.object({ kind: v.literal("playground") }),
  v.object({ kind: v.literal("analysis"),   errorAnalysisId: v.id("errorAnalyses") }),
);

export const resolveContainerInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentId: v.id("agents"),
    hint: hintValidator,
  },
  handler: async (ctx, { orgId, agentId, hint }) => {
    if (hint.kind === "analysis") return hint.errorAnalysisId;

    // Find existing
    if (hint.kind === "simulation") {
      const existing = await ctx.db
        .query("errorAnalyses")
        .withIndex("by_agent_origin_simulation", (q) =>
          q.eq("agentId", agentId).eq("origin.simulationId", hint.simulationId),
        )
        .first();
      if (existing) return existing._id;
    } else if (hint.kind === "upload") {
      const existing = await ctx.db
        .query("errorAnalyses")
        .withIndex("by_agent_origin_upload", (q) =>
          q.eq("agentId", agentId).eq("origin.uploadId", hint.uploadId),
        )
        .first();
      if (existing) return existing._id;
    } else {
      // playground — one per agent
      const candidates = await ctx.db
        .query("errorAnalyses")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect();
      const existing = candidates.find((c) => c.origin.kind === "playground");
      if (existing) return existing._id;
    }

    // Lazy-create
    const name =
      hint.kind === "simulation" ? await defaultSimName(ctx, hint.simulationId) :
      hint.kind === "upload"     ? await defaultUploadName(ctx, hint.uploadId) :
      "Playground conversations";

    return await ctx.db.insert("errorAnalyses", {
      orgId,
      agentId,
      name,
      origin:
        hint.kind === "simulation" ? { kind: "simulation", simulationId: hint.simulationId } :
        hint.kind === "upload"     ? { kind: "upload",     uploadId:     hint.uploadId } :
        { kind: "playground" },
      createdAt: Date.now(),
    });
  },
});

async function defaultSimName(ctx: any, id: Id<"conversationSimulations">) {
  const sim = await ctx.db.get(id);
  return sim?.name ?? "Simulation run";
}
async function defaultUploadName(ctx: any, id: Id<"livechatUploads">) {
  const u = await ctx.db.get(id);
  return u?.filename ?? "Upload";
}

export const addMemberInternal = internalMutation({
  args: {
    orgId: v.string(),
    errorAnalysisId: v.id("errorAnalyses"),
    source: v.union(
      v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
      v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
    ),
    addedVia: v.union(v.literal("annotation"), v.literal("import")),
  },
  handler: async (ctx, args) => {
    // Idempotent insert (skip if already a member)
    const existing = args.source.kind === "conversation"
      ? await ctx.db.query("errorAnalysisMembers")
          .withIndex("by_analysis_conversation", (q) =>
            q.eq("errorAnalysisId", args.errorAnalysisId)
             .eq("source.conversationId", args.source.conversationId))
          .first()
      : await ctx.db.query("errorAnalysisMembers")
          .withIndex("by_analysis_transcript", (q) =>
            q.eq("errorAnalysisId", args.errorAnalysisId)
             .eq("source.transcriptId", args.source.transcriptId))
          .first();
    if (existing) return existing._id;
    return await ctx.db.insert("errorAnalysisMembers", {
      orgId: args.orgId,
      errorAnalysisId: args.errorAnalysisId,
      source: args.source,
      addedVia: args.addedVia,
      addedAt: Date.now(),
    });
  },
});
```

- [ ] **Step 2.4: Run the test, verify pass**

```bash
cd packages/backend && pnpm test errorAnalyses
```
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
git add packages/backend/convex/errorAnalysis/members.ts packages/backend/tests/errorAnalyses.test.ts
git commit -m "feat(backend): error-analysis container resolution + idempotent member helper"
```

---

### Task 3: `annotations.upsertWithAutoContainer`

**Files:**
- Modify: `packages/backend/convex/annotations/crud.ts`
- Test:   `packages/backend/tests/annotationsCrud.test.ts`

- [ ] **Step 3.1: Write the failing test**

Append to `annotationsCrud.test.ts`:

```ts
it("upsertWithAutoContainer creates a container and links the annotation", async () => {
  const t = convexTest(schema);
  const { user, orgId, asUser } = await setupTest(t);
  const agentId = await seedAgent(t, orgId, user);
  const conversationId = await t.run(async (ctx) =>
    await ctx.db.insert("conversations", {
      orgId, source: "playground", /* ...required fields */
    }),
  );

  const annotationId = await asUser.mutation(api.annotations.crud.upsertWithAutoContainer, {
    agentId,
    source: { kind: "conversation", conversationId },
    hint: { kind: "playground" },
    rating: "bad",
    comment: "wrong tone",
    tags: ["tone"],
  });

  const ann = await t.run(async (ctx) => await ctx.db.get(annotationId));
  expect(ann?.errorAnalysisId).toBeDefined();

  // Same call again returns same container
  const annotationId2 = await asUser.mutation(api.annotations.crud.upsertWithAutoContainer, {
    agentId,
    source: { kind: "conversation", conversationId },
    hint: { kind: "playground" },
    rating: "great",
    tags: [],
  });
  const ann2 = await t.run(async (ctx) => await ctx.db.get(annotationId2));
  expect(ann2?.errorAnalysisId).toBe(ann?.errorAnalysisId);
  expect(ann2?.rating).toBe("great");
});
```

- [ ] **Step 3.2: Run, confirm failure**

```bash
cd packages/backend && pnpm test annotationsCrud
```

- [ ] **Step 3.3: Replace `upsert` with `upsertWithAutoContainer`**

In `convex/annotations/crud.ts`, replace the existing `upsert` export with:

```ts
const hintValidator = v.union(
  v.object({ kind: v.literal("simulation"), simulationId: v.id("conversationSimulations") }),
  v.object({ kind: v.literal("upload"),     uploadId:     v.id("livechatUploads") }),
  v.object({ kind: v.literal("playground") }),
  v.object({ kind: v.literal("analysis"),   errorAnalysisId: v.id("errorAnalyses") }),
);

export const upsertWithAutoContainer = mutation({
  args: {
    agentId: v.id("agents"),
    source: sourceValidator,
    hint: hintValidator,
    rating: ratingValidator,
    comment: v.optional(v.string()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx, userId);

    // Verify source row
    if (args.source.kind === "conversation") {
      const conv = await ctx.db.get(args.source.conversationId);
      if (!conv || conv.orgId !== orgId) throw new Error("Conversation not found");
    } else {
      const tr = await ctx.db.get(args.source.transcriptId);
      if (!tr || tr.orgId !== orgId) throw new Error("Transcript not found");
    }

    // Resolve container (inline; avoids cross-mutation call)
    const errorAnalysisId = await resolveContainerInline(ctx, orgId, args.agentId, args.hint);

    // Add membership (idempotent)
    await addMemberInline(ctx, orgId, errorAnalysisId, args.source, "annotation");

    // Upsert annotation
    const existing = await queryAnnotationsBySource(ctx, args.source as AnnotationSource);
    const mine = existing.find((a) => a.ratedBy === user._id);
    if (mine) {
      await ctx.db.patch(mine._id, {
        rating: args.rating,
        comment: args.comment,
        tags: args.tags,
        errorAnalysisId,
        updatedAt: Date.now(),
      });
      return mine._id;
    }
    return await ctx.db.insert("annotations", {
      orgId,
      errorAnalysisId,
      source: args.source,
      rating: args.rating,
      comment: args.comment,
      tags: args.tags,
      ratedBy: user._id,
      createdAt: Date.now(),
    });
  },
});

// (move resolveContainerInline + addMemberInline here, or import from errorAnalysis/members
//  by reusing the same body since internalMutation can't be called from a public mutation in
//  the same DB tx. Inline copy is fine; both paths share unit-tested logic via Task 2's helper
//  being the canonical one — repeat the body here verbatim to stay transactional.)
```

> Note: Convex doesn't let one mutation call another in the same transaction. So copy the resolve + add-member bodies into `crud.ts` as private async fns. Keep them byte-identical to `errorAnalysis/members.ts` so the canonical version in Task 2 remains the reference; tests in Task 2 protect the logic.

- [ ] **Step 3.4: Delete the old `upsert` export**

Remove the original `upsert` export from `annotations/crud.ts`. The internal `bySourceInternal` and other queries stay.

- [ ] **Step 3.5: Update existing call sites**

```bash
grep -rn "api\.annotations\.crud\.upsert\b" packages/frontend/src packages/backend/convex
```

For each hit, swap to `upsertWithAutoContainer` with the appropriate `agentId` + `hint` props. Frontend hits get fixed in Phase 4; backend internal hits (if any) get adjusted now.

- [ ] **Step 3.6: Run tests + typecheck**

```bash
cd packages/backend && pnpm test annotationsCrud && pnpm typecheck
```
Expected: PASS, typecheck clean (frontend may still be broken — fix in Phase 4).

- [ ] **Step 3.7: Commit**

```bash
git add packages/backend
git commit -m "feat(backend): annotations.upsertWithAutoContainer w/ lazy container creation"
```

---

### Task 4: `errorAnalysis/orchestration.ts` — public CRUD

**Files:**
- Create: `packages/backend/convex/errorAnalysis/orchestration.ts`
- Test:   `packages/backend/tests/errorAnalyses.test.ts` (extend)

- [ ] **Step 4.1: Tests for `byAgent`, `get`, `createCustom`, `rename`, `deleteAnalysis`**

Add tests for each. Each test seeds an agent + one or two analyses and asserts query/mutation results. Use the same helpers as Task 2.

```ts
it("byAgent returns analyses with counts", async () => {
  /* ... seed agent + 2 analyses + members + annotations + failure modes ... */
  const result = await asUser.query(api.errorAnalysis.orchestration.byAgent, { agentId });
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({
    memberCount: expect.any(Number),
    annotatedCount: expect.any(Number),
    failureModeCount: expect.any(Number),
    judgeCount: expect.any(Number),
  });
});

it("createCustom imports N conversations", async () => {
  /* ... seed 5 playground convs ... */
  const id = await asUser.mutation(api.errorAnalysis.orchestration.createCustom, {
    agentId,
    name: "Last 3",
    sourcePool: { kind: "playground" },
    size: 3,
  });
  const members = await t.run((ctx) =>
    ctx.db.query("errorAnalysisMembers")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", id)).collect(),
  );
  expect(members).toHaveLength(3);
});
```

- [ ] **Step 4.2: Run to confirm failures**

```bash
cd packages/backend && pnpm test errorAnalyses
```

- [ ] **Step 4.3: Implement `orchestration.ts`**

Public mutations + queries:

```ts
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";
// ... import shared inline helpers (or copy from members.ts pattern)

export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db.query("errorAnalyses")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .collect();
    return await Promise.all(rows.filter(r => r.orgId === orgId).map(async (r) => {
      const members = await ctx.db.query("errorAnalysisMembers")
        .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", r._id)).collect();
      const annotated = members.filter(m => m.addedVia === "annotation").length;
      const failureModes = await ctx.db.query("failureModes")
        .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", r._id)).collect();
      // judges count: query evaluators where source.kind=error_analysis & source.errorAnalysisId=r._id
      const evaluators = await ctx.db.query("evaluators")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId)).collect();
      const judgeCount = evaluators.filter(e =>
        e.source.kind === "error_analysis" && e.source.errorAnalysisId === r._id,
      ).length;
      return {
        ...r,
        memberCount: members.length,
        annotatedCount: annotated,
        failureModeCount: failureModes.length,
        judgeCount,
      };
    }));
  },
});

export const get = query({
  args: { id: v.id("errorAnalyses") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const r = await ctx.db.get(id);
    if (!r || r.orgId !== orgId) return null;
    return r;
  },
});

export const createCustom = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    sourcePool: v.union(
      v.object({ kind: v.literal("playground") }),
      v.object({ kind: v.literal("simulation"), simulationId: v.id("conversationSimulations") }),
      v.object({ kind: v.literal("upload"),     uploadId:     v.id("livechatUploads") }),
    ),
    size: v.union(v.literal(10), v.literal(20), v.literal(50), v.literal(100), v.literal(200)),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const analysisId = await ctx.db.insert("errorAnalyses", {
      orgId,
      agentId: args.agentId,
      name: args.name,
      origin: { kind: "custom" },
      createdAt: Date.now(),
    });
    // Sample N newest convs from the pool
    const sampled = await samplePool(ctx, orgId, args.agentId, args.sourcePool, args.size, []);
    for (const s of sampled) {
      await ctx.db.insert("errorAnalysisMembers", {
        orgId, errorAnalysisId: analysisId, source: s, addedVia: "import", addedAt: Date.now(),
      });
    }
    return analysisId;
  },
});

export const importMore = mutation({
  args: {
    errorAnalysisId: v.id("errorAnalyses"),
    sourcePool: /* same union as createCustom */,
    size: /* same literal union */,
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const a = await ctx.db.get(args.errorAnalysisId);
    if (!a || a.orgId !== orgId) throw new Error("Analysis not found");
    const existingMembers = await ctx.db.query("errorAnalysisMembers")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", args.errorAnalysisId)).collect();
    const excludeConvIds = existingMembers
      .filter(m => m.source.kind === "conversation")
      .map(m => m.source.conversationId);
    const excludeTrIds = existingMembers
      .filter(m => m.source.kind === "transcript")
      .map(m => m.source.transcriptId);
    const sampled = await samplePool(ctx, orgId, a.agentId, args.sourcePool, args.size, [...excludeConvIds, ...excludeTrIds]);
    for (const s of sampled) {
      await ctx.db.insert("errorAnalysisMembers", {
        orgId, errorAnalysisId: args.errorAnalysisId, source: s, addedVia: "import", addedAt: Date.now(),
      });
    }
    return sampled.length;
  },
});

export const rename = mutation({
  args: { id: v.id("errorAnalyses"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const { orgId } = await getAuthContext(ctx);
    const r = await ctx.db.get(id);
    if (!r || r.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { name, updatedAt: Date.now() });
  },
});

export const deleteAnalysis = mutation({
  args: { id: v.id("errorAnalyses") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const r = await ctx.db.get(id);
    if (!r || r.orgId !== orgId) throw new Error("Not found");
    // Cascade: members, annotations, failureModes, memberships
    const members = await ctx.db.query("errorAnalysisMembers")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", id)).collect();
    for (const m of members) await ctx.db.delete(m._id);
    const anns = await ctx.db.query("annotations")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", id)).collect();
    for (const a of anns) await ctx.db.delete(a._id);
    const modes = await ctx.db.query("failureModes")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", id)).collect();
    for (const m of modes) {
      const memberships = await ctx.db.query("failureModeMemberships")
        .withIndex("by_failure_mode", (q) => q.eq("failureModeId", m._id)).collect();
      for (const mm of memberships) await ctx.db.delete(mm._id);
      await ctx.db.delete(m._id);
    }
    await ctx.db.delete(id);
  },
});

// samplePool: helper that returns the newest N convs from the chosen source, excluding given ids.
async function samplePool(ctx: any, orgId: string, agentId: any, pool: any, size: number, excludeIds: any[]) {
  const exclude = new Set(excludeIds.map(String));
  if (pool.kind === "playground") {
    const convs = await ctx.db.query("conversations")
      .withIndex("by_agent_source", /* if exists, else by_agent */ (q: any) => q.eq("agentId", agentId).eq("source", "playground"))
      .order("desc").collect();
    return convs.filter((c: any) => !exclude.has(String(c._id))).slice(0, size)
      .map((c: any) => ({ kind: "conversation", conversationId: c._id }));
  }
  if (pool.kind === "simulation") {
    const convs = await ctx.db.query("conversations")
      .filter((q: any) => q.eq(q.field("simulationId"), pool.simulationId))
      .order("desc").collect();
    return convs.filter((c: any) => !exclude.has(String(c._id))).slice(0, size)
      .map((c: any) => ({ kind: "conversation", conversationId: c._id }));
  }
  // upload
  const trs = await ctx.db.query("livechatConversations")
    .filter((q: any) => q.eq(q.field("uploadId"), pool.uploadId))
    .order("desc").collect();
  return trs.filter((t: any) => !exclude.has(String(t._id))).slice(0, size)
    .map((t: any) => ({ kind: "transcript", transcriptId: t._id }));
}
```

> The exact index names on `conversations` / `livechatConversations` depend on what's defined in `schema.ts`. Inspect those tables first; add a `by_agent_source` or `by_simulation` index if missing (separate task), or use `.filter` if the volume is small enough for the current dev dataset.

- [ ] **Step 4.4: Run tests, fix any index issues**

```bash
cd packages/backend && pnpm test errorAnalyses
```

- [ ] **Step 4.5: Commit**

```bash
git add packages/backend/convex/errorAnalysis packages/backend/tests/errorAnalyses.test.ts
git commit -m "feat(backend): error-analysis CRUD — byAgent, get, createCustom, importMore, rename, delete (cascading)"
```

---

### Task 5: Failure-modes `byAnalysis` query + `errorAnalysisId` on writes

**Files:**
- Modify: `packages/backend/convex/failureModes/crud.ts`
- Test:   `packages/backend/tests/failureModesCrud.test.ts` (extend)

- [ ] **Step 5.1: Update mutations to accept `errorAnalysisId` (required)**

Every create mutation in `failureModes/crud.ts` gains `errorAnalysisId: v.id("errorAnalyses")` and writes it to the row. Patch existing `byAgent` to also accept an optional `errorAnalysisId` filter.

- [ ] **Step 5.2: Add `byAnalysis` query**

```ts
export const byAnalysis = query({
  args: { errorAnalysisId: v.id("errorAnalyses") },
  handler: async (ctx, { errorAnalysisId }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db.query("failureModes")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", errorAnalysisId))
      .collect();
    return rows.filter((r) => r.orgId === orgId);
  },
});
```

- [ ] **Step 5.3: Update existing tests + add `byAnalysis` test**

- [ ] **Step 5.4: Run tests**

```bash
cd packages/backend && pnpm test failureModesCrud
```

- [ ] **Step 5.5: Commit**

```bash
git add packages/backend/convex/failureModes packages/backend/tests/failureModesCrud.test.ts
git commit -m "feat(backend): failureModes — analysis-scoped writes + byAnalysis query"
```

---

### Task 6: Clustering action — analysis-scoped

**Files:**
- Create: `packages/backend/convex/errorAnalysis/clustering.ts` (`"use node"`)
- Modify or remove: old clustering action under `convex/experiments/...` if it existed agent-scoped

- [ ] **Step 6.1: Copy existing clustering implementation to new file**

Lift the LLM clustering logic into `clustering.ts`. Input changes: takes `errorAnalysisId` instead of `experimentId`. Reads annotations via `by_analysis` index. Writes failure modes with `errorAnalysisId` populated.

```ts
"use node";
import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const cluster = action({
  args: { errorAnalysisId: v.id("errorAnalyses") },
  handler: async (ctx, { errorAnalysisId }) => {
    // 1. Fetch annotations for this analysis via internalQuery
    // 2. Call LLM (existing util)
    // 3. Write proposed failure modes back via internalMutation
    // Steps mirror the previous experiment-scoped clustering action.
  },
});
```

- [ ] **Step 6.2: Smoke test via convex-test**

Doesn't need full LLM; mock the LLM call or test only the data plumbing in / out.

- [ ] **Step 6.3: Delete the old experiment-scoped clustering action if present**

```bash
grep -rn "axial\|cluster\|failureModes" packages/backend/convex/experiments/
```
Remove references that are now redundant.

- [ ] **Step 6.4: Commit**

```bash
git add packages/backend/convex
git commit -m "feat(backend): analysis-scoped failure-mode clustering action"
```

---

### Task 7: Spawn-judge mutation with label inheritance

**Files:**
- Create: `packages/backend/convex/errorAnalysis/evaluatorSpawn.ts`
- Test:   `packages/backend/tests/evaluatorSpawn.test.ts`

- [ ] **Step 7.1: Write failing test**

```ts
it("spawnJudgeFromFailureMode creates evaluator + inherits fail/pass labels", async () => {
  /* seed analysis with 4 annotated convs, 2 in failure mode A, 2 not */
  const evalId = await asUser.mutation(api.errorAnalysis.evaluatorSpawn.spawnJudgeFromFailureMode, {
    failureModeId,
  });
  const labels = await t.run((ctx) => ctx.db.query("evaluatorLabels")
    .withIndex("by_evaluator", (q) => q.eq("evaluatorId", evalId)).collect());
  expect(labels.filter(l => l.humanLabel === "fail")).toHaveLength(2);
  expect(labels.filter(l => l.humanLabel === "pass")).toHaveLength(2);
});
```

- [ ] **Step 7.2: Run, confirm failure**

- [ ] **Step 7.3: Implement**

```ts
export const spawnJudgeFromFailureMode = mutation({
  args: { failureModeId: v.id("failureModes") },
  handler: async (ctx, { failureModeId }) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx, userId);
    const mode = await ctx.db.get(failureModeId);
    if (!mode || mode.orgId !== orgId) throw new Error("Failure mode not found");

    // Create evaluator
    const evaluatorId = await ctx.db.insert("evaluators", {
      orgId,
      agentId: mode.agentId,
      name: mode.name,
      description: mode.description,
      type: "llm_judge",
      llmJudgeConfig: {
        dimensions: [{
          failureModeId,
          name: mode.name,
          rubric: mode.description,
          passExamples: [],
          failExamples: [],
        }],
        outputFormat: "per_dimension",
        model: "gpt-4o-mini",   // default
        inputContext: ["transcript"],
      },
      source: { kind: "error_analysis", failureModeId, errorAnalysisId: mode.errorAnalysisId },
      status: "draft",
      tags: [],
      createdAt: Date.now(),
    });

    // Fail labels: failureModeMemberships for this mode
    const memberships = await ctx.db.query("failureModeMemberships")
      .withIndex("by_failure_mode", (q) => q.eq("failureModeId", failureModeId)).collect();
    for (const m of memberships) {
      await ctx.db.insert("evaluatorLabels", {
        orgId, evaluatorId,
        failureModeId,
        source: m.source,
        humanLabel: "fail",
        origin: { kind: "axial_coding", failureModeId },
        ratedBy: user._id,
        createdAt: Date.now(),
      });
    }

    // Pass labels: annotated members of the analysis NOT in this failure mode
    const annotated = await ctx.db.query("annotations")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", mode.errorAnalysisId)).collect();
    const memberSet = new Set(memberships.map(m =>
      m.source.kind === "conversation" ? `c:${m.source.conversationId}` : `t:${m.source.transcriptId}`
    ));
    for (const a of annotated) {
      const key = a.source.kind === "conversation" ? `c:${a.source.conversationId}` : `t:${a.source.transcriptId}`;
      if (memberSet.has(key)) continue;
      await ctx.db.insert("evaluatorLabels", {
        orgId, evaluatorId,
        failureModeId,
        source: a.source,
        humanLabel: "pass",
        origin: { kind: "inferred_negative" },
        ratedBy: user._id,
        createdAt: Date.now(),
      });
    }
    return evaluatorId;
  },
});
```

- [ ] **Step 7.4: Run test, verify pass**

- [ ] **Step 7.5: Commit**

```bash
git add packages/backend
git commit -m "feat(backend): spawnJudgeFromFailureMode w/ auto-inherited fail/pass labels"
```

---

## Phase 3 — Shared frontend components

### Task 8: `AnnotationSidePanel`

**Files:**
- Create: `packages/frontend/src/components/annotations/AnnotationSidePanel.tsx`

- [ ] **Step 8.1: Write the component**

```tsx
"use client";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@/lib/convex";

export type PencilOriginHint =
  | { kind: "simulation"; simulationId: Id<"conversationSimulations"> }
  | { kind: "upload";     uploadId:     Id<"livechatUploads"> }
  | { kind: "playground" }
  | { kind: "analysis";   errorAnalysisId: Id<"errorAnalyses"> };

interface Props {
  agentId: Id<"agents">;
  conversationRef:
    | { kind: "conversation"; conversationId: Id<"conversations"> }
    | { kind: "transcript";   transcriptId: Id<"livechatConversations"> };
  originHint: PencilOriginHint;
  open: boolean;
  onClose(): void;
}

const RATINGS = ["great", "good_enough", "bad", "pass", "fail"] as const;

export function AnnotationSidePanel(props: Props) {
  const existing = useQuery(api.annotations.crud.bySource, { source: props.conversationRef });
  const upsert = useMutation(api.annotations.crud.upsertWithAutoContainer);
  const mine = existing?.[0];

  const [rating, setRating] = useState<typeof RATINGS[number]>("bad");
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (mine) {
      setRating(mine.rating);
      setComment(mine.comment ?? "");
      setTags(mine.tags);
    }
  }, [mine?._id]);

  if (!props.open) return null;

  return (
    <aside className="fixed right-0 top-0 h-screen w-[360px] bg-zinc-900 border-l border-zinc-800 z-40 p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm font-semibold">Annotate</h2>
        <button onClick={props.onClose} className="text-zinc-400 hover:text-white">✕</button>
      </div>
      {/* rating buttons, tag input, comment textarea, Save button */}
      {/* On Save: upsert.mutate({ agentId, source: conversationRef, hint: originHint, rating, comment, tags }) */}
    </aside>
  );
}
```

Fill in the form UI per existing styling conventions (look at `ExperimentAnnotationPane` if it still exists; otherwise match the dark theme).

- [ ] **Step 8.2: Typecheck**

```bash
pnpm -C packages/frontend build
```

- [ ] **Step 8.3: Commit**

```bash
git add packages/frontend/src/components/annotations
git commit -m "feat(frontend): AnnotationSidePanel — reusable annotation drawer w/ origin hint"
```

---

### Task 9: `ErrorAnalysisCard`, `CreateCustomCohortModal`, `ImportMoreModal`, `FailureModeCard`

**Files:**
- Create each in `packages/frontend/src/components/errorAnalysis/`

- [ ] **Step 9.1: `ErrorAnalysisCard.tsx`**

Props: `{ analysis, onClick }`. Renders a card with origin badge, name, "X convs · Y annotated · Z failure modes · K judges".

- [ ] **Step 9.2: `CreateCustomCohortModal.tsx`**

Three-step modal (source kind → size → name). On submit: `api.errorAnalysis.orchestration.createCustom`, then navigate to the new analysis's annotate page.

- [ ] **Step 9.3: `ImportMoreModal.tsx`**

Used from inside an analysis detail. Source pool depends on container origin (sim/upload/playground → fixed; custom → user picks). Size: 10/20/50/100/200, capped to remaining. On submit: `api.errorAnalysis.orchestration.importMore`.

- [ ] **Step 9.4: `FailureModeCard.tsx`**

Renders one failure mode in the Failure modes tab. Shows name (editable), description (editable), member count. Buttons: `+ Spawn judge`. If judges exist, render "K judges spawned →" link.

- [ ] **Step 9.5: Typecheck + commit**

```bash
pnpm -C packages/frontend build
git add packages/frontend/src/components/errorAnalysis
git commit -m "feat(frontend): error-analysis cards + modals (Create, ImportMore, FailureModeCard)"
```

---

### Task 10: `FromFailureModeModal` (for evaluator creation)

**Files:**
- Create: `packages/frontend/src/components/evaluators/FromFailureModeModal.tsx`

- [ ] **Step 10.1: Implement**

Two-step modal: pick analysis (lists `api.errorAnalysis.orchestration.byAgent`), pick failure mode (`api.failureModes.crud.byAnalysis`). On submit: `api.errorAnalysis.evaluatorSpawn.spawnJudgeFromFailureMode`. Navigate to `/agents/[id]/evaluate/evaluators/[evalId]`.

- [ ] **Step 10.2: Commit**

---

## Phase 4 — New routes

### Task 11: Sidebar entry + routes scaffolding

**Files:**
- Modify: `packages/frontend/src/components/shell/sidebars.tsx`
- Create: `packages/frontend/src/app/agents/[id]/evaluate/error-analysis/page.tsx`
- Create: `packages/frontend/src/app/agents/[id]/evaluate/error-analysis/[analysisId]/page.tsx`
- Create: `.../[analysisId]/annotate/page.tsx`
- Create: `.../[analysisId]/failure-modes/page.tsx`

- [ ] **Step 11.1: Update `agentSidebar` export**

Add an entry between Experiments and Evaluators:

```ts
{ label: "Error analysis", href: `/agents/${agentId}/evaluate/error-analysis`, icon: ErrorAnalysisIcon },
```

- [ ] **Step 11.2: Landing page (grid of cards)**

`error-analysis/page.tsx` — `useQuery(api.errorAnalysis.orchestration.byAgent)` → grid of `ErrorAnalysisCard`s. Top-right: `+ New analysis` opens `CreateCustomCohortModal`.

- [ ] **Step 11.3: `[analysisId]/page.tsx` redirects to `/annotate`**

```tsx
import { redirect } from "next/navigation";
export default function Page({ params }: { params: { id: string; analysisId: string } }) {
  redirect(`/agents/${params.id}/evaluate/error-analysis/${params.analysisId}/annotate`);
}
```

- [ ] **Step 11.4: Annotate tab**

Three-column layout: members list (left) | transcript (center) | `AnnotationSidePanel` (right, always open in this view, `originHint: { kind: "analysis", errorAnalysisId }`).

Selected conversation in URL as `?conv=<id>`. Click in list → updates query string + side panel re-binds.

- [ ] **Step 11.5: Failure modes tab**

Top: container metadata + tab strip (Annotate / Failure modes). Below: header "N modes · ⟲ Re-cluster". Grid of `FailureModeCard`s. Re-cluster button calls `api.errorAnalysis.clustering.cluster`.

- [ ] **Step 11.6: Typecheck + smoke test in browser**

```bash
pnpm dev   # in one terminal
pnpm dev:backend  # in another
```
Open `/agents/<id>/evaluate/error-analysis`. Create a custom cohort. Open it. Annotate a conv. Verify member appears.

- [ ] **Step 11.7: Commit**

```bash
git add packages/frontend
git commit -m "feat(frontend): Error analysis section — landing grid, detail (annotate/failure-modes tabs)"
```

---

## Phase 5 — Integrate pencil into existing viewers + delete sub-sidebar

### Task 12: Sim-run viewer — flatten + pencil

**Files:**
- Modify: `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/page.tsx`
- **Delete:** `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/layout.tsx`
- **Delete:** `.../experiments/[runId]/open-coding/` (whole dir)
- **Delete:** `.../experiments/[runId]/axial-coding/` (whole dir)
- Modify: `packages/frontend/src/components/shell/sidebars.tsx` — remove `agentRunSidebar` export

- [ ] **Step 12.1: Delete sub-sidebar layout + sub-pages**

```bash
rm packages/frontend/src/app/agents/\[id\]/evaluate/experiments/\[runId\]/layout.tsx
rm -rf packages/frontend/src/app/agents/\[id\]/evaluate/experiments/\[runId\]/open-coding
rm -rf packages/frontend/src/app/agents/\[id\]/evaluate/experiments/\[runId\]/axial-coding
```

- [ ] **Step 12.2: Remove `agentRunSidebar` from `sidebars.tsx`** + any callers

```bash
grep -rn "agentRunSidebar" packages/frontend/src
```

- [ ] **Step 12.3: Rewrite `[runId]/page.tsx`**

Two columns: conversation list (left) | transcript (right). Above transcript: ✏ Annotate button. Top-right of header: secondary "View as error analysis →" link.

Annotate click → opens `<AnnotationSidePanel originHint={{ kind: "simulation", simulationId }} ... />`. "View as error analysis" → click resolves container via a tiny new mutation `api.errorAnalysis.orchestration.openForOrigin` that calls the same resolveContainer helper, then navigates.

> Add `openForOrigin` mutation in `errorAnalysis/orchestration.ts` if it isn't there yet — returns the existing container id, or creates one (empty) and returns its id.

- [ ] **Step 12.4: Smoke test**

`/agents/<id>/evaluate/experiments/<runId>` shows flat viewer; pencil opens panel; annotation creates `errorAnalyses` row of origin=`simulation`; clicking "View as error analysis" navigates to that container.

- [ ] **Step 12.5: Commit**

```bash
git add -A packages/frontend
git commit -m "feat(frontend): flatten sim-run viewer; pencil + view-as-error-analysis link; remove run sub-sidebar"
```

---

### Task 13: Playground + transcript viewers — pencil

**Files:**
- Modify: `packages/frontend/src/app/agents/[id]/configure/page.tsx` (or playground component)
- Modify: transcript viewer (locate via `grep -rn "livechatConversations" packages/frontend/src/app`)

- [ ] **Step 13.1: Playground — add pencil to each playground conversation**

Mount `<AnnotationSidePanel originHint={{ kind: "playground" }} ... />`.

- [ ] **Step 13.2: Transcript viewer — add pencil**

`originHint: { kind: "upload", uploadId }`.

- [ ] **Step 13.3: Commit**

```bash
git add packages/frontend
git commit -m "feat(frontend): pencil annotation on playground & transcript viewers"
```

---

### Task 14: Evaluators page — "From failure mode" option

**Files:**
- Modify: `packages/frontend/src/app/agents/[id]/evaluate/evaluators/page.tsx`

- [ ] **Step 14.1: Extend the `+ New Evaluator` menu**

Existing options: Start blank, From template. Add: **From failure mode** → opens `<FromFailureModeModal>`.

- [ ] **Step 14.2: Smoke test**

Create an analysis with 1 failure mode → spawn judge via `From failure mode` menu → verify evaluator created with labels inherited.

- [ ] **Step 14.3: Commit**

```bash
git add packages/frontend
git commit -m "feat(frontend): evaluator creation — 'From failure mode' option"
```

---

## Phase 6 — Cleanup + final verification

### Task 15: Drop obsolete code paths

- [ ] **Step 15.1: Remove `api.annotations.crud.upsert`** if still exported (Task 3 should have done this; verify)

```bash
grep -rn "annotations\.crud\.upsert\b" packages/
```

- [ ] **Step 15.2: Remove old experiment-scoped axial / failure-mode components**

```bash
grep -rn "ExperimentNavSidebar\|ExperimentAnnotationPane" packages/frontend/src
# delete unreferenced files
```

- [ ] **Step 15.3: Remove obsolete crons / actions referencing old paths**

```bash
grep -rn "open-coding\|axial-coding" packages/backend packages/frontend
```

- [ ] **Step 15.4: Final typecheck + tests**

```bash
pnpm -C packages/backend typecheck && pnpm -C packages/backend test
pnpm -C packages/frontend build
```

- [ ] **Step 15.5: Manual click-through (per spec testing section)**

Walk every bullet under the spec's "Testing (manual)" section. Each one passes → record in PR description.

- [ ] **Step 15.6: Final commit**

```bash
git add -A
git commit -m "chore: remove obsolete open-coding/axial-coding code paths"
```

---

## Self-Review notes

- All spec sections covered: schema (Task 1), container helpers (Tasks 2-4), failure modes (Task 5), clustering (Task 6), evaluator spawn (Task 7), AnnotationSidePanel (Task 8), other shared components (Tasks 9-10), new routes (Task 11), sim-run viewer flattening + sub-sidebar deletion (Task 12), pencil in other viewers (Task 13), evaluator "From failure mode" (Task 14), cleanup (Task 15).
- Tests live with their tasks; convex-test patterns mirror existing tests in `packages/backend/tests/`.
- Naming consistent: `errorAnalysisId`, `errorAnalyses`, `errorAnalysisMembers`, `spawnJudgeFromFailureMode` used uniformly across tasks.
- Manual testing in Phase 6 mirrors spec testing section.

---
