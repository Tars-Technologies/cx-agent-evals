# Generate Page Layout Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the generate page layout to match the KB page pattern — move sidebar controls to a top bar, make the question list a resizable primary sidebar, and convert the generation wizard to a modal.

**Architecture:** Three independent changes: (1) top bar with KB dropdown + dataset dropdown + New Generation button, (2) wrap GenerationWizard in a modal overlay, (3) make QuestionList the primary resizable sidebar with search. The existing `ResizablePanel` component is reused. No backend changes.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Convex reactive queries.

---

## File Map

### Modified Files

| File | Responsibility |
|------|---------------|
| `packages/frontend/src/app/generate/page.tsx` | Main layout restructure: remove left sidebar, add top bar, wrap QuestionList in ResizablePanel, show wizard as modal |
| `packages/frontend/src/components/QuestionList.tsx` | Add search input at top, remove document grouping headers |
| `packages/frontend/src/components/GenerationWizard.tsx` | No internal changes — just props adjustment for modal wrapping |

### No New Files

The modal wrapper is inline in `page.tsx` (same pattern as `CreateKBModal` usage in KB page — a `showWizardModal` state + conditional render). `ResizablePanel` is already a reusable component.

---

## Verification Approach

**TypeScript check:** `pnpm -C packages/frontend build`
No backend changes, no tests to update (frontend has no unit tests currently).

---

## Task 1: Top bar — KB dropdown + dataset dropdown + New Generation button

**Files:**
- Modify: `packages/frontend/src/app/generate/page.tsx:256-410`

This is the biggest layout change. We remove the entire left sidebar (`w-[360px]`) and replace it with a compact top bar matching the KB page pattern.

- [ ] **Step 1: Read current page.tsx layout**

Read `packages/frontend/src/app/generate/page.tsx` lines 256–488 to understand the full JSX structure.

- [ ] **Step 2: Replace the left sidebar with a top bar**

Remove the entire left sidebar div (lines 282–410, the `w-[360px]` div containing KB Selector, New Generation button, Datasets section, and error displays).

In its place, add a top bar immediately after the GenerationBanner (and before the `flex flex-1 overflow-hidden` div). The top bar follows the KB page pattern:

```tsx
      {/* ── Controls Bar ── */}
      <div className="border-b border-border bg-bg-elevated px-6 py-3">
        <div className="flex items-center gap-4">
          {/* KB dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">
              KB
            </label>
            <KBDropdown selectedKbId={selectedKbId} onSelect={setSelectedKbId} />
          </div>

          {/* Dataset dropdown */}
          {selectedKbId && kbDatasets !== undefined && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">
                Dataset
              </label>
              <select
                value={browseDatasetId ?? ""}
                onChange={(e) => {
                  if (e.target.value) {
                    const id = e.target.value as Id<"datasets">;
                    setBrowseDatasetId(id);
                    setSelectedQuestion(null);
                    setSelectedDocId(null);
                    setMode("browse");
                  }
                }}
                className="max-w-xs bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none"
              >
                <option value="">Select a dataset...</option>
                {kbDatasets.map((ds) => (
                  <option key={ds._id} value={ds._id}>
                    {ds.name} ({ds.questionCount} Qs{activeJob?.datasetId === ds._id ? " — generating" : ""})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* New Generation button */}
          {selectedKbId && (
            <button
              onClick={() => setShowWizardModal(true)}
              disabled={!hasDocuments || !!activeJob}
              title={
                !hasDocuments
                  ? "Upload documents before generating"
                  : activeJob
                    ? "Only one generation at a time"
                    : undefined
              }
              className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + New Generation
            </button>
          )}
        </div>
      </div>
```

- [ ] **Step 3: Add `showWizardModal` state**

Near the other state declarations (around line 70), add:

```typescript
const [showWizardModal, setShowWizardModal] = useState(false);
```

- [ ] **Step 4: Update the main content area**

The main content area (the `flex flex-1 overflow-hidden` div) no longer has the `mode === "generate"` branch showing the wizard inline. Instead, it always shows the questions sidebar + document viewer layout:

```tsx
      <div className="flex flex-1 overflow-hidden max-w-full">
        {/* Left: question list (resizable) */}
        {(displayQuestions.length > 0 || displayGenerating) && (
          <ResizablePanel storageKey="generate-questions" defaultWidth={320} minWidth={200} maxWidth={600}>
            <div className="h-full border-r border-border bg-bg">
              <QuestionList
                questions={displayQuestions}
                selectedIndex={selectedQuestion}
                onSelect={setSelectedQuestion}
                generating={displayGenerating}
                totalDone={displayTotalDone}
                phaseStatus={displayPhaseStatus}
                realWorldCount={
                  !displayGenerating
                    ? displayQuestions.filter((q) => q.source === "real-world").length
                    : undefined
                }
              />
            </div>
          </ResizablePanel>
        )}

        {/* Right: document viewer */}
        <div className="flex-1 min-w-0 bg-bg overflow-hidden">
          <DocumentViewer doc={selectedDoc} question={selectedQ} />
        </div>
      </div>
```

