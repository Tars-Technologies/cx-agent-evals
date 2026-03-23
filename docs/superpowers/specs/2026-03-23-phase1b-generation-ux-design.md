# Phase 1b: Generation UX Robustness — Design Spec

**Goal:** Fix remaining generation bugs and add UX polish: fix misleading error message, persist generation state across navigation, make wizard steps clickable, save discovery URL, enforce single concurrent generation, and show dataset status during generation.

**Scope:** Frontend UX + minimal backend changes. No new LLM providers, no architecture changes.

---

## Item 1: Fix Misleading Error Message in `createLLMClient`

### Problem

`packages/eval-lib/src/llm/client.ts` line 12 says "Configure it in your Convex dashboard under Settings → Environment Variables" — but `createLLMClient` also runs in the Next.js API route (`/api/discover-dimensions`), where the key comes from Next.js `.env.local`, not Convex.

### Design

Change the error message to be environment-agnostic:

```
OPENAI_API_KEY environment variable is not set.
Set it in your environment variables (.env.local for Next.js, Convex dashboard for backend).
```

**Files:** `packages/eval-lib/src/llm/client.ts`

---

## Item 2: Generation State Persistence Across Navigation

### Problem

When a user starts question generation and navigates away (switches tabs, goes to Retrievers, etc.), the `jobId` stored in React `useState` is lost. Returning to the Generate page shows no indication of an ongoing generation.

### Design

**Approach: Backend-driven active job detection (no localStorage for job state)**

Add a new query `getActiveJob` to `generation/orchestration.ts` that returns the currently running/pending generation job for a given KB (or across the org). The frontend uses this reactive query to automatically detect and display active jobs when the page loads.

#### Backend

Add query to `packages/backend/convex/generation/orchestration.ts`:

```typescript
export const getActiveJob = query({
  args: { kbId: v.optional(v.id("knowledgeBases")) },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    // Use by_status index: check for "running" and "pending" jobs
    const running = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "running"))
      .collect();
    const pending = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .collect();

    const active = [...running, ...pending];

    // If kbId specified, filter to that KB
    const filtered = args.kbId ? active.filter(j => j.kbId === args.kbId) : active;

    if (filtered.length === 0) return null;

    // Return the most recent active job
    const job = filtered.sort((a, b) => b.createdAt - a.createdAt)[0];
    return {
      ...job,
      pendingItems: job.totalItems - job.processedItems - job.failedItems - job.skippedItems,
    };
  },
});
```

#### Frontend

In `generate/page.tsx`:

1. Call `useQuery(api.generation.orchestration.getActiveJob, { kbId: selectedKbId })` to detect active jobs
2. When an active job is found and local `jobId` is null, auto-set `jobId` and `datasetId` from the active job
3. Switch to the generating UI state automatically

This means: user starts generation → navigates away → comes back → `getActiveJob` returns the running job → UI shows generation in progress. No localStorage needed for job state.

#### Edge case: Stale "running" jobs

If a job gets stuck in "running" state (backend crash, WorkPool loses track), `getActiveJob` would permanently block new generations. **Mitigation:** Add a staleness check — if a "running" job's `createdAt` is more than 2 hours old and has made no progress (same `processedItems` count), treat it as stale and don't return it from `getActiveJob`. This is a heuristic; full job recovery is out of scope for Phase 1b.

```typescript
const TWO_HOURS = 2 * 60 * 60 * 1000;
const isStale = (job: Doc<"generationJobs">) =>
  Date.now() - job.createdAt > TWO_HOURS;

// Filter out stale jobs
const healthy = filtered.filter(j => !isStale(j));
```

**Files:** `packages/backend/convex/generation/orchestration.ts`, `packages/frontend/src/app/generate/page.tsx`

---

## Item 3: Dimension Wizard Clickable Step Navigation

### Problem

The wizard step indicators (numbered circles with "Discover", "Edit", "Configure" labels) are display-only. Users can't click a completed step to go back to it.

### Design

Make step indicators clickable with these rules:

- **Current step:** highlighted (accent color), not clickable (already there)
- **Completed steps (< current):** clickable, shown with a checkmark (✓) instead of the number, `bg-accent/20 text-accent` background with `cursor-pointer`
- **Future steps (> current):** not clickable, dimmed, `bg-bg-surface text-text-muted`
- **Click behavior:** `setStep(s)` — only allowed when `s < step`

Visual states for each step indicator:

| State | Circle | Label | Clickable |
|-------|--------|-------|-----------|
| Completed (`s < step`) | `bg-accent/20 text-accent` with ✓ | `text-accent cursor-pointer` | Yes |
| Current (`s === step`) | `bg-accent text-bg` with number | `text-accent` | No |
| Future (`s > step`) | `bg-bg-surface text-text-muted` with number | `text-text-dim` | No |

**Files:** `packages/frontend/src/components/DimensionWizard.tsx`

---

## Item 4: Discovery URL Persistence in localStorage

### Problem

When the user returns to the Dimension Wizard after closing it, the discovery URL input is empty. They have to re-enter the URL.

### Design

- **Save:** When dimension discovery succeeds (response is valid), save the URL to `localStorage` key `rag-eval:dimension-discover-url` (matches existing `rag-eval:dimension-config` naming pattern)
- **Load:** When the wizard opens at Step 1, initialize `url` state from `localStorage` if available
- **No auto-trigger:** The saved URL pre-populates the input but does NOT auto-trigger discovery

