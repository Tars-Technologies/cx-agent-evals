# Phase 1b: Generation UX Robustness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix generation state persistence across navigation, enforce single concurrent generation, add persistent status banner, improve dimension wizard UX (clickable steps + URL persistence), and fix misleading error message.

**Architecture:** Backend gets a new `getActiveJob` query and a concurrent-job guard in `startGeneration`. Frontend uses the reactive `getActiveJob` query to auto-detect running jobs, shows a `GenerationBanner` component, and auto-selects the generating dataset. DimensionWizard gets clickable step indicators and localStorage URL persistence.

**Tech Stack:** TypeScript, Convex (backend), Next.js 16 App Router (frontend), Tailwind CSS v4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-phase1b-generation-ux-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/frontend/src/components/GenerationBanner.tsx` | Persistent banner showing active generation status with "View" button |

### Modified Files
| File | Changes |
|------|---------|
| `packages/eval-lib/src/llm/client.ts` | Fix misleading error message |
| `packages/backend/convex/generation/orchestration.ts` | Add `getActiveJob` query + concurrent job guard in `startGeneration` |
| `packages/frontend/src/components/DimensionWizard.tsx` | Clickable step indicators + URL localStorage persistence |
| `packages/frontend/src/app/generate/page.tsx` | Wire `getActiveJob`, auto-select dataset, show inline progress, integrate banner |

---

## Task 1: Fix Misleading Error Message (eval-lib)

**Files:**
- Modify: `packages/eval-lib/src/llm/client.ts:10-14`

- [ ] **Step 1: Update the error message**

In `packages/eval-lib/src/llm/client.ts`, replace the error string (lines 11-14):

```typescript
// BEFORE
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. " +
        "Configure it in your Convex dashboard under Settings → Environment Variables.",
    );

// AFTER
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. " +
        "Set it in your environment variables (.env.local for Next.js, Convex dashboard for backend).",
    );
```

- [ ] **Step 2: Run eval-lib tests**

Run: `cd packages/eval-lib && pnpm test -- --run`

Expected: All tests pass (this is a string-only change, no logic affected)

- [ ] **Step 3: Rebuild eval-lib**

Run: `pnpm build`

Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add packages/eval-lib/src/llm/client.ts
git commit -m "fix(eval-lib): fix misleading OPENAI_API_KEY error message for multi-environment use"
```

---

## Task 2: Add `getActiveJob` Query + Concurrent Job Guard (Backend)

**Files:**
- Modify: `packages/backend/convex/generation/orchestration.ts`

- [ ] **Step 1: Add `getActiveJob` query**

Add the following query at the end of `packages/backend/convex/generation/orchestration.ts` (after the existing `listJobs` query):

```typescript
/**
 * Return the most recent active (running/pending) generation job for this org.
 * Filters out stale jobs (>2 hours old) to prevent permanent blocking.
 * If kbId is provided, only returns active jobs for that KB.
 */
export const getActiveJob = query({
  args: { kbId: v.optional(v.id("knowledgeBases")) },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const running = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "running"))
      .collect();
    const pending = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .collect();

    const active = [...running, ...pending];

    // Filter out stale jobs (>2 hours old)
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const healthy = active.filter((j) => Date.now() - j.createdAt <= TWO_HOURS);

    // If kbId specified, filter to that KB
    const filtered = args.kbId
      ? healthy.filter((j) => j.kbId === args.kbId)
      : healthy;

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

- [ ] **Step 2: Add concurrent job guard to `startGeneration`**

In `packages/backend/convex/generation/orchestration.ts`, inside the `startGeneration` mutation handler, add the following check **after** the KB validation (`if (!kb || kb.orgId !== orgId)` block) and **before** the `ctx.db.insert("datasets", ...)` call:

```typescript
    // ── Concurrent generation guard ──
    // Only one active generation per org at a time
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    const existingRunning = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "running"))
      .first();
    const existingPending = await ctx.db
      .query("generationJobs")
      .withIndex("by_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .first();

    const existingActive = existingRunning ?? existingPending;
    if (existingActive && Date.now() - existingActive.createdAt <= TWO_HOURS) {
      const activeKb = await ctx.db.get(existingActive.kbId);
      const kbName = activeKb?.name ?? "unknown";
      throw new Error(
        `A generation job is already in progress (${existingActive.strategy} on "${kbName}"). ` +
        `Wait for it to complete or cancel it before starting a new one.`,
      );
    }
```

- [ ] **Step 3: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`

Expected: Deployment succeeds with no TypeScript errors.

- [ ] **Step 4: Run backend tests**

Run: `cd packages/backend && pnpm test`

Expected: All existing tests pass. The new query doesn't break anything (it's read-only). The guard only activates when there's an active job, which existing tests don't create.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/generation/orchestration.ts
git commit -m "feat(backend): add getActiveJob query and concurrent generation guard"
```

---

## Task 3: Dimension Wizard — Clickable Steps + URL Persistence

**Files:**
- Modify: `packages/frontend/src/components/DimensionWizard.tsx`

- [ ] **Step 1: Add URL localStorage persistence**

In `packages/frontend/src/components/DimensionWizard.tsx`, change the `url` state initialization (line 26) from:

```typescript
const [url, setUrl] = useState("");
```

To:

```typescript
const [url, setUrl] = useState(() => {
  try {
    return localStorage.getItem("rag-eval:dimension-discover-url") ?? "";
  } catch {
    return "";
  }
});
```

Then, in the `handleDiscover` function, after the successful fetch response (where `data.dimensions` is set), add the localStorage save. Find the line where dimensions are set from the response (around line 52 where `setDimensions(data.dimensions)` is called) and add immediately after it:

```typescript
      try {
        localStorage.setItem("rag-eval:dimension-discover-url", url);
      } catch {
        // localStorage full or unavailable
      }
