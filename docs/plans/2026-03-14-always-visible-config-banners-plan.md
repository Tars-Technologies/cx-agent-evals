# Always-Visible Pipeline Config Banners — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make pipeline configuration always visible in every tab before and after running queries, and fix the sidebar accordion so the config summary appears when clicking a retriever.

**Architecture:** Each tab extracts its stage config from `retriever.retrieverConfig` using the existing `resolveConfig()` helper and renders a static config box. The sidebar bug is a double-toggle in event handling.

**Tech Stack:** React, TypeScript, Tailwind CSS, Convex (existing)

**Design doc:** `docs/plans/2026-03-14-always-visible-config-banners-design.md`

---

### Task 1: Fix sidebar double-toggle bug

**Files:**
- Modify: `packages/frontend/src/components/RetrieverListItem.tsx:249-259`

**Context:** `handleHeaderClick` calls both `onSelect()` and `onToggleExpand()`. The sidebar's `handleSelect` already toggles `expandedId` via `setExpandedId((prev) => (prev === id ? null : id))`. Two toggles cancel out — accordion never opens.

**Step 1: Fix handleHeaderClick to only call onSelect**

In `packages/frontend/src/components/RetrieverListItem.tsx`, replace lines 249-259:

```typescript
// BEFORE (broken — double toggle)
const handleHeaderClick = () => {
  if (isCheckboxMode) {
    onSelect();
    onToggleExpand();
    return;
  }
  onSelect();
  onToggleExpand();
};
```

With:

```typescript
// AFTER (fixed — single toggle via handleSelect in sidebar)
const handleHeaderClick = () => {
  onSelect();
};
```

**Step 2: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 3: Commit**

```bash
git add packages/frontend/src/components/RetrieverListItem.tsx
git commit -m "fix(frontend): fix sidebar double-toggle — accordion now expands on click"
```

---

### Task 2: Add static index config box to IndexTab

**Files:**
- Modify: `packages/frontend/src/components/tabs/IndexTab.tsx`

**Context:** IndexTab currently has zero configuration display. We need to add a compact config box at the very top showing index settings (chunk strategy, size, overlap, embedding model). Use `resolveConfig()` from `pipeline-types.ts` to extract config with defaults.

**Step 1: Add import for resolveConfig and PipelineConfig**

At the top of `IndexTab.tsx` (after existing imports, line 7):

```typescript
import { resolveConfig } from "@/lib/pipeline-types";
import type { PipelineConfig } from "@/lib/pipeline-types";
```

**Step 2: Add IndexConfigBanner sub-component**

Add before the main `IndexTab` component (before line ~793):

