# Frontend KB-First Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add KB-scoped URL params, dataset browsing on generate page, KB-first experiment flow with multi-retriever batch runs, and progressive experiment display.

**Architecture:** URL query params (`?kb=<kbId>`) for cross-page state. Each page reads/writes the param independently. Backend gets a denormalized `kbId` on experiments table for direct querying.

**Tech Stack:** Next.js App Router (useSearchParams, useRouter), Convex (schema, queries, mutations), React (useState, useEffect, useCallback), TypeScript strict mode.

**Design doc:** `docs/plans/2026-03-03-frontend-kb-flow-design.md`

---

### Task 1: Add `kbId` to experiments schema + `by_kb` index

**Files:**
- Modify: `packages/backend/convex/schema.ts:149-185`

**Step 1: Add kbId field and index to experiments table**

In `packages/backend/convex/schema.ts`, add `kbId` field to the experiments table definition (after `orgId` on line 151), and add a `by_kb` index:

```typescript
// Line 149-185: experiments table
experiments: defineTable({
    orgId: v.string(),
    kbId: v.optional(v.id("knowledgeBases")),  // NEW — denormalized from dataset
    datasetId: v.id("datasets"),
    // ... rest unchanged ...
  })
    .index("by_org", ["orgId"])
    .index("by_dataset", ["datasetId"])
    .index("by_retriever", ["retrieverId"])
    .index("by_kb", ["kbId"]),  // NEW
```

Note: `kbId` is `v.optional()` for backward compatibility with existing experiment records that lack it.

**Step 2: Deploy schema to verify**

Run: `cd packages/backend && npx convex dev --once`
Expected: Successful deployment, schema accepted with new field + index.

**Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "schema: add kbId + by_kb index to experiments table"
```

---

### Task 2: Populate `kbId` on experiment creation + add `byKb` query

**Files:**
- Modify: `packages/backend/convex/experiments.ts:24-95` (start mutation)
- Modify: `packages/backend/convex/experiments.ts:236-267` (add byKb query)

**Step 1: Update start mutation to populate kbId**

In `packages/backend/convex/experiments.ts`, the `start` mutation already fetches the dataset (line 35) which has `dataset.kbId`. Add `kbId` to the insert on line 69:

```typescript
    const experimentId = await ctx.db.insert("experiments", {
      orgId,
      kbId: dataset.kbId,  // NEW — denormalized for direct querying
      datasetId: args.datasetId,
      name: args.name,
      retrieverId: args.retrieverId,
      retrievalConfig: args.retrieverConfig,
      k: args.k,
      metricNames: args.metricNames,
      status: "pending",
      createdBy: user._id,
      createdAt: Date.now(),
    });
```

**Step 2: Add byKb query**

Add after the existing `byDataset` query (after line 254):

```typescript
export const byKb = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }

    return await ctx.db
      .query("experiments")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .order("desc")
      .collect();
  },
});
```

**Step 3: Deploy and verify**

Run: `cd packages/backend && npx convex dev --once`
Expected: Successful deployment with new query available.

**Step 4: Commit**

```bash
git add packages/backend/convex/experiments.ts
git commit -m "feat: populate kbId on experiment creation, add experiments.byKb query"
```

---

### Task 3: Create `useKbFromUrl` hook

**Files:**
- Create: `packages/frontend/src/lib/useKbFromUrl.ts`

**Step 1: Write the hook**

```typescript
"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Id } from "@convex/_generated/dataModel";

/**
 * Reads ?kb=<kbId> from the URL and syncs it with local state.
 * Returns [selectedKbId, setSelectedKbId] — setting updates the URL.
 */