Implementation in `DimensionWizard.tsx`:

1. Initialize `url` state: `useState(() => { try { return localStorage.getItem("rag-eval:dimension-discover-url") ?? ""; } catch { return ""; } })`
2. In the `handleDiscover` function, after successful response: `localStorage.setItem("rag-eval:dimension-discover-url", url)`

**Files:** `packages/frontend/src/components/DimensionWizard.tsx`

---

## Item 5: Single Concurrent Generation Enforcement

### Problem

The backend allows unlimited concurrent generation jobs. If a user starts generation on a large KB (100 docs), navigates away, and starts another, both consume API tokens simultaneously. The UI only prevents starting a second generation while the `generating` flag is active (React state), which is lost on navigation.

### Design

**Backend enforcement + frontend indication**

#### Backend

In `startGeneration` mutation, add the check **before** the dataset insert (right after KB validation, before `ctx.db.insert("datasets", ...)`). This prevents orphaned dataset records if the check fails.

```typescript
// Check for existing active jobs in this org (before creating dataset)
const activeRunning = await ctx.db
  .query("generationJobs")
  .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "running"))
  .first();
const activePending = await ctx.db
  .query("generationJobs")
  .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
  .first();

if (activeRunning || activePending) {
  const active = activeRunning ?? activePending;
  // Look up KB name for a helpful error message
  const activeKb = await ctx.db.get(active!.kbId);
  const kbName = activeKb?.name ?? "unknown";
  throw new Error(
    `A generation job is already in progress (${active!.strategy} on "${kbName}"). ` +
    `Wait for it to complete or cancel it before starting a new one.`
  );
}
```

**Stale job handling:** Apply the same 2-hour staleness check from Item 2. If the only active job is stale, allow the new generation to proceed.

#### Frontend

Use the `getActiveJob` query (from Item 2) to show a persistent generation banner:

**Generation Banner Component** (`GenerationBanner.tsx`):
- Shown at the top of the Generate page when an active job exists anywhere in the org
- Shows: strategy name, KB name, phase, progress (processed/total), pulsing indicator
- "View" button that selects the generating KB and dataset
- Stays visible regardless of which KB is selected
- Non-dismissible (disappears when job completes)

```
┌──────────────────────────────────────────────────────────────┐
│ ● Generating: dimension-driven on "Product Docs"            │
│   Phase: generating (12/100 items)                  [View]  │
└──────────────────────────────────────────────────────────────┘
```

The Generate button is disabled whenever the banner is visible, with tooltip: "Generation in progress"

**Files:** `packages/backend/convex/generation/orchestration.ts`, `packages/frontend/src/components/GenerationBanner.tsx` (new), `packages/frontend/src/app/generate/page.tsx`

---

## Item 6: Dataset Visible During Generation

### Problem

After starting generation, the user must mentally track that a job is running. The dataset exists (created before generation starts) but the UI doesn't auto-navigate to it or show progress in the dataset list.

### Design

Two changes:

#### A. Auto-select dataset after generation starts

In `handleGenerate`, after `setDatasetId(result.datasetId)`:

```typescript
setBrowseDatasetId(result.datasetId);
setMode("browse");
```

This immediately switches the UI to show the new dataset, where the QuestionList will display the generation progress.

#### B. Show generation status on dataset list items

In the dataset list rendering, detect if a dataset has an active generation job and show an inline indicator:

```
┌─────────────────────────────────────┐
│ ● dimension-driven-1711234567       │
│   Generating... (12/100)            │
├─────────────────────────────────────┤
│ simple-1711234000                   │
│   15 questions  ·  simple           │
└─────────────────────────────────────┘
```

To detect active datasets: use a separate query or piggyback on `getActiveJob` — if the active job's `datasetId` matches a dataset in the list, show the generating indicator.

Implementation: In `page.tsx`, when rendering dataset items, check if `activeJob?.datasetId === ds._id`. If so, show pulsing dot + "Generating..." + progress instead of the question count.

**Files:** `packages/frontend/src/app/generate/page.tsx`

---

## Data Flow Summary

```
User clicks "Generate"
  → startGeneration mutation
    → Check for active jobs (org-scoped) — throw if exists
    → Create dataset (questionCount: 0)
    → Create generationJob (status: "running")
    → Enqueue work items
    → Return { datasetId, jobId }
  → Frontend auto-selects new dataset in browse mode
  → GenerationBanner appears (reactive via getActiveJob query)
  → QuestionList shows generation progress
  → User navigates away...
  → User comes back
    → getActiveJob query finds running job
    → Banner shows, jobId/datasetId auto-restored
    → UI shows generation in progress
  → Generation completes
    → getActiveJob returns null
    → Banner disappears
    → Generate button re-enabled
```

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `packages/eval-lib/src/llm/client.ts` | Fix error message |
| `packages/backend/convex/generation/orchestration.ts` | Add `getActiveJob` query + concurrent job guard in `startGeneration` |
| `packages/frontend/src/components/DimensionWizard.tsx` | Clickable step indicators + URL localStorage |
| `packages/frontend/src/components/GenerationBanner.tsx` | New: persistent generation status banner |
| `packages/frontend/src/app/generate/page.tsx` | Use `getActiveJob`, auto-select dataset, show inline progress, wire banner |
