# Retriever UX Improvements — Design Document

**Date:** 2026-03-14
**Status:** Approved
**Scope:** Delete confirmation modals, sidebar cleanup, View Full Config danger zone, wizard improvements, auto-naming, selection flash fix

---

## 1. Confirmation Modal Component

A reusable `ConfirmDeleteModal` component for both "Delete Retriever" and "Delete Index" actions.

**Structure:**
- **Header:** "Delete Retriever" or "Delete Index"
- **Impact summary box:**
  - Retriever name and status
  - Whether the index is shared or unique
  - If shared: list the other retriever names that share it
  - Clear outcome statement (what will happen)
- **Warning highlight (contextual):**
  - **Delete Retriever + unique index:** Red callout — "The index will also be permanently deleted since no other retriever uses it."
  - **Delete Retriever + shared index:** Green callout — "The index will NOT be deleted. It is still used by: [retriever names]."
  - **Delete Index (shared):** Red callout — "This will also affect [N] other retrievers: [names]. They will need to be re-indexed."
  - **Delete Index (unique):** Simple warning — "This retriever will reset to 'configuring' and need re-indexing."
- **Typed confirmation:** Text input with placeholder "Type DELETE to confirm"
- **Action button:** Disabled until input === "DELETE". Red styled button.

**Data requirement:** The modal needs the list of retrievers sharing the same index. The sidebar already fetches all retrievers for the KB — pass sharing info down.

**Backend change:** The `deleteIndex` mutation currently throws an error if other retrievers share the index. Change it to allow deletion and auto-reset all affected retrievers to "configuring" status.

---

## 2. Sidebar Accordion Cleanup

**Current:** Expanded accordion shows config summary + all action buttons (Start Indexing, Cancel, Delete Index, Delete Retriever) + "View Full Config" link. Cramped layout.

**New:** Accordion becomes info-only + non-destructive actions:
- 4-line config summary (unchanged)
- Status-specific non-destructive actions:
  - `configuring`: "Start Indexing" button
  - `indexing`: spinner + progress + "Cancel" button
  - `ready`: no action buttons (just config summary)
  - `error`: "Retry Indexing" button + error message
- "View Full Config" link at bottom (styled consistently)

All destructive actions (Delete Index, Delete Retriever) move to the View Full Config modal.

---

## 3. View Full Config Modal — Danger Zone

**Current modal:** 4 config sections (Index, Query, Search, Refinement) + retriever info header.

**Add Danger Zone at bottom:**

```
┌─────────────────────────────────────────┐
│  Retriever Configuration          [✕]   │
├─────────────────────────────────────────┤
│  Name / Status / Created info           │
├─────────────────────────────────────────┤
│  ▸ Index Configuration                  │
│  ▸ Query Configuration                  │
│  ▸ Search Configuration                 │
│  ▸ Refinement Configuration             │
├─────────────────────────────────────────┤
│  ⚠ Danger Zone                          │
│  ┌─────────────────────────────────────┐│
│  │ Delete Index                    [⊘] ││
│  │ Resets retriever to configuring     ││
│  └─────────────────────────────────────┘│
│  ┌─────────────────────────────────────┐│
│  │ Delete Retriever                [⊘] ││
│  │ Permanently removes this retriever  ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

- Red-bordered section at the very bottom
- Each action has a description and button
- Clicking opens the `ConfirmDeleteModal` on top
- "Delete Index" only shown when retriever status is "ready" or "error"

---

## 4. Wizard — Create Retriever Button + Save Config Removal

**Current:** Step 6 (Review) has "Save Config" and "Create Retriever" side-by-side in step content. Back/Next at bottom bar, Next hidden on step 6.

**Changes:**
- Remove "Save Config" button entirely (drop localStorage preset saving)
- Move "Create Retriever" to the sticky bottom bar, right-aligned where Next normally appears
- On step 6: `[Back]` on left, `[Create Retriever]` on right (accent/green style)
- Remove `handleSave` and related localStorage logic from RetrieverWizard

---

## 5. Sentence-Style Auto-Naming

Generate human-readable names from config. Algorithm priority:

1. **Search strategy** leads: "Dense search", "Hybrid search", "Sparse search"
2. **Query rewriting** if non-default (not "identity"): ", HyDE rewriting" or ", multi-query"
3. **Refinement** if present: "with reranking", "with threshold filtering", "with reranking + threshold"
4. **k value** always appended: "(k=5)"
5. **Chunking** only if non-default: prefix "Parent-child" or note non-standard chunk size

**Examples:**
- `Dense search with reranking (k=5)`
- `Hybrid search, HyDE rewriting (k=10)`
- `Parent-child, dense search with reranking + threshold (k=5)`
- `Dense search (k=5)` — simplest case

User can still override with a custom name. Auto-name only applies when not manually edited.

---

## 6. Fix Retriever Selection Flash

**Root cause:** `page.tsx:205` — condition `selectedRetrieverId && selectedRetriever` is false during the async gap when Convex `useQuery` is loading the new retriever's data. The empty state ("No retriever selected") flashes briefly.

**Fix:** Add a "loading" rendering state:

```tsx
{selectedRetrieverId && selectedRetriever ? (
  // Tab content (normal case)
) : selectedRetrieverId && !selectedRetriever ? (
  // Loading state — keep tab bar visible, show spinner in content area
) : (
  <EmptyState />  // Only when truly no retriever selected
)}
```

This prevents the empty state flash when switching between retrievers.

---

## 7. Wizard Step 1 — Move "Start from Scratch" to Top

**Current:** Preset cards shown first, "Start from Scratch" at the bottom — hidden without scrolling.

**Change:** Move "Start from Scratch" button to the top of the step, keeping its existing styling. Add a horizontal divider with centered "or" text between it and the preset section. Everything else in the preset step stays as-is.

```
┌─────────────────────────────────────────┐
│  [  Start from Scratch  ]               │
│  (existing styling preserved)           │
├──────────── or ─────────────────────────┤
│  (existing preset filters + cards)      │
└─────────────────────────────────────────┘
```

---

## Files Affected

**Frontend (modify):**
- `packages/frontend/src/app/retrievers/page.tsx` — selection flash fix
- `packages/frontend/src/components/RetrieverListItem.tsx` — remove delete buttons from accordion
- `packages/frontend/src/components/RetrieverSidebar.tsx` — pass sharing info, remove delete handlers from item props
- `packages/frontend/src/components/RetrieverDetailModal.tsx` — add Danger Zone section
- `packages/frontend/src/components/wizard/RetrieverWizard.tsx` — naming, save removal, create button move
- `packages/frontend/src/components/wizard/steps/ReviewStep.tsx` — remove save button, move create
- `packages/frontend/src/components/wizard/steps/ChoosePresetStep.tsx` — move Start from Scratch to top
- `packages/frontend/src/lib/pipeline-storage.ts` — update naming logic

**Frontend (create):**
- `packages/frontend/src/components/ConfirmDeleteModal.tsx` — new reusable confirmation modal

**Backend (modify):**
- `packages/backend/convex/crud/retrievers.ts` — update `deleteIndex` to allow shared index deletion with auto-reset
