# Cold-Start Agent Score (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cold-start path produce a trustworthy, bias-corrected, per-dimension agent score with confidence intervals over simulated conversations — by making LLM judges actually judge, validating them honestly (dev + held-out test, Wilson CIs, min-labels gate), and batch-applying ready judges to compute Score B.

**Architecture:** All evaluator logic lives in `packages/backend/convex/evaluator/`. The judge LLM logic is **dependency-injected**: `llmJudge.ts` (no `"use node"`) takes a structural LLM client interface, so prompt building and verdict dispatch are unit-testable in the edge-runtime with a fake client. Only the three Convex **action** files (`validate.ts`, `autoApply.ts`, `batchApply.ts`) carry `"use node"`, construct the real `new OpenAI()`, and pass it down. Pure stats functions extend the existing `metrics.ts`. A unified message fetcher (`sources.ts`) lets validation and batch-apply read both conversation- and transcript-sourced labels. Two new tables (`evaluationRuns`, `evaluationResults`) persist Score B.

**Tech Stack:** Convex (queries/mutations/actions, `"use node"` for Node deps), `openai` SDK (`gpt-4o-mini`, `response_format: json_object`), Vitest + `convex-test` (edge-runtime), Next.js 16 / React (frontend), Tailwind v4.

**Scope deviation from the design doc (flagged, deliberate):** The design suggests running batch-apply "through WorkPool for scale." For Slice 1 the cohort is a single simulation batch (tens of conversations), so `batchApply.runOnCohort` is implemented as a **single `"use node"` action that loops** with bounded sequential scoring — no new WorkPool component. WorkPool-backed scaling is deferred to Slice 3 (real traffic). This is called out in Task 11.

---

## File Structure

**Backend — `packages/backend/convex/`**
- `schema.ts` — *modify*: extend `evaluators`; add `evaluationRuns`, `evaluationResults` tables. (Task 1)
- `evaluator/metrics.ts` — *modify*: add `wilsonCI`, `scoreBCI`. (Tasks 2–3)
- `evaluator/sources.ts` — *create*: `normalizeTranscriptMessages` (pure) + `getMessagesForSource` (internalQuery). (Task 4)
- `evaluator/llmJudge.ts` — *create*: `JudgeLlmClient` interface, `buildJudgePrompt` (Task 5), `runLlmJudge` + `scoreOneAsync` (Task 6).
- `evaluator/fewShot.ts` — *create*: `selectFewShot` + `renderFewShotBlock` (pure). (Task 7)
- `evaluator/crud.ts` — *modify*: extend `updateMetrics`; add `updateValidation` internalMutation. (Task 8)
- `evaluator/validate.ts` — *rewrite*: `"use node"`, dev+test, Wilson CI, min-labels gate, transcript labels included. (Task 9)
- `evaluator/autoApply.ts` — *modify*: `"use node"`, use `scoreOneAsync`. (Task 10)
- `evaluator/batchApply.ts` — *create*: `runOnCohort` action + aggregation + writes; needed internal queries. (Task 11)
- `evaluator/evaluationRuns.ts` — *create*: write internalMutations + read queries for the scorecard. (Tasks 11–12)
- `conversationSim/runs.ts` — *modify*: add `bySimulationInternal` internalQuery (if absent). (Task 11)

**Backend tests — `packages/backend/tests/`**
- `evaluatorMetrics.test.ts` — *modify*: add `wilsonCI`, `scoreBCI` cases. (Tasks 2–3)
- `evaluatorSources.test.ts` — *create*: transcript normalization + `getMessagesForSource`. (Task 4)
- `evaluatorLlmJudge.test.ts` — *create*: `buildJudgePrompt`, `runLlmJudge`, `scoreOneAsync`. (Tasks 5–6)
- `evaluatorFewShot.test.ts` — *create*: `selectFewShot`, `renderFewShotBlock`. (Task 7)
- `evaluatorValidate.test.ts` — *modify*: test-split confirmation, min-labels gate, transcript labels scored. (Task 9)
- `autoApply.test.ts` — *modify*: llm judge now scores via injected client. (Task 10)
- `evaluatorBatchApply.test.ts` — *create*: aggregation, calibration-set exclusion, correction, uncorrected warning. (Task 11)

**Frontend — `packages/frontend/src/`**
- `app/agents/[id]/evaluate/evaluators/[evalId]/validate/page.tsx` — *modify*: dev+test metrics + CIs + `insufficient_labels` state. (Task 13)
- `app/agents/[id]/evaluate/experiments/[runId]/page.tsx` (+ a new `ScorecardPanel.tsx` component) — *modify/create*: scorecard panel + "Run scorecard". (Task 14)

---

## Conventions for every task

- Run backend tests with: `pnpm -C packages/backend test` (Vitest, edge-runtime). Single file: `pnpm -C packages/backend test <file>`.
- Backend typecheck: `pnpm -C packages/backend typecheck` (`tsc --noEmit -p convex/tsconfig.json`).
- Schema/codegen verification: `cd packages/backend && npx convex dev --once` (regenerates `_generated/`, validates schema).
- Frontend typecheck: `cd packages/frontend && npx tsc -p tsconfig.json --noEmit`.
- Pure functions are imported directly from `../convex/evaluator/<file>` in tests (no `convex-test` needed).
- Convex functions are tested via `convex-test` using `setupTest`, `seedUser`, etc. from `packages/backend/tests/helpers.ts`.
- Commit after each task passes.

---

## Task 1: Schema — extend `evaluators`, add `evaluationRuns` + `evaluationResults`

**Files:**
- Modify: `packages/backend/convex/schema.ts` (the `evaluators` table, ~lines 772–833; add two new tables)

- [ ] **Step 1: Extend the `evaluators` table**

In `schema.ts`, inside the `evaluators: defineTable({ ... })` definition, locate the existing `devMetrics` field:

```typescript
  devMetrics: v.optional(v.object({
    tpr: v.number(),
    tnr: v.number(),
    agreement: v.number(),
  })),
```

Add the following fields immediately after it (keep `devMetrics` as-is):

```typescript
  testMetrics: v.optional(
    v.object({
      tpr: v.number(),
      tnr: v.number(),
      agreement: v.number(),
      n: v.number(),
    }),
  ),
  devMetricsCI: v.optional(
    v.object({
      tpr: v.object({ lower: v.number(), upper: v.number() }),
      tnr: v.object({ lower: v.number(), upper: v.number() }),
    }),
  ),
  testMetricsCI: v.optional(
    v.object({
      tpr: v.object({ lower: v.number(), upper: v.number() }),
      tnr: v.object({ lower: v.number(), upper: v.number() }),
    }),
  ),
  labelCounts: v.optional(
    v.object({
      passDev: v.number(),
      failDev: v.number(),
      passTest: v.number(),
      failTest: v.number(),
    }),
  ),
  validatedAt: v.optional(v.number()),
```

- [ ] **Step 2: Add `evaluationRuns` and `evaluationResults` tables**

