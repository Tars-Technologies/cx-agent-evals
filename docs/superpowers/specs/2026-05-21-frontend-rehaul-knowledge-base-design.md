# Frontend Re-haul — Knowledge Base Section

**Date:** 2026-05-21
**Status:** Draft
**Parent:** `2026-05-21-frontend-rehaul-umbrella-design.md`

## Goal

Move all knowledge-base-related pages (`kb`, `dataset`, `retrievers`, `experiments`) under a single `/kb` section organized as: list landing → per-KB detail with Configure + Evaluate.

## Routes (new)

```
/kb                                          → list landing
/kb/<id>/configure                           → documents + indexing playground
/kb/<id>/evaluate/datasets                   → dataset list + question generation
/kb/<id>/evaluate/datasets/<datasetId>       → dataset detail
/kb/<id>/evaluate/retrievers                 → retriever list
/kb/<id>/evaluate/retrievers/<rid>           → retriever config + playground
/kb/<id>/evaluate/experiments                → retriever experiment runs
/kb/<id>/evaluate/experiments/<expId>        → experiment run detail
```

## Routes (deleted in this PR)

- `/kb` (legacy single-KB page)
- `/dataset`
- `/retrievers`, `/retrievers/results`
- `/experiments`, `/experiments/[id]`

## Pages

### `/kb` — landing
- `EntityListLayout` with grid of KB cards (name, doc count, last-modified, "Open" CTA).
- `+ New KB` button opens `CreateKBModal` (reuse existing component).
- Backed by `knowledgeBases.listWithDocCounts`.

### `/kb/<id>/configure` — Configure
- Left side: documents list, upload zone, doc viewer (reuse `FileUploader`, `DocumentViewer`, `ImportUrlModal`).
- Right side: indexing playground (chunk preview / search test — extract from current KB page if not already a standalone component).

### `/kb/<id>/evaluate/datasets`
- Reuses existing `/dataset` page content, scoped to the URL's KB ID instead of a global dropdown.
- Reuse: `GenerateConfig`, `GenerationWizard`, `QuestionList`, `EditQuestionModal`, `DeleteDatasetModal`, dimension wizard components.

### `/kb/<id>/evaluate/retrievers`
- List of retrievers for this KB. Reuse `RetrieverSidebar` / `RetrieverListItem` content reorganized into a main-pane list, not a sidebar.
- Click a retriever → `/kb/<id>/evaluate/retrievers/<rid>`.

### `/kb/<id>/evaluate/retrievers/<rid>` — Retriever detail
- Two-pane: retriever configuration form on the left, `RetrieverPlayground` docked on the right.
- Reuse: `RetrieverDetailModal` contents, `RetrieverPlayground`, `DocSearchResults`, `ChunkCard`.

### `/kb/<id>/evaluate/experiments`
- Retriever experiment run list. Reuse current `/experiments` page content, KB-scoped.

### `/kb/<id>/evaluate/experiments/<expId>`
- Experiment detail. Reuse current `/experiments/[id]` page.

## Component contract changes

- **KB selection comes from the URL.** Any component currently reading from a global KB dropdown / context must accept a `kbId` prop instead. The global dropdown is removed in the umbrella PR.
- No visual redesigns. Components keep their existing layouts; only their data source / mounting point changes.

## Backend

No new endpoints required for this section beyond what the umbrella verifies. If a component is found relying on the global KB context internally, refactor it to take a `kbId` prop in this PR.

## Testing

Manual click-through:

- KB landing renders all KBs for the org.
- Click a KB → land on Configure with breadcrumb `Knowledge Base / <name> / Configure`.
- Sidebar navigation between Configure / Datasets / Retrievers / Experiments preserves the KB ID in the URL.
- Deep-link to `/kb/<id>/evaluate/retrievers/<rid>` works on fresh load.
- Refresh and back/forward preserve everything.
- Document upload, dataset generation, retriever config edits, experiment runs all still function.

## Risks

- Components that currently read KB from a global dropdown/context will need refactoring. List them as discovered and refactor in this PR — do not leave hybrid wiring.
- Retriever sidebar → main-pane list conversion is the only layout reshape in this PR. Keep the visual styling close to existing cards.
