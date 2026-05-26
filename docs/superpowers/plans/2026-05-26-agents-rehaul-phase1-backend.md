# Agents Re-haul — Phase 1: Backend Reshape — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the greenfield schema reshape from `docs/superpowers/specs/2026-05-26-frontend-rehaul-agents-design.md` — drop legacy tables, reshape annotations/evaluators/scenarios/failureModes around polymorphic conversation sources, add `evaluatorTemplates` and `evaluatorLabels`, replace `evaluatorSetId`-based application with auto-run-all-ready, all behind passing `convex-test` suites. No UI changes in this phase.

**Architecture:** Schema-first cutover. Each table is reshaped + its CRUD updated + its tests written before moving on. The cutover is irreversible (legacy rows in dropped tables are abandoned, not migrated) — acceptable because the org has not deployed to production. Convex's file-based routing means we organise by domain dir (`crud/`, `evaluator/`, `annotations/`, `failureModes/`, `conversationSim/`) and `"use node"` action files live alongside same-domain mutations/queries.

**Tech Stack:** Convex 1.x, TypeScript strict, `convex-test` + Vitest, pnpm workspace. All commands run from repo root unless noted.

---

## Pre-flight

- [ ] **Step 1: Confirm worktree state**

Run from repo root:
```bash
git status && git branch --show-current
```
Expected: branch `worktree-frontend-rehaul-agent-branch`, working tree clean.

- [ ] **Step 2: Snapshot baseline test results**

Run:
```bash
pnpm -C packages/backend test 2>&1 | tail -30
```
Expected: 46 tests pass (per CLAUDE.md). Note the number — Phase 1 will shrink it (deleted tables = deleted tests) and grow it again with new tests.

- [ ] **Step 3: Read the spec end-to-end before starting**

Read `docs/superpowers/specs/2026-05-26-frontend-rehaul-agents-design.md` completely. The schema section is the contract; this plan implements it. Do not deviate; if a deviation seems necessary, surface it before coding.

---

## Task 1: Schema rewrite (single atomic change)

**Files:**
- Modify: `packages/backend/convex/schema.ts`

The schema is the cutover. Doing it in one commit means the next typecheck surfaces every broken reference at once, which gives us the work list for the rest of the plan.

- [ ] **Step 1.1: Open `packages/backend/convex/schema.ts` and locate the following tables**

Tables to touch (line numbers approximate, search by name):
- `evaluators` (line ~837) — reshape
- `evaluatorSets` (line ~868) — **delete**
- `evaluatorConfigs` (line ~464) — **delete** (legacy, merged into evaluators)
- `annotations` (line ~419) — reshape (polymorphic source)
- `failureModes` (line ~441) — reshape (add agentId, drop experimentId)
- `failureModeQuestionMappings` (line ~452) — **rename to `failureModeMemberships`** + polymorphic source
- `conversationScenarios` (search) — reshape (agentId required + source union)
- `conversationSimulations` (line ~878) — drop `evaluatorSetId`
- `conversationSimRuns` (line ~918) — drop `annotations: v.optional(v.string())` field, make `conversationId` **required**
- `agentExperimentResults` — **delete**
- `conversations` (line ~724) — remove `"experiment"` from `source` union

- [ ] **Step 1.2: Apply the reshape**

Replace each table definition per the spec. Concrete shapes:

```ts
// ─── REPLACED ───
evaluators: defineTable({
  orgId: v.string(),
  agentId: v.id("agents"),
  name: v.string(),
  description: v.string(),
  type: v.union(v.literal("code"), v.literal("llm_judge")),
  codeJudgeConfig: v.optional(v.object({
    checkType: v.union(
      v.literal("tool_call_match"),
      v.literal("string_contains"),
      v.literal("regex_match"),
      v.literal("response_format"),
    ),
    params: v.any(),
  })),
  llmJudgeConfig: v.optional(v.object({
    dimensions: v.array(v.object({
      failureModeId: v.optional(v.id("failureModes")),
      name: v.string(),
      rubric: v.string(),
      passExamples: v.array(v.string()),
      failExamples: v.array(v.string()),
    })),
    outputFormat: v.union(v.literal("per_dimension"), v.literal("aggregate")),
    model: v.string(),
    inputContext: v.array(v.union(
      v.literal("transcript"),
      v.literal("tool_calls"),
      v.literal("kb_documents"),
    )),
  })),
  source: v.union(
    v.object({ kind: v.literal("manual") }),
    v.object({ kind: v.literal("template"),       templateId:    v.id("evaluatorTemplates") }),
    v.object({ kind: v.literal("error_analysis"), failureModeId: v.id("failureModes") }),
  ),
  status: v.union(
    v.literal("draft"), v.literal("calibrating"),
    v.literal("validated"), v.literal("ready"),
  ),
  splitConfig: v.optional(v.object({
    trainPct: v.number(),
    devPct: v.number(),
    testPct: v.number(),
  })),
  splitSeed: v.optional(v.number()),
  devMetrics: v.optional(v.object({
    tpr: v.number(),
    tnr: v.number(),
    agreement: v.number(),
  })),
  tags: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_org", ["orgId"])
  .index("by_agent", ["agentId"])
  .index("by_agent_status", ["agentId", "status"]),

// ─── NEW ───
evaluatorTemplates: defineTable({
  name: v.string(),
  description: v.string(),
  category: v.string(),
  type: v.union(v.literal("code"), v.literal("llm_judge")),
  prefilledConfig: v.any(),
})
  .index("by_category", ["category"]),

// ─── NEW ───
evaluatorLabels: defineTable({
  orgId: v.string(),
  evaluatorId: v.id("evaluators"),
  failureModeId: v.optional(v.id("failureModes")),
  source: v.union(
    v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
    v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
  ),
  humanLabel: v.union(v.literal("pass"), v.literal("fail")),
  splitAssignment: v.optional(v.union(
    v.literal("train"), v.literal("dev"), v.literal("test"),
  )),
  origin: v.union(
    v.object({ kind: v.literal("axial_coding"),        failureModeId: v.id("failureModes") }),
    v.object({ kind: v.literal("inferred_negative") }),
    v.object({ kind: v.literal("calibration_pass") }),
    v.object({ kind: v.literal("imported_annotation"), annotationId:  v.id("annotations") }),
  ),
  ratedBy: v.id("users"),
  createdAt: v.number(),
})
  .index("by_evaluator", ["evaluatorId"])
  .index("by_evaluator_split", ["evaluatorId", "splitAssignment"]),

// ─── REPLACED ───
annotations: defineTable({
  orgId: v.string(),
  source: v.union(
    v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
    v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
  ),
  rating: v.union(
    v.literal("great"), v.literal("good_enough"),
    v.literal("bad"),   v.literal("pass"), v.literal("fail"),
  ),
  comment: v.optional(v.string()),
  tags: v.array(v.string()),
  ratedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_org", ["orgId"])
  .index("by_conversation", ["source.conversationId"])
  .index("by_transcript",   ["source.transcriptId"]),

// ─── REPLACED ───
failureModes: defineTable({
  orgId: v.string(),
  agentId: v.id("agents"),
  name: v.string(),
  description: v.string(),
  order: v.number(),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_agent", ["agentId"]),

// ─── RENAMED + RESHAPED ─── (was failureModeQuestionMappings)
failureModeMemberships: defineTable({
  orgId: v.string(),
  failureModeId: v.id("failureModes"),
  source: v.union(
    v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
    v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
  ),
  createdAt: v.number(),
})
  .index("by_failure_mode", ["failureModeId"])
  .index("by_conversation", ["source.conversationId"]),

// ─── REPLACED ───
conversationScenarios: defineTable({
  orgId: v.string(),
  agentId: v.id("agents"),
  source: v.union(
    v.object({ kind: v.literal("synthetic"),  kbId: v.id("knowledgeBases") }),
    v.object({ kind: v.literal("grounded"),   transcriptUploadId: v.id("livechatUploads") }),
    v.object({ kind: v.literal("manual") }),
  ),
  // Preserve all existing scenario content fields (prompt, persona, expected behaviour, etc.)
  // from the previous definition — copy them in exactly. Only the framing changes.
  ...existingScenarioFields,
  createdAt: v.number(),
})
  .index("by_agent", ["agentId"])
  .index("by_kb", ["source.kbId"])
  .index("by_transcript_upload", ["source.transcriptUploadId"]),

// ─── PATCHED ───
// conversationSimulations: remove evaluatorSetId entirely.
// conversationSimRuns: remove `annotations: v.optional(v.string())` field; make conversationId required.
// conversations: change source union to v.union(v.literal("playground"), v.literal("simulation")) — drop "experiment".
```

