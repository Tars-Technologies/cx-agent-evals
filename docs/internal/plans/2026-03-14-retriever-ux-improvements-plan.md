# Retriever UX Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve retriever management UX — safe delete with confirmation modals, cleaner sidebar layout, better auto-naming, wizard fixes, and eliminate the selection flash.

**Architecture:** New `ConfirmDeleteModal` component handles typed DELETE confirmation with contextual impact summaries. Delete buttons move from sidebar accordion to View Full Config modal's Danger Zone. Backend `deleteIndex` mutation updated to allow shared-index deletion with auto-reset. Wizard gets Create Retriever in footer, sentence-style auto-naming, and Start from Scratch at top.

**Tech Stack:** React, TypeScript, Tailwind CSS, Convex (existing)

**Design doc:** `docs/plans/2026-03-14-retriever-ux-improvements-design.md`

---

### Task 1: Fix retriever selection flash

**Files:**
- Modify: `packages/frontend/src/app/retrievers/page.tsx:205-244`

**Context:** When switching retrievers, `selectedRetrieverId` updates immediately but `selectedRetriever` (from `useQuery`) is briefly `undefined`. The condition `selectedRetrieverId && selectedRetriever` evaluates to false, flashing the "No retriever selected" empty state for ~50-500ms.

**Step 1: Add loading state between selected-but-loading and empty**

In `packages/frontend/src/app/retrievers/page.tsx`, replace lines 205-244:

```tsx
{selectedRetrieverId && selectedRetriever ? (
  <>
    {/* Tab bar */}
    <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

    {/* Tab content */}
    <div className="flex-1 overflow-auto">
      {activeTab === "index" && (
        <IndexTab
          retriever={selectedRetriever}
          onStartIndexing={() =>
            handleStartIndexing(selectedRetriever._id)
          }
        />
      )}
      {activeTab === "query-search" && (
        <QuerySearchTab
          retriever={selectedRetriever}
          query={query}
          onQueryChange={setQuery}
        />
      )}
      {activeTab === "refine" && (
        <RefineTab
          retriever={selectedRetriever}
          query={query}
          onQueryChange={setQuery}
        />
      )}
      {activeTab === "playground" && (
        <PlaygroundTab
          selectedRetrieverIds={selectedRetrieverIds}
          retrievers={allRetrievers ?? []}
        />
      )}
    </div>
  </>
) : (
  <EmptyState onNewRetriever={() => setShowWizard(true)} />
)}
```

With:

```tsx
{selectedRetrieverId && selectedRetriever ? (
  <>
    {/* Tab bar */}
    <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

    {/* Tab content */}
    <div className="flex-1 overflow-auto">
      {activeTab === "index" && (
        <IndexTab
          retriever={selectedRetriever}
          onStartIndexing={() =>
            handleStartIndexing(selectedRetriever._id)
          }
        />
      )}
      {activeTab === "query-search" && (
        <QuerySearchTab
          retriever={selectedRetriever}
          query={query}
          onQueryChange={setQuery}
        />
      )}
      {activeTab === "refine" && (
        <RefineTab
          retriever={selectedRetriever}
          query={query}
          onQueryChange={setQuery}
        />
      )}
      {activeTab === "playground" && (
        <PlaygroundTab
          selectedRetrieverIds={selectedRetrieverIds}
          retrievers={allRetrievers ?? []}
        />
      )}
    </div>
  </>
) : selectedRetrieverId ? (
  /* Loading state — retriever selected but data still loading */
  <div className="flex-1 flex flex-col overflow-hidden">
    <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
    <div className="flex-1 flex items-center justify-center">
      <div className="flex items-center gap-2 text-text-dim text-sm">
        <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        Loading...
      </div>
    </div>
  </div>
) : (
  <EmptyState onNewRetriever={() => setShowWizard(true)} />
)}
```

**Step 2: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 3: Commit**

```bash
git add packages/frontend/src/app/retrievers/page.tsx
git commit -m "fix(frontend): eliminate empty-state flash when switching retrievers"
```

