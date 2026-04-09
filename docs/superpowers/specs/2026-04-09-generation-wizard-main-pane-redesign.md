# Generation Wizard Main-Pane Redesign — Design Spec

**Date:** 2026-04-09
**Branch:** `va_generate_questions_improvements`
**Status:** Draft

## Problem

The `GenerationWizard` currently lives inside a 360px-wide sidebar on `/generate`. With four steps, dimension configuration, and a document priority table in the review step, the wizard is cramped — particularly step 4, where users need to see every document with its priority and allocated question count in a usable way. Users have to scroll heavily and cannot take in the whole configuration at once.

Three related problems show up alongside the layout:

1. **Global wizard config leaks across KBs.** The wizard config (real-world questions, dimensions, preferences, total questions) is persisted in `localStorage` under a single global key `rag-eval:unified-wizard-config`. Switching between KBs in the sidebar does not swap the wizard state, so company-specific dimensions and questions bleed across knowledge bases. The dimension auto-discover URL is also stored under a global key `rag-eval:dimension-discover-url` with the same bleed problem.

2. **Document priorities never persist in the UI.** The `documents.listByKb` Convex query does not return the `priority` field, and `packages/frontend/src/app/generate/page.tsx` hardcodes `priority: 3` for every document when passing them into the wizard. The Review step's priority dots appear to work (they fire `updatePriority` to Convex), but on reload the query returns no priority, the page hardcodes 3 again, and the UI is reset. This is an existing bug that surfaces whenever we redesign the review step.

## Goals

1. Move the `GenerationWizard` out of the sidebar into the main content pane where it has room to breathe. The sidebar must remain useful as a navigation surface.
2. Keep the existing 4-step flow (Real-World Qs → Dimensions → Preferences → Review) and the existing per-step component boundaries.
3. Persist wizard configuration **per-KB** in `localStorage` so each knowledge base remembers its own settings. Also fix `rag-eval:dimension-discover-url` to be per-KB.
4. Fix the priority persistence bug so the Review step's priority dots actually survive reloads.
5. Remain visually consistent with the rest of the application — same color tokens, typography, spacing, and interaction patterns as the experiments and retrievers pages.

## Non-Goals

- Document priority flow redesign (e.g., document content preview, priority as a separate wizard step). Explicitly deferred.
- Changes to the unified question generation algorithm, backend WorkPool, or strategy types.
- Rewriting any of the four step components (`WizardStepRealWorld`, `WizardStepDimensions`, `WizardStepPreferences`, `WizardStepReview`). Only their container markup + minor responsive layout tweaks change.
- Migrating priorities into localStorage. Priorities remain on the Convex `documents` record as the single source of truth.
- Adding new unit tests. The changes are purely presentational; no new logic warrants automated tests (see Testing section for justification).

## Design Overview

### Two page modes, one layout

The `/generate` page already has an internal mode state (`"browse" | "generate"`). We keep these two modes and redefine what each renders in the **main content area** (everything to the right of the sidebar):

| Mode | Main pane content |
|---|---|
| `browse` | Current layout — question list (center) + document viewer (right). Unchanged. |
| `generate` | The `GenerationWizard`, rendered as a single wide card that fills the main pane. |

The sidebar renders the same content in both modes: KB selector, primary action button, and dataset list. Only the main pane content changes.

### Sidebar treatment

The `+ New Generation` button is placed **above** the dataset list so it remains visible regardless of how long the dataset list grows:

```
┌────────────────────────────┐
│ Knowledge Base             │
│ [▸ docs-v2          ▾]     │
│                            │
│ [  + New Generation  ]     │   ← primary action, above list
│                            │
│ Datasets (3)               │
│ ┌────────────────────────┐ │
│ │ dataset-01             │ │
│ │ 42 questions · unified │ │
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ feb-baseline           │ │
│ │ 30 questions · unified │ │
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ dimension-test         │ │
│ │ 25 questions · unified │ │
│ └────────────────────────┘ │
└────────────────────────────┘
```

**Button states:**
- `browse` mode: dashed border, `text-accent` label, hover brightens. Uses `border border-dashed border-accent/40 text-accent hover:bg-accent/5`.
- `generate` mode: filled accent background, shows `● Creating new generation`. Uses `bg-accent text-bg font-medium`.
- KB has no documents: disabled (`opacity-40 cursor-not-allowed`) with tooltip `"Upload documents before generating"`.
- Org-wide active job exists: disabled with tooltip `"Only one generation at a time"`. Matches current behavior.

