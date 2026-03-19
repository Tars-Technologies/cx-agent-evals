# Retriever Module Overhaul — Design Document

**Date:** 2026-03-12
**Status:** Approved
**Approach:** Sidebar + Tabbed Inspector (Approach A)

## Goal

Transform the retrievers frontend from an opaque card-based layout into a transparent, stage-by-stage pipeline inspector. Users should be able to inspect every stage of a retriever's pipeline: how documents were chunked (Index), how queries are rewritten (Query), what search returns (Search), how refinement transforms results (Refine), and compare multiple retrievers (Playground).

## Architecture Overview

### Page Layout

Two-panel layout: left sidebar (320px) + main content area (flex).

```
┌──────────────────────────────────────────────────────────┐
│ Header                                                   │
├──────────────┬───────────────────────────────────────────┤
│ KB Selector  │  ┌───────┬──────────────┬────────┬──────┐ │
│──────────────│  │ Index │ Query+Search │ Refine │ Play │ │
│ + New        │  ├───────┴──────────────┴────────┴──────┤ │
│──────────────│  │                                      │ │
│ ▸ baseline   │  │       Tab content area               │ │
│ ▾ hybrid-rer │  │                                      │ │
│   dense+rr   │  │                                      │ │
│   Summary    │  │                                      │ │
│   k=5        │  │                                      │ │
│   [Details]  │  │                                      │ │
│──────────────│  │                                      │ │
│ ▸ bm25-basic │  │                                      │ │
│ ▸ contextual │  │                                      │ │
└──────────────┴──┴──────────────────────────────────────┘
```

### Sidebar

1. **KB Selector** — existing dropdown, unchanged
2. **"+ New Retriever" button** — opens existing wizard modal
3. **Retriever list** — vertical expandable items:
   - **Collapsed:** Name + status dot + chunk count badge
   - **Expanded (on click):** Summary config (4 one-liners: Index/Query/Search/Refine) + status-specific action buttons + "View Full Config" button (opens modal with review-page-style detail)
   - **Selected state:** Accent border. Selecting activates the 4 tabs.
   - **Indexing progress:** Small progress bar in expanded view when status=indexing
4. **Playground mode:** When Playground tab is active, sidebar shows multi-select checkboxes instead of single-select

**No retriever selected:** Main area shows empty state with prompt to select or create.

---

## Tab 1: Index

Three-panel layout within the tab:

```
┌──────────┬─────────────────────────┬──────────────────────┐
│ Doc List │  Document View          │  Chunk Inspector     │
│          │  (original text)        │  (selected chunk)    │
│ doc1.md  │                         │                      │
│ doc2.md  │  ...text [1] chunk...   │  Chunk #3            │
│ doc3.md  │  ~~~overlap region~~~   │  Span: 1420–2380     │
│          │  ...text [2] chunk...   │                      │
│          │                         │  ┌─ Original Text ─┐ │
│          │                         │  │ (from document)  │ │
│          │                         │  └──────────────────┘ │
│          │                         │                      │
│          │                         │  ┌─ Indexed Content ┐ │
│          │                         │  │ (stored content)  │ │
│          │                         │  └──────────────────┘ │
│          │                         │  Content differs! ⚠  │
└──────────┴─────────────────────────┴──────────────────────┘
```

### Document List (left, ~200px)
- All documents in the KB
- Each shows: document name + chunk count for this retriever's index
- Click to select → loads in viewer

### Document Viewer (center)
- Full document content with raw/rendered markdown toggle
- **Chunk boundaries:** Alternating zebra-stripe tints (even/odd chunks)
- **Overlap regions:** Distinct pattern (hatched/diagonal-stripe) where adjacent chunks share characters
- **Numbered pills:** `[1]` `[2]` at chunk start positions
- **Hover:** Highlights chunk region, shows tooltip with chunk ID, offsets, metadata, content length
- **Click chunk pill:** Selects chunk in inspector panel