---

### Task 2: Create ConfirmDeleteModal component

**Files:**
- Create: `packages/frontend/src/components/ConfirmDeleteModal.tsx`

**Context:** Reusable confirmation modal for both "Delete Retriever" and "Delete Index" actions. Shows impact summary, contextual warning about shared/unique indexes, requires typing DELETE, and has a red confirm button.

**Step 1: Create the component**

Create `packages/frontend/src/components/ConfirmDeleteModal.tsx`:

```tsx
"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SharingRetriever {
  name: string;
}

interface ConfirmDeleteModalProps {
  /** "retriever" or "index" */
  action: "retriever" | "index";
  /** Name of the retriever being acted on */
  retrieverName: string;
  /** Retrievers that share the same index (excluding the current one) */
  sharingRetrievers: SharingRetriever[];
  /** Whether the retriever has an index (status is "ready" or "error") */
  hasIndex: boolean;
  /** Callback when confirmed */
  onConfirm: () => void;
  /** Callback to close modal */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfirmDeleteModal({
  action,
  retrieverName,
  sharingRetrievers,
  hasIndex,
  onConfirm,
  onClose,
}: ConfirmDeleteModalProps) {
  const [input, setInput] = useState("");
  const isConfirmed = input === "DELETE";

  const isShared = sharingRetrievers.length > 0;
  const title =
    action === "retriever" ? "Delete Retriever" : "Delete Index";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[480px] bg-bg-elevated border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-red-400">{title}</h3>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text transition-colors cursor-pointer text-lg"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Impact summary */}
          <div className="bg-bg-surface border border-border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-dim">Retriever:</span>
              <span className="text-xs text-text font-medium">
                {retrieverName}
              </span>
            </div>
            {action === "retriever" && hasIndex && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-dim">Index:</span>
                <span className="text-xs text-text">
                  {isShared ? "Shared with other retrievers" : "Unique to this retriever"}
                </span>
              </div>
            )}
            {action === "index" && isShared && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-dim">Shared by:</span>
                <span className="text-xs text-text">
                  {sharingRetrievers.map((r) => r.name).join(", ")}
                </span>
              </div>
            )}
          </div>

          {/* Contextual warning */}
          {action === "retriever" && hasIndex && !isShared && (
            <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
              <p className="text-xs text-red-400 font-medium">
                The index will also be permanently deleted since no other
                retriever uses it.
              </p>
            </div>
          )}
          {action === "retriever" && hasIndex && isShared && (
            <div className="border border-accent/30 bg-accent/5 rounded-lg p-3">
              <p className="text-xs text-accent">
                The index will NOT be deleted. It is still used by:{" "}
                <span className="font-medium">
                  {sharingRetrievers.map((r) => r.name).join(", ")}
                </span>
              </p>
            </div>
          )}
          {action === "index" && isShared && (
            <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
              <p className="text-xs text-red-400 font-medium mb-1">
                This will also affect {sharingRetrievers.length} other
                retriever{sharingRetrievers.length > 1 ? "s" : ""}:
              </p>
              <ul className="text-xs text-red-400 list-disc list-inside">
                {sharingRetrievers.map((r) => (
                  <li key={r.name}>{r.name}</li>
                ))}
              </ul>
              <p className="text-xs text-red-400 mt-1">
                They will stop working and need to be re-indexed.
              </p>
            </div>
          )}
          {action === "index" && !isShared && (
            <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-3">
              <p className="text-xs text-yellow-400">
                This retriever will reset to &ldquo;configuring&rdquo; and need
                to be re-indexed.
              </p>
            </div>
          )}

          {/* Typed confirmation */}
          <div>
            <label className="text-xs text-text-dim block mb-1">
              Type <span className="text-text font-mono font-medium">DELETE</span> to
              confirm
            </label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="DELETE"
              className="w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5 placeholder:text-text-dim focus:outline-none focus:border-red-400/50 transition-colors"
              autoFocus
            />
          </div>

          {/* Confirm button */}
          <button
            onClick={onConfirm}
            disabled={!isConfirmed}
            className="w-full py-2 text-sm rounded-lg font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {title}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 3: Commit**

```bash
git add packages/frontend/src/components/ConfirmDeleteModal.tsx
git commit -m "feat(frontend): add ConfirmDeleteModal with typed DELETE confirmation and impact summary"
```

---

### Task 3: Update backend deleteIndex to allow shared-index deletion

**Files:**
- Modify: `packages/backend/convex/crud/retrievers.ts:236-289`

**Context:** Currently `deleteIndex` throws an error if other retrievers share the index. Change it to allow deletion and auto-reset all affected retrievers to "configuring" status.

**Step 1: Update the deleteIndex mutation**

In `packages/backend/convex/crud/retrievers.ts`, replace lines 262-266:

```typescript
    if (sharingChunks.length > 0) {
      throw new Error(
        `Cannot delete index: ${sharingChunks.length} other retriever(s) share the same index. Delete them first.`,
      );
    }