- [ ] **Step 5: Add the wizard modal**

After the main content area (and before the delete dataset modal), add the wizard modal:

```tsx
      {/* Generation Wizard Modal */}
      {showWizardModal && selectedKbId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowWizardModal(false)} />
          <div className="relative bg-bg-elevated border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] overflow-y-auto animate-fade-in">
            <GenerationWizard
              kbId={selectedKbId}
              documents={(documentsData ?? []).map((d) => ({
                _id: d._id as string,
                docId: d.docId,
                title: d.title,
                priority: d.priority ?? 3,
              }))}
              generating={generating}
              disabledReason={activeJob ? "Only one generation at a time" : undefined}
              onGenerated={(dsId, jId) => {
                setDatasetId(dsId);
                setJobId(jId);
                setBrowseDatasetId(dsId);
                setMode("browse");
                setShowWizardModal(false);
              }}
              onError={(err) => {
                setGenError(err);
                setShowWizardModal(false);
              }}
              onCancel={() => setShowWizardModal(false)}
            />
          </div>
        </div>
      )}
```

- [ ] **Step 6: Add `ResizablePanel` import**

Add to imports at the top of the file:

```typescript
import { ResizablePanel } from "@/components/ResizablePanel";
```

- [ ] **Step 7: Clean up mode handling**

The `mode` state is still needed (for `displayQuestions` / `displayGenerating` / `displayPhaseStatus` resolution). However, several things become dead code:

1. **Remove `handleCancelGeneration`** (line 178) — wizard cancel now just closes the modal.
2. **Remove the `kbDatasets` useEffect** (lines 87–96) that auto-sets `mode("generate")` when datasets are empty — with the wizard in a modal, this effect is dead code (mode no longer controls the main layout branch).
3. **Update `handleReset`** — remove `setMode("browse")` since the main layout always shows the browse view now.
4. **Keep** the `displayQuestions` derivation (line 198), the `browsingActiveDataset` logic (line 209), the auto-switch-to-browse effect (line 243), and `mode` references in those derivations — they still correctly distinguish "looking at the dataset being generated" from "browsing a finished dataset".

- [ ] **Step 8: Move error displays**

The `genError` and `job?.error` displays that were in the sidebar need to move. Add them as toast notifications at the bottom-right (same pattern as the delete error toast already in the file):

```tsx
      {/* Generation error toast */}
      {(genError || job?.error) && (
        <div className="fixed bottom-4 right-4 z-[70] max-w-md bg-bg-elevated border border-red-500/30 rounded-lg p-3 shadow-2xl animate-fade-in">
          <p className="text-xs text-red-400">{genError || job?.error}</p>
          <button
            onClick={() => setGenError(null)}
            className="text-[10px] text-text-dim mt-1 hover:text-text"
          >
            Dismiss
          </button>
        </div>
      )}
```

- [ ] **Step 9: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds. If there are unused import/variable warnings, clean them up.

- [ ] **Step 10: Commit**

```bash
git add packages/frontend/src/app/generate/page.tsx
git commit -m "feat(frontend): restructure generate page — top bar + wizard modal

Moves KB selector, dataset dropdown, and New Generation button to a
top bar matching the KB page pattern. Wizard opens as a modal.
QuestionList becomes the primary left panel with ResizablePanel."
```

---

## Task 2: QuestionList — add search input

**Files:**
- Modify: `packages/frontend/src/components/QuestionList.tsx:1-143`

- [ ] **Step 1: Read the current QuestionList**

Read `packages/frontend/src/components/QuestionList.tsx` to understand the full component.

- [ ] **Step 2: Add search state and filter logic**

Add a `searchQuery` state inside the component:

```typescript
const [searchQuery, setSearchQuery] = useState("");
```

Add import of `useState`:

```typescript
import { useState } from "react";
```

Filter questions by the search query. Add after the existing `grouped` Map construction:

```typescript
  // Filter questions by search query
  const filteredQuestions = searchQuery
    ? questions.filter((q) =>
        q.query.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : questions;
```

Then update the `grouped` Map to use `filteredQuestions` instead of `questions`:

```typescript
  const grouped = new Map<string, { question: GeneratedQuestion; index: number }[]>();
  filteredQuestions.forEach((q, i) => {
    // Use original index for selection (so selecting a filtered result selects the right question)
    const originalIndex = questions.indexOf(q);
    const list = grouped.get(q.docId) || [];
    list.push({ question: q, index: originalIndex });
    grouped.set(q.docId, list);
  });
```