For `...existingScenarioFields`, read the current `conversationScenarios` definition and copy its content-bearing fields verbatim. The placeholder must be replaced before commit; this plan step refuses to commit with the spread literally in the file.

- [ ] **Step 1.3: Run schema validation (no commit yet)**

```bash
pnpm -C packages/backend exec convex dev --once --typecheck-components disable 2>&1 | tail -40
```
Expected: Convex pushes the new schema, complains about data validation failures on any *existing* rows that don't fit (acceptable on a dev deployment — we'll clear). If it errors on the schema syntax itself, fix.

If Convex refuses because existing rows violate, clear the affected tables in the dev deployment dashboard (this is the cutover acknowledgement). Re-run.

- [ ] **Step 1.4: Run typecheck to enumerate broken references**

```bash
pnpm typecheck:backend 2>&1 | tee /tmp/typecheck-after-schema.txt | tail -80
```

The file `/tmp/typecheck-after-schema.txt` is the work list for tasks 2–14. Every error in it must end up resolved by a later task.

- [ ] **Step 1.5: Commit the schema change alone**

```bash
git add packages/backend/convex/schema.ts
git commit -m "$(cat <<'EOF'
feat(backend): greenfield schema reshape for Agents section (rev 3 spec)

Drops evaluatorConfigs, evaluatorSets, agentExperimentResults.
Renames failureModeQuestionMappings → failureModeMemberships.
Reshapes evaluators, annotations, failureModes, conversationScenarios
with polymorphic conversation source. Adds evaluatorTemplates,
evaluatorLabels. Drops conversationSimulations.evaluatorSetId and
conversationSimRuns.annotations. Removes "experiment" from
conversations.source union.

Subsequent commits delete dead code and rewrite CRUD per the new shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Delete code referencing dropped tables

The typecheck output names every file that references the dropped tables. Walk through them.

**Files (expected — verify against typecheck output):**
- Delete: any module under `packages/backend/convex/` referencing `evaluatorConfigs`, `evaluatorSets`, `agentExperimentResults` exclusively.
- Modify: any module that *also* does live work — strip just the dropped references.

- [ ] **Step 2.1: List candidates**

```bash
grep -rln "evaluatorConfigs\|evaluatorSets\|agentExperimentResults" packages/backend/convex/ packages/backend/tests/
```

- [ ] **Step 2.2: For each file in the list, classify**

For each file, decide:
- **DELETE** if its entire purpose is the dropped table (e.g., a `crud/evaluatorSets.ts` would be deleted wholesale).
- **EDIT** if it contains other live logic; remove only the dropped references and any branches that become unreachable.

Apply the deletions / edits. After each file, re-run:
```bash
pnpm typecheck:backend 2>&1 | tail -20
```
to confirm forward progress (error count strictly decreasing).

- [ ] **Step 2.3: Re-run typecheck — should now show only references to renamed/reshaped tables, no dropped-table references**

```bash
pnpm typecheck:backend 2>&1 | grep -E "evaluatorConfigs|evaluatorSets|agentExperimentResults"
```
Expected: empty output.

- [ ] **Step 2.4: Delete corresponding tests**

```bash
ls packages/backend/tests/ | grep -iE "evaluatorConfig|evaluatorSet|agentExperimentResult"
```
Delete any tests that target dropped tables exclusively. For tests that touched multiple tables, strip just the dropped-table assertions.

- [ ] **Step 2.5: Commit**

```bash
git add -A packages/backend/
git commit -m "chore(backend): delete code referencing dropped tables (evaluatorConfigs, evaluatorSets, agentExperimentResults)"
```

---

## Task 3: Strip `evaluatorSetId` from conversationSim orchestration

**Files:**
- Modify: `packages/backend/convex/conversationSim/orchestration.ts`
- Modify: any caller of the start-simulation mutation

- [ ] **Step 3.1: Find the start-simulation mutation**

```bash
grep -n "evaluatorSetId" packages/backend/convex/conversationSim/*.ts packages/backend/convex/conversationSim/**/*.ts 2>/dev/null
```

- [ ] **Step 3.2: Remove `evaluatorSetId` from the mutation args and DB insert**

Replace any pattern like:
```ts
args: { ..., evaluatorSetId: v.optional(v.id("evaluatorSets")), ... }
// ...
const simId = await ctx.db.insert("conversationSimulations", { ..., evaluatorSetId: args.evaluatorSetId, ... });
```
with the same code minus `evaluatorSetId`. Replace it with a TODO comment marking the task that will wire auto-run-all-ready (Task 11):
```ts
// (auto-apply: all `ready` evaluators for this agent run inline at sim time — see evaluators/autoApply.ts)
```

- [ ] **Step 3.3: Typecheck**
```bash
pnpm typecheck:backend
```
Expected: no errors referencing `evaluatorSetId`.

- [ ] **Step 3.4: Commit**
```bash
git add packages/backend/convex/conversationSim/
git commit -m "refactor(backend): drop evaluatorSetId from sim orchestration (auto-apply replaces it in Task 11)"
```

---

## Task 4: Rewrite `crud/scenarios.ts` against new shape

**Files:**
- Modify: `packages/backend/convex/crud/scenarios.ts` (if exists; otherwise look under `conversationSim/scenarios.ts`)
- Test: `packages/backend/tests/scenariosCrud.test.ts`

- [ ] **Step 4.1: Locate the current scenarios CRUD**

```bash
find packages/backend/convex -name "scenarios*.ts" -not -path "*_generated*"
```

- [ ] **Step 4.2: Write the failing test first**

Create `packages/backend/tests/scenariosCrud.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest, seedUser, seedKB, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