```

With:

```typescript
    // Reset any other retrievers sharing this index to "configuring"
    for (const sharer of sharingChunks) {
      await ctx.db.patch(sharer._id, {
        status: "configuring",
        chunkCount: undefined,
        indexingJobId: undefined,
        error: undefined,
      });
    }
```

**Step 2: Build and verify**

Run: `pnpm typecheck:backend`
Expected: Compiles successfully.

**Step 3: Run backend tests**

Run: `pnpm -C packages/backend test`
Expected: All 78 tests pass (9 test files).

**Step 4: Commit**

```bash
git add packages/backend/convex/crud/retrievers.ts
git commit -m "feat(backend): allow deleting shared indexes — auto-reset affected retrievers to configuring"
```

---

### Task 4: Add Danger Zone to RetrieverDetailModal

**Files:**
- Modify: `packages/frontend/src/components/RetrieverDetailModal.tsx`
- Modify: `packages/frontend/src/components/RetrieverSidebar.tsx`

**Context:** Add a Danger Zone section at the bottom of the View Full Config modal with "Delete Index" and "Delete Retriever" buttons. Clicking either opens the `ConfirmDeleteModal`. The modal needs retriever ID, status, and sharing info passed through from the sidebar.

**Step 1: Update RetrieverDetailModal props and add imports**

In `RetrieverDetailModal.tsx`, update the props interface and add imports.

Replace lines 1-27:

```tsx
"use client";

import { useState } from "react";
import {
  INDEX_STRATEGY_REGISTRY,
  QUERY_STRATEGY_REGISTRY,
  SEARCH_STRATEGY_REGISTRY,
  REFINEMENT_STEP_REGISTRY,
  CHUNKER_REGISTRY,
  EMBEDDER_REGISTRY,
  RERANKER_REGISTRY,
} from "rag-evaluation-system/registry";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SharingRetriever {
  name: string;
}

interface RetrieverDetailModalProps {
  retriever: {
    name: string;
    retrieverConfig: unknown;
    defaultK: number;
    status: string;
    chunkCount?: number;
    createdAt: number;
  };
  /** Retrievers sharing the same index (excluding this one) */
  sharingRetrievers: SharingRetriever[];
  onDeleteIndex: () => void;
  onDeleteRetriever: () => void;
  onClose: () => void;
}
```

**Step 2: Add DangerZone sub-component**

Add before the main `RetrieverDetailModal` component (before line ~271):

```tsx
// ---------------------------------------------------------------------------
// Danger Zone
// ---------------------------------------------------------------------------