In `schema.ts`, add these two table definitions (place them just after the `evaluatorLabels` table, keeping the file's grouping sensible). The `cohort` and `source` unions mirror the existing inline polymorphic patterns.

```typescript
  evaluationRuns: defineTable({
    orgId: v.string(),
    agentId: v.id("agents"),
    evaluatorId: v.id("evaluators"),
    cohort: v.object({
      kind: v.literal("simulation"),
      simulationId: v.id("conversationSimulations"),
    }),
    n: v.number(),
    observedPassRate: v.number(),
    correctedPassRate: v.number(),
    ci: v.object({ lower: v.number(), upper: v.number() }),
    corrected: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_agent", ["agentId"])
    .index("by_evaluator", ["evaluatorId"])
    .index("by_simulation", ["cohort.simulationId"]),

  evaluationResults: defineTable({
    orgId: v.string(),
    evaluationRunId: v.id("evaluationRuns"),
    source: v.union(
      v.object({
        kind: v.literal("conversation"),
        conversationId: v.id("conversations"),
      }),
      v.object({
        kind: v.literal("transcript"),
        transcriptId: v.id("livechatConversations"),
      }),
    ),
    passed: v.boolean(),
    justification: v.string(),
  }).index("by_run", ["evaluationRunId"]),
```

- [ ] **Step 3: Regenerate + verify schema**

Run: `cd packages/backend && npx convex dev --once`
Expected: completes without schema errors; `_generated/dataModel.d.ts` now includes `evaluationRuns` and `evaluationResults`.

Then run: `pnpm -C packages/backend typecheck`
Expected: PASS (no type errors introduced).

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts packages/backend/convex/_generated
git commit -m "feat(backend): schema — evaluator validation metrics + evaluationRuns/Results tables"
```

---

## Task 2: `metrics.ts` — add `wilsonCI`

**Files:**
- Modify: `packages/backend/convex/evaluator/metrics.ts`
- Test: `packages/backend/tests/evaluatorMetrics.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/tests/evaluatorMetrics.test.ts` (import `wilsonCI` — add it to the existing import from `../convex/evaluator/metrics`):

```typescript
import { wilsonCI } from "../convex/evaluator/metrics";

describe("wilsonCI", () => {
  it("returns [0,1]-bounded interval straddling the point estimate", () => {
    const { lower, upper } = wilsonCI(8, 10); // p̂ = 0.8
    expect(lower).toBeGreaterThan(0);
    expect(upper).toBeLessThanOrEqual(1);
    expect(lower).toBeLessThan(0.8);
    expect(upper).toBeGreaterThan(0.8);
  });

  it("is wider for smaller n at the same proportion", () => {
    const small = wilsonCI(4, 5); // 0.8, n=5
    const large = wilsonCI(40, 50); // 0.8, n=50
    expect(small.upper - small.lower).toBeGreaterThan(large.upper - large.lower);
  });

  it("returns the full [0,1] interval when n is 0", () => {
    expect(wilsonCI(0, 0)).toEqual({ lower: 0, upper: 1 });
  });

  it("clamps within [0,1] at the extremes", () => {
    const { lower, upper } = wilsonCI(10, 10); // p̂ = 1.0
    expect(lower).toBeGreaterThanOrEqual(0);
    expect(upper).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test evaluatorMetrics`
Expected: FAIL — `wilsonCI is not a function` / import error.

- [ ] **Step 3: Implement `wilsonCI`**

Append to `packages/backend/convex/evaluator/metrics.ts`:

```typescript
/**
 * Wilson score interval (95%) for a binomial proportion.
 * More reliable than the normal approximation at small n and extreme p̂.
 * Returns the full [0, 1] interval when n === 0.
 */
export function wilsonCI(
  successes: number,
  n: number,
): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 1 };
  const z = 1.959963984540054; // 95% two-sided
  const z2 = z * z;
  const phat = successes / n;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test evaluatorMetrics`
Expected: PASS (all `wilsonCI` cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/evaluator/metrics.ts packages/backend/tests/evaluatorMetrics.test.ts
git commit -m "feat(backend): metrics — Wilson score CI"
```

---

## Task 3: `metrics.ts` — add `scoreBCI`

`scoreBCI` generalizes the existing `bootstrapCI`: it resamples **both** the cohort verdicts (uncertainty in observed pass rate) **and** the validation test pairs (uncertainty in TPR/TNR), then applies the Rogan-Gladen correction per bootstrap draw.

**Files:**
- Modify: `packages/backend/convex/evaluator/metrics.ts`
- Test: `packages/backend/tests/evaluatorMetrics.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/tests/evaluatorMetrics.test.ts` (add `scoreBCI` to the metrics import):

```typescript
import { scoreBCI } from "../convex/evaluator/metrics";

describe("scoreBCI", () => {
  const perfectLabels = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
  const perfectPreds = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]; // TPR=TNR=1

  it("brackets the corrected pass rate and is deterministic for a fixed seed", () => {
    const cohortPreds = [1, 1, 1, 0]; // observed pass rate 0.75
    const a = scoreBCI(cohortPreds, perfectLabels, perfectPreds, 2000, 7);
    const b = scoreBCI(cohortPreds, perfectLabels, perfectPreds, 2000, 7);
    expect(a).toEqual(b); // seeded determinism
    expect(a.lower).toBeGreaterThanOrEqual(0);
    expect(a.upper).toBeLessThanOrEqual(1);
    expect(a.lower).toBeLessThanOrEqual(0.75);
    expect(a.upper).toBeGreaterThanOrEqual(0.75);
  });

  it("returns [0,1] when the cohort is empty", () => {
    expect(scoreBCI([], perfectLabels, perfectPreds, 2000, 7)).toEqual({
      lower: 0,
      upper: 1,
    });
  });

  it("widens the interval when the validation set is noisier", () => {
    const cohortPreds = [1, 1, 1, 0, 1, 0, 1, 1];
    const noisyPreds = [1, 1, 0, 1, 1, 0, 1, 0, 0, 1]; // imperfect judge
    const clean = scoreBCI(cohortPreds, perfectLabels, perfectPreds, 3000, 7);
    const noisy = scoreBCI(cohortPreds, perfectLabels, noisyPreds, 3000, 7);
    expect(noisy.upper - noisy.lower).toBeGreaterThan(clean.upper - clean.lower);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test evaluatorMetrics`
Expected: FAIL — `scoreBCI is not a function`.

- [ ] **Step 3: Implement `scoreBCI`**

Append to `packages/backend/convex/evaluator/metrics.ts`:

```typescript
/**
 * Bootstrap 95% CI for Score B (corrected agent pass rate).
 *
 * Unlike `bootstrapCI`, this propagates BOTH sources of uncertainty:
 *   1. sampling uncertainty in the observed cohort pass rate (resample cohortPreds)
 *   2. uncertainty in the judge's TPR/TNR (resample the validation test pairs)
 * Each bootstrap draw recomputes p_obs* and TPR*/TNR*, then applies the
 * Rogan-Gladen correction. Returns the 2.5/97.5 percentiles.
 */
export function scoreBCI(
  cohortPreds: number[], // 0 = fail, 1 = pass (judge verdicts over the cohort)
  testLabels: number[], // 0 = fail, 1 = pass (human labels on the test split)
  testPreds: number[], // 0 = fail, 1 = pass (judge verdicts on the test split)
  B: number = 20000,
  seed: number = 42,
): { lower: number; upper: number } {
  const M = cohortPreds.length;
  const N = testLabels.length;
  if (M === 0 || N === 0) return { lower: 0, upper: 1 };

  let rngState = seed | 0;
  const rng = () => {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const samples: number[] = [];

  for (let b = 0; b < B; b++) {
    // 1) resample cohort → p_obs*
    let passBoot = 0;
    for (let i = 0; i < M; i++) {
      const idx = Math.floor(rng() * M);
      if (cohortPreds[idx] === 1) passBoot++;
    }
    const pObsStar = passBoot / M;

    // 2) resample validation pairs → TPR*/TNR*
    let pCount = 0;
    let fCount = 0;
    let tpBoot = 0;
    let tnBoot = 0;
    for (let i = 0; i < N; i++) {
      const idx = Math.floor(rng() * N);
      const lbl = testLabels[idx];
      const pred = testPreds[idx];
      if (lbl === 1) {
        pCount++;
        if (pred === 1) tpBoot++;
      } else {
        fCount++;
        if (pred === 0) tnBoot++;
      }
    }
    if (pCount === 0 || fCount === 0) continue;

    const tprStar = tpBoot / pCount;
    const tnrStar = tnBoot / fCount;
    const denomStar = tprStar + tnrStar - 1;
    if (denomStar <= 0) continue;

    const thetaStar = (pObsStar + tnrStar - 1) / denomStar;
    samples.push(Math.max(0, Math.min(1, thetaStar)));
  }

  if (samples.length === 0) return { lower: 0, upper: 1 };
  samples.sort((a, b) => a - b);
  const lowerIdx = Math.floor(0.025 * samples.length);
  const upperIdx = Math.min(
    Math.floor(0.975 * samples.length),
    samples.length - 1,
  );
  return { lower: samples[lowerIdx], upper: samples[upperIdx] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test evaluatorMetrics`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/evaluator/metrics.ts packages/backend/tests/evaluatorMetrics.test.ts
git commit -m "feat(backend): metrics — scoreBCI bootstrap CI for corrected agent score"
```

---

## Task 4: `sources.ts` — unified message fetcher

Conversation labels return the full `messages` rows (so code judges keep access to `toolCall`/`toolResult`). Transcript labels return normalized `{ role, content }` rows mapping livechat roles (`user → user`, `human_agent → assistant`, `workflow_input → system`), preferring `translatedMessages` text when present.

**Files:**
- Create: `packages/backend/convex/evaluator/sources.ts`
- Test: `packages/backend/tests/evaluatorSources.test.ts`

- [ ] **Step 1: Write the failing unit test for `normalizeTranscriptMessages`**

Create `packages/backend/tests/evaluatorSources.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeTranscriptMessages } from "../convex/evaluator/sources";

describe("normalizeTranscriptMessages", () => {
  const base = {
    messages: [
      { id: 1, role: "user" as const, text: "hi" },
      { id: 2, role: "human_agent" as const, text: "hello, how can I help?" },
      { id: 3, role: "workflow_input" as const, text: "intent=greet" },
    ],
  };

  it("maps livechat roles to judge roles and drops workflow_input", () => {
    const out = normalizeTranscriptMessages(base as any);
    expect(out).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello, how can I help?" },
    ]);
  });

  it("prefers translatedMessages text when present (matched by id)", () => {
    const withTranslation = {
      ...base,
      translatedMessages: [
        { id: 1, text: "hi (translated)" },
        { id: 2, text: "hello (translated)" },
      ],
    };
    const out = normalizeTranscriptMessages(withTranslation as any);
    expect(out).toEqual([
      { role: "user", content: "hi (translated)" },
      { role: "assistant", content: "hello (translated)" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test evaluatorSources`
Expected: FAIL — module `../convex/evaluator/sources` not found.

- [ ] **Step 3: Implement `sources.ts`**

Create `packages/backend/convex/evaluator/sources.ts`:

```typescript
import { internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

/** Judge-facing message shape (loose; code judges read extra fields off the row). */
export type JudgeMessage = {
  role: string;
  content: string;
  toolCall?: unknown;
  toolResult?: unknown;
};

/**
 * Pure: map a livechat transcript document to judge-facing messages.
 * - user → user, human_agent → assistant, workflow_input → system (dropped from context)
 * - prefer translatedMessages[].text (matched by id) when available
 */
export function normalizeTranscriptMessages(
  doc: Pick<Doc<"livechatConversations">, "messages" | "translatedMessages">,
): JudgeMessage[] {
  const translation = new Map<number, string>();
  for (const t of doc.translatedMessages ?? []) translation.set(t.id, t.text);

  const roleMap: Record<string, string> = {
    user: "user",
    human_agent: "assistant",
    workflow_input: "system",
  };

  const out: JudgeMessage[] = [];
  for (const m of doc.messages) {
    const role = roleMap[m.role] ?? m.role;
    if (role === "system") continue; // workflow_input excluded from judge context
    out.push({ role, content: translation.get(m.id) ?? m.text });
  }
  return out;
}

const sourceValidator = v.union(
  v.object({
    kind: v.literal("conversation"),
    conversationId: v.id("conversations"),
  }),
  v.object({
    kind: v.literal("transcript"),
    transcriptId: v.id("livechatConversations"),
  }),
);

/**
 * Fetch judge-facing messages for any label/membership source.
 * Conversation sources return full `messages` rows (code judges need toolCall/toolResult).
 * Transcript sources return normalized {role, content} rows.
 */
export const getMessagesForSource = internalQuery({
  args: { source: sourceValidator },
  handler: async (ctx, { source }): Promise<JudgeMessage[]> => {
    if (source.kind === "conversation") {
      const rows = await ctx.runQuery(
        internal.crud.conversations.listMessagesInternal,
        { conversationId: source.conversationId },
      );
      return rows as unknown as JudgeMessage[];
    }
    const doc = await ctx.db.get(source.transcriptId);
    if (!doc) return [];
    return normalizeTranscriptMessages(doc);
  },
});
```

> Note: `getMessagesForSource` calls `internal.crud.conversations.listMessagesInternal` via `ctx.runQuery` so the conversation branch reuses the existing internal query. If `ctx.runQuery` from inside an `internalQuery` is rejected by the type checker, inline the same query instead: `ctx.db.query("messages").withIndex("by_conversation", q => q.eq("conversationId", source.conversationId)).order("asc").collect()`.

- [ ] **Step 4: Run unit test to verify it passes**

Run: `pnpm -C packages/backend test evaluatorSources`
Expected: PASS for `normalizeTranscriptMessages`.

- [ ] **Step 5: Add a `convex-test` integration test for `getMessagesForSource`**

Append to `packages/backend/tests/evaluatorSources.test.ts`:

```typescript
import { convexTest } from "convex-test";
import { internal } from "../convex/_generated/api";
import { TEST_ORG_ID, setupTest } from "./helpers";

describe("getMessagesForSource (integration)", () => {
  it("returns normalized messages for a transcript source", async () => {
    const t = setupTest();
    const transcriptId = await t.run(async (ctx) => {
      const uploadId = await ctx.db.insert("livechatUploads" as any, {
        orgId: TEST_ORG_ID,
        createdAt: Date.now(),
      } as any);
      return await ctx.db.insert("livechatConversations", {
        uploadId,
        orgId: TEST_ORG_ID,
        conversationId: "c1",
        visitorId: "v1",
        visitorName: "V",
        visitorPhone: "",
        visitorEmail: "",
        agentId: "a1",
        agentName: "A",
        agentEmail: "",
        inbox: "",
        labels: [],
        status: "closed",
        messages: [
          { id: 1, role: "user", text: "hi" },
          { id: 2, role: "human_agent", text: "hello" },
        ],
        metadata: {},
        classificationStatus: "none",
        translationStatus: "none",
      } as any);
    });

    const msgs = await t.query(internal.evaluator.sources.getMessagesForSource, {
      source: { kind: "transcript", transcriptId },
    });
    expect(msgs).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});
```

> If `livechatUploads` requires different/more fields, adjust the seed insert to satisfy the schema — the assertion on `msgs` is what matters. Confirm the exact required fields by reading the `livechatUploads` table in `schema.ts` before running.

- [ ] **Step 6: Run the full file to verify both pass**

Run: `pnpm -C packages/backend test evaluatorSources`
Expected: PASS (unit + integration).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/evaluator/sources.ts packages/backend/tests/evaluatorSources.test.ts
git commit -m "feat(backend): evaluator/sources — unified message fetcher incl. transcripts"
```

---

## Task 5: `llmJudge.ts` — `buildJudgePrompt` (pure)

**Files:**
- Create: `packages/backend/convex/evaluator/llmJudge.ts`
- Test: `packages/backend/tests/evaluatorLlmJudge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/evaluatorLlmJudge.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildJudgePrompt } from "../convex/evaluator/llmJudge";

const evaluator = {
  type: "llm_judge" as const,
  llmJudgeConfig: {
    dimensions: [
      {
        name: "No hallucinated refunds",
        rubric: "Pass if the agent never promises a refund it cannot grant.",
        passExamples: ["Agent declines politely."],
        failExamples: ["Agent promises an instant refund."],
      },
    ],
    outputFormat: "per_dimension" as const,
    model: "gpt-4o-mini",
    inputContext: ["transcript"] as const,
  },
};

const messages = [
  { role: "user", content: "Can I get a refund?" },
  { role: "assistant", content: "Let me check our policy." },
];

describe("buildJudgePrompt", () => {
  it("includes rubric, pass/fail examples and the JSON output contract", () => {
    const { system, user } = buildJudgePrompt(evaluator as any, messages, "");
    expect(system).toContain("No hallucinated refunds");
    expect(system).toContain("Pass if the agent never promises");
    expect(system).toContain("Agent promises an instant refund.");
    expect(system.toLowerCase()).toContain("json");
    expect(system).toContain('"answer"');
    expect(user).toContain("Can I get a refund?");
    expect(user).toContain("Let me check our policy.");
  });

  it("renders a few-shot block when provided", () => {
    const fewShot = "### Example 1\nVerdict: fail\n";
    const { system } = buildJudgePrompt(evaluator as any, messages, fewShot);
    expect(system).toContain("### Example 1");
  });

  it("includes tool calls only when inputContext requests tool_calls", () => {
    const withTool = [
      ...messages,
      { role: "assistant", content: "", toolCall: { name: "lookupOrder", args: { id: 7 } } },
    ];
    const off = buildJudgePrompt(evaluator as any, withTool, "");
    expect(off.user).not.toContain("lookupOrder");

    const evWithTools = {
      ...evaluator,
      llmJudgeConfig: { ...evaluator.llmJudgeConfig, inputContext: ["transcript", "tool_calls"] },
    };
    const on = buildJudgePrompt(evWithTools as any, withTool, "");
    expect(on.user).toContain("lookupOrder");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test evaluatorLlmJudge`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client interface + `buildJudgePrompt`**

Create `packages/backend/convex/evaluator/llmJudge.ts`:

```typescript
import { scoreOne, type Verdict } from "./scoreOne";

/** Structural subset of the OpenAI client used by the judge — enables injection + mocking. */
export interface JudgeLlmClient {
  chat: {
    completions: {
      create(args: {
        model: string;
        temperature?: number;
        response_format?: { type: "json_object" };
        messages: { role: "system" | "user"; content: string }[];
      }): Promise<{ choices: { message: { content: string | null } }[] }>;
    };
  };
}

type Dimension = {
  name: string;
  rubric: string;
  passExamples: string[];
  failExamples: string[];
};

function renderMessages(
  messages: any[],
  includeToolCalls: boolean,
): string {
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.role ?? "unknown";
    if (m.content) lines.push(`${role}: ${m.content}`);
    if (includeToolCalls && m.toolCall) {
      lines.push(`${role} [tool_call]: ${JSON.stringify(m.toolCall)}`);
    }
    if (includeToolCalls && m.toolResult) {
      lines.push(`${role} [tool_result]: ${JSON.stringify(m.toolResult)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Build the system + user prompt for an LLM judge.
 * Pure — no network. `fewShot` is a pre-rendered block (may be empty).
 */
export function buildJudgePrompt(
  evaluator: { llmJudgeConfig?: { dimensions: Dimension[]; inputContext: string[] } },
  messages: any[],
  fewShot: string,
): { system: string; user: string } {
  const cfg = evaluator.llmJudgeConfig;
  const dimensions = cfg?.dimensions ?? [];
  const includeToolCalls = (cfg?.inputContext ?? []).includes("tool_calls");

  const dimBlocks = dimensions
    .map((d, i) => {
      const pass = d.passExamples.length
        ? d.passExamples.map((e) => `  - PASS: ${e}`).join("\n")
        : "  - (none)";
      const fail = d.failExamples.length
        ? d.failExamples.map((e) => `  - FAIL: ${e}`).join("\n")
        : "  - (none)";
      return `Dimension ${i + 1}: ${d.name}\nRubric: ${d.rubric}\nExamples:\n${pass}\n${fail}`;
    })
    .join("\n\n");

  const system =
    `You are a strict pass/fail judge for a conversational AI agent. ` +
    `Evaluate the conversation against the dimension(s) below. ` +
    `A conversation PASSES only if it satisfies every dimension; otherwise it FAILS.\n\n` +
    `${dimBlocks}\n\n` +
    (fewShot ? `Worked examples:\n${fewShot}\n\n` : "") +
    `Respond with a single JSON object and nothing else, of the form ` +
    `{ "answer": "pass" | "fail", "reasoning": "<one or two sentences>" }.`;

  const user =
    `Conversation transcript:\n\n${renderMessages(messages, includeToolCalls)}\n\n` +
    `Return your JSON verdict now.`;

  return { system, user };
}
```

> `kb_documents` input context is intentionally a no-op in Slice 1 (documented stub). `scoreOne`/`Verdict` are imported now for use in Task 6.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test evaluatorLlmJudge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/evaluator/llmJudge.ts packages/backend/tests/evaluatorLlmJudge.test.ts
git commit -m "feat(backend): llmJudge — buildJudgePrompt + injectable client interface"
```

---

## Task 6: `llmJudge.ts` — `runLlmJudge` + `scoreOneAsync`

**Files:**
- Modify: `packages/backend/convex/evaluator/llmJudge.ts`
- Test: `packages/backend/tests/evaluatorLlmJudge.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/tests/evaluatorLlmJudge.test.ts`:

```typescript
import { runLlmJudge, scoreOneAsync, type JudgeLlmClient } from "../convex/evaluator/llmJudge";

function fakeClient(content: string): JudgeLlmClient {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content } }] }),
      },
    },
  };
}

describe("runLlmJudge", () => {
  it("returns passed=true on a pass verdict", async () => {
    const client = fakeClient(JSON.stringify({ answer: "pass", reasoning: "fine" }));
    const v = await runLlmJudge(client, evaluator as any, messages, "");
    expect(v.passed).toBe(true);
    expect(v.justification).toContain("fine");
  });

  it("returns passed=false on a fail verdict", async () => {
    const client = fakeClient(JSON.stringify({ answer: "fail", reasoning: "bad" }));
    const v = await runLlmJudge(client, evaluator as any, messages, "");
    expect(v.passed).toBe(false);
  });

  it("throws on unparseable judge output", async () => {
    const client = fakeClient("not json at all");
    await expect(runLlmJudge(client, evaluator as any, messages, "")).rejects.toThrow();
  });
});

describe("scoreOneAsync dispatch", () => {
  it("uses code scorer for code judges without calling the client", async () => {
    let called = false;
    const client: JudgeLlmClient = {
      chat: { completions: { create: async () => { called = true; return { choices: [] }; } } },
    };
    const codeEvaluator = {
      type: "code",
      codeJudgeConfig: {
        checkType: "string_contains",
        params: { needle: "policy", expectPresent: true },
      },
    };
    const v = await scoreOneAsync(client, codeEvaluator as any, messages, "");
    expect(called).toBe(false);
    expect(v.passed).toBe(true); // "Let me check our policy." contains "policy"
  });

  it("routes llm_judge to the client", async () => {
    const client = fakeClient(JSON.stringify({ answer: "fail", reasoning: "x" }));
    const v = await scoreOneAsync(client, evaluator as any, messages, "");
    expect(v.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test evaluatorLlmJudge`
Expected: FAIL — `runLlmJudge`/`scoreOneAsync` not exported.

- [ ] **Step 3: Implement `runLlmJudge` + `scoreOneAsync`**

Append to `packages/backend/convex/evaluator/llmJudge.ts` (the `parseJudgeResponse` import goes at the top of the file with the other imports):

```typescript
// add to the imports at the top of the file:
import { parseJudgeResponse } from "./parseJudge";

/**
 * Run a single LLM judge against a conversation. Throws on unparseable output
 * so callers can record an error rather than silently passing.
 */
export async function runLlmJudge(
  client: JudgeLlmClient,
  evaluator: { llmJudgeConfig?: { model?: string; dimensions: any[]; inputContext: string[] } },
  messages: any[],
  fewShot: string,
): Promise<Verdict> {
  const { system, user } = buildJudgePrompt(evaluator as any, messages, fewShot);
  const model = evaluator.llmJudgeConfig?.model ?? "gpt-4o-mini";
  const res = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("LLM judge returned no content");
  const parsed = parseJudgeResponse(content); // throws on garbage
  return { passed: parsed.verdict === "pass", justification: parsed.reasoning };
}

/**
 * Async scoring dispatcher: code judges stay synchronous (`scoreOne`),
 * llm judges go through the injected client. Used inside Node actions.
 */
export async function scoreOneAsync(
  client: JudgeLlmClient,
  evaluator: { type: "code" | "llm_judge"; [k: string]: any },
  messages: any[],
  fewShot: string = "",
): Promise<Verdict> {
  if (evaluator.type === "code") return scoreOne(evaluator, messages);
  return runLlmJudge(client, evaluator, messages, fewShot);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test evaluatorLlmJudge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/evaluator/llmJudge.ts packages/backend/tests/evaluatorLlmJudge.test.ts
git commit -m "feat(backend): llmJudge — runLlmJudge + scoreOneAsync dispatcher"
```

---

## Task 7: `fewShot.ts` — select + render few-shot examples

Few-shot examples are drawn from the **train** split (balanced via `stratifiedFewShot`) and built **once per validation/batch run**. This task is the pure selection + rendering; fetching transcripts happens at the call sites (Tasks 9/11) using `getMessagesForSource`.

**Files:**
- Create: `packages/backend/convex/evaluator/fewShot.ts`
- Test: `packages/backend/tests/evaluatorFewShot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/evaluatorFewShot.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderFewShotBlock } from "../convex/evaluator/fewShot";

describe("renderFewShotBlock", () => {
  it("renders labeled transcript examples with verdicts", () => {
    const block = renderFewShotBlock([
      { label: "fail", messages: [{ role: "user", content: "refund?" }, { role: "assistant", content: "instant refund!" }] },
      { label: "pass", messages: [{ role: "user", content: "refund?" }, { role: "assistant", content: "let me check policy" }] },
    ]);
    expect(block).toContain("Verdict: fail");
    expect(block).toContain("Verdict: pass");
    expect(block).toContain("instant refund!");
    expect(block).toContain("let me check policy");
  });

  it("returns an empty string for no examples", () => {
    expect(renderFewShotBlock([])).toBe("");
  });

  it("truncates very long transcripts to keep the prompt bounded", () => {
    const long = Array.from({ length: 50 }, (_, i) => ({ role: "user", content: `line ${i}` }));
    const block = renderFewShotBlock([{ label: "pass", messages: long }]);
    expect(block.length).toBeLessThan(4000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test evaluatorFewShot`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fewShot.ts`**

Create `packages/backend/convex/evaluator/fewShot.ts`:

```typescript
import { stratifiedFewShot } from "./splits";

export type FewShotExample = {
  label: "pass" | "fail";
  messages: { role: string; content: string }[];
};

const MAX_LINES_PER_EXAMPLE = 16;

/** Pure: render selected examples into a prompt block. Returns "" when empty. */
export function renderFewShotBlock(examples: FewShotExample[]): string {
  if (examples.length === 0) return "";
  return examples
    .map((ex, i) => {
      const lines = ex.messages
        .slice(0, MAX_LINES_PER_EXAMPLE)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
      const truncated =
        ex.messages.length > MAX_LINES_PER_EXAMPLE ? "\n…(truncated)" : "";
      return `### Example ${i + 1}\n${lines}${truncated}\nVerdict: ${ex.label}`;
    })
    .join("\n\n");
}

/**
 * Pure: choose a balanced set of train-label ids for few-shot.
 * Wraps `stratifiedFewShot` so call sites only deal with ids.
 */
export function selectFewShot(
  passIds: string[],
  failIds: string[],
  targetCount: number,
  seed: number,
): string[] {
  return stratifiedFewShot(passIds, failIds, targetCount, seed).ids;
}
```

- [ ] **Step 4: Add the `selectFewShot` test**

Append to `packages/backend/tests/evaluatorFewShot.test.ts`:

```typescript
import { selectFewShot } from "../convex/evaluator/fewShot";

describe("selectFewShot", () => {
  it("returns a bounded, balanced id set", () => {
    const ids = selectFewShot(["p1", "p2", "p3"], ["f1", "f2"], 4, 1);
    expect(ids.length).toBeLessThanOrEqual(4);
    expect(ids.every((id) => ["p1", "p2", "p3", "f1", "f2"].includes(id))).toBe(true);
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/backend test evaluatorFewShot`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/evaluator/fewShot.ts packages/backend/tests/evaluatorFewShot.test.ts
git commit -m "feat(backend): fewShot — balanced selection + prompt rendering"
```

---

## Task 8: extend `updateMetrics`, add `updateValidation` internal mutation

The current `updateMetrics` only accepts `devMetrics` + `status`. Add a richer `updateValidation` internalMutation that persists dev/test metrics, CIs, label counts, status, and `validatedAt`. Keep `updateMetrics` working (back-compat for any caller) but route validate.ts to the new one.

**Files:**
- Modify: `packages/backend/convex/evaluator/crud.ts`
- Test: `packages/backend/tests/evaluatorsCrud.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/tests/evaluatorsCrud.test.ts` (reuse the file's existing seed helpers; if it seeds an evaluator via a helper, use it — otherwise insert directly as shown):

```typescript
import { internal } from "../convex/_generated/api";

describe("updateValidation", () => {
  it("persists dev+test metrics, CIs, counts, status and validatedAt", async () => {
    const t = setupTest();
    const { evaluatorId } = await seedEvaluatorForCrud(t); // existing/local helper

    await t.mutation(internal.evaluator.crud.updateValidation, {
      evaluatorId,
      devMetrics: { tpr: 0.9, tnr: 0.88, agreement: 0.89 },
      testMetrics: { tpr: 0.86, tnr: 0.87, agreement: 0.86, n: 12 },
      devMetricsCI: { tpr: { lower: 0.7, upper: 0.97 }, tnr: { lower: 0.6, upper: 0.96 } },
      testMetricsCI: { tpr: { lower: 0.6, upper: 0.95 }, tnr: { lower: 0.6, upper: 0.95 } },
      labelCounts: { passDev: 6, failDev: 6, passTest: 6, failTest: 6 },
      status: "ready",
      validatedAt: 1000,
    });

    const ev = await t.run(async (ctx) => ctx.db.get(evaluatorId));
    expect(ev!.status).toBe("ready");
    expect(ev!.testMetrics!.n).toBe(12);
    expect(ev!.devMetricsCI!.tpr.upper).toBeCloseTo(0.97);
    expect(ev!.labelCounts!.passTest).toBe(6);
    expect(ev!.validatedAt).toBe(1000);
  });
});
```

> If `evaluatorsCrud.test.ts` has no reusable evaluator seeder, add a small local `seedEvaluatorForCrud(t)` that inserts an `agents` row then an `evaluators` row (status `"draft"`, `type: "llm_judge"`, minimal `llmJudgeConfig`) and returns `{ agentId, evaluatorId }`. Mirror the field shape from `evaluator/crud.ts` `create`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test evaluatorsCrud`
Expected: FAIL — `updateValidation` not found.

- [ ] **Step 3: Add validators + `updateValidation`**

In `packages/backend/convex/evaluator/crud.ts`, add these validators near `devMetricsValidator`:

```typescript
const ciPairValidator = v.object({
  tpr: v.object({ lower: v.number(), upper: v.number() }),
  tnr: v.object({ lower: v.number(), upper: v.number() }),
});

const testMetricsValidator = v.object({
  tpr: v.number(),
  tnr: v.number(),
  agreement: v.number(),
  n: v.number(),
});

const labelCountsValidator = v.object({
  passDev: v.number(),
  failDev: v.number(),
  passTest: v.number(),
  failTest: v.number(),
});
```

Then add the new internalMutation (next to `updateMetrics`):

```typescript
export const updateValidation = internalMutation({
  args: {
    evaluatorId: v.id("evaluators"),
    devMetrics: devMetricsValidator,
    testMetrics: v.optional(testMetricsValidator),
    devMetricsCI: v.optional(ciPairValidator),
    testMetricsCI: v.optional(ciPairValidator),
    labelCounts: v.optional(labelCountsValidator),
    status: statusValidator,
    validatedAt: v.optional(v.number()),
  },
  handler: async (ctx, { evaluatorId, ...patch }) => {
    const filtered = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(evaluatorId, { ...filtered, updatedAt: Date.now() });
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test evaluatorsCrud`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/evaluator/crud.ts packages/backend/tests/evaluatorsCrud.test.ts
git commit -m "feat(backend): evaluator/crud — updateValidation persists dev/test metrics + CIs"
```

---

## Task 9: rewrite `validate.ts` — honest validation

Convert to a `"use node"` action that: builds few-shot once from train labels, scores **dev** and (when present) **test** splits via `scoreOneAsync`, includes transcript-sourced labels (via `getMessagesForSource`), computes Wilson CIs, applies the `MIN_PER_CLASS` gate, and persists via `updateValidation`.

**Files:**
- Rewrite: `packages/backend/convex/evaluator/validate.ts`
- Test: `packages/backend/tests/evaluatorValidate.test.ts`

- [ ] **Step 1: Write the failing tests (replace the file's assertions)**

Open `packages/backend/tests/evaluatorValidate.test.ts`. Keep its existing seed helpers. The action now constructs `new OpenAI()`, so mock the module at the top of the test file:

```typescript
import { vi } from "vitest";

vi.mock("openai", () => {
  // verdict driven by a per-test global the seeds set on conversation content
  return {
    default: class {
      chat = {
        completions: {
          create: async (args: any) => {
            // Pass iff the transcript contains the marker "GOOD"
            const transcript = args.messages.map((m: any) => m.content).join("\n");
            const answer = transcript.includes("GOOD") ? "pass" : "fail";
            return {
              choices: [
                { message: { content: JSON.stringify({ answer, reasoning: "mock" }) } },
              ],
            };
          },
        },
      };
    },
  };
});
```

Add/replace tests:

```typescript
describe("validate.run (honest)", () => {
  it("reports calibrating + insufficient_labels when below MIN_PER_CLASS", async () => {
    const t = setupTest();
    // seed an llm_judge evaluator with only 2 dev pass + 2 dev fail labels (< 5/class)
    const { evaluatorId } = await seedJudgeWithLabels(t, {
      dev: { pass: 2, fail: 2 },
      test: { pass: 0, fail: 0 },
      train: { pass: 1, fail: 1 },
    });
    const res = await t.action(api.evaluator.validate.run, { evaluatorId });
    expect(res.status).toBe("calibrating");
    expect(res.reason).toBe("insufficient_labels");
  });

  it("confirms on the test split and marks ready when test metrics clear thresholds", async () => {
    const t = setupTest();
    const { evaluatorId } = await seedJudgeWithLabels(t, {
      dev: { pass: 5, fail: 5 },
      test: { pass: 5, fail: 5 },
      train: { pass: 2, fail: 2 },
      perfect: true, // seed conversations so the mock judge matches every label
    });
    const res = await t.action(api.evaluator.validate.run, { evaluatorId });
    expect(res.status).toBe("ready");
    expect(res.testMetrics).not.toBeNull();
    const ev = await t.run(async (ctx) => ctx.db.get(evaluatorId));
    expect(ev!.testMetrics!.n).toBe(10);
    expect(ev!.validatedAt).toBeGreaterThan(0);
  });

  it("scores transcript-sourced labels instead of skipping them", async () => {
    const t = setupTest();
    const { evaluatorId } = await seedJudgeWithLabels(t, {
      dev: { pass: 5, fail: 5 },
      test: { pass: 5, fail: 5 },
      train: { pass: 2, fail: 2 },
      perfect: true,
      sourceKind: "transcript",
    });
    const res = await t.action(api.evaluator.validate.run, { evaluatorId });
    expect(res.devMetrics.agreement).toBeGreaterThan(0); // not skipped
  });
});
```

> Implement `seedJudgeWithLabels(t, opts)` as a local helper in this test file: it creates an agent + an `llm_judge` evaluator, then inserts `evaluatorLabels` with the requested split/class counts. For each label it creates the backing source: a `conversations` row + `messages` (content contains `"GOOD"` for the verdict the mock should return), or a `livechatConversations` row when `sourceKind === "transcript"`. When `perfect: true`, make pass-labeled sources contain `"GOOD"` and fail-labeled sources omit it so the mock judge matches every human label (TPR=TNR=1). Reuse seed patterns already present in `spawnJudge.test.ts`/`evaluatorValidate.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test evaluatorValidate`
Expected: FAIL — new return fields (`reason`, `testMetrics`) and behavior not yet implemented.

- [ ] **Step 3: Rewrite `validate.ts`**

Replace the entire contents of `packages/backend/convex/evaluator/validate.ts` with:

```typescript
"use node";
import OpenAI from "openai";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";
import { scoreOneAsync, type JudgeLlmClient } from "./llmJudge";
import { computeTPRTNR, wilsonCI, type JudgmentPair } from "./metrics";
import { selectFewShot, renderFewShotBlock, type FewShotExample } from "./fewShot";

const TPR_THRESHOLD = 0.85;
const TNR_THRESHOLD = 0.85;
const MIN_PER_CLASS = 5;
const FEWSHOT_TARGET = 4;

type Metrics = { tpr: number; tnr: number; agreement: number };
type CIPair = {
  tpr: { lower: number; upper: number };
  tnr: { lower: number; upper: number };
};

export const run = action({
  args: { evaluatorId: v.id("evaluators") },
  handler: async (
    ctx,
    { evaluatorId },
  ): Promise<{
    status: "ready" | "validated" | "calibrating";
    reason?: "insufficient_labels";
    needed?: { pass: number; fail: number };
    devMetrics: Metrics;
    testMetrics: (Metrics & { n: number }) | null;
  }> => {
    const { orgId } = await getAuthContext(ctx);
    const evaluator = await ctx.runQuery(internal.evaluator.crud.getInternal, {
      id: evaluatorId,
    });
    if (!evaluator || evaluator.orgId !== orgId) {
      throw new Error("Evaluator not found");
    }

    const allLabels = await ctx.runQuery(
      internal.evaluator.labels.byEvaluatorInternal,
      { evaluatorId },
    );

    const client = new OpenAI() as unknown as JudgeLlmClient;

    // ── Build few-shot once from the TRAIN split ──
    const train = allLabels.filter((l: any) => l.splitAssignment === "train");
    const trainPass = train.filter((l: any) => l.humanLabel === "pass");
    const trainFail = train.filter((l: any) => l.humanLabel === "fail");
    const byId = new Map<string, any>(train.map((l: any) => [l._id, l]));
    const fewShotIds = selectFewShot(
      trainPass.map((l: any) => l._id),
      trainFail.map((l: any) => l._id),
      FEWSHOT_TARGET,
      evaluator.splitSeed ?? 42,
    );
    const fewShotExamples: FewShotExample[] = [];
    for (const id of fewShotIds) {
      const lbl = byId.get(id);
      if (!lbl) continue;
      const messages = await ctx.runQuery(
        internal.evaluator.sources.getMessagesForSource,
        { source: lbl.source },
      );
      fewShotExamples.push({ label: lbl.humanLabel, messages });
    }
    const fewShot = renderFewShotBlock(fewShotExamples);

    // ── Score a split into JudgmentPairs ──
    const scoreSplit = async (split: "dev" | "test"): Promise<JudgmentPair[]> => {
      const labels = allLabels.filter((l: any) => l.splitAssignment === split);
      const pairs: JudgmentPair[] = [];
      for (const label of labels) {
        const messages = await ctx.runQuery(
          internal.evaluator.sources.getMessagesForSource,
          { source: label.source },
        );
        const verdict = await scoreOneAsync(client, evaluator, messages, fewShot);
        pairs.push({
          humanLabel: label.humanLabel,
          judgeVerdict: verdict.passed ? "pass" : "fail",
        });
      }
      return pairs;
    };

    const devPairs = await scoreSplit("dev");
    const testPairs = await scoreSplit("test");

    if (devPairs.length === 0) {
      throw new Error("No dev labels — calibrate this evaluator first.");
    }

    const dev = computeTPRTNR(devPairs);
    const test = testPairs.length > 0 ? computeTPRTNR(testPairs) : null;

    const ciFor = (m: typeof dev): CIPair => ({
      tpr: wilsonCI(m.tp, m.tp + m.fn),
      tnr: wilsonCI(m.tn, m.tn + m.fp),
    });
    const devCI = ciFor(dev);
    const testCI = test ? ciFor(test) : undefined;

    const devMetrics: Metrics = {
      tpr: dev.tpr,
      tnr: dev.tnr,
      agreement: dev.accuracy,
    };
    const testMetrics =
      test !== null
        ? { tpr: test.tpr, tnr: test.tnr, agreement: test.accuracy, n: test.total }
        : null;

    // ── Gate on the final split (test if sufficient, else dev) ──
    const finalMatrix = test ?? dev;
    const finalPass = finalMatrix.tp + finalMatrix.fn;
    const finalFail = finalMatrix.tn + finalMatrix.fp;
    const sufficient = finalPass >= MIN_PER_CLASS && finalFail >= MIN_PER_CLASS;

    const labelCounts = {
      passDev: dev.tp + dev.fn,
      failDev: dev.tn + dev.fp,
      passTest: test ? test.tp + test.fn : 0,
      failTest: test ? test.tn + test.fp : 0,
    };

    if (!sufficient) {
      await ctx.runMutation(internal.evaluator.crud.updateValidation, {
        evaluatorId,
        devMetrics,
        testMetrics: testMetrics ?? undefined,
        devMetricsCI: devCI,
        testMetricsCI: testCI,
        labelCounts,
        status: "calibrating",
      });
      return {
        status: "calibrating",
        reason: "insufficient_labels",
        needed: {
          pass: Math.max(0, MIN_PER_CLASS - finalPass),
          fail: Math.max(0, MIN_PER_CLASS - finalFail),
        },
        devMetrics,
        testMetrics,
      };
    }

    const status: "ready" | "validated" =
      finalMatrix.tpr >= TPR_THRESHOLD && finalMatrix.tnr >= TNR_THRESHOLD
        ? "ready"
        : "validated";

    await ctx.runMutation(internal.evaluator.crud.updateValidation, {
      evaluatorId,
      devMetrics,
      testMetrics: testMetrics ?? undefined,
      devMetricsCI: devCI,
      testMetricsCI: testCI,
      labelCounts,
      status,
      validatedAt: Date.now(),
    });

    return { status, devMetrics, testMetrics };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test evaluatorValidate`
Expected: PASS (calibrating gate, test confirmation → ready, transcript labels scored).

- [ ] **Step 5: Typecheck backend**

Run: `pnpm -C packages/backend typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/evaluator/validate.ts packages/backend/tests/evaluatorValidate.test.ts
git commit -m "feat(backend): validate — real LLM judge, dev+test, Wilson CI, min-labels gate"
```

---

## Task 10: `autoApply.ts` — real LLM judges at sim-run completion

**Files:**
- Modify: `packages/backend/convex/evaluator/autoApply.ts`
- Test: `packages/backend/tests/autoApply.test.ts`

- [ ] **Step 1: Update the test for llm_judge scoring**

In `packages/backend/tests/autoApply.test.ts`, add the same `vi.mock("openai", ...)` block as in Task 9 (transcript-contains-`"GOOD"` → pass). Add a test that seeds a **ready** `llm_judge` evaluator and a completed sim run whose conversation messages contain `"GOOD"`, then asserts the appended `evaluatorResults` has `passed: true`. Keep existing code-judge tests intact.

```typescript
it("applies a ready llm_judge via the LLM client", async () => {
  const t = setupTest();
  const { simRunId } = await seedReadyLlmJudgeAndSimRun(t, { good: true }); // local helper
  await t.action(internal.evaluator.autoApply.applyReadyEvaluatorsToSimRun, { simRunId });
  const run = await t.run(async (ctx) => ctx.db.get(simRunId));
  const llm = run!.evaluatorResults!.find((r: any) => r.evaluatorName.includes("llm"));
  expect(llm!.passed).toBe(true);
});
```

> `seedReadyLlmJudgeAndSimRun` mirrors existing autoApply seeds (agent + simulation + conversationSimRun + conversation + messages) but inserts an evaluator with `type: "llm_judge"`, `status: "ready"`, and messages containing `"GOOD"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test autoApply`
Expected: FAIL — current `autoApply` calls sync `scoreOne`, which stubs llm_judge to always pass with the stub justification (test asserts real flow / may still pass-by-accident; the meaningful failure is the typecheck/intent). If it passes by accident, also assert `llm!.justification` does **not** contain `"[stub]"`:

```typescript
  expect(llm!.justification).not.toContain("[stub]");
```

Re-run; Expected: FAIL on the `[stub]` assertion.

- [ ] **Step 3: Implement**

Replace the contents of `packages/backend/convex/evaluator/autoApply.ts` with:

```typescript
"use node";
import OpenAI from "openai";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { scoreOneAsync, type JudgeLlmClient } from "./llmJudge";
import { selectFewShot, renderFewShotBlock, type FewShotExample } from "./fewShot";

type EvaluatorResult = {
  evaluatorId: Id<"evaluators">;
  evaluatorName: string;
  passed: boolean;
  justification: string;
  required: boolean;
};

export const applyReadyEvaluatorsToSimRun = internalAction({
  args: { simRunId: v.id("conversationSimRuns") },
  handler: async (ctx, { simRunId }) => {
    const simRun = await ctx.runQuery(
      internal.conversationSim.runs.getInternal,
      { id: simRunId },
    );
    if (!simRun || !simRun.conversationId) return;

    const ready = await ctx.runQuery(
      internal.evaluator.crud.byAgentStatusInternal,
      { agentId: simRun.agentId, status: "ready" },
    );
    if (ready.length === 0) return;

    const messages = await ctx.runQuery(
      internal.crud.conversations.listMessagesInternal,
      { conversationId: simRun.conversationId },
    );

    const client = new OpenAI() as unknown as JudgeLlmClient;
    const results: EvaluatorResult[] = [];

    for (const ev of ready as any[]) {
      // Build few-shot once per evaluator from its train labels.
      let fewShot = "";
      if (ev.type === "llm_judge") {
        const labels = await ctx.runQuery(
          internal.evaluator.labels.byEvaluatorInternal,
          { evaluatorId: ev._id },
        );
        const train = labels.filter((l: any) => l.splitAssignment === "train");
        const byId = new Map<string, any>(train.map((l: any) => [l._id, l]));
        const ids = selectFewShot(
          train.filter((l: any) => l.humanLabel === "pass").map((l: any) => l._id),
          train.filter((l: any) => l.humanLabel === "fail").map((l: any) => l._id),
          4,
          ev.splitSeed ?? 42,
        );
        const examples: FewShotExample[] = [];
        for (const id of ids) {
          const lbl = byId.get(id);
          if (!lbl) continue;
          const m = await ctx.runQuery(
            internal.evaluator.sources.getMessagesForSource,
            { source: lbl.source },
          );
          examples.push({ label: lbl.humanLabel, messages: m });
        }
        fewShot = renderFewShotBlock(examples);
      }

      const verdict = await scoreOneAsync(client, ev, messages, fewShot);
      results.push({
        evaluatorId: ev._id,
        evaluatorName: ev.name,
        passed: verdict.passed,
        justification: verdict.justification,
        required: false,
      });
    }

    await ctx.runMutation(
      internal.conversationSim.runs.appendEvaluatorResultsInternal,
      { runId: simRunId, results },
    );
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test autoApply`
Expected: PASS (llm judge produces a real verdict, no `[stub]`).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/evaluator/autoApply.ts packages/backend/tests/autoApply.test.ts
git commit -m "feat(backend): autoApply — score ready llm_judges via real LLM client"
```

---

## Task 11: `batchApply.ts` — Score B over a simulation cohort

Single `"use node"` action (Slice-1 scope; see deviation note at top). It resolves the simulation's completed runs into conversation sources, **excludes** any source that is a calibration label for the evaluator, scores the rest via `scoreOneAsync`, computes observed + Rogan-Gladen-corrected pass rate with a `scoreBCI` CI, and writes one `evaluationRuns` row plus per-conversation `evaluationResults`.

**Files:**
- Create: `packages/backend/convex/evaluator/batchApply.ts`
- Create: `packages/backend/convex/evaluator/evaluationRuns.ts` (write internalMutations + read queries)
- Modify: `packages/backend/convex/conversationSim/runs.ts` (add `bySimulationInternal` if missing)
- Test: `packages/backend/tests/evaluatorBatchApply.test.ts`

- [ ] **Step 1: Add `bySimulationInternal` internalQuery (if absent)**

Check `packages/backend/convex/conversationSim/runs.ts` for an internal query returning all runs for a simulation. If absent, add:

```typescript
export const bySimulationInternal = internalQuery({
  args: { simulationId: v.id("conversationSimulations") },
  handler: async (ctx, { simulationId }) => {
    return await ctx.db
      .query("conversationSimRuns")
      .withIndex("by_simulation", (q) => q.eq("simulationId", simulationId))
      .collect();
  },
});
```

(Ensure `internalQuery` is imported in that file.)

- [ ] **Step 2: Create `evaluationRuns.ts` write + read functions**

Create `packages/backend/convex/evaluator/evaluationRuns.ts`:

```typescript
import { internalMutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

const resultSourceValidator = v.union(
  v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
  v.object({ kind: v.literal("transcript"), transcriptId: v.id("livechatConversations") }),
);

export const insertRunInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentId: v.id("agents"),
    evaluatorId: v.id("evaluators"),
    simulationId: v.id("conversationSimulations"),
    n: v.number(),
    observedPassRate: v.number(),
    correctedPassRate: v.number(),
    ci: v.object({ lower: v.number(), upper: v.number() }),
    corrected: v.boolean(),
    results: v.array(
      v.object({
        source: resultSourceValidator,
        passed: v.boolean(),
        justification: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const runId = await ctx.db.insert("evaluationRuns", {
      orgId: args.orgId,
      agentId: args.agentId,
      evaluatorId: args.evaluatorId,
      cohort: { kind: "simulation", simulationId: args.simulationId },
      n: args.n,
      observedPassRate: args.observedPassRate,
      correctedPassRate: args.correctedPassRate,
      ci: args.ci,
      corrected: args.corrected,
      createdAt: Date.now(),
    });
    for (const r of args.results) {
      await ctx.db.insert("evaluationResults", {
        orgId: args.orgId,
        evaluationRunId: runId,
        source: r.source,
        passed: r.passed,
        justification: r.justification,
      });
    }
    return runId;
  },
});

/** Latest evaluationRun per evaluator for a simulation cohort (for the scorecard). */
export const bySimulation = query({
  args: { simulationId: v.id("conversationSimulations") },
  handler: async (ctx, { simulationId }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db
      .query("evaluationRuns")
      .withIndex("by_simulation", (q) => q.eq("cohort.simulationId", simulationId))
      .collect();
    const mine = rows.filter((r) => r.orgId === orgId);
    // keep the most recent run per evaluator
    const latest = new Map<string, (typeof mine)[number]>();
    for (const r of mine) {
      const prev = latest.get(r.evaluatorId);
      if (!prev || r.createdAt > prev.createdAt) latest.set(r.evaluatorId, r);
    }
    return Array.from(latest.values());
  },
});
```

- [ ] **Step 3: Write the failing batch-apply test**

Create `packages/backend/tests/evaluatorBatchApply.test.ts` with the `vi.mock("openai", ...)` block (transcript-contains-`"GOOD"` → pass, same as Task 9). Seed: an agent, a completed `conversationSimulations`, several `conversationSimRuns` each with a `conversations` row + `messages` (some containing `"GOOD"`, some not), and a `ready` `llm_judge` evaluator whose `testMetrics`/`devMetrics` are set so correction applies. Add one conversation that is *also* an `evaluatorLabel` (the calibration set) and assert it is excluded from `n`.

```typescript
it("computes corrected Score B and excludes the calibration set", async () => {
  const t = setupTest();
  const { agentId, simulationId, evaluatorId, calibrationConvId } =
    await seedCohortAndJudge(t, {
      goodCount: 3, // pass
      badCount: 1, // fail  → observed pass rate 0.75 over the 4 measured convs
      validated: { tpr: 0.9, tnr: 0.9 },
    });

  const res = await t.action(api.evaluator.batchApply.runOnCohort, {
    evaluatorIds: [evaluatorId],
    cohort: { kind: "simulation", simulationId },
  });

  expect(res.runs).toHaveLength(1);
  expect(res.runs[0].n).toBe(4); // calibration conv excluded
  expect(res.runs[0].observedPassRate).toBeCloseTo(0.75, 5);
  expect(res.runs[0].corrected).toBe(true);

  const runRow = await t.run(async (ctx) =>
    ctx.db
      .query("evaluationRuns")
      .withIndex("by_evaluator", (q) => q.eq("evaluatorId", evaluatorId))
      .first(),
  );
  expect(runRow).not.toBeNull();

  // calibration conversation never measured
  const results = await t.run(async (ctx) =>
    ctx.db
      .query("evaluationResults")
      .withIndex("by_run", (q) => q.eq("evaluationRunId", runRow!._id))
      .collect(),
  );
  const measuredConvIds = results.map((r: any) =>
    r.source.kind === "conversation" ? r.source.conversationId : null,
  );
  expect(measuredConvIds).not.toContain(calibrationConvId);
});

it("marks Score B uncorrected when the judge is not validated", async () => {
  const t = setupTest();
  const { simulationId, evaluatorId } = await seedCohortAndJudge(t, {
    goodCount: 2,
    badCount: 2,
    validated: null, // status draft, no metrics
  });
  const res = await t.action(api.evaluator.batchApply.runOnCohort, {
    evaluatorIds: [evaluatorId],
    cohort: { kind: "simulation", simulationId },
  });
  expect(res.runs[0].corrected).toBe(false);
});
```

> `seedCohortAndJudge(t, opts)` builds the agent, a `conversationSimulations` (status `completed`), `opts.goodCount + opts.badCount` completed runs each with a conversation + messages (`"GOOD"` for pass), one extra conversation registered as an `evaluatorLabel` for the judge (the calibration set), and the evaluator (`type: "llm_judge"`; when `opts.validated` is set, status `"ready"` with `devMetrics`/`testMetrics` populated and enough test labels; else `"draft"`). Return the ids used in assertions.

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm -C packages/backend test evaluatorBatchApply`
Expected: FAIL — `batchApply.runOnCohort` not found.

- [ ] **Step 5: Implement `batchApply.ts`**

Create `packages/backend/convex/evaluator/batchApply.ts`:

```typescript
"use node";
import OpenAI from "openai";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { getAuthContext } from "../lib/auth";
import { scoreOneAsync, type JudgeLlmClient } from "./llmJudge";
import { selectFewShot, renderFewShotBlock, type FewShotExample } from "./fewShot";
import { correctedPassRate, scoreBCI } from "./metrics";

type RunSummary = {
  evaluatorId: Id<"evaluators">;
  n: number;
  observedPassRate: number;
  correctedPassRate: number;
  ci: { lower: number; upper: number };
  corrected: boolean;
};

export const runOnCohort = action({
  args: {
    evaluatorIds: v.array(v.id("evaluators")),
    cohort: v.object({
      kind: v.literal("simulation"),
      simulationId: v.id("conversationSimulations"),
    }),
    sampleSize: v.optional(v.number()),
  },
  handler: async (ctx, { evaluatorIds, cohort, sampleSize }): Promise<{ runs: RunSummary[] }> => {
    const { orgId } = await getAuthContext(ctx);

    const sim = await ctx.runQuery(
      internal.conversationSim.orchestration.getInternal,
      { id: cohort.simulationId },
    );
    if (!sim || sim.orgId !== orgId) throw new Error("Simulation not found");

    const runsRows = await ctx.runQuery(
      internal.conversationSim.runs.bySimulationInternal,
      { simulationId: cohort.simulationId },
    );
    let cohortConvIds = runsRows
      .filter((r: any) => r.status === "completed" && r.conversationId)
      .map((r: any) => r.conversationId as Id<"conversations">);
    if (sampleSize && sampleSize < cohortConvIds.length) {
      cohortConvIds = cohortConvIds.slice(0, sampleSize);
    }

    const client = new OpenAI() as unknown as JudgeLlmClient;
    const runs: RunSummary[] = [];

    for (const evaluatorId of evaluatorIds) {
      const evaluator = await ctx.runQuery(internal.evaluator.crud.getInternal, {
        id: evaluatorId,
      });
      if (!evaluator || evaluator.orgId !== orgId) continue;

      const labels = await ctx.runQuery(
        internal.evaluator.labels.byEvaluatorInternal,
        { evaluatorId },
      );

      // Exclude calibration-set conversations for THIS evaluator.
      const labeledConvIds = new Set(
        labels
          .filter((l: any) => l.source.kind === "conversation")
          .map((l: any) => l.source.conversationId as string),
      );
      const measured = cohortConvIds.filter((id) => !labeledConvIds.has(id));

      // Build few-shot once from train labels.
      let fewShot = "";
      if (evaluator.type === "llm_judge") {
        const train = labels.filter((l: any) => l.splitAssignment === "train");
        const byId = new Map<string, any>(train.map((l: any) => [l._id, l]));
        const ids = selectFewShot(
          train.filter((l: any) => l.humanLabel === "pass").map((l: any) => l._id),
          train.filter((l: any) => l.humanLabel === "fail").map((l: any) => l._id),
          4,
          evaluator.splitSeed ?? 42,
        );
        const examples: FewShotExample[] = [];
        for (const id of ids) {
          const lbl = byId.get(id);
          if (!lbl) continue;
          const m = await ctx.runQuery(
            internal.evaluator.sources.getMessagesForSource,
            { source: lbl.source },
          );
          examples.push({ label: lbl.humanLabel, messages: m });
        }
        fewShot = renderFewShotBlock(examples);
      }

      // Score each measured conversation.
      const resultRows: {
        source: { kind: "conversation"; conversationId: Id<"conversations"> };
        passed: boolean;
        justification: string;
      }[] = [];
      let passes = 0;
      for (const conversationId of measured) {
        const messages = await ctx.runQuery(
          internal.evaluator.sources.getMessagesForSource,
          { source: { kind: "conversation", conversationId } },
        );
        const verdict = await scoreOneAsync(client, evaluator, messages, fewShot);
        if (verdict.passed) passes++;
        resultRows.push({
          source: { kind: "conversation", conversationId },
          passed: verdict.passed,
          justification: verdict.justification,
        });
      }

      const n = measured.length;
      const observed = n > 0 ? passes / n : 0;

      // Correct only when the evaluator is validated/ready and has test metrics.
      const tm = evaluator.testMetrics ?? evaluator.devMetrics;
      const canCorrect =
        (evaluator.status === "ready" || evaluator.status === "validated") &&
        !!tm;
      let corrected = observed;
      let ci = { lower: 0, upper: 1 };
      if (canCorrect && tm) {
        corrected = correctedPassRate(observed, tm.tpr, tm.tnr);
        // Reconstruct test-pair arrays from the test confusion matrix counts.
        const tmFull = evaluator.testMetrics;
        if (tmFull) {
          const cohortPreds = resultRows.map((r) => (r.passed ? 1 : 0));
          const { testLabels, testPreds } = reconstructPairs(evaluator);
          ci = scoreBCI(cohortPreds, testLabels, testPreds, 20000, evaluator.splitSeed ?? 42);
        }
      }

      const runId = await ctx.runMutation(
        internal.evaluator.evaluationRuns.insertRunInternal,
        {
          orgId,
          agentId: evaluator.agentId,
          evaluatorId,
          simulationId: cohort.simulationId,
          n,
          observedPassRate: observed,
          correctedPassRate: corrected,
          ci,
          corrected: canCorrect,
          results: resultRows,
        },
      );
      void runId;

      runs.push({
        evaluatorId,
        n,
        observedPassRate: observed,
        correctedPassRate: corrected,
        ci,
        corrected: canCorrect,
      });
    }

    return { runs };
  },
});

/**
 * Reconstruct flat (label, pred) arrays from a stored test confusion matrix.
 * We don't persist per-pair verdicts, but TP/TN/FP/FN counts fully determine
 * a representative array for the bootstrap (order-independent).
 */
function reconstructPairs(evaluator: any): {
  testLabels: number[];
  testPreds: number[];
} {
  const m = evaluator.testMetrics;
  const testLabels: number[] = [];
  const testPreds: number[] = [];
  if (!m) return { testLabels, testPreds };
  // Derive counts from tpr/tnr/n is lossy; instead store counts on testMetrics
  // if available. Fallback: approximate from tpr/tnr and n split evenly.
  const n = m.n ?? 0;
  const nPass = Math.round(n / 2);
  const nFail = n - nPass;
  const tp = Math.round(m.tpr * nPass);
  const tn = Math.round(m.tnr * nFail);
  for (let i = 0; i < tp; i++) { testLabels.push(1); testPreds.push(1); }
  for (let i = 0; i < nPass - tp; i++) { testLabels.push(1); testPreds.push(0); }
  for (let i = 0; i < tn; i++) { testLabels.push(0); testPreds.push(0); }
  for (let i = 0; i < nFail - tn; i++) { testLabels.push(0); testPreds.push(1); }
  return { testLabels, testPreds };
}
```

> **Precision note:** `reconstructPairs` approximates the test-pair arrays from stored `testMetrics` (it assumes a ~even pass/fail test split). For an exact CI, persist the raw test `tp/tn/fp/fn` counts on `testMetrics` in Task 9 (`computeTPRTNR` already returns them) and read them here. If you want exactness now, extend the `testMetrics` validator (Task 1 + Task 8) with `tp,tn,fp,fn` and replace the approximation. The bootstrap is otherwise correct.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -C packages/backend test evaluatorBatchApply`
Expected: PASS (n excludes calibration conv; observed 0.75; corrected flag toggles with validation status).

> If `internal.conversationSim.orchestration.getInternal` does not exist, add an `internalQuery` `getInternal` in `conversationSim/orchestration.ts` returning `ctx.db.get(id)` (mirror `evaluator/crud.ts:getInternal`).

- [ ] **Step 7: Typecheck backend**

Run: `pnpm -C packages/backend typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/convex/evaluator/batchApply.ts packages/backend/convex/evaluator/evaluationRuns.ts packages/backend/convex/conversationSim packages/backend/tests/evaluatorBatchApply.test.ts
git commit -m "feat(backend): batchApply — Score B over a simulation cohort (corrected + CI)"
```

---

## Task 12: scorecard rollup query

A thin read query the frontend uses to render the agent scorecard: per-evaluator latest run plus a mean-corrected overall.

**Files:**
- Modify: `packages/backend/convex/evaluator/evaluationRuns.ts`
- Test: `packages/backend/tests/evaluatorBatchApply.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/tests/evaluatorBatchApply.test.ts`:

```typescript
it("scorecardBySimulation returns per-evaluator rows + overall mean", async () => {
  const t = setupTest();
  const { simulationId, evaluatorId, agentId } = await seedCohortAndJudge(t, {
    goodCount: 3,
    badCount: 1,
    validated: { tpr: 0.9, tnr: 0.9 },
  });
  await t.action(api.evaluator.batchApply.runOnCohort, {
    evaluatorIds: [evaluatorId],
    cohort: { kind: "simulation", simulationId },
  });
  const card = await t.query(api.evaluator.evaluationRuns.scorecardBySimulation, {
    simulationId,
  });
  expect(card.rows).toHaveLength(1);
  expect(card.rows[0].evaluatorId).toBe(evaluatorId);
  expect(typeof card.overall.correctedPassRate).toBe("number");
});
```

> The `api.query`/`api.action` test calls require an authenticated identity in `convex-test`. Use the file's existing `withIdentity(testIdentity)` wrapper if present (see other tests in the repo), e.g. `t.withIdentity(testIdentity).query(...)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/backend test evaluatorBatchApply`
Expected: FAIL — `scorecardBySimulation` not found.

- [ ] **Step 3: Implement `scorecardBySimulation`**

Append to `packages/backend/convex/evaluator/evaluationRuns.ts`:

```typescript
export const scorecardBySimulation = query({
  args: { simulationId: v.id("conversationSimulations") },
  handler: async (ctx, { simulationId }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db
      .query("evaluationRuns")
      .withIndex("by_simulation", (q) => q.eq("cohort.simulationId", simulationId))
      .collect();
    const mine = rows.filter((r) => r.orgId === orgId);

    const latest = new Map<string, (typeof mine)[number]>();
    for (const r of mine) {
      const prev = latest.get(r.evaluatorId);
      if (!prev || r.createdAt > prev.createdAt) latest.set(r.evaluatorId, r);
    }

    const out = [];
    for (const r of latest.values()) {
      const ev = await ctx.db.get(r.evaluatorId);
      out.push({
        evaluatorId: r.evaluatorId,
        name: ev?.name ?? "(deleted)",
        n: r.n,
        observedPassRate: r.observedPassRate,
        correctedPassRate: r.correctedPassRate,
        ci: r.ci,
        corrected: r.corrected,
      });
    }

    const overall =
      out.length > 0
        ? out.reduce((s, r) => s + r.correctedPassRate, 0) / out.length
        : 0;

    return { rows: out, overall: { correctedPassRate: overall } };
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/backend test evaluatorBatchApply`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/evaluator/evaluationRuns.ts packages/backend/tests/evaluatorBatchApply.test.ts
git commit -m "feat(backend): evaluationRuns — scorecardBySimulation rollup query"
```

---

## Task 13: Frontend — validate page shows dev + test metrics, CIs, calibrating state

**Files:**
- Modify: `packages/frontend/src/app/agents/[id]/evaluate/evaluators/[evalId]/validate/page.tsx`

- [ ] **Step 1: Read the current page to confirm structure**

Run: `cat "packages/frontend/src/app/agents/[id]/evaluate/evaluators/[evalId]/validate/page.tsx"` and confirm it calls `api.evaluator.validate.run` and renders MetricBars from the returned `{ tpr, tnr, agreement, status, skipped }`.

- [ ] **Step 2: Update the result handling + rendering**

The validate action now returns `{ status: "ready"|"validated"|"calibrating", reason?, needed?, devMetrics, testMetrics }` (no top-level `tpr`/`skipped`). Update the page:

- Type the action result to the new shape.
- Render **two metric groups**: "Dev (tuning)" from `devMetrics` and "Test (held-out)" from `testMetrics` (render the test group only when `testMetrics` is non-null; otherwise show "No test labels yet").
- When `status === "calibrating" && reason === "insufficient_labels"`, render a clear banner instead of metrics-as-verdict:
  - Copy: `Need ${needed.pass} more Pass and ${needed.fail} more Fail label(s) on the final split before this judge can be marked ready.` with a link to the Labels tab.
- Pull persisted CIs for display from `api.evaluator.crud.get` (the evaluator now has `devMetricsCI`/`testMetricsCI`/`labelCounts`). Render each metric as `value (lower–upper)` when a CI is present.

Concretely, replace the result-state type and the metrics render block. Example result type + calibrating banner:

```tsx
type ValidateResult = {
  status: "ready" | "validated" | "calibrating";
  reason?: "insufficient_labels";
  needed?: { pass: number; fail: number };
  devMetrics: { tpr: number; tnr: number; agreement: number };
  testMetrics: { tpr: number; tnr: number; agreement: number; n: number } | null;
};

// in render, after running validation:
{result?.status === "calibrating" && result.reason === "insufficient_labels" && (
  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
    Need {result.needed?.pass ?? 0} more Pass and {result.needed?.fail ?? 0} more
    Fail label(s) on the final split before this judge can be marked ready.{" "}
    <Link href={labelsHref} className="underline">Go to Labels</Link>
  </div>
)}
```

And a metric group reused for dev/test (CI optional):

```tsx
function MetricGroup({
  title,
  metrics,
  ci,
}: {
  title: string;
  metrics: { tpr: number; tnr: number; agreement: number } | null;
  ci?: { tpr: { lower: number; upper: number }; tnr: { lower: number; upper: number } };
}) {
  if (!metrics) {
    return (
      <div className="text-sm text-text-muted">{title}: no labels yet</div>
    );
  }
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const range = (c?: { lower: number; upper: number }) =>
    c ? ` (${pct(c.lower)}–${pct(c.upper)})` : "";
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-text-muted">{title}</div>
      <div className="text-sm">TPR: {pct(metrics.tpr)}{range(ci?.tpr)}</div>
      <div className="text-sm">TNR: {pct(metrics.tnr)}{range(ci?.tnr)}</div>
      <div className="text-sm">Agreement: {pct(metrics.agreement)}</div>
    </div>
  );
}
```

Wire `MetricGroup` for dev (using `evaluator.devMetricsCI`) and test (using `evaluator.testMetricsCI`), reading the persisted evaluator via the existing `api.evaluator.crud.get` query.

- [ ] **Step 3: Typecheck frontend**

Run: `cd packages/frontend && npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "packages/frontend/src/app/agents/[id]/evaluate/evaluators/[evalId]/validate/page.tsx"
git commit -m "feat(frontend): validate page — dev+test metrics, CIs, calibrating state"
```

---

## Task 14: Frontend — agent scorecard panel on the simulation results page

**Files:**
- Create: `packages/frontend/src/components/evaluator/ScorecardPanel.tsx`
- Modify: `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/page.tsx`

- [ ] **Step 1: Create `ScorecardPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";

export function ScorecardPanel({
  agentId,
  simulationId,
}: {
  agentId: Id<"agents">;
  simulationId: Id<"conversationSimulations">;
}) {
  const card = useQuery(api.evaluator.evaluationRuns.scorecardBySimulation, {
    simulationId,
  });
  const readyEvaluators = useQuery(api.evaluator.crud.byAgentStatus, {
    agentId,
    status: "ready",
  });
  const runOnCohort = useAction(api.evaluator.batchApply.runOnCohort);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

  const handleRun = async () => {
    if (!readyEvaluators || readyEvaluators.length === 0) return;
    setRunning(true);
    setError(null);
    try {
      await runOnCohort({
        evaluatorIds: readyEvaluators.map((e) => e._id),
        cohort: { kind: "simulation", simulationId },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run scorecard");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-bg-elevated/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Agent scorecard</h3>
        <button
          onClick={handleRun}
          disabled={running || !readyEvaluators || readyEvaluators.length === 0}
          className="text-xs rounded-md border border-border px-2 py-1 disabled:opacity-50"
          title={
            readyEvaluators && readyEvaluators.length === 0
              ? "No ready (validated) judges yet"
              : undefined
          }
        >
          {running ? "Running…" : "Run scorecard"}
        </button>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      {card && card.rows.length > 0 ? (
        <div className="space-y-2">
          <div className="text-sm">
            Overall: <span className="font-semibold">{pct(card.overall.correctedPassRate)}</span>
          </div>
          <ul className="space-y-1">
            {card.rows.map((r) => (
              <li key={r.evaluatorId} className="text-sm flex items-center justify-between gap-2">
                <span className="text-text">{r.name}</span>
                <span className="text-text-muted">
                  {pct(r.correctedPassRate)} ({pct(r.ci.lower)}–{pct(r.ci.upper)}), n={r.n}
                  {!r.corrected && (
                    <span className="ml-2 text-amber-400" title="Judge not validated — uncorrected">
                      ⚠ uncorrected
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-sm text-text-muted">
          No scorecard yet. Run ready judges across this simulation’s conversations.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount the panel on the simulation results page**

In `packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/page.tsx`, import the panel and render it in the results column (where the metadata band / detail render). Pass `agentId` and the simulation id (`runId` mapped to `simulationId`):

```tsx
import { ScorecardPanel } from "@/components/evaluator/ScorecardPanel";
// ... within the JSX, near the sim metadata band:
<ScorecardPanel agentId={agentId} simulationId={simulationId} />
```

(Use the page's existing `agentId` and `simulationId` variables — confirm their names when editing.)

- [ ] **Step 3: Typecheck frontend**

Run: `cd packages/frontend && npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/evaluator/ScorecardPanel.tsx "packages/frontend/src/app/agents/[id]/evaluate/experiments/[runId]/page.tsx"
git commit -m "feat(frontend): agent scorecard panel + Run scorecard on sim results"
```

---

## Final verification

- [ ] **Backend tests:** `pnpm -C packages/backend test` → all green (incl. the existing suites unchanged).
- [ ] **Backend typecheck:** `pnpm -C packages/backend typecheck` → PASS.
- [ ] **Convex schema/codegen:** `cd packages/backend && npx convex dev --once` → no errors.
- [ ] **Frontend typecheck:** `cd packages/frontend && npx tsc -p tsconfig.json --noEmit` → PASS.
- [ ] **End-to-end smoke (manual, optional):** in the running app — validate a judge with enough dev+test labels → status `ready` with CIs; on a sim results page click "Run scorecard" → per-dimension corrected pass rate ± CI appears; an unvalidated judge shows the ⚠ uncorrected marker.

---

## Notes / resolved decisions baked into this plan

- **Judge logic is dependency-injected** (`JudgeLlmClient`), keeping `llmJudge.ts`/`fewShot.ts`/`metrics.ts`/`sources.ts` free of `"use node"` and unit-testable in the edge-runtime. Only `validate.ts`, `autoApply.ts`, `batchApply.ts` carry `"use node"` and `new OpenAI()`.
- **Judge model** defaults to `gpt-4o-mini`, configurable per evaluator via `llmJudgeConfig.model`.
- **Score B runs over the simulation batch minus the calibration set** (single action, looped — WorkPool scaling deferred to Slice 3).
- **`kb_documents` input context** is a documented no-op stub in Slice 1.
- **CI exactness for Score B:** if exact bootstrap is required immediately, persist raw test `tp/tn/fp/fn` on `testMetrics` (Task 1/8) and drop the `reconstructPairs` approximation in Task 11.
- **Out of scope (Slices 2–3):** versioning/regression, real-traffic ingestion, coverage/representativeness, severity/safety floors, acceptance gate.