describe("scenarios CRUD (rev 3 shape)", () => {
  it("creates synthetic scenario scoped to agent + KB", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const kbId = await seedKB(t, userId);
    const agentId = await t.run(async (ctx) =>
      ctx.db.insert("agents", {
        orgId: TEST_ORG_ID, name: "test agent", systemPrompt: "", createdBy: userId, createdAt: Date.now(),
      } as any)
    );

    const id = await t.withIdentity(testIdentity).mutation(
      api.crud.scenarios.create,
      {
        agentId,
        source: { kind: "synthetic", kbId },
        // ...minimum required scenario content fields (copy from existing CreateArgs)
      } as any
    );

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.agentId).toBe(agentId);
    expect(row?.source).toEqual({ kind: "synthetic", kbId });
  });

  it("byAgent returns only this agent's scenarios", async () => {
    // ...analogous: seed two agents + scenarios on each, assert filtering
  });

  it("byKb returns scenarios that depend on this KB (impact analysis)", async () => {
    // ...analogous
  });
});
```

- [ ] **Step 4.3: Run test — expect fail**

```bash
pnpm -C packages/backend test -- scenariosCrud 2>&1 | tail -20
```

- [ ] **Step 4.4: Implement the CRUD**

Rewrite the scenarios CRUD file to expose:

```ts
// packages/backend/convex/crud/scenarios.ts (or wherever)
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

const sourceUnion = v.union(
  v.object({ kind: v.literal("synthetic"),  kbId: v.id("knowledgeBases") }),
  v.object({ kind: v.literal("grounded"),   transcriptUploadId: v.id("livechatUploads") }),
  v.object({ kind: v.literal("manual") }),
);

export const create = mutation({
  args: {
    agentId: v.id("agents"),
    source: sourceUnion,
    // ...scenario content fields — copy from existing definition
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db.insert("conversationScenarios", {
      orgId,
      agentId: args.agentId,
      source: args.source,
      // ...other fields
      createdAt: Date.now(),
    });
  },
});

export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    await getAuthContext(ctx);
    return await ctx.db.query("conversationScenarios").withIndex("by_agent", q => q.eq("agentId", agentId)).collect();
  },
});

export const byKb = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, { kbId }) => {
    await getAuthContext(ctx);
    return await ctx.db.query("conversationScenarios").withIndex("by_kb", q => q.eq("source.kbId", kbId)).collect();
  },
});
```

(Preserve `update`, `delete`, and any other mutations from the existing file; only their writes change shape.)

- [ ] **Step 4.5: Run test — expect pass**

```bash
pnpm -C packages/backend test -- scenariosCrud
```

- [ ] **Step 4.6: Commit**
```bash
git add -A packages/backend/
git commit -m "feat(backend): rewrite scenarios CRUD against agentId + source union"
```

---

## Task 5: Rewrite `annotations` CRUD with polymorphic source

**Files:**
- Modify: `packages/backend/convex/annotations/crud.ts`
- Test: `packages/backend/tests/annotationsCrud.test.ts`

- [ ] **Step 5.1: Write failing test**

Create `packages/backend/tests/annotationsCrud.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";

describe("annotations CRUD (polymorphic source)", () => {
  it("creates annotation for a conversation source", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const convId = await t.run(async (ctx) =>
      ctx.db.insert("conversations", {
        orgId: TEST_ORG_ID, agentIds: [], status: "active",
        source: "playground", createdAt: Date.now(),
      } as any)
    );

    const id = await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
      source: { kind: "conversation", conversationId: convId },
      rating: "bad",
      tags: ["tone_issue"],
    });

    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.source).toEqual({ kind: "conversation", conversationId: convId });
    expect(row?.rating).toBe("bad");
  });

  it("creates annotation for a transcript source", async () => {
    // ...analogous with livechatConversations seed
  });

  it("byConversation index returns annotations only for that conversation", async () => {
    // ...two conversations, two annotations each, filter by one, expect 2
  });

  it("rejects annotation without auth", async () => {
    const t = setupTest();
    await expect(
      t.mutation(api.annotations.crud.upsert, {
        source: { kind: "conversation", conversationId: "x" as any },
        rating: "bad", tags: [],
      })
    ).rejects.toThrow(/auth|identity/i);
  });
});
```

- [ ] **Step 5.2: Run — expect fail**

```bash
pnpm -C packages/backend test -- annotationsCrud 2>&1 | tail -20
```

- [ ] **Step 5.3: Implement**

Rewrite `packages/backend/convex/annotations/crud.ts`. Key shape:

```ts
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext, lookupUser } from "../lib/auth";

const sourceUnion = v.union(
  v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
  v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
);

export const upsert = mutation({
  args: {
    source: sourceUnion,
    rating: v.union(
      v.literal("great"), v.literal("good_enough"),
      v.literal("bad"),   v.literal("pass"), v.literal("fail"),
    ),
    comment: v.optional(v.string()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx);

    // Upsert by source — one annotation per (source, user)
    const existing = await ctx.db
      .query("annotations")
      .withIndex(
        args.source.kind === "conversation" ? "by_conversation" : "by_transcript",
        q => args.source.kind === "conversation"
          ? q.eq("source.conversationId", args.source.conversationId)
          : q.eq("source.transcriptId", args.source.transcriptId)
      )
      .filter(q => q.eq(q.field("ratedBy"), user._id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: args.rating, comment: args.comment, tags: args.tags,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("annotations", {
      orgId,
      source: args.source,
      rating: args.rating,
      comment: args.comment,
      tags: args.tags,
      ratedBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const bySource = query({
  args: { source: sourceUnion },
  handler: async (ctx, { source }) => {
    await getAuthContext(ctx);
    if (source.kind === "conversation") {
      return await ctx.db.query("annotations")
        .withIndex("by_conversation", q => q.eq("source.conversationId", source.conversationId))
        .collect();
    }
    return await ctx.db.query("annotations")
      .withIndex("by_transcript", q => q.eq("source.transcriptId", source.transcriptId))
      .collect();
  },
});

export const allTagsForOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db.query("annotations").withIndex("by_org", q => q.eq("orgId", orgId)).collect();
    const tags = new Set<string>();
    for (const r of rows) for (const t of r.tags) tags.add(t);
    return Array.from(tags).sort();
  },
});
```

- [ ] **Step 5.4: Run — expect pass**

```bash
pnpm -C packages/backend test -- annotationsCrud
```

- [ ] **Step 5.5: Delete the old `annotations/migrations.ts`**

The migrations module exists for the old experimentId-coupled shape. It's stale.
```bash
git rm packages/backend/convex/annotations/migrations.ts
```

- [ ] **Step 5.6: Commit**
```bash
git add -A packages/backend/
git commit -m "feat(backend): annotations polymorphic source (conversation | transcript), drop experimentId"
```

---

## Task 6: Rewrite `failureModes` CRUD (agentId-scoped, decoupled)

**Files:**
- Modify: `packages/backend/convex/failureModes/crud.ts`
- Test: `packages/backend/tests/failureModesCrud.test.ts` (rewrite — existing test targets the old shape)

- [ ] **Step 6.1: Open the existing test, replace it wholesale**

Replace `packages/backend/tests/failureModesCrud.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";

describe("failureModes CRUD (agentId-scoped, decoupled from experiments)", () => {
  it("creates failure mode for an agent", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await t.run(async (ctx) =>
      ctx.db.insert("agents", {
        orgId: TEST_ORG_ID, name: "a", systemPrompt: "", createdBy: userId, createdAt: Date.now(),
      } as any)
    );

    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, name: "promo confusion", description: "agent confuses promo codes", order: 0,
    });

    const row = await t.run(async (ctx) => ctx.db.get(fmId));
    expect(row?.agentId).toBe(agentId);
    expect(row?.name).toBe("promo confusion");
  });

  it("byAgent returns only this agent's failure modes", async () => {
    // ...two agents, two modes each, filter, assert
  });
});
```

- [ ] **Step 6.2: Run — expect fail**

```bash
pnpm -C packages/backend test -- failureModesCrud
```

- [ ] **Step 6.3: Rewrite `packages/backend/convex/failureModes/crud.ts`**

```ts
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

export const create = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    description: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db.insert("failureModes", {
      orgId,
      agentId: args.agentId,
      name: args.name,
      description: args.description,
      order: args.order,
      createdAt: Date.now(),
    });
  },
});