function DangerZone({
  retrieverName,
  status,
  sharingRetrievers,
  onDeleteIndex,
  onDeleteRetriever,
}: {
  retrieverName: string;
  status: string;
  sharingRetrievers: SharingRetriever[];
  onDeleteIndex: () => void;
  onDeleteRetriever: () => void;
}) {
  const [confirmAction, setConfirmAction] = useState<
    "retriever" | "index" | null
  >(null);

  const hasIndex = status === "ready" || status === "error";
  const dangerBtn =
    "text-xs px-3 py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer";

  return (
    <>
      <section className="border border-red-500/20 rounded-lg p-4 bg-red-500/[0.02]">
        <h4 className="text-xs font-medium text-red-400 uppercase tracking-wider mb-3">
          Danger Zone
        </h4>
        <div className="space-y-3">
          {hasIndex && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-text">Delete Index</p>
                <p className="text-[11px] text-text-dim">
                  Resets retriever to configuring — needs re-indexing
                </p>
              </div>
              <button
                onClick={() => setConfirmAction("index")}
                className={dangerBtn}
              >
                Delete Index
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-text">Delete Retriever</p>
              <p className="text-[11px] text-text-dim">
                Permanently removes this retriever
              </p>
            </div>
            <button
              onClick={() => setConfirmAction("retriever")}
              className={dangerBtn}
            >
              Delete Retriever
            </button>
          </div>
        </div>
      </section>

      {confirmAction && (
        <ConfirmDeleteModal
          action={confirmAction}
          retrieverName={retrieverName}
          sharingRetrievers={sharingRetrievers}
          hasIndex={hasIndex}
          onConfirm={() => {
            if (confirmAction === "index") {
              onDeleteIndex();
            } else {
              onDeleteRetriever();
            }
            setConfirmAction(null);
          }}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}
```

**Step 3: Insert DangerZone into the modal render**

In the main `RetrieverDetailModal` component's render, add after the `<RefinementSection>` (after line 337):

```tsx
          {/* Danger Zone */}
          <DangerZone
            retrieverName={retriever.name}
            status={retriever.status}
            sharingRetrievers={sharingRetrievers}
            onDeleteIndex={onDeleteIndex}
            onDeleteRetriever={onDeleteRetriever}
          />
```

Also update the component function signature to destructure the new props:

Replace `export function RetrieverDetailModal({ retriever, onClose }: RetrieverDetailModalProps)` with:

```tsx
export function RetrieverDetailModal({
  retriever,
  sharingRetrievers,
  onDeleteIndex,
  onDeleteRetriever,
  onClose,
}: RetrieverDetailModalProps)
```

**Step 4: Update RetrieverSidebar to pass new props**

In `RetrieverSidebar.tsx`, update the `detailRetriever` state to store the retriever ID and indexConfigHash so we can compute sharing info. Replace lines 123-130:

```tsx
  const [detailRetrieverId, setDetailRetrieverId] =
    useState<Id<"retrievers"> | null>(null);
```

Then compute the detail retriever and sharing info from the `retrievers` query result. Replace lines 278-284:

```tsx
      {/* Detail modal */}
      {detailRetrieverId && (() => {
        const r = retrievers?.find((ret) => ret._id === detailRetrieverId);
        if (!r) return null;
        const sharingRetrievers = (retrievers ?? [])
          .filter(
            (other) =>
              other._id !== r._id &&
              other.indexConfigHash === r.indexConfigHash,
          )
          .map((other) => ({ name: other.name }));
        return (
          <RetrieverDetailModal
            retriever={{
              name: r.name,
              retrieverConfig: r.retrieverConfig,
              defaultK: r.defaultK,
              status: r.status,
              chunkCount: r.chunkCount,
              createdAt: r._creationTime,
            }}
            sharingRetrievers={sharingRetrievers}
            onDeleteIndex={async () => {
              await handleDeleteIndex(r._id);
              setDetailRetrieverId(null);
            }}
            onDeleteRetriever={async () => {
              await handleDelete(r._id);
              setDetailRetrieverId(null);
            }}
            onClose={() => setDetailRetrieverId(null)}
          />
        );
      })()}
```

And update the `onViewFullConfig` callback in the list item (line 260-268) to use the new state:

Replace:

```tsx
              onViewFullConfig={() =>
                setDetailRetriever({
                  name: r.name,
                  retrieverConfig: r.retrieverConfig,
                  defaultK: r.defaultK,
                  status: r.status,
                  chunkCount: r.chunkCount,
                  createdAt: r._creationTime,
                })
              }
```

With:

```tsx
              onViewFullConfig={() => setDetailRetrieverId(r._id)}
```

**Step 5: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 6: Commit**

```bash
git add packages/frontend/src/components/RetrieverDetailModal.tsx packages/frontend/src/components/RetrieverSidebar.tsx
git commit -m "feat(frontend): add Danger Zone to View Full Config modal with delete confirmation"
```

---

### Task 5: Remove delete buttons from sidebar accordion

**Files:**
- Modify: `packages/frontend/src/components/RetrieverListItem.tsx:149-225`

**Context:** Delete buttons now live in the View Full Config modal. Remove them from the accordion's `ActionButtons` component. Keep non-destructive actions (Start Indexing, Cancel, Retry).

**Step 1: Remove delete-related props and buttons**

In `RetrieverListItem.tsx`, update the `ActionButtons` component. Remove `onDeleteIndex` and `onDelete` from its props. Update the render for each status:

- `configuring`: Keep "Start Indexing" only, remove "Delete" button
- `indexing`: Keep spinner + "Cancel" only (unchanged)
- `ready`: Remove entire block (no action buttons for ready state)
- `error`: Keep "Retry Indexing" only, remove "Delete" button

Replace `ActionButtons` (lines 149-225) with:

```tsx
function ActionButtons({
  status,
  progress,
  onStartIndexing,
  onCancelIndexing,
}: {
  status: string;
  progress?: IndexingProgress;
  onStartIndexing: () => void;
  onCancelIndexing: () => void;
}) {
  const primaryBtn =
    "text-[11px] px-2 py-1 rounded border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer";
  const dangerBtn =
    "text-[11px] px-2 py-1 rounded border border-border text-text-dim hover:text-red-400 hover:border-red-400/30 transition-colors cursor-pointer";

  return (
    <div className="mt-2 flex gap-2 flex-wrap">
      {status === "configuring" && (
        <button onClick={onStartIndexing} className={primaryBtn}>
          Start Indexing
        </button>
      )}

      {status === "indexing" && (
        <>
          <div className="flex items-center gap-1.5 text-[11px] text-accent">
            <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            {progress && progress.totalDocs > 0 ? (
              <span>
                {progress.processedDocs}/{progress.totalDocs} docs
              </span>
            ) : (
              <span>Indexing...</span>
            )}
          </div>
          <button onClick={onCancelIndexing} className={dangerBtn}>
            Cancel
          </button>
        </>
      )}

      {status === "error" && (
        <button onClick={onStartIndexing} className={primaryBtn}>
          Retry Indexing
        </button>
      )}
    </div>
  );
}
```

**Step 2: Remove delete props from the main component interface**

In `RetrieverListItemProps` (lines 15-40), remove:
- `onDeleteIndex: () => void;` (line 31)
- `onDelete: () => void;` (line 32)

In the main component destructuring (lines 231-246), remove `onDeleteIndex` and `onDelete`.

Update the `ActionButtons` usage (lines 348-356) to remove the deleted props:

```tsx
          <ActionButtons
            status={retriever.status}
            progress={progress}
            onStartIndexing={onStartIndexing}
            onCancelIndexing={onCancelIndexing}
          />
```

**Step 3: Update RetrieverSidebar to stop passing delete props**

In `RetrieverSidebar.tsx`, remove these props from the `RetrieverListItemWithProgress` usage (around lines 258-259):

```tsx
              onDeleteIndex={() => handleDeleteIndex(r._id)}
              onDelete={() => handleDelete(r._id)}
```

Also remove them from the `RetrieverListItemWithProgress` wrapper's type definition (around lines 57-58).

**Step 4: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 5: Commit**

```bash
git add packages/frontend/src/components/RetrieverListItem.tsx packages/frontend/src/components/RetrieverSidebar.tsx
git commit -m "feat(frontend): remove delete buttons from sidebar accordion — now in View Full Config modal"
```

---

### Task 6: Move "Start from Scratch" to top in ChoosePresetStep

**Files:**
- Modify: `packages/frontend/src/components/wizard/steps/ChoosePresetStep.tsx:109-196`

**Context:** Currently "Start from Scratch" button is at the bottom after the preset grid. Move it to the top with a divider "or" between it and the presets.

**Step 1: Restructure the render**

In `ChoosePresetStep.tsx`, replace lines 109-196 (the return statement) with:

```tsx
  return (
    <div className="flex flex-col gap-5">
      {/* Start from scratch — now at the top */}
      <button
        type="button"
        onClick={() => onSelectPreset(null)}
        className={`
          w-full text-center text-sm py-2 rounded-lg border transition-colors cursor-pointer
          ${selectedPresetId === null
            ? "border-accent text-accent bg-accent-dim/10"
            : "border-border text-text-muted bg-bg-surface hover:bg-bg-hover hover:border-border-bright"
          }
        `}
      >
        Start from scratch
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-text-dim text-xs">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        {/* Complexity checkboxes */}
        <div className="flex items-center gap-4">
          {ALL_COMPLEXITIES.map((c) => (
            <label key={c} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={enabledComplexities.has(c)}
                onChange={() => toggleComplexity(c)}
                className="w-3.5 h-3.5 rounded border-border bg-bg-surface text-accent focus:ring-accent/50"
              />
              <ComplexityBadge complexity={c} />
            </label>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search presets..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="
            w-full bg-bg-surface border border-border text-text text-xs rounded px-2 py-1.5
            placeholder:text-text-dim
            focus:outline-none focus:border-accent/50 transition-colors
          "
        />
      </div>

      {/* Preset grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.map((preset) => (
          <div key={preset.id} className="flex flex-col">
            <StrategyCard
              id={preset.id}
              name={preset.name}
              description={preset.description}
              status={preset.status}
              selected={selectedPresetId === preset.id}
              onSelect={(id) => onSelectPreset(id)}
              badge={<ComplexityBadge complexity={preset.complexity} />}
              tags={preset.tags}
            />
            {/* Extra metadata below the card */}
            <div className="flex items-center gap-2 mt-1 px-1">
              <RequirementPills preset={preset} />
              <span className="text-text-dim text-xs truncate">
                {stageBreadcrumb(preset.stages)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-text-muted text-xs text-center py-4">
          No presets match the current filters.
        </p>
      )}
    </div>
  );
```

**Step 2: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 3: Commit**

```bash
git add packages/frontend/src/components/wizard/steps/ChoosePresetStep.tsx
git commit -m "feat(frontend): move Start from Scratch to top of preset step in wizard"
```

---

### Task 7: Wizard — remove Save Config, move Create Retriever to footer

**Files:**
- Modify: `packages/frontend/src/components/wizard/RetrieverWizard.tsx`
- Modify: `packages/frontend/src/components/wizard/steps/ReviewStep.tsx`

**Context:** Remove the "Save Config" button from ReviewStep. Move "Create Retriever" from ReviewStep's content area to the wizard's sticky footer bar (where Back/Next live), aligned right on step 5.

**Step 1: Remove Save Config from ReviewStep**

In `ReviewStep.tsx`, remove `onSave` from props interface (line 37) and destructuring (line 102).

Replace the actions section (lines 217-243):

```tsx
      {/* ---- Actions ---- */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={onSave}
          className="
            flex-1 py-2 text-sm rounded-lg border
            bg-bg-surface border-border text-text
            hover:bg-bg-hover
            transition-colors cursor-pointer
          "
        >
          Save Config
        </button>
        <button
          type="button"
          onClick={onCreate}
          className="
            flex-1 py-2 text-sm rounded-lg font-medium
            bg-accent text-bg
            hover:bg-accent-bright
            transition-colors cursor-pointer
          "
        >
          Create Retriever
        </button>
      </div>
```

With nothing — just remove the entire actions div. The `ReviewStep` no longer has any action buttons.

**Step 2: Move Create Retriever to wizard footer**

In `RetrieverWizard.tsx`, update the footer section (lines 432-451).

Replace:

```tsx
      {/* Footer: Back / Next buttons */}
      <div className="flex items-center justify-between p-4 border-t border-border">
        <button
          type="button"
          onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
          disabled={currentStep === 0}
          className="text-xs text-text-muted hover:text-text disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          &larr; Back
        </button>
        {currentStep < 5 && (
          <button
            type="button"
            onClick={() => setCurrentStep((s) => s + 1)}
            className="text-xs bg-accent text-bg px-3 py-1.5 rounded hover:bg-accent-bright font-medium transition-colors cursor-pointer"
          >
            Next &rarr;
          </button>
        )}
      </div>
```

With:

```tsx
      {/* Footer: Back / Next / Create buttons */}
      <div className="flex items-center justify-between p-4 border-t border-border">
        <button
          type="button"
          onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
          disabled={currentStep === 0}
          className="text-xs text-text-muted hover:text-text disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          &larr; Back
        </button>
        {currentStep < 5 ? (
          <button
            type="button"
            onClick={() => setCurrentStep((s) => s + 1)}
            className="text-xs bg-accent text-bg px-3 py-1.5 rounded hover:bg-accent-bright font-medium transition-colors cursor-pointer"
          >
            Next &rarr;
          </button>
        ) : (
          <button
            type="button"
            onClick={handleCreate}
            className="text-xs bg-accent text-bg px-3 py-1.5 rounded hover:bg-accent-bright font-medium transition-colors cursor-pointer"
          >
            Create Retriever
          </button>
        )}
      </div>
```

**Step 3: Remove handleSave and onSave from wizard**

In `RetrieverWizard.tsx`:
- Remove `onSave` from `RetrieverWizardProps` (line 35)
- Remove `onSave` from component destructuring (line 100)
- Remove the `handleSave` callback (lines 319-327)
- Remove `onSave={handleSave}` from `ReviewStep` usage (line 426)
- Remove `SavedConfig` interface (lines 40-44) if unused

**Step 4: Update page.tsx to remove onSave prop**

In `packages/frontend/src/app/retrievers/page.tsx`, remove the `onSave` prop from the `RetrieverWizard` usage (lines 252-255):

```tsx
                onSave={() => {
                  // No separate "save config" flow — wizard creates directly
                  setShowWizard(false);
                }}
```

**Step 5: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 6: Commit**

```bash
git add packages/frontend/src/components/wizard/RetrieverWizard.tsx packages/frontend/src/components/wizard/steps/ReviewStep.tsx packages/frontend/src/app/retrievers/page.tsx
git commit -m "feat(frontend): remove Save Config, move Create Retriever to wizard footer"
```

---

### Task 8: Sentence-style auto-naming for retrievers

**Files:**
- Modify: `packages/frontend/src/components/wizard/RetrieverWizard.tsx:78-91`

**Context:** Replace the `custom-{hash}` auto-naming with human-readable sentence-style names like "Dense search with reranking (k=5)".

**Step 1: Replace buildAutoName and shortHash**

In `RetrieverWizard.tsx`, replace lines 78-91:

```typescript
function buildAutoName(presetId: string | null, config: BuiltConfig): string {
  if (!presetId) return `custom-${shortHash(config)}`;

  // Check if the current config exactly matches the selected preset
  const preset = PRESET_REGISTRY.find((p) => p.id === presetId);
  if (!preset) return `custom-${shortHash(config)}`;

  return presetId;
}

function shortHash(config: BuiltConfig): string {
  const { name: _, ...withoutName } = config;
  return configHash(JSON.stringify(withoutName));
}
```

With:

```typescript
/**
 * Build a human-readable sentence-style name from config.
 * Priority: search strategy > query rewriting > refinement > k > chunking.
 */
function buildAutoName(presetId: string | null, config: BuiltConfig): string {
  // If a preset is selected and name matches, use the preset id
  if (presetId) {
    const preset = PRESET_REGISTRY.find((p) => p.id === presetId);
    if (preset) return presetId;
  }

  const parts: string[] = [];

  // Chunking prefix (only if non-default)
  const chunkSize = config.index?.chunkSize;
  const strategy = config.index?.strategy;
  if (strategy === "parent-child") {
    parts.push("Parent-child,");
  } else if (chunkSize && chunkSize !== 1000) {
    parts.push(`Recursive-${chunkSize},`);
  }

  // Search strategy (always — this is the lead)
  const searchStrategy = config.search?.strategy ?? "dense";
  const searchLabel =
    searchStrategy.charAt(0).toUpperCase() + searchStrategy.slice(1);
  parts.push(`${searchLabel} search`);

  // Query rewriting (if non-default)
  const queryStrategy = config.query?.strategy;
  if (queryStrategy && queryStrategy !== "identity") {
    const queryLabel = queryStrategy.replace(/_/g, " ");
    parts.push(`${queryLabel} rewriting`);
  }

  // Refinement
  const refinement = config.refinement;
  if (refinement && refinement.length > 0) {
    const types = refinement.map((s) => s.type);
    if (types.length === 1) {
      parts.push(`with ${types[0]}`);
    } else {
      parts.push(`with ${types.join(" + ")}`);
    }
  }

  // k value
  const k = config.k ?? 5;
  parts.push(`(k=${k})`);

  // Join with appropriate separators
  // "Dense search with reranking (k=5)"
  // "Parent-child, Hybrid search, HyDE rewriting, with rerank + threshold (k=10)"
  let name = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("with ") || part.startsWith("(")) {
      name += ` ${part}`;
    } else {
      name += `, ${part}`;
    }
  }

  return name;
}
```

**Step 2: Remove configHash import if unused**

Check if `configHash` from `@/lib/pipeline-storage` is still used elsewhere in the file. If not, remove the import (line 12):

```typescript
import { configHash } from "@/lib/pipeline-storage";
```

**Step 3: Build and verify**

Run: `pnpm -C packages/frontend build`
Expected: Compiles successfully.

**Step 4: Commit**

```bash
git add packages/frontend/src/components/wizard/RetrieverWizard.tsx
git commit -m "feat(frontend): sentence-style auto-naming for custom retrievers"
```

---

### Task 9: End-to-end verification

**Step 1: Full build**

Run: `pnpm build && pnpm typecheck && pnpm typecheck:backend && pnpm -C packages/frontend build`
Expected: All pass.

**Step 2: Run tests**

Run: `pnpm test && pnpm -C packages/backend test`
Expected: All tests pass.

**Step 3: Manual E2E checklist**

- [ ] Click a retriever in sidebar → accordion expands, NO delete buttons visible
- [ ] Click "View Full Config" → modal shows, Danger Zone at bottom
- [ ] Click "Delete Index" in Danger Zone → confirmation modal with impact summary
- [ ] Type "DELETE" → button enables, clicking deletes index
- [ ] For shared-index retriever: confirmation shows other retriever names
- [ ] After shared-index deletion: affected retrievers reset to "configuring"
- [ ] Switch between retrievers → NO flash of empty state
- [ ] Wizard step 1 → "Start from Scratch" at top, "or" divider, then presets
- [ ] Wizard step 6 → no "Save Config" button, "Create Retriever" in footer bar
- [ ] Create custom retriever → name is sentence-style (e.g., "Dense search with reranking (k=5)")
- [ ] Preset retriever → name is the preset id

**Step 4: Commit**

Only if fixes were needed during E2E testing.