- [ ] **Step 3: Add search input to the header area**

After the existing header div (the one with "Questions" label and count), add a search input:

```tsx
      {/* Search */}
      {questions.length > 0 && (
        <div className="px-3 py-2 border-b border-border">
          <input
            type="text"
            placeholder="Search questions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-xs text-text placeholder:text-text-dim focus:border-accent outline-none"
          />
        </div>
      )}
```

- [ ] **Step 4: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/QuestionList.tsx
git commit -m "feat(frontend): add search input to QuestionList

Filters questions by text as user types. Uses original indices
for selection so filtered results map to correct questions."
```

---

## Task 3: Visual polish and consistency pass

**Files:**
- Modify: `packages/frontend/src/app/generate/page.tsx` (minor adjustments)
- Modify: `packages/frontend/src/components/QuestionList.tsx` (minor adjustments)

This task handles edge cases and visual consistency with the KB page.

- [ ] **Step 1: Handle empty state when no dataset is selected**

In `page.tsx`, when no dataset is selected and the main area would be empty, show a placeholder:

In the main content area, if there are no questions and not generating, show an empty state:

```tsx
        {/* Left: question list OR empty state */}
        {displayQuestions.length === 0 && !displayGenerating ? (
          <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
            {selectedKbId
              ? browseDatasetId
                ? "No questions in this dataset"
                : "Select a dataset to view questions"
              : "Select a knowledge base to get started"}
          </div>
        ) : (
          <>
            {/* ResizablePanel + QuestionList ... */}
            {/* DocumentViewer ... */}
          </>
        )}
```

- [ ] **Step 2: Handle the "auto-select first dataset" behavior**

When a KB is selected and has datasets but no dataset is selected yet, auto-select the first one. Add an effect:

```typescript
  // Auto-select first dataset when KB changes and datasets load
  useEffect(() => {
    if (kbDatasets && kbDatasets.length > 0 && !browseDatasetId) {
      setBrowseDatasetId(kbDatasets[0]._id);
    }
  }, [kbDatasets, browseDatasetId]);
```

- [ ] **Step 3: Ensure wizard modal closes on Escape**

Add an effect for Escape key handling:

```typescript
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && showWizardModal) {
        setShowWizardModal(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showWizardModal]);
```

- [ ] **Step 4: Ensure the delete dataset button is accessible**

The delete button was previously in the sidebar dataset list. Since datasets are now in a dropdown, we need a way to delete them. Add a small delete/trash icon button next to the dataset dropdown, visible only when a dataset is selected:

```tsx
          {browseDatasetId && (
            <button
              onClick={() => {
                const ds = kbDatasets?.find((d) => d._id === browseDatasetId);
                if (ds) {
                  setDeleteTarget({
                    id: ds._id,
                    name: ds.name,
                    questionCount: ds.questionCount,
                    strategy: ds.strategy,
                  });
                  setDeleteError(null);
                }
              }}
              className="p-1.5 text-text-dim hover:text-red-400 transition-colors"
              title="Delete dataset"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
            </button>
          )}
```

Place this immediately after the dataset `<select>`, inside the same flex container.

- [ ] **Step 5: Clean up unused code**

Remove:
- The `mode === "generate"` ternary branch in the main content JSX (wizard is now modal-only) — should already be gone from Task 1
- The `initialModeSet` ref and its associated logic (no longer needed since the `kbDatasets` auto-mode effect was removed in Task 1 Step 7)
- Any unused imports

Keep:
- `mode` state (still used for `displayQuestions` / `displayGenerating` / `displayPhaseStatus`)
- The auto-switch-to-browse effect (line 243) and auto-restore active job effect (line 106)

- [ ] **Step 6: TypeScript check**

Run: `pnpm -C packages/frontend build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/app/generate/page.tsx packages/frontend/src/components/QuestionList.tsx
git commit -m "feat(frontend): polish generate page — empty states, delete, escape

Adds empty state messages, auto-select first dataset, Escape to
close wizard modal, dataset delete from top bar, cleanup unused code."
```

---

## Summary

| Task | Files | Key change |
|------|-------|------------|
| 1. Top bar + wizard modal + resizable sidebar | `page.tsx` | Remove sidebar, add top bar, modal wizard, ResizablePanel |
| 2. QuestionList search | `QuestionList.tsx` | Search input, filtered question display |
| 3. Visual polish | `page.tsx`, `QuestionList.tsx` | Empty states, auto-select, Escape, delete button, cleanup |

Total: ~3 commits across 2 files. No new files, no backend changes.
