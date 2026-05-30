# Knowledge Base Page — Design Doc

## Problem

KB management (create, upload, crawl, view documents) is currently embedded inside `KBSelector`, which appears identically on all three pages (Generate, Retrievers, Experiments). This creates several issues:

1. **Scattered management**: Upload, crawl, and create controls are duplicated across pages where users don't need them
2. **No document viewing**: No way to read full document content — only a truncated list with file sizes
3. **Unclear workflow**: Users don't know they should set up a KB first, then move to generation/experiments
4. **Cramped UI**: KBSelector tries to fit filtering, KB list, create form, upload, crawl, and document list into a narrow sidebar widget

## Decisions

Decisions made during brainstorming (see Excalidraw wireframes in `docs/diagrams/`):

- **Layout**: Layout B — Top Bar + Master-Detail Split (see `layout-b-topbar-split.excalidraw`)
- **Navigation**: New "Knowledge Base" tab as the first tab, before Generate/Retrievers/Experiments
- **Create KB**: Modal dialog (see `create-kb-workflow.excalidraw`)
- **Upload files**: Inline — click button, OS file picker opens, files upload directly
- **Import URL**: Inline — expandable input field below action buttons, crawl progress in document panel
- **Other pages**: Simplified read-only KB dropdown with doc count, no management controls
- **URL state**: Continue using `?kb=<kbId>` query param for cross-page KB persistence

## Design

### 1. New Route: `/kb`

New page at `/kb` (or `/knowledge-base`), accessible as the first tab in the header navigation.

**URL**: `/kb?kb=<kbId>` — same `?kb=` convention as other pages. When a KB is selected, it's in the URL. Navigating to other tabs preserves the KB selection.

### 2. KB Page Layout (Layout B)

```
┌──────────────────────────────────────────────────────────────┐
│ [KB]  Generate  Retrievers  Experiments           Org Switch │
├──────────────────────────────────────────────────────────────┤
│ KB: [Acme Corp v]  Industry: [Finance v]  [+ Create KB]     │
│ Company: Acme Inc  |  Entity: Company  |  12 documents      │
├──────────────────┬───────────────────────────────────────────┤
│ [Search docs...] │                                           │
│ [Upload] [URL]   │  Document Title  |  8.4k  |  Scraped     │
│                  │  ─────────────────────────────────────    │
│ faq.md      3.2k │  # Customer Support Guide                │
│ pricing    12.1k │                                           │
│ > support   8.4k │  Welcome to the Acme Corp support guide.  │
│ terms       5.0k │  This document covers common issues...    │
│ onboard     2.3k │                                           │
│ api-docs    9.7k │  ## Getting Started                       │
│                  │                                           │
│ Crawling 4/12    │  Before contacting support, check the FAQ │
└──────────────────┴───────────────────────────────────────────┘
```

**Three sections**:

#### A. KB Selection & Metadata Bar (top)
- KB dropdown (lists all KBs, filterable by industry)
- Industry filter dropdown
- "+ Create KB" button → opens modal
- Metadata line: company, entity type, source URL, document count

#### B. Document Panel (left, ~30%)
- Search/filter input for documents
- Action buttons: "Upload Files", "Import URL"
- Scrollable document list: name, size, source type indicator
- Active crawl progress (when running)
- Click a document → loads it in the content viewer

#### C. Document Content Viewer (right, ~70%)
- Document title bar: name, size, source type (uploaded/scraped)
- Full document content rendered as text (scrollable)
- Empty state when no document selected: "Select a document to view its content"

### 3. Create KB Workflow (Modal)

Click "+ Create KB" → centered modal opens over dimmed page.

**Modal fields**:
- **Name** (required) — text input
- **Industry** (optional) — dropdown: finance, insurance, healthcare, telecom, education, government
- **Entity Type** (optional) — dropdown: company, government-state, government-county, industry-aggregate
- **Company** (optional) — text input
- **Source URL** (optional) — text input

**On submit**:
1. Calls `knowledgeBases.create` mutation
2. Modal closes
3. New KB auto-selected in dropdown (URL updates to `?kb=<newId>`)
4. Page shows empty state — document list empty, content viewer shows placeholder
5. Upload/Import URL buttons are immediately available