**Empty state:** If the KB has zero datasets and at least one document, the page auto-enters `generate` mode on first load (existing `initialModeSet` logic). The sidebar datasets section renders an empty state: `"No datasets yet"` in `text-text-dim`, no list items. The `+ New Generation` button is shown in its `generate`-mode filled state since we're already in that mode.

**Click behavior:**
- Clicking `+ New Generation` in `browse` mode switches to `generate` mode. Main pane swaps to the wizard card.
- Clicking any existing dataset in `browse` mode selects that dataset (existing behavior).
- Clicking any existing dataset while in `generate` mode switches back to `browse` mode with that dataset active.
- Clicking the wizard's `✕ Cancel` button returns to `browse` mode. If a `browseDatasetId` is set, it's preserved. Otherwise, the first dataset in `kbDatasets` (by `createdAt` descending, matching existing order) becomes active. If there are no datasets at all, mode stays in `generate` (there's nowhere to go).

The pre-existing dataset deletion, active-job banner, and URL/KB restore logic are unchanged.

### Wizard container

The wizard is rendered as a single card that fills the main pane. Layout:

- Outer container: full height of main pane (`h-full`), padded `p-6` with overflow allowed vertically.
- Inner card: `max-w-[840px] mx-auto border border-border rounded-lg bg-bg-elevated p-6 animate-fade-in`.
- The 840px cap keeps the wizard readable on ultra-wide monitors while still giving meaningful room on 13–15" laptops.

The wizard card has three regions stacked vertically:

1. **Header** — Title `New Question Generation` on the left (`text-sm font-semibold text-text`), `✕ Cancel` text button on the right (`text-xs text-text-dim hover:text-text`). Thin separator below (`border-b border-border pb-3 mb-4`).

2. **Stepper** — Four equal-width step indicators. Replaces the current pill-button stepper. Each step is a clickable button containing:
   - A 3px-tall progress bar (`h-[3px] rounded-sm`).
   - A centered label below (`text-[10px]`).
   - States: pending (`bg-border text-text-dim`), active (`bg-accent text-accent`), done (`bg-accent-dim text-accent`).
   - Clicking any step jumps to that step (matching current behavior).

3. **Step content** — Hosts `WizardStepRealWorld`, `WizardStepDimensions`, `WizardStepPreferences`, or `WizardStepReview`. `min-h-[420px]` keeps the container from collapsing on short steps like step 3.

### Per-step layout refinements

Since every step now has much more horizontal room, the step components get minor layout upgrades (not rewrites). No props, state, or callback shapes change. All refinements are applied inside the existing step component files.

- **Step 1 — Real-World Questions:** The `<textarea>` grows to `min-h-[200px]`. The "N questions added" counter moves from the top to directly below the textarea.
- **Step 2 — Dimensions:** Dimension cards switch from a stacked vertical list to a responsive grid: `grid grid-cols-1 md:grid-cols-2 gap-3`. Each card keeps its current content (name, description, value chips, remove button). The `+ Add dimension` and `Auto-discover` actions stay at the top-right of the section. The auto-discover URL input keeps its current behavior, but its persisted value (see "Per-KB localStorage persistence") is per-KB.
- **Step 3 — Preferences:** The three inputs (question types, tone, focus areas) switch from a stacked single-column layout to `grid grid-cols-1 md:grid-cols-2 gap-4`, with focus areas spanning the full row below. This is a committed change — not "optional".
- **Step 4 — Review:** Summary cards stay (3-column grid). Total-questions slider stays. The document priority table gets wrapped in a `max-h-[360px] overflow-y-auto` scrollable container. The `<thead>` uses `sticky top-0 bg-bg-secondary z-10` so column headers remain visible while scrolling. No column layout changes needed — the extra main-pane width removes the need for truncation.

### Per-KB localStorage persistence

Both global keys are replaced with per-KB schemes:

```ts
const WIZARD_CONFIG_PREFIX = "rag-eval:unified-wizard-config:";
const DISCOVER_URL_PREFIX = "rag-eval:dimension-discover-url:";
const wizardKey = (kbId: string) => `${WIZARD_CONFIG_PREFIX}${kbId}`;
const discoverUrlKey = (kbId: string) => `${DISCOVER_URL_PREFIX}${kbId}`;
```

**Behavior:**
- `GenerationWizard` accepts the `kbId` prop (already does). On mount, and whenever `kbId` changes, it reads from `localStorage.getItem(wizardKey(kbId))`. If no entry exists, it falls back to `DEFAULT_CONFIG`. The `useState` initializer still runs once; the `useEffect` watching `kbId` handles subsequent switches.
- On every config change, it writes to `localStorage.setItem(wizardKey(kbId), JSON.stringify(config))`.
- `WizardStepDimensions` reads/writes `discoverUrlKey(kbId)` instead of the global key. Since the step already has `kbId` context via the wizard (currently not passed as a prop), we thread `kbId` through as a new prop on `WizardStepDimensions`.

**One-time migration:** On first mount after the upgrade, `GenerationWizard` checks for the old global keys:
- If `localStorage.getItem("rag-eval:unified-wizard-config")` exists **and** `localStorage.getItem(wizardKey(kbId))` does NOT exist, copy the old value into the KB's entry. Then delete the old global key.
- Same logic for `rag-eval:dimension-discover-url` → `discoverUrlKey(kbId)`.

The "only seed if the KB's entry doesn't already exist" check prevents the migration from clobbering a user who has already started using the new per-KB storage (e.g., across branch switches).

The migration only needs to run once per browser session, since after the first run the old keys are deleted. Using a simple `useEffect` that runs once on mount is sufficient — no need for a separate "migration ran" flag.

This is a client-only change. No backend or schema modifications for the localStorage part.

### Document priority persistence fix

Two small changes to make priority dots actually survive reloads:

1. **Backend — `packages/backend/convex/crud/documents.ts`:** The `listByKb` query's return object is extended to include `priority: doc.priority`. Schema already has the field (from the earlier Phase 2 work); we just need to expose it in the listing response.

2. **Frontend — `packages/frontend/src/app/generate/page.tsx`:** The inline `documents.map` that constructs the wizard's `documents` prop stops hardcoding `priority: 3` and reads `d.priority ?? 3` from the query result (with `3` as a safe default in case the field is nullable on older records).

With those two changes, the Review step's priority dots reflect the persisted value on reload, and editing them updates Convex and reflects back immediately via the reactive query.

## Component Changes

### Files modified

| File | Change |
|---|---|
| `packages/backend/convex/crud/documents.ts` | `listByKb` query returns `priority` field. |
| `packages/frontend/src/app/generate/page.tsx` | Remove the sidebar `Generation Config` block. Add `+ New Generation` button above the dataset list (above the "Datasets (N)" section). Render `<GenerationWizard>` inside the main pane when `mode === "generate"`. Add `handleCancelGeneration` that falls back to the previously-selected dataset or the first dataset. Stop hardcoding `priority: 3`. |
| `packages/frontend/src/components/GenerationWizard.tsx` | Replace single-column sidebar layout with the wizard card layout (header + stepper + content). Accept `onCancel` prop. Switch localStorage key from global to per-KB. Add one-time migration for both old keys (wizard config + discover URL). Pass `kbId` through to `WizardStepDimensions`. |
| `packages/frontend/src/components/WizardStepRealWorld.tsx` | Textarea grows to `min-h-[200px]`. Counter moves below. |
| `packages/frontend/src/components/WizardStepDimensions.tsx` | Switch dimension list to `grid grid-cols-1 lg:grid-cols-2 gap-3`. Accept `kbId` prop. Switch localStorage read/write to `discoverUrlKey(kbId)`. |
| `packages/frontend/src/components/WizardStepPreferences.tsx` | Two-column layout for preference inputs on `lg:` and up. |
| `packages/frontend/src/components/WizardStepReview.tsx` | Wrap priority table in `max-h-[360px] overflow-y-auto` with sticky thead. No prop or logic changes. |

### Files created

None. This is a layout refactor and a small backend query enrichment.

### Files deleted

None.

## Data flow

The high-level data flow does not change. `GenerationWizard` still:

1. Reads `documents` as a prop (now with real priorities).
2. Owns `config` state + localStorage persistence (now per-KB).
3. Calls `api.crud.documents.updatePriority` when the user adjusts priorities.
4. Calls `api.generation.orchestration.startGeneration` on submit.
5. Calls `onGenerated` callback which the parent uses to switch into browse mode.

New: `GenerationWizard` accepts an `onCancel` prop. The parent page (`/generate`) implements `handleCancelGeneration` which switches `mode` to `"browse"` and restores a reasonable `browseDatasetId` (see "Click behavior" above).

The parent page already has the mode-switching infrastructure (`mode`, `setMode`, `browseDatasetId`, `setBrowseDatasetId`, `initialModeSet`, `activeJob` detection, restore-active-job effect). We reuse it directly — no new top-level state.

## Behavior in edge cases

- **localStorage unavailable or corrupted JSON:** Read/write blocks are wrapped in try/catch (as today). On read failure, `DEFAULT_CONFIG` is used. On write failure, silent.
- **KB with no documents:** `+ New Generation` button is disabled with tooltip. If the user is already in `generate` mode when the last document is deleted, the wizard stays visible but its own "Generate Questions" button disables with a message.
- **Org-wide active generation job:** `+ New Generation` is disabled. If the user is already in the wizard when a job becomes active (e.g., another team member starts one), the wizard stays open and the user can still navigate steps and edit configuration, but the final "Generate Questions" button in step 4 is disabled with the same `"Only one generation at a time"` tooltip. This matches the existing `disabled` / `disabledReason` plumbing.
- **User clicks Cancel mid-wizard:** Config state is preserved in localStorage (not cleared). Mode returns to `browse`. A subsequent `+ New Generation` click restores the wizard with the same config.
- **KB switched mid-wizard:** The KB switch is respected immediately. The wizard reloads config from the new KB's stored entry (or defaults). Any unsaved step-local state (e.g., a draft line in the Real-World Questions textarea that hasn't triggered `onChange` yet) is lost. This is acceptable because `onChange` fires on every keystroke for the relevant inputs.
- **Generation completes while user is in wizard:** Existing behavior — the page's `useEffect` watching `job?.status` switches `mode` to `"browse"` and sets `browseDatasetId` to the just-created dataset. The wizard unmounts.
- **Migration from old global key during an active KB switch:** The migration reads and deletes the old global key only on first `useEffect` run after mount. Subsequent KB switches see the old key already gone and skip migration. No race between migration and KB switch handling.

