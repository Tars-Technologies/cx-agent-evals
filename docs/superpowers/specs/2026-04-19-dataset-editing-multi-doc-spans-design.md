# Dataset Editing & Multi-Document Spans Design

**Date:** 2026-04-19
**Branch:** `va_manually_edit_questions_dataset`
**Status:** Approved

## Problem

The generate module serves a broader purpose than just generation — it's about curating evaluation datasets. Currently:
1. The module is named "Generate" but is really about dataset management
2. There is no way to manually edit generated questions or their character spans
3. Ground truth spans are locked to a single source document per question, but real-world questions often have relevant passages across multiple documents
4. The question list groups by document, which doesn't fit when spans cross documents

## Scope

| In scope | Out of scope |
|----------|-------------|
| Rename Generate → Dataset (nav, URL, route) | Generation algorithm for auto cross-doc spans |
| Manual editing of question text | Server-side search query |
| Manual add/delete of character spans | Vector/embedding-based search |
| Multi-document spans (manual) | |
| Flat question list with filters | |
| LangSmith re-sync on edit | |

## Design

### 1. Rename: Generate → Dataset

Frontend-only cosmetic + routing change:

| What | Before | After |
|------|--------|-------|
| Nav label in `Header.tsx` | `Generate` | `Dataset` |
| URL route | `/generate` | `/dataset` |
| Frontend directory | `src/app/generate/` | `src/app/dataset/` |
| Mode identifier | `"generate"` | `"dataset"` |

### 2. Backend: New Public Mutation

**One new public mutation** in `crud/questions.ts`:

```typescript
// updateQuestion — public mutation
// Args: questionId, optional queryText, optional relevantSpans
// Behavior:
//   1. Auth-gate: getAuthContext(ctx) for userId/orgId
//   2. Fetch question, verify org access via dataset → KB chain
//   3. Patch provided fields (queryText, relevantSpans)
//   4. Clear langsmithExampleId (set to undefined) to force re-sync
```

**No schema changes.** The existing `relevantSpans` array stores `{ docId, start, end, text }` per span — already supports different `docId` values per span. The `sourceDocId` field is retained as metadata indicating which document the question was originally generated from.

**LangSmith re-sync:** Clearing `langsmithExampleId` on edit means the next experiment run will re-upload the modified question to LangSmith before evaluation.

### 3. Question List Redesign (`QuestionList.tsx`)

**Current:** Questions grouped by document with collapsible doc-title headers.

**New:** Flat list with filters.

- All questions in a flat scrollable list (no document grouping)
- Each question item shows:
  - Question text (truncated)
  - Span count badge (e.g., "3 spans")
  - Document count badge if multi-doc (e.g., "2 docs")
  - Source badge: "generated" or "real-world"
  - Edit button (pencil icon) → opens edit modal
- Filter bar at the top:
  - Text search (existing — filters by query text)
  - Source type filter: All / Generated / Real-world
- Default sort: creation order

### 4. Edit Question Modal (`EditQuestionModal.tsx`)

New component. Split-panel modal triggered by clicking edit on any question.

#### Layout

Wide modal (95vw, max 1200px, 80vh height) with two panels:

**Left Panel — Question & Spans:**
- Editable question text (textarea at top)
- "Ground Truth Spans" section listing all current spans, grouped by document name
- Each span shows:
  - Color-coded left border (matches highlight in document viewer)
  - Excerpt text (3-line clamp)
  - Character range (e.g., "chars 1,247 — 1,432")
- Hover on span → "✕ delete" button appears top-right
- Click delete → inline popover on the span: "Remove this span? [Yes] [No]"
  - Yes → span removed from list immediately
  - No → popover dismissed
- Bottom section: "Add spans from another document" with clickable chips for remaining KB docs

**Right Panel — Document Viewer + Search:**
- Toolbar:
  - Fuzzy text search input (searches across all KB documents)
  - Document selector dropdown (all docs in KB)
- Search results bar: matches with doc name + snippet with highlighted terms
  - Clicking a result switches to that document and scrolls to the match
- Document content area:
  - Full document text displayed
  - Existing spans highlighted with color-coded backgrounds (matching left panel colors)
  - Text selection → floating action bar at bottom: "Selected · [char count] · [line range] · [+ Add as Span]"
  - Click "+ Add as Span" → span added to left panel list with green flash animation

#### Document Navigation (two paths)

1. Click a document name in the left panel span list → right panel switches to that doc (dropdown syncs)
2. Use the dropdown in the right panel toolbar
3. Click a doc chip in the "Add spans from another document" section

#### Fuzzy Search

- Client-side fuzzy text search across all documents loaded for the KB
- Simple substring/token matching with ranking
- Results grouped by document, showing snippet with highlighted match terms
- No server-side query needed for v1 — documents are small enough to load client-side

#### Save Behavior

- "Save Changes" button updates `queryText` and `relevantSpans` via `updateQuestion` mutation
- Clears `langsmithExampleId` to force LangSmith re-sync
- "Cancel" discards all unsaved changes
- Unsaved changes indicator (pulsing amber dot) in header

#### Data Loading

- `listByKb` (existing public query) — doc metadata for dropdown/chips
- `getContent` (existing public query) — full doc text loaded on-demand when user selects a document in the right panel
- No new backend queries needed

### 5. Evaluation Pipeline Compatibility

The evaluation metrics already support multi-document spans:
- `spanOverlaps()` in `utils/span.ts` checks `docId` match before computing overlap
- Metrics group spans by `docId` when merging overlapping spans
- No changes needed to eval-lib

## Component Inventory

| Component | Action |
|-----------|--------|
| `Header.tsx` | Modify — rename nav label + mode |
| `src/app/generate/` | Rename directory → `src/app/dataset/` |
| `src/app/dataset/page.tsx` | Modify — update imports if needed |
| `QuestionList.tsx` | Modify — flat list, filters, edit button |
| `EditQuestionModal.tsx` | **New** — split-panel edit modal |
| `crud/questions.ts` | Modify — add `updateQuestion` public mutation |

## Interaction States

Visual mockups created during brainstorming (see `.superpowers/brainstorm/` directory):

1. **Select text to add span** — highlight text in document viewer → floating bar with "+ Add as Span"
2. **Span added** — new span appears in left list with green flash, highlighted in document
3. **Delete span** — hover shows "✕ delete" → click → inline popover "Remove this span? [Yes] [No]"
4. **Navigate documents** — click doc name in left panel or use right dropdown; active doc highlighted