```typescript
function IndexConfigBanner({ retrieverConfig }: { retrieverConfig: unknown }) {
  const config = resolveConfig(retrieverConfig as PipelineConfig);
  const { chunkSize, chunkOverlap, embeddingModel } = config.index;
  const embedShort = embeddingModel.replace("text-embedding-", "");

  return (
    <div className="px-3 py-2 border-b border-border flex-shrink-0">
      <div className="bg-bg-surface border border-border rounded-lg p-2">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
          <span className="text-text-muted font-medium">Index</span>
          <span>
            Chunking: <span className="text-text-muted">recursive</span>
          </span>
          <span>
            Size: <span className="text-text-muted">{chunkSize}/{chunkOverlap}</span>
          </span>
          <span>
            Embedding: <span className="text-text-muted">{embedShort}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Insert the banner in the IndexTab render**

In the `IndexTab` component's return, change the outer div structure from:

```tsx
return (
  <div className="flex h-full border-t border-border">
    {/* Left: Document list */}
```

To:

```tsx
return (
  <div className="flex flex-col h-full border-t border-border">
    {/* Index config banner */}
    <IndexConfigBanner retrieverConfig={retriever.retrieverConfig} />

    <div className="flex flex-1 min-h-0">
      {/* Left: Document list */}
```

And close the new inner `<div>` at the end (before the outer closing `</div>`). The three-panel layout (`w-[200px]` + `flex-1` + `w-[300px]`) moves inside this new `flex flex-1 min-h-0` wrapper.

**Step 4: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 5: Commit**

```bash
git add packages/frontend/src/components/tabs/IndexTab.tsx
git commit -m "feat(frontend): add always-visible index config banner to IndexTab"
```

---

### Task 3: Add static config boxes to QuerySearchTab

**Files:**
- Modify: `packages/frontend/src/components/tabs/QuerySearchTab.tsx`

**Context:** The QueryRewritingPanel and SearchResultsPanel currently show "Run a query to see results" before execution, with no config. We need to:
1. Add a static query strategy config box inside the QueryRewritingPanel (visible before AND after running).
2. Add a static search config box inside the SearchResultsPanel (visible before AND after running).
3. Move latency from the search config box to the result header line.
4. Put the query strategy in a bordered box (consistent with search config).

**Step 1: Add import for resolveConfig**

At the top of `QuerySearchTab.tsx` (after line 7):

```typescript
import { resolveConfig } from "@/lib/pipeline-types";
import type { PipelineConfig } from "@/lib/pipeline-types";
```

**Step 2: Add queryConfig and searchConfig props to both panels**

Add `queryStrategy: string` prop to `QueryRewritingPanel`:

```typescript
function QueryRewritingPanel({
  rewriteResult,
  selectedQueryIndex,
  onSelectQueryIndex,
  isRewriting,
  queryStrategy,  // NEW
}: {
  rewriteResult: RewriteResult | null;
  selectedQueryIndex: number | null;
  onSelectQueryIndex: (index: number | null) => void;
  isRewriting: boolean;
  queryStrategy: string;  // NEW
}) {
```

Add `staticSearchConfig` prop to `SearchResultsPanel`:

```typescript
function SearchResultsPanel({
  searchResult,
  selectedQueryIndex,
  isSearching,
  staticSearchConfig,  // NEW
}: {
  searchResult: SearchResult | null;
  selectedQueryIndex: number | null;
  isSearching: boolean;
  staticSearchConfig: { strategy: string; k: number; denseWeight?: number; sparseWeight?: number; fusionMethod?: string };  // NEW
}) {
```

**Step 3: Rewrite QueryRewritingPanel to always show config box**

Replace the early return for `!rewriteResult` (lines 108-113). Instead, the panel always renders its header + config box. After the config box, conditionally render the rewrite results or "Run a query" message:

```typescript
// Remove the early return for !rewriteResult (lines 108-113)
// Instead, always render:

return (
  <div className="h-full flex flex-col">
    {/* Header */}
    <div className="px-3 py-2 border-b border-border bg-bg-elevated/50 flex-shrink-0">
      <span className="text-[11px] text-text-muted font-medium">
        Query Rewriting
      </span>
    </div>

    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* Static config box — always visible */}
      <div className="bg-bg-surface border border-border rounded-lg p-2">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
          <span>
            Strategy: <span className="text-text-muted">{strategyLabel(queryStrategy)}</span>
          </span>
        </div>
      </div>

      {/* Spinner while rewriting */}
      {isRewriting && (
        <div className="flex items-center gap-2 py-4 justify-center">
          <Spinner />
          <span className="text-[11px] text-text-dim">Rewriting query...</span>
        </div>
      )}

      {/* Rewrite results (after running) */}
      {rewriteResult && !isRewriting && (
        <>
          {/* Radio options */}
          <div className="space-y-1">
            <RadioOption
              label={...existing logic...}
              ...
            />
            {/* rewritten queries */}
          </div>

          {/* HyDE hypothetical answer (if applicable) */}
          ...existing logic...

          {/* Latency */}
          <p className="text-[11px] text-text-dim">
            Latency: {rewriteResult.latencyMs}ms
          </p>
        </>
      )}

      {/* Empty state (before running) */}
      {!rewriteResult && !isRewriting && (
        <div className="text-xs text-text-dim text-center py-4">
          Run a query to see rewriting results.
        </div>
      )}
    </div>
  </div>
);
```

Keep the existing `isRewriting` spinner early return (lines 99-106) but inline it into the flow as shown above.

**Step 4: Rewrite SearchResultsPanel to always show static config**

Replace the early return for `!searchResult` (lines 259-264). The panel always renders its header + static config box. The dynamic config banner from the API response is removed (it duplicates what we now show statically). Latency moves into the result header:

```typescript
return (
  <div className="h-full flex flex-col">
    {/* Header */}
    <div className="px-3 py-2 border-b border-border bg-bg-elevated/50 flex-shrink-0">
      <span className="text-[11px] text-text-muted font-medium">
        Search Results
      </span>
    </div>

    <div className="flex-1 overflow-y-auto">
      {/* Static config box — always visible */}
      <div className="m-3 bg-bg-surface border border-border rounded-lg p-2">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-dim">
          <span>
            Strategy: <span className="text-text-muted">{staticSearchConfig.strategy}</span>
          </span>
          {staticSearchConfig.denseWeight != null && (
            <span>
              Dense: <span className="text-text-muted">{staticSearchConfig.denseWeight}</span>
            </span>
          )}
          {staticSearchConfig.sparseWeight != null && (
            <span>
              Sparse: <span className="text-text-muted">{staticSearchConfig.sparseWeight}</span>
            </span>
          )}
          {staticSearchConfig.fusionMethod != null && (
            <span>
              Fusion: <span className="text-text-muted">{staticSearchConfig.fusionMethod}</span>
            </span>
          )}
          <span>
            k: <span className="text-text-muted">{staticSearchConfig.k}</span>
          </span>
        </div>
      </div>

      {/* Spinner */}
      {isSearching && (
        <div className="flex items-center gap-2 py-4 justify-center">
          <Spinner />
          <span className="text-[11px] text-text-dim">Searching...</span>
        </div>
      )}

      {/* Results (after running) */}
      {searchResult && !isSearching && (
        <>
          {/* Result header with latency */}
          <div className="px-3 pb-2">
            <p className="text-[11px] text-text-dim">
              {resultHeader} · {searchResult.latencyMs}ms
            </p>
          </div>
          {/* Chunk list */}
          ...existing chunk rendering...
        </>
      )}

      {/* Empty state */}
      {!searchResult && !isSearching && (
        <div className="text-xs text-text-dim text-center py-4">
          Run a query to see search results.
        </div>
      )}
    </div>
  </div>
);
```

**Step 5: Pass resolved config from the main QuerySearchTab component**

In the main `QuerySearchTab` component, resolve config and pass to panels:

```typescript
export function QuerySearchTab({ retriever, query, onQueryChange }: QuerySearchTabProps) {
  // Resolve static config
  const resolved = resolveConfig(retriever.retrieverConfig as PipelineConfig);

  // ... existing state ...

  // Build static search config for the panel
  const staticSearchConfig = {
    strategy: resolved.search.strategy,
    k: resolved.k,
    ...(resolved.search.strategy === "hybrid" ? {
      denseWeight: (resolved.search as any).denseWeight,
      sparseWeight: (resolved.search as any).sparseWeight,
      fusionMethod: (resolved.search as any).fusionMethod,
    } : {}),
  };

  // ... existing handlers ...

  return (
    // ... existing layout ...
    <QueryRewritingPanel
      rewriteResult={rewriteResult}
      selectedQueryIndex={selectedQueryIndex}
      onSelectQueryIndex={setSelectedQueryIndex}
      isRewriting={isRewriting}
      queryStrategy={resolved.query.strategy}  // NEW
    />
    // ...
    <SearchResultsPanel
      searchResult={searchResult}
      selectedQueryIndex={selectedQueryIndex}
      isSearching={isSearching}
      staticSearchConfig={staticSearchConfig}  // NEW
    />
  );
}
```

**Step 6: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 7: Commit**

```bash
git add packages/frontend/src/components/tabs/QuerySearchTab.tsx
git commit -m "feat(frontend): add always-visible query + search config boxes to QuerySearchTab"
```

---

### Task 4: Add static refinement config to RefineTab

**Files:**
- Modify: `packages/frontend/src/components/tabs/RefineTab.tsx`

**Context:** The RefineTab shows "Run a query to see the refinement pipeline stages" before execution. We need to add horizontal pipeline chips showing the configured refinement stages, visible always.

**Step 1: Add import for resolveConfig**

At the top of `RefineTab.tsx` (after line 7):

```typescript
import { resolveConfig } from "@/lib/pipeline-types";
import type { PipelineConfig, RefinementStepConfig } from "@/lib/pipeline-types";
```

**Step 2: Add StaticRefinementConfig sub-component**

Add before the main `RefineTab` component:

```typescript
function StaticRefinementConfig({
  steps,
}: {
  steps: readonly RefinementStepConfig[];
}) {
  if (steps.length === 0) {
    return (
      <div className="bg-bg-surface border border-border rounded-lg p-2 text-[11px] text-text-dim">
        No refinement stages configured. Search results are the final output.
      </div>
    );
  }

  return (
    <div className="bg-bg-surface border border-border rounded-lg p-3">
      <p className="text-[10px] text-text-dim uppercase tracking-wider mb-2">
        Refinement Pipeline
      </p>
      <div className="flex items-center gap-1 flex-wrap">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-1">
            {i > 0 && (
              <span className="text-text-dim text-xs select-none">{"\u2192"}</span>
            )}
            <span className="px-2.5 py-1 rounded-full text-xs bg-bg-elevated text-text-muted border border-border">
              {step.type}
              {step.type === "threshold" && "minScore" in step && (
                <span className="text-text-dim"> · min={String((step as any).minScore)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 3: Insert the config banner and restructure the content area**

In the `RefineTab` main component, resolve config and show the static refinement config always. Place it between the query bar and the content area:

```typescript
export function RefineTab({ retriever, query, onQueryChange }: RefineTabProps) {
  const resolved = resolveConfig(retriever.retrieverConfig as PipelineConfig);

  // ... existing state and handlers ...

  // Remove the non-ready early return (lines 305-320). The static config should
  // still be visible even for non-ready retrievers. The query bar + Run button
  // can be disabled when not ready instead.

  return (
    <div className="flex flex-col h-full">
      {/* Query bar */}
      <div className="flex items-center gap-2 p-3 border-b border-border flex-shrink-0">
        <input ... existing ... />
        <button
          ...
          disabled={!query.trim() || isLoading || retriever.status !== "ready"}
          ...
        >
          ...
        </button>
      </div>

      {/* Static refinement config — always visible */}
      <div className="px-3 pt-3">
        <StaticRefinementConfig steps={resolved.refinement} />
      </div>

      {/* Error banner */}
      {error && ( ... existing ... )}

      {/* Dynamic results area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* ... existing pipeline stepper and stage detail ... */}
      </div>
    </div>
  );
}
```

**Step 4: Remove the non-ready early return**

Delete lines 305-320 (the `if (retriever.status !== "ready")` block). Instead, the Run button is disabled for non-ready retrievers. The static config and query bar are always visible.

**Step 5: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 6: Commit**

```bash
git add packages/frontend/src/components/tabs/RefineTab.tsx
git commit -m "feat(frontend): add always-visible refinement pipeline config to RefineTab"
```

---

### Task 5: Remove non-ready early return from QuerySearchTab

**Files:**
- Modify: `packages/frontend/src/components/tabs/QuerySearchTab.tsx`

**Context:** QuerySearchTab also has a non-ready early return (lines 428-443) that blocks all config display. Since we now show static config always, we should remove this and instead disable the Run button.

**Step 1: Remove non-ready early return**

Delete lines 428-443 (the `if (retriever.status !== "ready")` block).

**Step 2: Disable Run button for non-ready**

Change the button `disabled` condition from:

```typescript
disabled={!query.trim() || isRewriting || isSearching}
```

To:

```typescript
disabled={!query.trim() || isRewriting || isSearching || retriever.status !== "ready"}
```

**Step 3: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 4: Commit**

```bash
git add packages/frontend/src/components/tabs/QuerySearchTab.tsx
git commit -m "feat(frontend): show Q+S config for non-ready retrievers, disable Run button"
```

---

### Task 6: End-to-end verification

**Step 1: Full build**

Run: `pnpm build && pnpm typecheck && pnpm typecheck:backend && pnpm -C packages/frontend build`
Expected: All pass.

**Step 2: Run tests**

Run: `pnpm test && pnpm -C packages/backend test`
Expected: All tests pass.

**Step 3: Manual E2E checklist**

- [ ] Click a retriever in sidebar → accordion expands showing 4-line config summary + "View Full Config"
- [ ] Click same retriever → accordion collapses
- [ ] Index tab: config box visible at top (chunking strategy, size, overlap, embedding model)
- [ ] Index tab: config box visible even for unindexed retrievers
- [ ] Query+Search tab: query strategy box visible in left panel before running
- [ ] Query+Search tab: search config box visible in right panel before running
- [ ] Query+Search tab: after running, latency appears in result line, not in config box
- [ ] Refine tab: horizontal pipeline chips visible before running
- [ ] Refine tab: "No refinement stages configured" shown for retrievers without refinement
- [ ] All tabs: config visible for non-ready retrievers (Run button disabled)

**Step 4: Commit final verification**

Only if fixes were needed during E2E testing.