**On cancel**: Modal closes, nothing created, previous KB selection preserved.

### 4. Upload Files (Inline)

Click "Upload Files" button → OS file picker opens.

- Accepts: `.md`, `.txt`, `.html`, `.htm`, `.pdf`
- Multi-file selection supported
- Files upload via existing `generateUploadUrl` + `documents.upload` flow
- Brief success/failure feedback (toast or inline status)
- Documents appear in the list as they're uploaded
- Optional: drag-and-drop onto the document list area

Same as current `FileUploader` component behavior, just relocated to the KB page.

### 5. Import URL (Inline Expansion)

Click "Import URL" → input field expands inline below the action buttons.

```
[Upload Files]  [Import URL]

┌─────────────────────────────────┐
│ https://example.com/docs  [Go]  │  ← appears on click
└─────────────────────────────────┘

Crawling... 4/12 pages  [Cancel]    ← progress while active

  faq.md                    3.2k    ← docs appear in real-time
  support-guide.pdf         8.4k
```

- Single URL input + "Start Crawl" button
- Crawl progress shows inline: pages scraped/discovered, cancel button
- Documents appear in the list as pages are scraped (Convex reactive queries)
- When crawl completes or is cancelled, progress disappears
- URL input can be dismissed/collapsed

Same as current crawl functionality in `KBSelector`, just relocated.

### 6. Simplified KB Selector (Other Pages)

Replace the full `KBSelector` component on Generate, Retrievers, and Experiments pages with a minimal read-only dropdown.

```
Knowledge Base:  [Acme Corp KB (12 docs) v]
```

**Behavior**:
- Single dropdown listing all KBs for the org
- Each option shows: KB name + document count in parentheses
- No industry filter, no create button, no upload, no import, no document list
- When no KBs exist: "No knowledge bases yet" with optional link to `/kb`
- Selection updates `?kb=` URL param (existing behavior)

**New component**: `KBDropdown` (or `ReadOnlyKBSelector`) — much simpler than current `KBSelector`.

### 7. Header Navigation Update

Current tabs: `Generate | Retrievers | Experiments`

New tabs: `Knowledge Base | Generate | Retrievers | Experiments`

- "Knowledge Base" is the first tab, links to `/kb?kb=<currentKbId>`
- All tabs continue to preserve KB selection via URL param
- Landing page (`/`) updated to show 4 cards instead of 3

### 8. Document Deletion

The KB page should support deleting individual documents:
- Delete button/icon on each document in the list (or on hover)
- Confirmation before delete
- Requires a new `documents.remove` mutation (or use existing if available)

This is management functionality that belongs exclusively on the KB page.

## Component Changes Summary

| Component | Change |
|-----------|--------|
| `KBSelector.tsx` | **Replace on other pages** with new `KBDropdown` component. KB page gets new dedicated layout. |
| `FileUploader.tsx` | **Move** to KB page only. Remove from KBSelector. |
| `Header.tsx` | **Add** "Knowledge Base" as first tab. Update `mode` type. |
| `ModeSelector.tsx` | **Add** KB card as first option on landing page. |
| New: `KBDropdown.tsx` | Simple read-only dropdown with doc count for other pages. |
| New: `kb/page.tsx` | New KB page with Layout B. |
| New: `CreateKBModal.tsx` | Modal form for creating new KBs. |
| `generate/page.tsx` | Replace `KBSelector` with `KBDropdown`. Remove file upload. |
| `retrievers/page.tsx` | Replace `KBSelector` with `KBDropdown`. |
| `experiments/page.tsx` | Replace `KBSelector` with `KBDropdown`. |

## Backend Changes

Minimal:
- **Optional**: `documents.remove` mutation if it doesn't exist (for document deletion on KB page)
- **Optional**: `documents.listByKb` may need to return doc count separately for the dropdown
- No schema changes needed

## Out of Scope

- KB deletion (can add later)
- KB metadata editing after creation (can add later)
- Document re-ordering or categorization
- Rendered markdown (show plain text for now, matching existing DocumentViewer)
- Drag-and-drop reordering of documents
- Bulk document operations