export function useKbFromUrl(): [
  Id<"knowledgeBases"> | null,
  (kbId: Id<"knowledgeBases"> | null) => void,
] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const kbFromUrl = searchParams.get("kb") as Id<"knowledgeBases"> | null;
  const [selectedKbId, setSelectedKbIdLocal] = useState<Id<"knowledgeBases"> | null>(kbFromUrl);

  // Sync from URL on mount / param change
  useEffect(() => {
    setSelectedKbIdLocal(kbFromUrl);
  }, [kbFromUrl]);

  const setSelectedKbId = useCallback(
    (kbId: Id<"knowledgeBases"> | null) => {
      setSelectedKbIdLocal(kbId);
      const params = new URLSearchParams(searchParams.toString());
      if (kbId) {
        params.set("kb", kbId);
      } else {
        params.delete("kb");
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  return [selectedKbId, setSelectedKbId];
}

/**
 * Build a path with the current KB param preserved.
 */
export function buildKbLink(path: string, kbId: Id<"knowledgeBases"> | null): string {
  if (!kbId) return path;
  return `${path}?kb=${kbId}`;
}
```

**Step 2: Verify build**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds (new file doesn't break anything yet — it's not imported).

**Step 3: Commit**

```bash
git add packages/frontend/src/lib/useKbFromUrl.ts
git commit -m "feat: add useKbFromUrl hook for URL-based KB state"
```

---

### Task 4: Update Header to preserve KB param in nav links

**Files:**
- Modify: `packages/frontend/src/components/Header.tsx`

**Step 1: Update Header props and links**

Add `kbId` prop. Update the three nav `Link` components to include `?kb=` when present:

```typescript
"use client";

import Link from "next/link";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { Id } from "@convex/_generated/dataModel";
import { buildKbLink } from "@/lib/useKbFromUrl";

interface HeaderProps {
  mode?: "generate" | "retrievers" | "experiments";
  kbId?: Id<"knowledgeBases"> | null;
  onReset?: () => void;
}

export function Header({ mode, kbId, onReset }: HeaderProps) {
```

Then update each `<Link href=...>` inside the mode tabs:

```typescript
<Link
  href={buildKbLink("/generate", kbId ?? null)}
  className={...}
>
  Generate
</Link>
<Link
  href={buildKbLink("/retrievers", kbId ?? null)}
  className={...}
>
  Retrievers
</Link>
<Link
  href={buildKbLink("/experiments", kbId ?? null)}
  className={...}
>
  Experiments
</Link>
```

**Step 2: Verify build**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds. Existing pages pass `mode` but not `kbId` yet — the prop is optional so no breakage.

**Step 3: Commit**

```bash
git add packages/frontend/src/components/Header.tsx
git commit -m "feat: Header preserves KB param in navigation links"
```

---

### Task 5: Update Retrievers page to use URL KB param

**Files:**
- Modify: `packages/frontend/src/app/retrievers/page.tsx:83-86`

**Step 1: Replace local KB state with useKbFromUrl**

Replace:
```typescript
const [selectedKbId, setSelectedKbId] = useState<Id<"knowledgeBases"> | null>(null);
```

With:
```typescript
import { useKbFromUrl } from "@/lib/useKbFromUrl";
// ...
const [selectedKbId, setSelectedKbId] = useKbFromUrl();
```

Remove the `Id` import if it's no longer needed for the KB state (it's likely still needed for other IDs).

**Step 2: Pass kbId to Header**

Change line 278:
```typescript
<Header mode="retrievers" kbId={selectedKbId} />
```

**Step 3: Wrap page in Suspense boundary**

Next.js requires `useSearchParams()` to be inside a `<Suspense>` boundary. Wrap the page content:

```typescript
import { Suspense } from "react";

export default function RetrieversPage() {
  return (
    <Suspense fallback={<div className="flex flex-col h-screen"><Header mode="retrievers" /></div>}>
      <RetrieversPageContent />
    </Suspense>
  );
}

function RetrieversPageContent() {
  // ... existing page code with useKbFromUrl ...
}
```

**Step 4: Verify build**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds. Page reads KB from URL on mount.

**Step 5: Commit**

```bash
git add packages/frontend/src/app/retrievers/page.tsx
git commit -m "feat: Retrievers page reads KB from URL param"
```

---

### Task 6: Update Generate page — add URL KB param

**Files:**
- Modify: `packages/frontend/src/app/generate/page.tsx:16-18`

**Step 1: Replace local KB state with useKbFromUrl**

Replace:
```typescript
const [selectedKbId, setSelectedKbId] = useState<Id<"knowledgeBases"> | null>(null);
```

With:
```typescript
import { useKbFromUrl } from "@/lib/useKbFromUrl";
// ...
const [selectedKbId, setSelectedKbId] = useKbFromUrl();
```

**Step 2: Pass kbId to Header**

Change line 219:
```typescript
<Header mode="generate" kbId={selectedKbId} onReset={handleReset} />
```

**Step 3: Wrap page in Suspense boundary**

Same pattern as retrievers page:

```typescript
import { Suspense } from "react";

export default function GeneratePage() {
  return (
    <Suspense fallback={<div className="flex flex-col h-screen"><Header mode="generate" /></div>}>
      <GeneratePageContent />
    </Suspense>
  );
}

function GeneratePageContent() {
  // ... existing page code ...
}
```

**Step 4: Verify build**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add packages/frontend/src/app/generate/page.tsx
git commit -m "feat: Generate page reads KB from URL param"
```

---

### Task 7: Generate page — add dataset browser (browse/generate modes)

**Files:**
- Modify: `packages/frontend/src/app/generate/page.tsx`

This is the largest frontend task. The generate page gets two modes:
- **Browse mode**: Shows existing datasets in sidebar, clicking one loads its questions
- **Generate mode**: Current behavior (strategy config + generate)

**Step 1: Add dataset list query and mode state**

After the KB selection, add:

```typescript
// Datasets for selected KB
const kbDatasets = useQuery(
  api.datasets.byKb,
  selectedKbId ? { kbId: selectedKbId } : "skip",
);

// Mode: "browse" (viewing existing datasets) or "generate" (creating new)
type PageMode = "browse" | "generate";
const [mode, setMode] = useState<PageMode>("browse");

// Selected dataset for browsing
const [browseDatasetId, setBrowseDatasetId] = useState<Id<"datasets"> | null>(null);

// Questions for browsed dataset
const browseQuestions = useQuery(
  api.questions.byDataset,
  browseDatasetId ? { datasetId: browseDatasetId } : "skip",
);

// Auto-switch to generate mode when no datasets exist
useEffect(() => {
  if (kbDatasets !== undefined && kbDatasets.length === 0) {
    setMode("generate");
  }
}, [kbDatasets]);

// Reset browse selection when KB changes
useEffect(() => {
  setBrowseDatasetId(null);
  setMode(kbDatasets && kbDatasets.length > 0 ? "browse" : "generate");
}, [selectedKbId]);
```

**Step 2: Determine which questions/generating state to show**

The center panel (QuestionList) should show:
- In browse mode: questions from the browsed dataset (read-only, `generating=false`)
- In generate mode: questions from the active generation (current behavior)

```typescript
// Resolve which questions + state to display
const displayQuestions: GeneratedQuestion[] =
  mode === "browse"
    ? (browseQuestions ?? []).map((q) => ({
        docId: q.sourceDocId,
        query: q.queryText,
        relevantSpans: q.relevantSpans,
      }))
    : questions;

const displayGenerating = mode === "generate" && generating;
const displayTotalDone = mode === "browse"
  ? browseQuestions?.length ?? null
  : totalDone;
const displayPhaseStatus = mode === "generate" ? phaseStatus : null;
```

**Step 3: Update sidebar to show dataset list + mode toggle**

After `<KBSelector>` and before `<GenerateConfig>`, add the dataset browser section:

```tsx
{/* Dataset section — appears after KB selected */}
{selectedKbId && kbDatasets !== undefined && (
  <div className="pt-2 border-t border-border">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs text-text-muted uppercase tracking-wide">
        Datasets ({kbDatasets.length})
      </span>
      {kbDatasets.length > 0 && (
        <button
          onClick={() => {
            if (mode === "generate") {
              setMode("browse");
            } else {
              setMode("generate");
              setBrowseDatasetId(null);
            }
          }}
          className="text-[11px] text-accent hover:text-accent/80 transition-colors"
        >
          {mode === "generate" ? "View Datasets" : "+ New Dataset"}
        </button>
      )}
    </div>

    {mode === "browse" && kbDatasets.length > 0 && (
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {kbDatasets.map((ds) => (
          <button
            key={ds._id}
            onClick={() => {
              setBrowseDatasetId(ds._id);
              setSelectedQuestion(null);
              setSelectedDocId(null);
            }}
            className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
              browseDatasetId === ds._id
                ? "bg-accent/10 border border-accent/30 text-text"
                : "hover:bg-bg-hover border border-transparent text-text-muted"
            }`}
          >
            <div className="font-medium truncate">{ds.name}</div>
            <div className="flex gap-2 text-[10px] text-text-dim mt-0.5">
              <span>{ds.questionCount} questions</span>
              <span>{ds.strategy}</span>
            </div>
          </button>
        ))}
      </div>
    )}
  </div>
)}
```

**Step 4: Conditionally show GenerateConfig only in generate mode**

Wrap the existing `<GenerateConfig>` section:

```tsx
{hasDocuments && mode === "generate" && (
  <div className="pt-2 border-t border-border">
    <GenerateConfig ... />
  </div>
)}
```

**Step 5: Update QuestionList to use display variables**

Replace the QuestionList section:

```tsx
{(displayQuestions.length > 0 || displayGenerating) && (
  <div className="w-80 flex-shrink-0 border-r border-border bg-bg">
    <QuestionList
      questions={displayQuestions}
      selectedIndex={selectedQuestion}
      onSelect={setSelectedQuestion}
      generating={displayGenerating}
      totalDone={displayTotalDone}
      phaseStatus={displayPhaseStatus}
    />
  </div>
)}
```

**Step 6: Update handleReset to also reset browse state**

```typescript
function handleReset() {
  setDatasetId(null);
  setJobId(null);
  setSelectedQuestion(null);
  setGenError(null);
  setSelectedDocId(null);
  setBrowseDatasetId(null);
  if (kbDatasets && kbDatasets.length > 0) {
    setMode("browse");
  }
}
```

**Step 7: When generation completes, switch to browse mode showing new dataset**

After generation completes, the new dataset appears in `kbDatasets`. Add an effect:

```typescript
// When generation completes, switch to browsing the new dataset
useEffect(() => {
  if (
    mode === "generate" &&
    datasetId &&
    job?.status === "completed" || job?.status === "completed_with_errors"
  ) {
    setMode("browse");
    setBrowseDatasetId(datasetId);
  }
}, [job?.status, datasetId, mode]);
```

**Step 8: Verify build**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

**Step 9: Commit**

```bash
git add packages/frontend/src/app/generate/page.tsx
git commit -m "feat: Generate page dataset browser with browse/generate modes"
```

---

### Task 8: Rewrite Experiments page — KB-first flow

**Files:**
- Modify: `packages/frontend/src/app/experiments/page.tsx` (near-full rewrite)

This is the most complex task. The experiments page gets:
1. KB selector at top
2. Progressive reveal: KB → Dataset → Retriever(s) → Config
3. Multi-retriever checkboxes
4. Progressive experiment display
5. Batch "Run Experiments" handler
6. Cross-page links when no datasets/retrievers exist

**Step 1: Replace the full page with KB-first flow**

The page becomes:

```typescript
"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import { Id } from "@convex/_generated/dataModel";
import { Header } from "@/components/Header";
import { KBSelector } from "@/components/KBSelector";
import { useKbFromUrl, buildKbLink } from "@/lib/useKbFromUrl";
import Link from "next/link";

