# Always-Visible Pipeline Config Banners — Design Document

**Date:** 2026-03-14
**Status:** Approved

## Problem

Pipeline configuration is invisible until a query is run. Users can't see what chunking, query rewriting, search, or refinement settings a retriever uses until they execute the pipeline. Additionally, the sidebar accordion is broken — clicking a retriever doesn't expand to show its config summary due to a double-toggle bug.

## Design

### Sidebar Fix

**Bug:** `RetrieverListItem.handleHeaderClick` calls both `onSelect()` and `onToggleExpand()`. The sidebar's `handleSelect` already toggles `expandedId` via functional state update. Two toggles cancel out.

**Fix:** Change `handleHeaderClick` to only call `onSelect()`. The sidebar's `handleSelect` handles both selection and expansion toggling.

**Result:** Clicking a retriever expands the accordion showing the 4-line config summary (Index/Query/Search/Refine) and "View Full Config" button. Clicking again collapses it.

---

### Tab-Specific Static Config Boxes

Each tab shows only its own stage configuration in a bordered box. Config is always visible regardless of retriever status or whether a query has been run.

**Shared styling:** `bg-bg-surface border border-border rounded-lg p-2 text-[11px]` with dim labels and muted values.

#### Index Tab

Compact config box at the top of the three-panel layout:

```
┌──────────────────────────────────────────────────────────┐
│ Index Configuration                                       │
│ Strategy: recursive · Chunk: 1000/200 · Embed: 3-small   │
└──────────────────────────────────────────────────────────┘
┌──────────┬──────────────────────┬─────────────────────────┐
│ Doc List │  Document Viewer     │  Chunk Inspector        │
```

Values extracted from `retriever.retrieverConfig` via `resolveConfig()`.

#### Query+Search Tab

Each panel gets a static config box in its header area, always visible before and after running:

- **Left panel (Query Rewriting):** Box showing `Strategy: <strategy-name>`. After running, the dynamic rewrite results (radio options, HyDE answer) and latency appear below the box.
- **Right panel (Search Results):** Box showing `Strategy: <strategy> · k=<k>` (plus weights/fusion for hybrid). After running, latency moves to the result header line (e.g., "Showing: fused results (5 chunks) · 234ms"), not inside the static config box.

#### Refine Tab

Horizontal pipeline chips at top, always visible:

```
┌─ Refinement Pipeline ────────────────────────────────────┐
│ [rerank] → [threshold · min=0.5] → [dedup]              │
└──────────────────────────────────────────────────────────┘
```

If no refinement stages: "No refinement stages configured."

After running, the dynamic stage stepper and per-stage detail appear below.

---

### Latency Placement

Latency is per-run data, not static config. It moves out of config boxes and into the dynamic result areas:
- Query rewriting: latency shown below the rewrite results
- Search results: latency in the result count line
- Refinement: latency in per-stage info banners (already correct)

---

## Files to Modify

| File | Change |
|------|--------|
| `RetrieverListItem.tsx` | Fix `handleHeaderClick` — only call `onSelect()` |
| `RetrieverSidebar.tsx` | Fix `handleSelect` — always expand on select (don't toggle) |
| `IndexTab.tsx` | Add static index config box at top |
| `QuerySearchTab.tsx` | Add static config boxes in panel headers, move latency to results |
| `RefineTab.tsx` | Add static refinement pipeline chips, show before running |

All config extraction uses existing `resolveConfig()` from `packages/frontend/src/lib/pipeline-types.ts`.