```

- [ ] **Step 2: Make step indicators clickable**

Replace the step indicator header section (lines 153-175, the `{[1, 2, 3].map((s) => (` block)) with:

```typescript
      {[1, 2, 3].map((s) => {
        const isCompleted = s < step;
        const isCurrent = s === step;
        const canClick = isCompleted; // Can only click completed steps

        return (
          <div
            key={s}
            className={`flex items-center gap-1.5 ${canClick ? "cursor-pointer" : ""}`}
            onClick={canClick ? () => setStep(s) : undefined}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                isCurrent
                  ? "bg-accent text-bg"
                  : isCompleted
                    ? "bg-accent/20 text-accent"
                    : "bg-bg-surface text-text-muted"
              }`}
            >
              {isCompleted ? "✓" : s}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wider ${
                isCurrent || isCompleted ? "text-accent" : "text-text-dim"
              }`}
            >
              {s === 1 ? "Discover" : s === 2 ? "Edit" : "Configure"}
            </span>
            {s < 3 && (
              <span className="w-4 h-px bg-border mx-1" />
            )}
          </div>
        );
      })}
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/DimensionWizard.tsx
git commit -m "feat(frontend): clickable wizard steps and URL persistence in localStorage"
```

---

## Task 4: Generation Banner Component

**Files:**
- Create: `packages/frontend/src/components/GenerationBanner.tsx`

- [ ] **Step 1: Create the GenerationBanner component**

```typescript
// packages/frontend/src/components/GenerationBanner.tsx
"use client";

interface GenerationBannerProps {
  strategy: string;
  kbName: string;
  phase: string;
  processedItems: number;
  totalItems: number;
  onView: () => void;
}

export function GenerationBanner({
  strategy,
  kbName,
  phase,
  processedItems,
  totalItems,
  onView,
}: GenerationBannerProps) {
  return (
    <div className="mx-4 mt-3 mb-1 px-4 py-2.5 rounded-lg border border-accent/30 bg-accent/5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-dot flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs text-text font-medium truncate">
              Generating: <span className="text-accent">{strategy}</span> on &ldquo;{kbName}&rdquo;
            </div>
            <div className="text-[10px] text-text-dim mt-0.5">
              Phase: {phase} ({processedItems}/{totalItems} items)
            </div>
          </div>
        </div>
        <button
          onClick={onView}
          className="flex-shrink-0 ml-3 px-3 py-1 text-[10px] font-medium text-accent border border-accent/30 rounded
                     hover:bg-accent/10 transition-colors cursor-pointer"
        >
          View
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No type errors (component is standalone, not yet wired into page)

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/GenerationBanner.tsx
git commit -m "feat(frontend): add GenerationBanner component for persistent generation status"
```

---

## Task 5: Wire Everything into Generate Page

**Files:**
- Modify: `packages/frontend/src/app/generate/page.tsx`

This is the integration task. It connects `getActiveJob`, the banner, auto-selection, and inline dataset progress.

- [ ] **Step 1: Add the `getActiveJob` query and KB name lookup**

In `packages/frontend/src/app/generate/page.tsx`, add a new `useQuery` call near the existing query declarations (around line 40-50). Also need to look up the KB name for the banner.

Add after the existing `useQuery` calls:

```typescript
  // Active job detection (org-wide, no kbId filter — we want to know about any active job)
  const activeJob = useQuery(api.generation.orchestration.getActiveJob, {});

  // Look up KB name for the active job's banner
  const activeJobKb = useQuery(
    api.crud.knowledgeBases.get,
    activeJob ? { id: activeJob.kbId } : "skip",
  );
```

Note: Check if `api.crud.knowledgeBases.get` exists. If not, we can use the KB data we already have — if `activeJob.kbId === selectedKbId`, we can use the selected KB's name. Otherwise we may need a simple name-only query. Read the existing `knowledgeBases.ts` CRUD file to check what queries exist.

- [ ] **Step 2: Auto-restore job state from `getActiveJob`**

Add a `useEffect` that syncs from `activeJob` to local state when the user returns to the page and the local `jobId` is null:

```typescript
  // Auto-restore active job state when returning to the page
  useEffect(() => {
    if (activeJob && !jobId) {
      setJobId(activeJob._id);
      setDatasetId(activeJob.datasetId);
      setBrowseDatasetId(activeJob.datasetId);
    }
  }, [activeJob, jobId]);
```

- [ ] **Step 3: Auto-select dataset after generation starts**

In the `handleGenerate` function, after `setJobId(result.jobId)`, add:

```typescript
      setBrowseDatasetId(result.datasetId);
```

This ensures the new dataset is immediately selected in the browse panel so the user sees generation progress.

- [ ] **Step 4: Add the GenerationBanner import and rendering**

Add the import at the top:

```typescript
import { GenerationBanner } from "@/components/GenerationBanner";
```

Then add the banner rendering in the JSX. Find a suitable location near the top of the page layout (after the KB selector area, before the main content). The banner should be visible regardless of which mode (generate/browse) is active:

```typescript
        {/* Generation Banner — shown when any job is active */}
        {activeJob && (
          <GenerationBanner
            strategy={activeJob.strategy}
            kbName={activeJobKb?.name ?? "..."}
            phase={activeJob.phase}
            processedItems={activeJob.processedItems}
            totalItems={activeJob.totalItems}
            onView={() => {
              // Switch to the KB and dataset of the active job
              if (activeJob.kbId !== selectedKbId) {
                setSelectedKbId(activeJob.kbId);
              }
              setBrowseDatasetId(activeJob.datasetId);
              setDatasetId(activeJob.datasetId);
              setJobId(activeJob._id);
            }}
          />
        )}
```

- [ ] **Step 5: Disable Generate button when a job is active**

Update the `generating` derived state to also consider the org-wide active job:

```typescript
  // Derive generating state: either from local job or org-wide active job
  const generating = job?.status === "pending" || job?.status === "running" || !!activeJob;
```

This ensures the Generate button (which is already disabled when `generating` is true) is disabled even when the user is on a different KB than the one with the active job.

- [ ] **Step 6: Show inline generation progress on dataset list items**

In the dataset list rendering section (where `kbDatasets.map(...)` is), update the subtitle area to show generation progress when a dataset has an active job:

Replace the subtitle line:

```typescript
        <div className="flex gap-2 text-[10px] text-text-dim mt-0.5">
          <span>{ds.questionCount} questions</span>
          <span>{ds.strategy}</span>
        </div>
```

With:

```typescript
        <div className="flex gap-2 text-[10px] text-text-dim mt-0.5">
          {activeJob?.datasetId === ds._id ? (
            <span className="flex items-center gap-1.5 text-accent">
              <span className="w-1 h-1 rounded-full bg-accent animate-pulse-dot" />
              Generating... ({activeJob.processedItems}/{activeJob.totalItems})
            </span>
          ) : (
            <>
              <span>{ds.questionCount} questions</span>
              <span>{ds.strategy}</span>
            </>
          )}
        </div>
```

- [ ] **Step 7: Verify frontend compiles**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No type errors. If there are issues with `api.crud.knowledgeBases.get`, check the available queries and adjust the KB name lookup.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/app/generate/page.tsx
git commit -m "feat(frontend): wire getActiveJob, generation banner, auto-select, inline progress"
```

---

## Task 6: Final Build Verification

- [ ] **Step 1: Build everything**

```bash
pnpm build
cd packages/backend && npx convex dev --once
```

Expected: Both succeed

- [ ] **Step 2: Run all test suites**

```bash
cd packages/eval-lib && pnpm test -- --run
cd ../backend && pnpm test
```

Expected: All tests pass

- [ ] **Step 3: Verify frontend compiles**

```bash
cd packages/frontend && npx tsc --noEmit
```

Expected: No errors