### Chunk Inspector (right panel)
When a chunk is selected:
1. **Header:** Chunk ID, character span (start–end), metadata
2. **Original Text:** `document.content.slice(start, end)` — extracted from source
3. **Indexed Content:** The actual stored `chunk.content` — what was embedded
4. **Diff detection:**
   - Identical → "Content matches source"
   - Has prefix not in original → "Contextual prefix detected" (prefix highlighted)
   - Entirely different → "Summary replacement" (both shown)
   - Span much larger than chunk size → "Parent chunk"
5. **Overlap info:** Adjacent chunks sharing characters, with counts
6. **List mode toggle:** Switch to scrollable list of all chunks (compact, one-line per chunk)

### Non-ready retrievers
Shows "This retriever hasn't been indexed yet" with "Start Indexing" button.

---

## Tab 2: Query + Search

Horizontal split layout:

```
┌──────────────────────────────────────────────────────────────┐
│  Query: [_________________________________] [Run ▶]          │
├──────────────────────────┬───────────────────────────────────┤
│  QUERY REWRITING         │  SEARCH RESULTS                  │
│  Strategy: multi-query   │  ┌ Search Config ──────────────┐ │
│                          │  │ dense · 3-small · k=5       │ │
│  ● Original (fused)      │  └────────────────────────────┘ │
│                          │                                   │
│  Rewritten:              │  Showing: fused (5 from 3 qs)    │
│  ○ 1. "what is..."      │                                   │
│  ○ 2. "how does..."     │  ┌ #1 · 0.94 · doc1.md ──────┐  │
│  ○ 3. "RAG archit..."   │  │ content...    [raw/render]  │  │
│                          │  └────────────────────────────┘  │
│  Latency: 1.2s           │  ┌ #2 · 0.89 · doc2.md ──────┐  │
│                          │  │ content...                   │  │
│                          │  └────────────────────────────┘  │
└──────────────────────────┴───────────────────────────────────┘
```

### Left Panel — Query Rewriting (~35%)
- Strategy name + latency
- **"Original (fused results)"** selected by default → right panel shows merged chunks
- Click any rewritten query → right filters to that query's results only
- Radio-button style (one at a time)

### Strategy-specific rendering

| Strategy | Left panel shows | Default right panel |
|----------|-----------------|-------------------|
| identity | Just "Original" (no rewriting section) | Direct search results |
| rewrite | Original + 1 rewritten query | Rewritten query results |
| multi-query | Original + N rewritten queries | Fused results |
| step-back | Original + 1 abstract query | Fused results |
| hyde | Original + hypothetical answer (truncated ~3 lines, "Show full" expand inline) | Results from hypothetical embedding |

### Right Panel — Search Results (~65%)

**Search config banner:** Strategy (dense/BM25/hybrid), for hybrid: dense/sparse weights + fusion method (RRF) + candidate multiplier, embedding model, top-k.

**Result header:** "fused results (N chunks from M queries)" or "results for query 2 (N chunks)"

**Chunk cards:** Expandable, with rank, score, source doc + span, content with raw/rendered toggle.

### Query persistence
Query input persists when switching to Refine tab.

---

## Tab 3: Refine