export default function ExperimentsPage() {
  return (
    <Suspense fallback={<div className="flex flex-col h-screen"><Header mode="experiments" /></div>}>
      <ExperimentsPageContent />
    </Suspense>
  );
}

function ExperimentsPageContent() {
  // --- KB selection (from URL) ---
  const [selectedKbId, setSelectedKbId] = useKbFromUrl();

  // --- Datasets for selected KB ---
  const kbDatasets = useQuery(
    api.datasets.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const [selectedDatasetId, setSelectedDatasetId] = useState<Id<"datasets"> | null>(null);
  const selectedDataset = useQuery(
    api.datasets.get,
    selectedDatasetId ? { id: selectedDatasetId } : "skip",
  );

  // --- Retrievers for selected KB (ready only) ---
  const kbRetrievers = useQuery(
    api.retrievers.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const readyRetrievers = (kbRetrievers ?? []).filter((r) => r.status === "ready");
  const [selectedRetrieverIds, setSelectedRetrieverIds] = useState<Set<Id<"retrievers">>>(new Set());

  // --- Progressive experiment queries ---
  const kbExperiments = useQuery(
    api.experiments.byKb,
    selectedKbId ? { kbId: selectedKbId } : "skip",
  );
  const datasetExperiments = useQuery(
    api.experiments.byDataset,
    selectedDatasetId ? { datasetId: selectedDatasetId } : "skip",
  );

  // Determine which experiments to display based on selection level
  const displayExperiments = (() => {
    if (selectedDatasetId && datasetExperiments) {
      // Filter by selected retrievers if any
      if (selectedRetrieverIds.size > 0) {
        return datasetExperiments.filter(
          (exp) => exp.retrieverId && selectedRetrieverIds.has(exp.retrieverId),
        );
      }
      return datasetExperiments;
    }
    if (selectedKbId && kbExperiments) {
      return kbExperiments;
    }
    return [];
  })();

  // --- Clear dependent selections when parent changes ---
  useEffect(() => {
    setSelectedDatasetId(null);
    setSelectedRetrieverIds(new Set());
  }, [selectedKbId]);

  useEffect(() => {
    setSelectedRetrieverIds(new Set());
  }, [selectedDatasetId]);

  // --- Experiment execution ---
  const startExperiment = useMutation(api.experiments.start);
  const [runningExperimentIds, setRunningExperimentIds] = useState<Set<Id<"experiments">>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // --- Metrics ---
  const [metrics, setMetrics] = useState({
    recall: true,
    precision: true,
    iou: true,
    f1: true,
  });

  // --- Handlers ---
  const toggleRetriever = useCallback((id: Id<"retrievers">) => {
    setSelectedRetrieverIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function handleRunExperiments() {
    if (!selectedDatasetId || selectedRetrieverIds.size === 0) return;
    setError(null);

    const selectedMetrics = Object.entries(metrics)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const retrieverList = readyRetrievers.filter((r) => selectedRetrieverIds.has(r._id));
    const datasetName = selectedDataset?.name ?? "dataset";

    for (const retriever of retrieverList) {
      try {
        const name = `${retriever.name}-${datasetName}`;
        const result = await startExperiment({
          datasetId: selectedDatasetId,
          name,
          retrieverId: retriever._id,
          metricNames: selectedMetrics,
        });
        setRunningExperimentIds((prev) => new Set([...prev, result.experimentId]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start experiment");
        break;
      }
    }
  }

  const canRun = !!selectedDatasetId && selectedRetrieverIds.size > 0;

  return (
    <div className="flex flex-col h-screen">
      <Header mode="experiments" kbId={selectedKbId} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Configuration Panel */}
        <div className="w-[420px] flex-shrink-0 border-r border-border bg-bg-elevated overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* KB Selector */}
            <div className="border border-border rounded-lg bg-bg">
              <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                Knowledge Base
              </div>
              <div className="p-4">
                <KBSelector selectedKbId={selectedKbId} onSelect={setSelectedKbId} />
              </div>
            </div>

            {/* Dataset Selector — appears after KB */}
            {selectedKbId && (
              <div className="border border-border rounded-lg bg-bg">
                <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                  Dataset
                </div>
                <div className="p-4 space-y-2">
                  {kbDatasets === undefined ? (
                    <div className="flex items-center gap-2 text-text-dim text-sm">
                      <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      Loading datasets...
                    </div>
                  ) : kbDatasets.length === 0 ? (
                    <div className="text-sm text-text-dim">
                      No datasets for this KB.{" "}
                      <Link
                        href={buildKbLink("/generate", selectedKbId)}
                        className="text-accent hover:text-accent/80 transition-colors"
                      >
                        Create one
                      </Link>
                    </div>
                  ) : (
                    <>
                      <select
                        value={selectedDatasetId ?? ""}
                        onChange={(e) =>
                          setSelectedDatasetId(
                            e.target.value ? (e.target.value as Id<"datasets">) : null,
                          )
                        }
                        className="w-full bg-bg-elevated border border-border rounded px-3 py-2 text-sm text-text focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none"
                      >
                        <option value="">Select a dataset...</option>
                        {kbDatasets.map((ds) => (
                          <option key={ds._id} value={ds._id}>
                            {ds.name} ({ds.questionCount} questions)
                          </option>
                        ))}
                      </select>
                      {selectedDataset && (
                        <div className="border border-border rounded bg-bg-elevated p-3 space-y-1 text-[11px]">
                          <div className="text-text-dim">Strategy: {selectedDataset.strategy}</div>
                          <div className="text-text-dim">Questions: {selectedDataset.questionCount}</div>
                          {selectedDataset.langsmithSyncStatus && (
                            <div className="text-text-dim">LangSmith: {selectedDataset.langsmithSyncStatus}</div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Retriever Selector — multi-select, appears after KB */}
            {selectedKbId && (
              <div className="border border-border rounded-lg bg-bg">
                <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                  Retrievers {selectedRetrieverIds.size > 0 && `(${selectedRetrieverIds.size} selected)`}
                </div>
                <div className="p-4 space-y-2">
                  {kbRetrievers === undefined ? (
                    <div className="flex items-center gap-2 text-text-dim text-sm">
                      <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                      Loading retrievers...
                    </div>
                  ) : readyRetrievers.length === 0 ? (
                    <div className="text-sm text-text-dim">
                      No ready retrievers for this KB.{" "}
                      <Link
                        href={buildKbLink("/retrievers", selectedKbId)}
                        className="text-accent hover:text-accent/80 transition-colors"
                      >
                        Create one
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {readyRetrievers.map((r) => (
                        <label
                          key={r._id}
                          className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors ${
                            selectedRetrieverIds.has(r._id)
                              ? "bg-accent/10 border border-accent/30"
                              : "hover:bg-bg-hover border border-transparent"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedRetrieverIds.has(r._id)}
                            onChange={() => toggleRetriever(r._id)}
                            className="w-4 h-4 rounded border-border bg-bg text-accent focus:ring-accent/50"
                          />
                          <div className="text-xs">
                            <div className="text-text">{r.name}</div>
                            <div className="text-text-dim text-[10px]">
                              {r.chunkCount ?? "?"} chunks, k={r.defaultK}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Metrics + Run */}
            {selectedKbId && (
              <div className="border border-border rounded-lg bg-bg">
                <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                  Configuration
                </div>
                <div className="p-4 space-y-4">
                  {/* Metrics */}
                  <div className="space-y-2">
                    <div className="text-xs text-text-dim uppercase tracking-wide">Metrics</div>
                    <div className="flex flex-wrap gap-3">
                      {(["recall", "precision", "iou", "f1"] as const).map((metric) => (
                        <label key={metric} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={metrics[metric]}
                            onChange={(e) => setMetrics({ ...metrics, [metric]: e.target.checked })}
                            className="w-4 h-4 rounded border-border bg-bg text-accent focus:ring-accent/50"
                          />
                          <span className="text-sm text-text-muted capitalize">
                            {metric === "iou" ? "IoU" : metric}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Run button */}
                  <button
                    onClick={handleRunExperiments}
                    disabled={!canRun}
                    className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors ${
                      canRun
                        ? "bg-accent hover:bg-accent/90 text-bg-elevated cursor-pointer"
                        : "bg-border text-text-dim cursor-not-allowed"
                    }`}
                  >
                    Run Experiment{selectedRetrieverIds.size > 1 ? "s" : ""}{" "}
                    {selectedRetrieverIds.size > 1 && `(${selectedRetrieverIds.size})`}
                  </button>

                  {error && (
                    <div className="text-xs text-red-400">{error}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Experiment Results */}
        <div className="flex-1 flex flex-col overflow-hidden bg-bg">
          <div className="p-4 space-y-4 overflow-y-auto">
            <div className="border border-border rounded-lg bg-bg-elevated">
              <div className="px-4 py-2 border-b border-border text-xs text-text-dim uppercase tracking-wider">
                Experiments
                {selectedDatasetId
                  ? " — filtered by dataset"
                  : selectedKbId
                    ? " — all for this KB"
                    : ""}
              </div>
              <div className="p-4">
                {!selectedKbId ? (
                  <p className="text-text-dim text-sm">Select a knowledge base to see experiments.</p>
                ) : displayExperiments.length === 0 ? (
                  <p className="text-text-dim text-sm">No experiments yet.</p>
                ) : (
                  <div className="space-y-3">
                    {displayExperiments.map((exp) => (
                      <ExperimentRow key={exp._id} experiment={exp} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add ExperimentRow component**

Below `ExperimentsPageContent`, add:

```typescript
function ExperimentRow({ experiment: exp }: { experiment: any }) {
  const statusColors: Record<string, string> = {
    completed: "bg-accent/10 text-accent",
    completed_with_errors: "bg-yellow-500/10 text-yellow-400",
    failed: "bg-red-500/10 text-red-400",
    running: "bg-blue-500/10 text-blue-400",
    pending: "bg-text-dim/10 text-text-dim",
    canceling: "bg-yellow-500/10 text-yellow-400",
    canceled: "bg-text-dim/10 text-text-dim",
  };

  const scores = exp.scores as Record<string, number> | undefined;

  return (
    <div className="border border-border rounded-lg p-4 hover:border-border/80 transition-colors">
      <div className="flex items-center justify-between">
        <div className="font-medium text-text text-sm">{exp.name}</div>
        <span className={`text-xs px-2 py-0.5 rounded ${statusColors[exp.status] ?? "bg-text-dim/10 text-text-dim"}`}>
          {exp.status}
        </span>
      </div>
      {exp.status === "running" && exp.processedQuestions != null && (
        <div className="mt-1 text-xs text-text-dim">
          {exp.phase ?? "Evaluating"}... ({exp.processedQuestions}/{exp.totalQuestions ?? "?"})
        </div>
      )}
      {scores && Object.keys(scores).length > 0 && (
        <div className="flex gap-4 mt-2 text-sm">
          {Object.entries(scores).slice(0, 4).map(([key, value]) => (
            <span key={key} className="text-text-muted">
              {key === "iou" ? "IoU" : key}: <span className="text-accent">{value.toFixed(3)}</span>
            </span>
          ))}
        </div>
      )}
      {exp.langsmithUrl && (
        <a
          href={exp.langsmithUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-text-dim hover:text-accent mt-2 transition-colors"
        >
          View in LangSmith
          <ExternalLinkIcon />
        </a>
      )}
      <div className="text-[10px] text-text-dim mt-1">
        {new Date(exp.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}
```

**Step 3: Verify build**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/frontend/src/app/experiments/page.tsx
git commit -m "feat: Experiments page KB-first flow with multi-retriever batch runs"
```

---

### Task 9: Update ModeSelector home page links (optional)

**Files:**
- Modify: `packages/frontend/src/components/ModeSelector.tsx`

Currently, the home page cards link to `/generate`, `/retrievers`, `/experiments` without KB params. This is fine since there's no KB selected yet on the home page. No changes needed unless we want to persist the last-used KB — which is out of scope.

This task is a no-op. Skip it.

---

### Task 10: Final verification and cleanup

**Step 1: Run frontend build**

Run: `pnpm -C packages/frontend build`
Expected: Clean build, no TypeScript errors.

**Step 2: Run backend deployment**

Run: `cd packages/backend && npx convex dev --once`
Expected: Clean deployment.

**Step 3: Run eval-lib tests**

Run: `pnpm test`
Expected: All tests pass (existing tests, no new ones needed for frontend changes).

**Step 4: Manual testing checklist**

1. Navigate to `/retrievers?kb=<validKbId>` — KB should be pre-selected
2. Navigate to `/generate?kb=<validKbId>` — KB should be pre-selected, datasets should show
3. Click on an existing dataset — questions should load in center panel
4. Click "+ New Dataset" — should switch to generation config
5. Navigate to `/experiments?kb=<validKbId>` — KB pre-selected, shows all KB experiments
6. Select a dataset — experiments filter to that dataset
7. Select multiple retrievers — experiments filter further
8. Click "Run Experiments" — creates N experiments, they appear in results
9. When no datasets exist for KB — "Create one" link goes to `/generate?kb=<kbId>`
10. When no retrievers exist for KB — "Create one" link goes to `/retrievers?kb=<kbId>`
11. Header nav tabs preserve KB param when switching pages

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup for KB-first frontend flow"
```