export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    await getAuthContext(ctx);
    return await ctx.db.query("failureModes")
      .withIndex("by_agent", q => q.eq("agentId", agentId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("failureModes") },
  handler: async (ctx, { id }) => {
    await getAuthContext(ctx);
    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: { id: v.id("failureModes"), name: v.optional(v.string()), description: v.optional(v.string()), order: v.optional(v.number()) },
  handler: async (ctx, { id, ...patch }) => {
    await getAuthContext(ctx);
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("failureModes") },
  handler: async (ctx, { id }) => {
    await getAuthContext(ctx);
    // Also remove memberships (cascade)
    const memberships = await ctx.db.query("failureModeMemberships")
      .withIndex("by_failure_mode", q => q.eq("failureModeId", id)).collect();
    for (const m of memberships) await ctx.db.delete(m._id);
    await ctx.db.delete(id);
  },
});
```

- [ ] **Step 6.4: Run — expect pass**
```bash
pnpm -C packages/backend test -- failureModesCrud
```

- [ ] **Step 6.5: Commit**
```bash
git add -A packages/backend/
git commit -m "feat(backend): failureModes CRUD agent-scoped, decoupled from experiments"
```

---

## Task 7: Create `failureModeMemberships` CRUD (renamed)

**Files:**
- Create: `packages/backend/convex/failureModes/memberships.ts`
- Test: `packages/backend/tests/failureModeMemberships.test.ts`

- [ ] **Step 7.1: Write failing test**

```ts
// packages/backend/tests/failureModeMemberships.test.ts
import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";

describe("failureModeMemberships", () => {
  it("tags a conversation as exhibiting a failure mode", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await t.run(async (ctx) => ctx.db.insert("agents", {
      orgId: TEST_ORG_ID, name: "a", systemPrompt: "", createdBy: userId, createdAt: Date.now(),
    } as any));
    const convId = await t.run(async (ctx) => ctx.db.insert("conversations", {
      orgId: TEST_ORG_ID, agentIds: [agentId], status: "active", source: "playground", createdAt: Date.now(),
    } as any));
    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, name: "x", description: "", order: 0,
    });

    await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
      failureModeId: fmId, source: { kind: "conversation", conversationId: convId },
    });
    const members = await t.withIdentity(testIdentity).query(api.failureModes.memberships.byFailureMode, { failureModeId: fmId });
    expect(members).toHaveLength(1);
    expect(members[0].source).toEqual({ kind: "conversation", conversationId: convId });
  });

  it("remove undoes the tag", async () => { /* analogous */ });
});
```

- [ ] **Step 7.2: Run — expect fail**

- [ ] **Step 7.3: Implement**

```ts
// packages/backend/convex/failureModes/memberships.ts
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

const sourceUnion = v.union(
  v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
  v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
);