```
┌──────────────────────────────────────────────────────────────┐
│  Query: [__persisted from Q+S__] [Run ▶]                    │
│                                                              │
│  ┌─ Stage Pipeline ─────────────────────────────────────────┐│
│  │ Search(8) ──→ Rerank(5) ──→ Threshold(3) ──→ Final(3)   ││
│  │   ●              ○               ○               ○       ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  STAGE: Search Input (8 chunks)                              │
│  ┌─ #1 · 0.94 · doc1.md ──────────────────────────────┐     │
│  │ content...                          [raw/rendered]  │     │
│  └─────────────────────────────────────────────────────┘     │
│  ...                                                         │
│                                                              │
│  ┌─ Stage Info ─────────────────────────────────────────┐    │
│  │ Rerank · cohere/rerank-v3.5 · 8→5 · 0.8s           │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Stage Pipeline (horizontal stepper)
- Visual pipeline: `Search Input → Stage 1 → Stage 2 → ... → Final`
- Each node: stage name + chunk count
- Arrows show transformation (e.g., "8 → 5")
- Click node → view chunks at that point
- Active node highlighted

### Stage Detail
- Chunks at selected pipeline point
- **Search Input** = raw search results
- **After each stage** = surviving/reordered chunks
- **Final** = definitive pipeline output

### Stage Info Banner
Between chunk list and next stage: stage type, config (reranker model, threshold value, MMR lambda, etc.), input→output count, latency.

### No refinement
"No refinement stages configured. Search results are the final output." with direct search result view.

### Query persistence
Pre-filled from Query+Search tab. Running re-executes the full pipeline.

---

## Tab 4: Playground

Enhanced version of the current playground.

- **Sidebar mode:** Multi-select checkboxes next to each "ready" retriever (replaces single-select when this tab is active)
- **Query input + "Retrieve" button**
- **Multi-column grid:** One column per selected retriever
  - Header: retriever name + result count + latency
  - Chunk cards with markdown rendering (raw/rendered toggle)
  - Score, source doc + span reference
- **Calls `retrieveWithTrace`** per retriever for a single efficient call

---

## Shared: Markdown Rendering

Global `MarkdownViewer` component:
- **Rendered mode (default):** Headings, lists, code blocks (syntax highlighted), tables, images, bold/italic
- **Raw mode:** Monospace pre-formatted block
- **Toggle:** `[raw ○ rendered ●]` pill in top-right of content area
- **Used in:** All tabs (document viewer, chunk inspector, chunk cards), Knowledge Base module, Generation module — everywhere content is displayed

---

## Backend: New Convex Actions

### New file: `retrieval/pipelineActions.ts` (`"use node"`)

1. **`rewriteQuery(retrieverId, query)`**
   - Reads retriever's query strategy config
   - Executes query rewriting via eval-lib
   - Returns `{ strategy, original, rewrittenQueries: string[], latencyMs }`
   - For HyDE: `{ strategy: "hyde", original, hypotheticalAnswer: string, latencyMs }`

2. **`searchWithQueries(retrieverId, queries)`**
   - Takes rewritten queries, runs search (dense/BM25/hybrid) per query
   - Returns `{ searchConfig: {...}, perQueryResults: { query, chunks[] }[], fusedResults: chunks[], latencyMs }`
   - Each chunk: content, docId, start, end, score, metadata

3. **`refine(retrieverId, chunks)`**
   - Runs all refinement stages sequentially
   - Returns `{ stages: { name, config, inputCount, outputCount, outputChunks[], latencyMs }[], finalChunks[] }`

4. **`retrieveWithTrace(retrieverId, query, k?)`**
   - Full pipeline, all intermediate results
   - Returns `{ rewriting: {...}, search: {...}, refinement: {...}, finalChunks[], totalLatencyMs }`
   - Used by Playground tab

### Existing file: `retrieval/chunks.ts` (add query)

5. **`getChunksByRetriever(retrieverId, documentId?)`**
   - Paginated chunks for a retriever's index config, optionally filtered by document
   - Used by Index tab

### Constraints respected
- All new actions in `"use node"` file
- Mutations/queries in separate files
- eval-lib `/langsmith` and `/llm` imports only in action files
- Paginated queries to avoid 16MB read limit

---

## Scope Decisions

- **Chunk enrichment data:** Use existing data only (content, start, end, metadata). Enrichment detected by comparing stored content vs document slice. No backend schema changes.
- **Backend pipeline actions:** Build new actions for each stage (rewrite, search, refine, full trace).
- **Markdown rendering:** Shared component, applied globally across the app.
- **Current wizard modal:** Kept as-is for creating new retrievers.