## Styling tokens used

All existing tokens from `globals.css`:
- Backgrounds: `bg-bg`, `bg-bg-elevated`, `bg-bg-surface`, `bg-bg-hover`
- Borders: `border-border`, `border-border-bright`
- Text: `text-text`, `text-text-muted`, `text-text-dim`
- Accent: `text-accent`, `text-accent-bright`, `bg-accent`, `bg-accent-dim`, `bg-accent/5`, `border-accent/40`
- Animations: `animate-fade-in`
- Typography: JetBrains Mono (inherited from body), size 13px base (inherited)

No new tokens, no new CSS, no new animations.

## Testing

**Why no new unit tests:** The changes are purely presentational — they move an existing component from one container to another, change localStorage key prefixes, and add responsive grid layouts. No logic is added or changed. The existing backend tests in `packages/backend/tests/` already cover the Convex mutations/queries the wizard calls (`updatePriority`, `startGeneration`, `listByKb`). Adding a frontend test for the key scheme would test mocked `localStorage` wrappers rather than real behavior.

**Manual verification checklist:**

1. Open `/generate`, select a KB with documents. Verify the sidebar shows `+ New Generation` as a dashed outline button above the datasets section.
2. Click `+ New Generation`. Verify: main pane swaps to the wizard card; sidebar button becomes the filled "creating" state; wizard shows step 1 with a roomy textarea.
3. Fill in some real-world questions, click Next, add a dimension, verify dimensions render in a 2-column grid on a wide window. Click Next. Adjust preferences in 2-column layout. Click Next.
4. On step 4, verify the summary cards render, the priority dots work (click to change), the slider updates allocations, and the priority table scrolls vertically with a sticky header when there are many documents.
5. Change a document's priority, reload the page, return to step 4. Verify the priority persists (confirms the backend fix).
6. Click `✕ Cancel`. Verify the page returns to browse mode and the previously-selected dataset is active (or the first dataset if none was selected).
7. Click `+ New Generation` again. Verify the config from step 3 is still there (localStorage persistence).
8. Switch to a different KB in the sidebar. Verify the wizard state swaps — if that KB has no stored config, defaults are shown.
9. Switch back to the first KB. Verify the earlier config returns.
10. In DevTools, set `localStorage.setItem("rag-eval:unified-wizard-config", JSON.stringify({ ... })`), reload. Verify the old key is migrated into the current KB's entry and the old key is deleted.
11. In DevTools, set `localStorage.setItem("rag-eval:dimension-discover-url", "https://example.com")`, reload, open the wizard dimensions step. Verify the URL shows up in the auto-discover input.
12. Start a generation, verify the banner shows. Open the wizard on a different KB — verify the "Generate" button is disabled with the tooltip but the wizard itself is fully navigable.
13. With zero datasets in a KB, open the page. Verify it auto-enters generate mode, the sidebar shows "No datasets yet", and the wizard is displayed.
14. Run `pnpm -C packages/frontend build` — verify TypeScript compiles with no errors.
15. Run `pnpm -C packages/backend test` — verify existing backend tests still pass with the `listByKb` priority addition.

## Open questions

None.