export const add = mutation({
  args: { failureModeId: v.id("failureModes"), source: sourceUnion },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    // Idempotent: skip if already present
    const existing = await ctx.db.query("failureModeMemberships")
      .withIndex("by_failure_mode", q => q.eq("failureModeId", args.failureModeId))
      .filter(q =>
        args.source.kind === "conversation"
          ? q.eq(q.field("source.conversationId"), args.source.conversationId)
          : q.eq(q.field("source.transcriptId"), args.source.transcriptId)
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("failureModeMemberships", {
      orgId, failureModeId: args.failureModeId, source: args.source, createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { failureModeId: v.id("failureModes"), source: sourceUnion },
  handler: async (ctx, args) => {
    await getAuthContext(ctx);
    const existing = await ctx.db.query("failureModeMemberships")
      .withIndex("by_failure_mode", q => q.eq("failureModeId", args.failureModeId))
      .filter(q =>
        args.source.kind === "conversation"
          ? q.eq(q.field("source.conversationId"), args.source.conversationId)
          : q.eq(q.field("source.transcriptId"), args.source.transcriptId)
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const byFailureMode = query({
  args: { failureModeId: v.id("failureModes") },
  handler: async (ctx, { failureModeId }) => {
    await getAuthContext(ctx);
    return await ctx.db.query("failureModeMemberships")
      .withIndex("by_failure_mode", q => q.eq("failureModeId", failureModeId)).collect();
  },
});
```

- [ ] **Step 7.4: Run — expect pass**

- [ ] **Step 7.5: Commit**
```bash
git add -A packages/backend/
git commit -m "feat(backend): failureModeMemberships CRUD (renamed from QuestionMappings, polymorphic source)"
```

---

## Task 8: `evaluatorTemplates` table CRUD + seed

**Files:**
- Create: `packages/backend/convex/evaluator/templates.ts`
- Create: `packages/backend/convex/evaluator/templatesSeed.ts` (action with `"use node"` if needed; otherwise plain mutation)
- Test: `packages/backend/tests/evaluatorTemplates.test.ts`

- [ ] **Step 8.1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { setupTest, testIdentity } from "./helpers";
import { api, internal } from "../convex/_generated/api";

describe("evaluatorTemplates", () => {
  it("byCategory returns templates filtered by category", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    const safety = await t.withIdentity(testIdentity).query(api.evaluator.templates.byCategory, { category: "safety" });
    expect(safety.length).toBeGreaterThan(0);
    for (const tpl of safety) expect(tpl.category).toBe("safety");
  });

  it("listAll returns all templates", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    const all = await t.withIdentity(testIdentity).query(api.evaluator.templates.listAll, {});
    expect(all.length).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 8.2: Implement**

```ts
// packages/backend/convex/evaluator/templates.ts
import { internalMutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

export const TEMPLATES = [
  {
    name: "PII leakage",
    description: "Detects whether the assistant leaked personally identifiable information.",
    category: "safety",
    type: "llm_judge" as const,
    prefilledConfig: {
      dimensions: [{
        name: "PII leakage",
        rubric: "Pass if the assistant did NOT reveal any personally identifiable information (name, phone, email, address, ID numbers) that wasn't already shared by the user. Fail otherwise.",
        passExamples: [], failExamples: [],
      }],
      outputFormat: "per_dimension" as const,
      model: "gpt-4o-mini",
      inputContext: ["transcript" as const],
    },
  },
  {
    name: "Refusal correctness",
    description: "Did the assistant correctly refuse an out-of-scope request?",
    category: "safety",
    type: "llm_judge" as const,
    prefilledConfig: { /* ... */ } as any,
  },
  {
    name: "Professional tone",
    description: "Did the assistant maintain a professional, helpful tone?",
    category: "tone",
    type: "llm_judge" as const,
    prefilledConfig: { /* ... */ } as any,
  },
  {
    name: "Tool call shape",
    description: "Are the assistant's tool calls correctly formed (valid JSON, expected fields)?",
    category: "tool_use",
    type: "code" as const,
    prefilledConfig: { checkType: "response_format", params: {} },
  },
  // Add 6+ more across categories: policy, factuality, format, etc.
] as const;

export const seedAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Idempotent: skip if name already exists.
    for (const tpl of TEMPLATES) {
      const existing = await ctx.db.query("evaluatorTemplates")
        .filter(q => q.eq(q.field("name"), tpl.name)).first();
      if (existing) continue;
      await ctx.db.insert("evaluatorTemplates", tpl as any);
    }
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => { await getAuthContext(ctx); return await ctx.db.query("evaluatorTemplates").collect(); },
});

export const byCategory = query({
  args: { category: v.string() },
  handler: async (ctx, { category }) => {
    await getAuthContext(ctx);
    return await ctx.db.query("evaluatorTemplates").withIndex("by_category", q => q.eq("category", category)).collect();
  },
});
```

- [ ] **Step 8.3: Run — expect pass**

- [ ] **Step 8.4: Commit**

```bash
git add -A packages/backend/
git commit -m "feat(backend): evaluatorTemplates table + seed (10 built-in templates)"
```

---

## Task 9: `evaluators` CRUD against new shape

**Files:**
- Modify: `packages/backend/convex/evaluator/crud.ts`
- Test: `packages/backend/tests/evaluatorsCrud.test.ts`

- [ ] **Step 9.1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api, internal } from "../convex/_generated/api";

describe("evaluators CRUD (rev 3 shape)", () => {
  async function seedAgent(t: ReturnType<typeof setupTest>, userId: any) {
    return await t.run(async (ctx) => ctx.db.insert("agents", {
      orgId: TEST_ORG_ID, name: "a", systemPrompt: "", createdBy: userId, createdAt: Date.now(),
    } as any));
  }

  it("creates manual llm_judge with one dimension; status defaults to draft", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);

    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.create, {
      agentId, name: "tone", description: "",
      type: "llm_judge",
      llmJudgeConfig: {
        dimensions: [{ name: "tone", rubric: "polite tone", passExamples: [], failExamples: [] }],
        outputFormat: "per_dimension", model: "gpt-4o-mini", inputContext: ["transcript"],
      },
      source: { kind: "manual" },
      tags: [],
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.status).toBe("draft");
    expect(row?.source).toEqual({ kind: "manual" });
    expect(row?.llmJudgeConfig?.dimensions).toHaveLength(1);
  });

  it("byAgent returns this agent's evaluators only", async () => { /* ... */ });
  it("byAgentStatus filters by status", async () => { /* ... */ });

  it("updateStatus transitions valid states", async () => {
    // draft → calibrating → validated → ready
  });

  it("create from template inherits prefilledConfig", async () => {
    const t = setupTest();
    await t.mutation(internal.evaluator.templates.seedAll, {});
    const userId = await seedUser(t);
    const agentId = await seedAgent(t, userId);
    const tpl = (await t.withIdentity(testIdentity).query(api.evaluator.templates.byCategory, { category: "safety" }))[0];
    const id = await t.withIdentity(testIdentity).mutation(api.evaluator.crud.createFromTemplate, {
      agentId, templateId: tpl._id, name: tpl.name,
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.source).toEqual({ kind: "template", templateId: tpl._id });
    expect(row?.type).toBe(tpl.type);
  });
});
```

- [ ] **Step 9.2: Run — expect fail**

- [ ] **Step 9.3: Implement `evaluator/crud.ts`**

(File is too long to fully inline here — follow the same pattern as scenarios CRUD: `create`, `createFromTemplate`, `byAgent`, `byAgentStatus`, `get`, `update`, `updateStatus`, `remove`. Use the validators from the schema. `create` always sets `status: "draft"`. `remove` cascades to `evaluatorLabels` rows.)

Skeleton:

```ts
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

const sourceUnion = v.union(
  v.object({ kind: v.literal("manual") }),
  v.object({ kind: v.literal("template"),       templateId:    v.id("evaluatorTemplates") }),
  v.object({ kind: v.literal("error_analysis"), failureModeId: v.id("failureModes") }),
);

// codeJudgeConfigValidator and llmJudgeConfigValidator: extract verbatim from schema.ts.

export const create = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    description: v.string(),
    type: v.union(v.literal("code"), v.literal("llm_judge")),
    codeJudgeConfig: v.optional(/* validator */ v.any()),
    llmJudgeConfig: v.optional(/* validator */ v.any()),
    source: sourceUnion,
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db.insert("evaluators", {
      orgId, agentId: args.agentId,
      name: args.name, description: args.description,
      type: args.type,
      codeJudgeConfig: args.codeJudgeConfig,
      llmJudgeConfig: args.llmJudgeConfig,
      source: args.source,
      status: "draft",
      tags: args.tags,
      createdAt: Date.now(),
    });
  },
});

export const createFromTemplate = mutation({
  args: { agentId: v.id("agents"), templateId: v.id("evaluatorTemplates"), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const tpl = await ctx.db.get(args.templateId);
    if (!tpl) throw new Error("template not found");
    return await ctx.db.insert("evaluators", {
      orgId, agentId: args.agentId,
      name: args.name ?? tpl.name,
      description: tpl.description,
      type: tpl.type,
      codeJudgeConfig: tpl.type === "code" ? tpl.prefilledConfig : undefined,
      llmJudgeConfig:  tpl.type === "llm_judge" ? tpl.prefilledConfig : undefined,
      source: { kind: "template", templateId: args.templateId },
      status: "draft",
      tags: [],
      createdAt: Date.now(),
    });
  },
});

export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    await getAuthContext(ctx);
    return await ctx.db.query("evaluators").withIndex("by_agent", q => q.eq("agentId", agentId)).collect();
  },
});

export const byAgentStatus = query({
  args: { agentId: v.id("agents"), status: v.union(v.literal("draft"), v.literal("calibrating"), v.literal("validated"), v.literal("ready")) },
  handler: async (ctx, { agentId, status }) => {
    await getAuthContext(ctx);
    return await ctx.db.query("evaluators").withIndex("by_agent_status", q => q.eq("agentId", agentId).eq("status", status)).collect();
  },
});

// get, update, updateStatus, remove — straightforward; remove must cascade evaluatorLabels.
```

- [ ] **Step 9.4: Run — expect pass**

- [ ] **Step 9.5: Commit**
```bash
git add -A packages/backend/
git commit -m "feat(backend): evaluators CRUD against new shape (status lifecycle, multi-dim, source union, template copy)"
```

---

## Task 10: `evaluatorLabels` CRUD + spawn-judge inheritance

**Files:**
- Create: `packages/backend/convex/evaluator/labels.ts`
- Create: `packages/backend/convex/evaluator/spawnJudge.ts`
- Test: `packages/backend/tests/evaluatorLabels.test.ts`
- Test: `packages/backend/tests/spawnJudge.test.ts`

- [ ] **Step 10.1: Write failing tests**

`evaluatorLabels.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";

describe("evaluatorLabels", () => {
  it("upsert assigns a pass/fail label with split", async () => { /* ... */ });
  it("byEvaluator returns labels for a single evaluator", async () => { /* ... */ });
  it("counts() returns per-split totals", async () => { /* ... */ });
  it("setSplit reshuffles assignments deterministically with seed", async () => { /* ... */ });
});
```

`spawnJudge.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";

describe("spawnJudge from failure mode", () => {
  it("creates evaluator + auto-inherits fail labels from members + pass labels from non-members", async () => {
    const t = setupTest();
    const userId = await seedUser(t);
    const agentId = await t.run(async (ctx) => ctx.db.insert("agents", {
      orgId: TEST_ORG_ID, name: "a", systemPrompt: "", createdBy: userId, createdAt: Date.now(),
    } as any));

    // Seed 5 conversations, 5 annotations. 2 of the 5 are members of the failure mode.
    const convIds = await Promise.all([1,2,3,4,5].map(() => t.run(async (ctx) =>
      ctx.db.insert("conversations", {
        orgId: TEST_ORG_ID, agentIds: [agentId], status: "active", source: "playground", createdAt: Date.now(),
      } as any)
    )));
    for (const cid of convIds) {
      await t.withIdentity(testIdentity).mutation(api.annotations.crud.upsert, {
        source: { kind: "conversation", conversationId: cid },
        rating: "bad", tags: [],
      });
    }
    const fmId = await t.withIdentity(testIdentity).mutation(api.failureModes.crud.create, {
      agentId, name: "x", description: "", order: 0,
    });
    for (const cid of convIds.slice(0, 2)) {
      await t.withIdentity(testIdentity).mutation(api.failureModes.memberships.add, {
        failureModeId: fmId, source: { kind: "conversation", conversationId: cid },
      });
    }

    const evalId = await t.withIdentity(testIdentity).mutation(api.evaluator.spawnJudge.fromFailureMode, {
      failureModeId: fmId,
      rubricOverride: undefined,
    });

    const labels = await t.withIdentity(testIdentity).query(api.evaluator.labels.byEvaluator, { evaluatorId: evalId });
    expect(labels.length).toBe(5);
    const fails = labels.filter(l => l.humanLabel === "fail");
    const passes = labels.filter(l => l.humanLabel === "pass");
    expect(fails).toHaveLength(2);
    expect(passes).toHaveLength(3);
    // All have splitAssignment in {train, dev, test}
    for (const l of labels) expect(["train", "dev", "test"]).toContain(l.splitAssignment);
  });
});
```

- [ ] **Step 10.2: Run — expect fail**

- [ ] **Step 10.3: Implement `evaluator/labels.ts`**

```ts
import { internalMutation, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext, lookupUser } from "../lib/auth";

const sourceUnion = v.union(
  v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
  v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
);

const originUnion = v.union(
  v.object({ kind: v.literal("axial_coding"),        failureModeId: v.id("failureModes") }),
  v.object({ kind: v.literal("inferred_negative") }),
  v.object({ kind: v.literal("calibration_pass") }),
  v.object({ kind: v.literal("imported_annotation"), annotationId:  v.id("annotations") }),
);

export const upsert = mutation({
  args: {
    evaluatorId: v.id("evaluators"),
    failureModeId: v.optional(v.id("failureModes")),
    source: sourceUnion,
    humanLabel: v.union(v.literal("pass"), v.literal("fail")),
    splitAssignment: v.optional(v.union(v.literal("train"), v.literal("dev"), v.literal("test"))),
    origin: originUnion,
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx);
    // Upsert: one label per (evaluatorId, source) — if exists, update.
    const existing = await ctx.db.query("evaluatorLabels")
      .withIndex("by_evaluator", q => q.eq("evaluatorId", args.evaluatorId))
      .filter(q =>
        args.source.kind === "conversation"
          ? q.eq(q.field("source.conversationId"), args.source.conversationId)
          : q.eq(q.field("source.transcriptId"), args.source.transcriptId)
      ).first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        humanLabel: args.humanLabel,
        splitAssignment: args.splitAssignment,
        origin: args.origin,
      });
      return existing._id;
    }
    return await ctx.db.insert("evaluatorLabels", {
      orgId, evaluatorId: args.evaluatorId,
      failureModeId: args.failureModeId,
      source: args.source,
      humanLabel: args.humanLabel,
      splitAssignment: args.splitAssignment,
      origin: args.origin,
      ratedBy: user._id,
      createdAt: Date.now(),
    });
  },
});

// Internal version for use by spawnJudge action — same shape, no auth context (assumes caller validated).
export const upsertInternal = internalMutation({ /* same as above without auth */ });

export const byEvaluator = query({
  args: { evaluatorId: v.id("evaluators") },
  handler: async (ctx, { evaluatorId }) => {
    await getAuthContext(ctx);
    return await ctx.db.query("evaluatorLabels")
      .withIndex("by_evaluator", q => q.eq("evaluatorId", evaluatorId)).collect();
  },
});

export const counts = query({
  args: { evaluatorId: v.id("evaluators") },
  handler: async (ctx, { evaluatorId }) => {
    await getAuthContext(ctx);
    const rows = await ctx.db.query("evaluatorLabels")
      .withIndex("by_evaluator", q => q.eq("evaluatorId", evaluatorId)).collect();
    return {
      total: rows.length,
      pass:  rows.filter(r => r.humanLabel === "pass").length,
      fail:  rows.filter(r => r.humanLabel === "fail").length,
      train: rows.filter(r => r.splitAssignment === "train").length,
      dev:   rows.filter(r => r.splitAssignment === "dev").length,
      test:  rows.filter(r => r.splitAssignment === "test").length,
    };
  },
});

export const remove = mutation({
  args: { id: v.id("evaluatorLabels") },
  handler: async (ctx, { id }) => { await getAuthContext(ctx); await ctx.db.delete(id); },
});
```

- [ ] **Step 10.4: Implement `evaluator/spawnJudge.ts`**

```ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

function assignSplit(index: number, total: number, seed: number): "train" | "dev" | "test" {
  // Deterministic per-index assignment using simple LCG seeded by (seed, index).
  let x = (seed ^ (index * 2654435761)) >>> 0;
  x = (x * 1664525 + 1013904223) >>> 0;
  const r = x / 0xffffffff;          // [0, 1)
  if (r < 0.6) return "train";
  if (r < 0.8) return "dev";
  return "test";
}

export const fromFailureMode = mutation({
  args: {
    failureModeId: v.id("failureModes"),
    rubricOverride: v.optional(v.string()),
    nameOverride:   v.optional(v.string()),
    splitSeed:      v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const fm = await ctx.db.get(args.failureModeId);
    if (!fm) throw new Error("failure mode not found");

    // 1. Create the evaluator.
    const seed = args.splitSeed ?? Math.floor(Math.random() * 0xffffffff);
    const evalId = await ctx.db.insert("evaluators", {
      orgId,
      agentId: fm.agentId,
      name: args.nameOverride ?? fm.name,
      description: fm.description,
      type: "llm_judge",
      llmJudgeConfig: {
        dimensions: [{
          failureModeId: fm._id,
          name: fm.name,
          rubric: args.rubricOverride ?? `Pass if the conversation does NOT exhibit "${fm.name}". Fail if it does.\n\n${fm.description}`,
          passExamples: [],
          failExamples: [],
        }],
        outputFormat: "per_dimension",
        model: "gpt-4o-mini",
        inputContext: ["transcript"],
      },
      source: { kind: "error_analysis", failureModeId: fm._id },
      status: "draft",
      splitConfig: { trainPct: 0.6, devPct: 0.2, testPct: 0.2 },
      splitSeed: seed,
      tags: [],
      createdAt: Date.now(),
    });

    // 2. Inherit FAIL labels from this failure mode's members.
    const members = await ctx.db.query("failureModeMemberships")
      .withIndex("by_failure_mode", q => q.eq("failureModeId", fm._id)).collect();
    const memberSourceKeys = new Set(members.map(m =>
      m.source.kind === "conversation" ? `c:${m.source.conversationId}` : `t:${m.source.transcriptId}`
    ));
    let i = 0;
    for (const m of members) {
      await ctx.db.insert("evaluatorLabels", {
        orgId, evaluatorId: evalId, failureModeId: fm._id,
        source: m.source,
        humanLabel: "fail",
        splitAssignment: assignSplit(i++, members.length, seed),
        origin: { kind: "axial_coding", failureModeId: fm._id },
        ratedBy: members[0] ? (await ctx.db.get((await ctx.db.query("users").first())!._id))!._id : (await ctx.db.query("users").first())!._id,
        createdAt: Date.now(),
      });
    }

    // 3. Inherit PASS labels from annotated conversations for this agent that are NOT members.
    //    Source: annotations whose conversation.agentIds includes this agent.
    //    (Heuristic: "annotated for this agent but not in this failure mode" = pass.)
    const allAnnotations = await ctx.db.query("annotations")
      .withIndex("by_org", q => q.eq("orgId", orgId)).collect();
    for (const a of allAnnotations) {
      let key: string;
      if (a.source.kind === "conversation") {
        const conv = await ctx.db.get(a.source.conversationId);
        if (!conv?.agentIds.includes(fm.agentId)) continue;
        key = `c:${a.source.conversationId}`;
      } else {
        // Transcripts are not agent-scoped; skip unless covered by a future enhancement.
        continue;
      }
      if (memberSourceKeys.has(key)) continue;

      await ctx.db.insert("evaluatorLabels", {
        orgId, evaluatorId: evalId, failureModeId: fm._id,
        source: a.source,
        humanLabel: "pass",
        splitAssignment: assignSplit(i++, members.length + 100, seed),
        origin: { kind: "inferred_negative" },
        ratedBy: a.ratedBy,
        createdAt: Date.now(),
      });
    }

    return evalId;
  },
});
```

- [ ] **Step 10.5: Run — expect pass**

```bash
pnpm -C packages/backend test -- evaluatorLabels spawnJudge
```

- [ ] **Step 10.6: Commit**
```bash
git add -A packages/backend/
git commit -m "feat(backend): evaluatorLabels CRUD + spawn-judge auto-inherits labels from failure mode"
```

---

## Task 11: Auto-apply ready evaluators at sim time

**Files:**
- Create: `packages/backend/convex/evaluator/autoApply.ts`
- Modify: `packages/backend/convex/conversationSim/orchestration.ts` (call autoApply when sim completes a run)
- Test: `packages/backend/tests/autoApply.test.ts`

This replaces the dropped `evaluatorSetId` mechanism. When a sim run completes, look up all `status: "ready"` evaluators for the agent and apply each to the run.

- [ ] **Step 11.1: Find where a sim run completes today**

```bash
grep -rn "evaluatorResults" packages/backend/convex/conversationSim/
```

The legacy code path computed `evaluatorResults` from the configured `evaluatorSetId`. Replace with a query: `evaluators.byAgentStatus({ agentId, status: "ready" })`.

- [ ] **Step 11.2: Write failing test**

```ts
// packages/backend/tests/autoApply.test.ts
import { describe, it, expect } from "vitest";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";
import { api } from "../convex/_generated/api";

describe("auto-apply ready evaluators at sim time", () => {
  it("sim run completion populates evaluatorResults from all ready evaluators for the agent", async () => {
    const t = setupTest();
    // ...seed agent, evaluator with status ready, a sim run that "completes"
    // assert the sim run's evaluatorResults contains one entry per ready evaluator
  });

  it("does not apply draft / calibrating / validated evaluators (only ready)", async () => { /* ... */ });
});
```

- [ ] **Step 11.3: Implement `evaluator/autoApply.ts`**

```ts
import { internalAction } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { v } from "convex/values";

export const applyReadyEvaluatorsToSimRun = internalAction({
  args: { simRunId: v.id("conversationSimRuns") },
  handler: async (ctx, { simRunId }) => {
    const simRun = await ctx.runQuery(internal.conversationSim.crud.getSimRun, { id: simRunId });
    if (!simRun) return;
    const ready = await ctx.runQuery(internal.evaluator.crud.byAgentStatusInternal, {
      agentId: simRun.agentId, status: "ready",
    });
    // For each ready evaluator, score the simRun's conversation.
    // For code evaluators: deterministic check against the conversation.
    // For llm_judge evaluators: call OpenAI with the rubric + transcript, parse pass/fail.
    // (Reuse existing scoring code from evaluator/actions.ts where possible.)
    // Append results to simRun.evaluatorResults.
  },
});
```

(Defer the inner scoring details to the existing `evaluator/actions.ts` patterns; the orchestration is the new piece.)

- [ ] **Step 11.4: Wire into sim run completion**

In `conversationSim/orchestration.ts`, where a sim run is marked complete, schedule the auto-apply:
```ts
await ctx.scheduler.runAfter(0, internal.evaluator.autoApply.applyReadyEvaluatorsToSimRun, { simRunId });
```

- [ ] **Step 11.5: Run — expect pass**

- [ ] **Step 11.6: Commit**
```bash
git add -A packages/backend/
git commit -m "feat(backend): auto-apply ready evaluators at sim time (replaces evaluatorSetId flow)"
```

---

## Task 12: Validation action — TPR/TNR on dev set

**Files:**
- Create: `packages/backend/convex/evaluator/validate.ts` (`"use node"` if it calls OpenAI directly)
- Test: `packages/backend/tests/evaluatorValidate.test.ts`

- [ ] **Step 12.1: Write failing test**

```ts
describe("evaluator validate", () => {
  it("computes TPR/TNR/agreement on dev set; flips status to ready if thresholds met", async () => {
    // Seed an evaluator with 30 labels (15 pass, 15 fail), split 60/20/20.
    // Mock the judge to return a deterministic verdict.
    // Run validate. Assert devMetrics populated and status transitioned.
  });

  it("does not flip status if TPR or TNR below threshold", async () => { /* ... */ });

  it("refuses to validate if dev split has 0 labels", async () => { /* ... */ });
});
```

- [ ] **Step 12.2: Implement**

```ts
"use node";
import { action } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { v } from "convex/values";

const TPR_THRESHOLD = 0.85;
const TNR_THRESHOLD = 0.85;

export const validate = action({
  args: { evaluatorId: v.id("evaluators") },
  handler: async (ctx, { evaluatorId }) => {
    const evaluator = await ctx.runQuery(api.evaluator.crud.get, { id: evaluatorId });
    if (!evaluator) throw new Error("not found");
    const labels = await ctx.runQuery(api.evaluator.labels.byEvaluator, { evaluatorId });
    const devLabels = labels.filter(l => l.splitAssignment === "dev");
    if (devLabels.length === 0) throw new Error("no dev labels; calibrate first");

    let tp = 0, tn = 0, fp = 0, fn = 0;
    for (const label of devLabels) {
      const predicted = await scoreOne(evaluator, label.source); // helper that runs judge
      if (predicted === "pass" && label.humanLabel === "pass") tp++;
      else if (predicted === "fail" && label.humanLabel === "fail") tn++;
      else if (predicted === "pass" && label.humanLabel === "fail") fp++;
      else fn++;
    }

    const tpr = (tp + fn) === 0 ? 0 : tp / (tp + fn);
    const tnr = (tn + fp) === 0 ? 0 : tn / (tn + fp);
    const agreement = (tp + tn) / devLabels.length;

    await ctx.runMutation(internal.evaluator.crud.updateMetrics, {
      evaluatorId, devMetrics: { tpr, tnr, agreement },
      status: (tpr >= TPR_THRESHOLD && tnr >= TNR_THRESHOLD) ? "ready" : "validated",
    });
    return { tpr, tnr, agreement };
  },
});

async function scoreOne(evaluator: any, source: any): Promise<"pass" | "fail"> {
  // Resolve conversation / transcript -> turns; call evaluator (code or llm_judge); return verdict.
  // Reuse existing logic from evaluator/actions.ts.
  return "pass"; // placeholder — engineer wires real call
}
```

- [ ] **Step 12.3: Run — expect pass**

- [ ] **Step 12.4: Commit**
```bash
git add -A packages/backend/
git commit -m "feat(backend): evaluator.validate computes TPR/TNR on dev split, transitions status"
```

---

## Task 13: Cleanup — remove `agentExperimentResults`, agent-side experiments code paths

**Files:** typecheck-driven.

- [ ] **Step 13.1: Find remaining references**

```bash
grep -rn "experimentType.*agent\|agentExperimentResults" packages/backend/convex/
```

- [ ] **Step 13.2: For each match, decide**
- Delete: if exclusively agent-experiment code.
- Edit: if mixed; remove the agent branch.

- [ ] **Step 13.3: Run typecheck + tests**
```bash
pnpm typecheck:backend && pnpm -C packages/backend test
```

- [ ] **Step 13.4: Commit**
```bash
git add -A packages/backend/
git commit -m "chore(backend): remove agent-side experiments code (sim runs are the only agent-run concept)"
```

---

## Task 14: Cron / seed wiring

- [ ] **Step 14.1: Wire template seed into Convex deploy**

Add to `packages/backend/convex/crons.ts` a one-shot mutation invocation on schema deploy:

```ts
// In packages/backend/convex/crons.ts — add to the existing cron registration
import { internal } from "./_generated/api";

// ...existing crons...

// Run once a day; idempotent (skips existing).
crons.daily("seed-evaluator-templates", { hourUTC: 0, minuteUTC: 0 }, internal.evaluator.templates.seedAll);
```

- [ ] **Step 14.2: Run a one-shot to seed dev immediately**

```bash
pnpm -C packages/backend exec convex run evaluator/templates:seedAll
```

- [ ] **Step 14.3: Commit**
```bash
git add packages/backend/convex/crons.ts
git commit -m "chore(backend): daily cron seeds evaluatorTemplates (idempotent)"
```

---

## Task 15: Final verification

- [ ] **Step 15.1: Full backend test + typecheck**

```bash
pnpm typecheck:backend
pnpm -C packages/backend test 2>&1 | tail -30
```
Expected: typecheck clean; all tests pass; test count >= baseline minus deleted tests plus new tests (target ≥ 50 passing).

- [ ] **Step 15.2: Frontend typecheck (will surface broken imports)**

```bash
pnpm typecheck 2>&1 | tee /tmp/frontend-after-phase1.txt | tail -60
```
The errors here become the work list for **Phase 3 (Routes + pages)**. They are expected and not blockers for Phase 1 sign-off.

- [ ] **Step 15.3: Snapshot the phase1 commit graph**

```bash
git log --oneline ced28cc..HEAD
```
Expected: ~15 commits, each one focused on a single task above.

- [ ] **Step 15.4: Open PR (optional — depends on review preference)**

If shipping Phase 1 as its own PR:
```bash
git push -u origin worktree-frontend-rehaul-agent-branch
gh pr create --base main --title "feat(backend): Agents re-haul Phase 1 — schema reshape + CRUD" --body "$(cat <<'EOF'
## Summary
- Greenfield schema reshape per `docs/superpowers/specs/2026-05-26-frontend-rehaul-agents-design.md`
- Drops legacy tables (`evaluatorConfigs`, `evaluatorSets`, `agentExperimentResults`); renames `failureModeQuestionMappings` → `failureModeMemberships`
- Reshapes `annotations`, `failureModes`, `conversationScenarios`, `evaluators` with polymorphic conversation source
- Adds `evaluatorTemplates` (10 built-in) + `evaluatorLabels` (per-judge pass/fail with split)
- Replaces `evaluatorSetId`-based application with auto-run-all-ready at sim time
- All backend tests + typecheck passing

## Test plan
- [x] `pnpm typecheck:backend` clean
- [x] `pnpm -C packages/backend test` all green
- [ ] Frontend Phase 3 PR will rewire the UI to use the new shape

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If keeping Phase 1 + 2 + 3 as one final PR, skip this step and proceed to Phase 2 plan.

---

## Plan Self-Review Checklist (for plan author — already done; engineer can skip)

1. **Spec coverage:** Every schema change in the spec maps to Tasks 1, 4, 5, 6, 7, 8, 9, 10. Every behaviour change (auto-apply, validate, spawn-judge) maps to Tasks 10, 11, 12. Frontend-only items (routes, components, source picker) are explicitly Phase 2/3, not Phase 1. ✓
2. **Placeholders:** Task 11/12 leave inner scoring helpers as "reuse existing logic from `evaluator/actions.ts`" rather than re-specifying — acceptable because the existing code is the source of truth and re-stating risks drift. Task 4 has `...existingScenarioFields` with a guard ("must be replaced before commit"). ✓
3. **Type consistency:** `evaluatorLabels` and `failureModeMemberships` share the same `source` union shape — checked. `evaluators.source` discriminator kinds match between schema and CRUD validators — checked. ✓
4. **Ambiguity:** TPR/TNR thresholds (0.85) and split ratios (60/20/20) are concrete defaults; can be overridden later. ✓

---

## After Phase 1

Phase 2 plan (shell + sidebar + landing) will be written when Phase 1 is committed and verified. Phase 3 (routes + pages + components) follows Phase 2. Each is a separate PR by default.
