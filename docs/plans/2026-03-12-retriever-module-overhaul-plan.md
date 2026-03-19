# Retriever Module Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the retrievers page from an opaque card-based layout into a transparent, stage-by-stage pipeline inspector with 4 tabs (Index, Query+Search, Refine, Playground) and new backend pipeline actions.

**Architecture:** Sidebar-driven single-retriever selection with tabbed main content. New Convex `"use node"` actions for pipeline stage execution (rewriteQuery, searchWithQueries, refine, retrieveWithTrace). Shared MarkdownViewer component for raw/rendered toggle everywhere. Index tab uses start/end offsets to detect enrichment by comparing stored content vs document slice.

**Tech Stack:** React 19, Next.js 16, Convex, TailwindCSS v4, react-markdown + remark-gfm + rehype-raw for markdown, eval-lib pipeline functions (PipelineRetriever, search strategies, refinement functions, query prompts).

**Design doc:** `docs/plans/2026-03-12-retriever-module-overhaul-design.md`

---

## Phase 1: Shared Foundation

### Task 1: Install markdown rendering dependencies

**Files:**
- Modify: `packages/frontend/package.json`

**Step 1:** Install dependencies

```bash
cd packages/frontend && pnpm add react-markdown remark-gfm rehype-raw
```

**Step 2:** Verify install

```bash
pnpm -C packages/frontend build
```

Expected: Build succeeds with new deps.

**Step 3:** Commit

```bash
git add packages/frontend/package.json pnpm-lock.yaml
git commit -m "chore(frontend): add react-markdown, remark-gfm, rehype-raw for markdown rendering"
```

---

### Task 2: Create MarkdownViewer shared component

**Files:**
- Create: `packages/frontend/src/components/MarkdownViewer.tsx`

**Context:** This component is used everywhere content is displayed — documents, chunks, inspector panels. It renders markdown with proper formatting and provides a raw/rendered toggle. Default state is rendered.

**Interface:**

```tsx
interface MarkdownViewerProps {
  content: string;
  className?: string;
  /** If true, show the raw/rendered toggle. Default: true */
  showToggle?: boolean;
  /** Override the default mode. Default: "rendered" */
  defaultMode?: "raw" | "rendered";
}
```

**Implementation notes:**
- Use `react-markdown` with `remarkGfm` plugin for GFM tables/strikethrough/autolinks
- Use `rehypeRaw` for inline HTML in markdown
- Rendered mode: Apply Tailwind prose-like styling manually (dark theme compatible — **do NOT use @tailwindcss/typography** as it conflicts with the existing dark theme tokens). Style headings, lists, code blocks, tables, blockquotes, links, images, hr using the project's color tokens (`text-text`, `text-dim`, `bg-elevated`, `border-border`, `accent`).
- Raw mode: `<pre>` with `whitespace-pre-wrap font-mono text-xs text-text-muted`
- Toggle: Small pill `[Raw | Rendered]` in top-right corner, styled with `bg-elevated border-border text-[10px]`
- Code block rendering: Use a simple `<pre><code>` with `bg-bg-surface` background and monospace font. No heavy syntax highlighting library needed.

**Step 1:** Create the component file with both rendering modes and toggle.

**Step 2:** Verify build

```bash
pnpm -C packages/frontend build
```

**Step 3:** Commit

```bash
git add packages/frontend/src/components/MarkdownViewer.tsx
git commit -m "feat(frontend): add MarkdownViewer component with raw/rendered toggle"
```

---

### Task 3: Create ChunkCard shared component

**Files:**
- Create: `packages/frontend/src/components/ChunkCard.tsx`

**Context:** Reusable chunk display card used across Query+Search, Refine, and Playground tabs. Shows rank, score, source doc reference, content with markdown toggle. Expandable.

**Interface:**

```tsx
interface ChunkCardProps {
  rank: number;
  score: number;
  docId?: string;
  start?: number;
  end?: number;
  content: string;
  metadata?: Record<string, unknown>;
  /** Default collapsed (3-line clamp). Click to expand. */
  defaultExpanded?: boolean;
}
```

**Implementation notes:**
- Header: `#rank · score: X.XX · docId (start–end)` in `text-[11px] text-dim font-mono`
- Content: `MarkdownViewer` with `showToggle={true}`
- Collapsed: `max-h-[4.5rem] overflow-hidden` with gradient fade at bottom
- Expanded: Full content visible
- Click anywhere on the card to toggle expand/collapse
- Styling: `bg-elevated border border-border rounded-lg p-3 cursor-pointer hover:border-accent/30 transition-colors`

**Step 1:** Create component file.

**Step 2:** Verify build.

**Step 3:** Commit

```bash
git add packages/frontend/src/components/ChunkCard.tsx
git commit -m "feat(frontend): add ChunkCard component with markdown rendering and expand/collapse"
```

---

### Task 4: Add backend query for chunks by retriever

**Files:**
- Modify: `packages/backend/convex/retrieval/chunks.ts` (add new query)
- Modify: `packages/backend/convex/crud/documents.ts` (add public query for doc content)

**Context:** The Index tab needs to fetch chunks for a specific retriever (by indexConfigHash) optionally filtered by document. Also needs to fetch document content for the document viewer.

**Step 1: Add `getChunksByRetrieverPage` to chunks.ts**

Add a new **public** query (not internal) near the existing `getChunksByDocConfigPage`:

```typescript
// Public paginated query for Index tab — fetches chunks by (kbId, indexConfigHash, documentId?)
export const getChunksByRetrieverPage = query({
  args: {
    kbId: v.id("knowledgeBases"),
    indexConfigHash: v.string(),
    documentId: v.optional(v.id("documents")),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Auth check via getAuthContext
    const { orgId } = await getAuthContext(ctx);
    // Verify KB belongs to org
    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) throw new Error("KB not found");

    const pageSize = args.pageSize ?? 50;
    let q;
    if (args.documentId) {
      q = ctx.db.query("documentChunks")
        .withIndex("by_doc_config", (q) =>
          q.eq("documentId", args.documentId!).eq("indexConfigHash", args.indexConfigHash)
        );
    } else {
      q = ctx.db.query("documentChunks")
        .withIndex("by_kb_config", (q) =>
          q.eq("kbId", args.kbId).eq("indexConfigHash", args.indexConfigHash)
        );
    }
    const page = await q.paginate({ numItems: pageSize, cursor: args.cursor ?? null });
    return {
      chunks: page.page.map(c => ({
        _id: c._id,
        chunkId: c.chunkId,
        documentId: c.documentId,
        content: c.content,
        start: c.start,
        end: c.end,
        metadata: c.metadata ?? {},
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
```

**Step 2: Add `getDocumentContent` public query to documents.ts**

Add a public query that returns a document's content with auth check:

```typescript
export const getContent = query({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const doc = await ctx.db.get(args.id);
    if (!doc) throw new Error("Document not found");
    // Verify org access via KB
    const kb = await ctx.db.get(doc.kbId);
    if (!kb || kb.orgId !== orgId) throw new Error("Access denied");
    return { docId: doc.docId, content: doc.content, kbId: doc.kbId };
  },
});
```

**Step 3:** Verify types

```bash
pnpm typecheck:backend
```

**Step 4:** Deploy and verify

```bash
cd packages/backend && npx convex dev --once
```

**Step 5:** Commit

```bash
git add packages/backend/convex/retrieval/chunks.ts packages/backend/convex/crud/documents.ts
git commit -m "feat(backend): add public queries for chunk browsing and document content"
```

---

## Phase 2: Backend Pipeline Actions

### Task 5: Create pipelineActions.ts with rewriteQuery action

**Files:**
- Create: `packages/backend/convex/retrieval/pipelineActions.ts`

**Context:** New `"use node"` action file. This task creates the file and the first action: `rewriteQuery`. This action takes a retrieverId and query, reads the retriever's query strategy config, and executes query rewriting using eval-lib's PipelineLLM interface.

**Implementation notes:**
- Import `createOpenAIClient` from `rag-evaluation-system/llm` (Node.js only, safe in "use node")
- Read retriever config via `internal.crud.retrievers.getInternal`
- Extract query config from `retrieverConfig.query`
- For each strategy, replicate the logic from `PipelineRetriever._processQuery()`:
  - `identity`: return `[query]`
  - `multi-query`: call LLM with multi-query prompt, parse N queries
  - `hyde`: call LLM with hyde prompt, return hypothetical doc
  - `step-back`: call LLM with step-back prompt, optionally include original
  - `rewrite`: call LLM with rewrite prompt, return single rewritten query
- Return `{ strategy, original, rewrittenQueries, hypotheticalAnswer?, latencyMs }`

**Key code pattern (follow existing retrieverActions.ts):**

```typescript
"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createOpenAIClient } from "rag-evaluation-system/llm";

// Helper: simple LLM completion
async function llmComplete(prompt: string): Promise<string> {
  const client = createOpenAIClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
  });
  return response.choices[0]?.message?.content ?? "";
}

export const rewriteQuery = action({
  args: {
    retrieverId: v.id("retrievers"),
    query: v.string(),
  },
  handler: async (ctx, args) => {
    const start = Date.now();
    const retriever = await ctx.runQuery(internal.crud.retrievers.getInternal, { id: args.retrieverId });
    if (!retriever) throw new Error("Retriever not found");
    if (retriever.status !== "ready") throw new Error("Retriever not ready");

    const queryConfig = retriever.retrieverConfig.query ?? { strategy: "identity" };
    const strategy = queryConfig.strategy;
    const original = args.query;
    let rewrittenQueries: string[] = [original];
    let hypotheticalAnswer: string | undefined;

    // Strategy-specific logic...
    // (identity, multi-query, hyde, step-back, rewrite)

    return {
      strategy,
      original,
      rewrittenQueries,
      hypotheticalAnswer,
      latencyMs: Date.now() - start,
    };
  },
});
```

**Import eval-lib prompts** from `rag-evaluation-system/llm` or inline defaults (check if prompts are exported — they are in `retrievers/pipeline/query/prompts.ts` but may not be in the public API). If not exported, duplicate the default prompts.

**Step 1:** Create the file with the rewriteQuery action.

**Step 2:** Verify types and deploy

```bash
pnpm typecheck:backend && cd packages/backend && npx convex dev --once
```

**Step 3:** Commit

```bash
git add packages/backend/convex/retrieval/pipelineActions.ts
git commit -m "feat(backend): add rewriteQuery pipeline action for interactive query inspection"
```

---

### Task 6: Add searchWithQueries action to pipelineActions.ts

**Files:**
- Modify: `packages/backend/convex/retrieval/pipelineActions.ts`

**Context:** Takes rewritten queries (from rewriteQuery output), runs search per query using the retriever's search config, returns per-query results and fused results.

**Implementation notes:**
- For dense search: Use existing `vectorSearchWithFilter` helper per query (embed each query → vector search → post-filter)
- For BM25 search: Requires loading all chunks into a BM25 index. Use `MiniSearch` (already in `convex.json` external packages as `minisearch`). Load chunks via paginated query, build BM25 index, search each query.
- For hybrid search: Run dense + BM25 in parallel per query, fuse using `weightedScoreFusion` or `reciprocalRankFusion` from eval-lib
- Multi-query fusion: Use `rrfFuseMultiple` from eval-lib to merge results across queries
- Return search config metadata (strategy, weights, fusion method, k, candidate multiplier)

**Key consideration:** BM25 and hybrid search require loading chunks into memory. For the interactive inspector this is acceptable since it's a user-initiated action, but should respect reasonable limits. Use the retriever's `defaultK` if k not provided.

**Return type:**
```typescript
{
  searchConfig: { strategy, denseWeight?, sparseWeight?, fusionMethod?, candidateMultiplier?, k },
  perQueryResults: Array<{ query: string, chunks: ChunkResult[] }>,
  fusedResults: ChunkResult[],
  latencyMs: number,
}
```

Where `ChunkResult = { chunkId, content, docId, start, end, score, metadata }`.

**Step 1:** Add the action to pipelineActions.ts.

**Step 2:** Verify types and deploy

```bash
pnpm typecheck:backend && cd packages/backend && npx convex dev --once
```

**Step 3:** Commit

```bash
git add packages/backend/convex/retrieval/pipelineActions.ts
git commit -m "feat(backend): add searchWithQueries pipeline action for per-query search results"
```

---

### Task 7: Add refine action to pipelineActions.ts

**Files:**
- Modify: `packages/backend/convex/retrieval/pipelineActions.ts`

**Context:** Takes search result chunks, runs all refinement stages sequentially, returns per-stage input/output and final results.

**Implementation notes:**
- Import refinement functions from eval-lib: `applyThresholdFilter`, `applyDedup`, `applyMmr`, `applyExpandContext` (these are exported from `rag-evaluation-system`)
- For `rerank` step: Use Cohere reranker from eval-lib (`CohereReranker` from `rag-evaluation-system`)
- Convert `ChunkResult[]` → `ScoredChunk[]` (the eval-lib format) for refinement functions
- After each stage, capture the output chunks and timing
- For `expand-context` step: Need access to corpus (document content). Fetch documents from Convex.
- Convert back to `ChunkResult[]` for return

**Return type:**
```typescript
{
  stages: Array<{
    name: string,       // "rerank", "threshold", "dedup", "mmr", "expand-context"
    config: Record<string, unknown>,  // stage-specific config values
    inputCount: number,
    outputCount: number,
    outputChunks: ChunkResult[],
    latencyMs: number,
  }>,
  finalChunks: ChunkResult[],
}
```

**Step 1:** Add the action.

**Step 2:** Verify types and deploy.

**Step 3:** Commit

```bash
git add packages/backend/convex/retrieval/pipelineActions.ts
git commit -m "feat(backend): add refine pipeline action with per-stage output tracking"
```

---

### Task 8: Add retrieveWithTrace action to pipelineActions.ts

**Files:**
- Modify: `packages/backend/convex/retrieval/pipelineActions.ts`

**Context:** Full pipeline execution returning all intermediate results. Used by the Playground tab for single-call retrieval. Composes the three previous actions' logic.

**Implementation notes:**
- Executes: rewriteQuery → searchWithQueries → refine sequentially
- Captures all intermediate outputs
- Returns the full trace plus final chunks

**Return type:**
```typescript
{
  rewriting: { strategy, original, rewrittenQueries, hypotheticalAnswer?, latencyMs },
  search: { searchConfig, perQueryResults, fusedResults, latencyMs },
  refinement: { stages, finalChunks },
  finalChunks: ChunkResult[],
  totalLatencyMs: number,
}
```

**Step 1:** Add the action.

**Step 2:** Verify types and deploy.

**Step 3:** Commit

```bash
git add packages/backend/convex/retrieval/pipelineActions.ts
git commit -m "feat(backend): add retrieveWithTrace action for full pipeline trace"
```

---

## Phase 3: Sidebar Overhaul

### Task 9: Create RetrieverListItem component

**Files:**
- Create: `packages/frontend/src/components/RetrieverListItem.tsx`

**Context:** An expandable list item for the sidebar. Shows retriever name + status dot when collapsed. When expanded, shows summary config + action buttons + "View Full Config" button.

**Interface:**

```tsx
interface RetrieverListItemProps {
  retriever: {
    _id: Id<"retrievers">;
    name: string;
    status: "configuring" | "indexing" | "ready" | "error";
    retrieverConfig: any;
    defaultK: number;
    chunkCount?: number;
    error?: string;
  };
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  /** For playground multi-select mode */
  isCheckboxMode?: boolean;
  isChecked?: boolean;
  onToggleCheck?: () => void;
  /** Indexing progress (fetched externally) */
  progress?: { totalDocs: number; processedDocs: number; failedDocs: number };
}
```

**Implementation notes:**
- Collapsed: `flex items-center gap-2` — status dot (8px circle, color from STATUS_STYLES) + name + chunk count badge
- Selected state: `border-l-2 border-accent bg-accent/5`
- Click → calls `onSelect` (selects this retriever) AND `onToggleExpand` (expands)
- Expanded: Below the header row, show:
  - `PipelineConfigSummary` component (reuse existing) for the 4-line summary
  - Action buttons (same logic as RetrieverCard: Start Indexing / Delete / Cancel based on status)
  - "View Full Config" button → calls a callback that opens the detail modal
  - Indexing progress bar (if status=indexing)
- Checkbox mode: Replace the click-to-select with a checkbox (for Playground tab multi-select)
- Reuse `STATUS_STYLES` from existing `RetrieverCard.tsx`

**Step 1:** Create component.

**Step 2:** Verify build.

**Step 3:** Commit

```bash
git add packages/frontend/src/components/RetrieverListItem.tsx
git commit -m "feat(frontend): add RetrieverListItem expandable sidebar component"
```

---

### Task 10: Create RetrieverDetailModal component

**Files:**
- Create: `packages/frontend/src/components/RetrieverDetailModal.tsx`

**Context:** Modal showing full retriever configuration. Mirrors the ReviewStep layout from the wizard but read-only (no edit buttons, no save/create buttons).

**Interface:**

```tsx
interface RetrieverDetailModalProps {
  retriever: {
    name: string;
    retrieverConfig: any;
    defaultK: number;
    status: string;
    chunkCount?: number;
    createdAt: number;
  };
  onClose: () => void;
}
```

**Implementation notes:**
- Reuse the layout and formatting helpers from `ReviewStep.tsx`:
  - `lookupName()` for strategy/chunker/embedder names
  - `formatOptions()` for key-value rendering
  - `SummaryRow` for label-value pairs
- 4 sections: Index, Query, Search, Refinement (same as ReviewStep)
- Additional info: retriever name, status, chunk count, created date
- Modal styling: Same as wizard modal (`fixed inset-0 z-50 bg-black/60`)
- Close button in top-right

**Step 1:** Create component.

**Step 2:** Verify build.

**Step 3:** Commit

```bash
git add packages/frontend/src/components/RetrieverDetailModal.tsx
git commit -m "feat(frontend): add RetrieverDetailModal for full config inspection"
```

---

### Task 11: Create RetrieverSidebar component

**Files:**
- Create: `packages/frontend/src/components/RetrieverSidebar.tsx`

**Context:** The complete left sidebar: KB selector + "New Retriever" button + retriever list. Manages expansion/selection state.

**Interface:**

```tsx
interface RetrieverSidebarProps {
  selectedKbId: Id<"knowledgeBases"> | null;
  onKbChange: (kbId: Id<"knowledgeBases"> | null) => void;
  selectedRetrieverId: Id<"retrievers"> | null;
  onRetrieverSelect: (id: Id<"retrievers"> | null) => void;
  onNewRetriever: () => void;
  /** Playground tab multi-select mode */
  isPlaygroundMode: boolean;
  selectedRetrieverIds: Set<Id<"retrievers">>;
  onToggleRetrieverCheck: (id: Id<"retrievers">) => void;
}
```

**Implementation notes:**
- Uses `useQuery(api.crud.retrievers.byKb, selectedKbId ? { kbId: selectedKbId } : "skip")` to fetch retrievers
- KB selector: Reuse existing `KBDropdown` component
- "New Retriever" button: Styled consistently with existing accent button
- Retriever list: Map over retrievers, render `RetrieverListItem` for each
- State: `expandedId` tracks which item is expanded (only one at a time)
- When `isPlaygroundMode=true`, show checkboxes instead of single-select
- Shows `RetrieverDetailModal` when "View Full Config" is clicked (managed by local state)
- Width: `w-[320px] flex-shrink-0`
- For indexing progress: Wrap each indexing retriever with a progress fetcher (similar to existing `RetrieverCardWithProgress` pattern in page.tsx)

**Step 1:** Create component.

**Step 2:** Verify build.

**Step 3:** Commit

```bash
git add packages/frontend/src/components/RetrieverSidebar.tsx
git commit -m "feat(frontend): add RetrieverSidebar with KB selection and retriever list"
```

---

## Phase 4: Index Tab

### Task 12: Create IndexTab component

**Files:**
- Create: `packages/frontend/src/components/tabs/IndexTab.tsx`

**Context:** Three-panel layout: document list + document viewer with chunk visualization + chunk inspector. Uses the new backend queries to fetch chunks and document content.

**Interface:**

```tsx
interface IndexTabProps {
  retriever: {
    _id: Id<"retrievers">;
    kbId: Id<"knowledgeBases">;
    indexConfigHash: string;
    retrieverConfig: any;
    status: string;
    chunkCount?: number;
  };
}
```

**Implementation notes:**

**Document list (left, ~200px):**
- Query `api.crud.documents.byKb` (already exists) to get documents for the KB
- Each item: `doc.docId` + chunk count (from a count query or derive from loaded chunks)
- Click to select document

**Document viewer (center):**
- Query `api.crud.documents.getContent` (added in Task 4) for selected document
- Query `api.retrieval.chunks.getChunksByRetrieverPage` with `documentId` filter to get chunks
- Load all chunks for the document (paginate automatically until `isDone`)
- Sort chunks by `start` offset
- Render document content with chunk annotations:
  - **Zebra striping:** Use `start`/`end` offsets to determine chunk regions. Alternate between `bg-accent/5` and `bg-transparent` for even/odd chunks
  - **Overlap detection:** Where chunk N's `end > chunk N+1's start`, render the overlap region with `bg-yellow-500/10` (distinct pattern)
  - **Numbered pills:** At each chunk's start offset, insert an inline `<span>` badge: `[N]` styled with `bg-accent/20 text-accent text-[9px] px-1 rounded font-mono`
  - **Hover:** On hovering a chunk region, add `ring-1 ring-accent/50` and show tooltip
  - **Click pill:** Set `selectedChunkIndex` state → updates inspector
- `MarkdownViewer` with toggle for the full document content
- **Rendering approach:** Split the document content into segments based on chunk boundaries. Each segment is either: (a) a regular chunk region, (b) an overlap region, or (c) uncovered text (gap between chunks). Render each with appropriate styling.

**Chunk inspector (right, ~300px):**
- Shows when a chunk is selected
- Header: chunk ID, `Span: start–end`, content length
- **Original Text section:** Compute `documentContent.slice(chunk.start, chunk.end)` — this is the original document text at this position
- **Indexed Content section:** Show `chunk.content` (the stored content)
- **Diff detection:**
  - Compare original vs indexed content
  - If identical → show "Content matches source" badge (green)
  - If indexed content starts with text not in original → "Contextual prefix detected" badge (blue), highlight the prefix
  - If indexed content is completely different → "Summary replacement" badge (yellow)
  - If chunk span is much larger than typical chunk size → "Parent chunk" badge (purple)
- **Overlap info:** Check adjacent chunks for overlapping spans. Show "Overlaps N chars with chunk #M"
- **Metadata:** Render `chunk.metadata` as key-value pairs
- **Chunk list toggle:** Button to switch inspector to a scrollable list of all chunks (compact mode — `chunkId: start–end` per line). Click any to inspect.

**Non-ready state:** If `retriever.status !== "ready"`, show: "This retriever hasn't been indexed yet." with appropriate action button.

**Step 1:** Create the component with all three panels.

**Step 2:** Verify build.

**Step 3:** Commit

```bash
git add packages/frontend/src/components/tabs/IndexTab.tsx
git commit -m "feat(frontend): add IndexTab with document viewer and chunk inspector"
```

---

## Phase 5: Query + Search Tab

### Task 13: Create QuerySearchTab component

**Files:**
- Create: `packages/frontend/src/components/tabs/QuerySearchTab.tsx`

**Context:** Horizontal split — query rewriting on left, search results on right. Uses the `rewriteQuery` and `searchWithQueries` backend actions.

**Interface:**

```tsx
interface QuerySearchTabProps {
  retriever: {
    _id: Id<"retrievers">;
    retrieverConfig: any;
    defaultK: number;
    status: string;
  };
  query: string;
  onQueryChange: (query: string) => void;
}
```

**Implementation notes:**

**Query input (top bar):**
- Input field + "Run" button
- `query` prop is managed by parent (persists across tabs)
- On submit: fire both `rewriteQuery` and `searchWithQueries` actions
- Flow: rewriteQuery → on result, auto-fire searchWithQueries with the rewritten queries

**Left panel — Query Rewriting (~35%):**
- Show strategy name from response
- Render original query as a radio option: `● Original (fused results)` — selected by default
- Render rewritten queries as radio options: `○ 1. "query text..."` etc.
- For HyDE: Show "Hypothetical Answer:" with truncated text (~3 lines) + "Show full" toggle (inline expand, no modal)
- Latency display
- `selectedQueryIndex` state: `null` = fused/original, `number` = specific rewritten query
- Loading spinner while rewriteQuery is in flight

**Right panel — Search Results (~65%):**
- **Search config banner** at top: strategy name, for hybrid: dense/sparse weights + fusion method + candidate multiplier, embedding model, k value. Styled as `bg-bg-surface border border-border rounded-lg p-2 text-[11px] text-dim`
- **Result header:** "Showing: fused results (N chunks from M queries)" or "Showing: results for query 2 (N chunks)"
- **Chunk list:** Map over chunks (fused or per-query based on `selectedQueryIndex`), render `ChunkCard` for each
- Loading spinner while searchWithQueries is in flight
- Error display if action fails

**Strategy-specific rendering table:**

| Strategy | Rewriting panel | Default search view |
|----------|----------------|-------------------|
| identity | Just "Original", no rewriting section | Direct results |
| rewrite | Original + 1 rewritten query | Rewritten query results |
| multi-query | Original + N queries | Fused (RRF) results |
| step-back | Original + 1 abstract query | Fused results |
| hyde | Original + hypothetical answer (expandable) | Results from hypothetical |

**Step 1:** Create component with both panels and all strategy handling.

**Step 2:** Verify build.

**Step 3:** Commit

```bash
git add packages/frontend/src/components/tabs/QuerySearchTab.tsx
git commit -m "feat(frontend): add QuerySearchTab with query rewriting and per-query search results"
```

---

## Phase 6: Refine Tab

### Task 14: Create RefineTab component

**Files:**
- Create: `packages/frontend/src/components/tabs/RefineTab.tsx`

**Context:** Horizontal pipeline stepper showing search input → each refinement stage → final output. Uses the `refine` backend action.

**Interface:**

```tsx
interface RefineTabProps {
  retriever: {
    _id: Id<"retrievers">;
    retrieverConfig: any;
    defaultK: number;
    status: string;
  };
  query: string;
  onQueryChange: (query: string) => void;
}
```

**Implementation notes:**

**Query input (top bar):**
- Same as QuerySearchTab — shared input with `query` prop from parent
- On submit: fire full pipeline (rewriteQuery → searchWithQueries → refine)

**Stage Pipeline Stepper (below query):**
- Horizontal bar showing pipeline nodes connected by arrows
- Nodes: `Search Input (N)` → `Stage 1 (N)` → `Stage 2 (N)` → ... → `Final (N)`
- Each node shows: stage name + chunk count in parentheses
- Arrows between nodes can show `N → M` transformation
- Active node: `bg-accent text-bg` (filled)
- Inactive nodes: `bg-elevated text-dim border border-border` (outlined)
- Click a node → set `selectedStageIndex` state → chunk list below updates
- Styling: `flex items-center gap-1` with `→` separators

**Stage Detail (main area below stepper):**
- Header: "STAGE: [name] ([N] chunks)"
- Chunk list: Map over chunks at selected stage, render `ChunkCard` for each
- **Stage info banner** between the chunk list heading and chunks:
  - Stage type, config details (reranker model for rerank, minScore for threshold, lambda for MMR, etc.)
  - Input→output count
  - Latency
  - Styled as `bg-bg-surface border border-border rounded-lg p-2 text-[11px]`

**No refinement state:** "No refinement stages configured. Search results are the final output." Show the search results directly.

**Loading:** Full-screen spinner while pipeline executes. Each stage appears progressively if we break it into sequential calls (or all at once if using the combined approach).

**Step 1:** Create component with stepper and stage detail view.

**Step 2:** Verify build.

**Step 3:** Commit

```bash
git add packages/frontend/src/components/tabs/RefineTab.tsx
git commit -m "feat(frontend): add RefineTab with pipeline stepper and per-stage chunk inspection"
```

---

## Phase 7: Enhanced Playground Tab

### Task 15: Create PlaygroundTab component

**Files:**
- Create: `packages/frontend/src/components/tabs/PlaygroundTab.tsx`

**Context:** Enhanced version of the current `RetrieverPlayground`. Uses markdown rendering, better chunk display. Uses `retrieveWithTrace` for efficient single-call retrieval.

**Interface:**

```tsx
interface PlaygroundTabProps {
  selectedRetrieverIds: Set<Id<"retrievers">>;
  retrievers: Array<{
    _id: Id<"retrievers">;
    name: string;
    status: string;
    defaultK: number;
  }>;
}
```

**Implementation notes:**
- Port logic from existing `RetrieverPlayground.tsx` (243 lines)
- Key changes from existing:
  1. Use `ChunkCard` component instead of raw text rendering
  2. Use `api.retrieval.pipelineActions.retrieveWithTrace` instead of `api.retrieval.retrieverActions.retrieve`
  3. Show scores more prominently
  4. Chunk cards are expandable with markdown rendering
- Query input + "Retrieve" button at top
- Multi-column grid: 1 col for 1 retriever, 2 cols for 2, 3 cols for 3+
- Column header: retriever name + result count + latency
- Each column: scrollable list of `ChunkCard` components
- Loading state per column (independent)
- Error display per column
- Disabled state: "Select one or more retrievers from the sidebar"

**Step 1:** Create component, porting from existing RetrieverPlayground.

**Step 2:** Verify build.

**Step 3:** Commit

```bash
git add packages/frontend/src/components/tabs/PlaygroundTab.tsx
git commit -m "feat(frontend): add PlaygroundTab with markdown rendering and trace-based retrieval"
```

---

## Phase 8: Page Assembly

### Task 16: Rewrite retrievers page with new layout

**Files:**
- Modify: `packages/frontend/src/app/retrievers/page.tsx`

**Context:** Replace the existing page layout with the new sidebar + tabbed content area. This is the main integration task.

**Implementation notes:**

**State management:**
```tsx
// KB selection (keep existing URL-based hook)
const [selectedKbId, ...] = useKbFromUrl();

// Retriever selection
const [selectedRetrieverId, setSelectedRetrieverId] = useState<Id<"retrievers"> | null>(null);
const selectedRetriever = useQuery(api.crud.retrievers.get, selectedRetrieverId ? { id: selectedRetrieverId } : "skip");

// Tab state
const [activeTab, setActiveTab] = useState<"index" | "query-search" | "refine" | "playground">("index");

// Shared query state (persists across Query+Search and Refine tabs)
const [query, setQuery] = useState("");

// Playground multi-select
const [selectedRetrieverIds, setSelectedRetrieverIds] = useState<Set<Id<"retrievers">>>(new Set());

// Wizard modal
const [showWizard, setShowWizard] = useState(false);
```

**Layout:**
```tsx
<div className="flex h-full">
  {/* Sidebar */}
  <RetrieverSidebar
    selectedKbId={selectedKbId}
    onKbChange={handleKbChange}
    selectedRetrieverId={selectedRetrieverId}
    onRetrieverSelect={setSelectedRetrieverId}
    onNewRetriever={() => setShowWizard(true)}
    isPlaygroundMode={activeTab === "playground"}
    selectedRetrieverIds={selectedRetrieverIds}
    onToggleRetrieverCheck={handleToggleRetrieverCheck}
  />

  {/* Main content */}
  <div className="flex-1 flex flex-col overflow-hidden">
    {selectedRetrieverId && selectedRetriever ? (
      <>
        {/* Tab bar */}
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Tab content */}
        <div className="flex-1 overflow-auto">
          {activeTab === "index" && <IndexTab retriever={selectedRetriever} />}
          {activeTab === "query-search" && <QuerySearchTab retriever={selectedRetriever} query={query} onQueryChange={setQuery} />}
          {activeTab === "refine" && <RefineTab retriever={selectedRetriever} query={query} onQueryChange={setQuery} />}
          {activeTab === "playground" && <PlaygroundTab selectedRetrieverIds={selectedRetrieverIds} retrievers={allRetrievers} />}
        </div>
      </>
    ) : (
      <EmptyState onNewRetriever={() => setShowWizard(true)} />
    )}
  </div>

  {/* Wizard modal (existing) */}
  {showWizard && <RetrieverWizard ... />}
</div>
```

**Tab bar component** (inline in page or separate small component):
- 4 tabs: Index | Query + Search | Refine | Playground
- Active tab: `border-b-2 border-accent text-accent`
- Inactive: `text-dim hover:text-text`
- Style: `flex gap-0 border-b border-border`

**Empty state:**
- Centered vertically and horizontally
- "Select a retriever to inspect its pipeline, or create a new one."
- "Create New Retriever" button

**Key behavior:**
- When `activeTab` changes to "playground", sidebar switches to multi-select mode
- When `activeTab` changes away from "playground", sidebar switches back to single-select
- Query persists across "query-search" and "refine" tabs
- Selecting a different retriever resets query and tab to "index"

**What to remove from current page:**
- Remove the entire left config panel (pipeline config form, preset dropdown, "Create Retriever" form)
- Remove the retriever cards grid
- Remove the inline RetrieverPlayground
- Remove the `RetrieverCardWithProgress` wrapper (progress is now in sidebar)
- Keep: `useKbFromUrl` hook, wizard modal integration, Convex hooks

**Step 1:** Rewrite page.tsx with new layout, importing all new components.

**Step 2:** Verify build

```bash
pnpm -C packages/frontend build
```

**Step 3:** Manual smoke test

```bash
pnpm dev
```

Navigate to retrievers page, verify:
- Sidebar shows KB selector + retriever list
- Clicking a retriever expands it and shows tabs
- Each tab renders without errors (even if data is loading)
- Wizard modal still opens from "New Retriever" button
- Playground tab shows multi-select mode

**Step 4:** Commit

```bash
git add packages/frontend/src/app/retrievers/page.tsx
git commit -m "feat(frontend): rewrite retrievers page with sidebar + tabbed inspector layout"
```

---

## Phase 9: Global Markdown Updates

### Task 17: Update DocumentViewer with raw/rendered toggle

**Files:**
- Modify: `packages/frontend/src/components/DocumentViewer.tsx`

**Context:** The existing `DocumentViewer` used in the generation/knowledge base module currently renders document content as plain `<pre>` text. Add the `MarkdownViewer` component with raw/rendered toggle.

**Implementation notes:**
- Replace the `<pre>` content rendering with `MarkdownViewer`
- Keep the existing highlight system (character span marks) — these work on the raw text
- When in "rendered" mode: Apply highlights to the rendered markdown (this is complex — may need to render markdown and overlay highlights, or only show highlights in raw mode)
- **Pragmatic approach:** Use `MarkdownViewer` for the document content. Highlights (character spans) only work in raw mode. In rendered mode, show the markdown without highlights but note "Switch to raw mode to see highlights" if highlights exist.
- Keep the existing `renderHighlightedText()` function for raw mode

**Step 1:** Update the component.

**Step 2:** Verify build and test in the generation page.

**Step 3:** Commit

```bash
git add packages/frontend/src/components/DocumentViewer.tsx
git commit -m "feat(frontend): add raw/rendered markdown toggle to DocumentViewer"
```

---

### Task 18: Clean up unused components

**Files:**
- Potentially remove or archive: `packages/frontend/src/components/RetrieverCard.tsx` (if fully replaced by RetrieverListItem)
- Potentially remove: `packages/frontend/src/components/RetrieverPlayground.tsx` (if fully replaced by PlaygroundTab)

**Context:** After the new page is working, the old card and playground components are no longer imported. Clean them up.

**Step 1:** Check that no file imports `RetrieverCard` or `RetrieverPlayground` anymore.

```bash
# Grep for imports — if no results, safe to remove
```

**Step 2:** Remove unused files.

**Step 3:** Verify build.

**Step 4:** Commit

```bash
git commit -m "chore(frontend): remove unused RetrieverCard and RetrieverPlayground components"
```

---

## Phase 10: Testing & Verification

### Task 19: Add backend tests for pipeline actions

**Files:**
- Create: `packages/backend/tests/pipelineActions.test.ts`

**Context:** Integration tests for the new pipeline actions using convex-test.

**Test cases:**
1. `rewriteQuery` with identity strategy returns original query unchanged
2. `rewriteQuery` with non-ready retriever throws error
3. `searchWithQueries` returns chunks with scores (requires indexed retriever)
4. `refine` with empty refinement config returns input unchanged
5. `retrieveWithTrace` returns all intermediate results
6. `getChunksByRetrieverPage` returns paginated chunks

**Pattern:** Follow existing test patterns in `packages/backend/tests/helpers.ts`:
- Use `setupTest()` for test context
- Use `seedUser()`, `seedKB()`, `seedDataset()` helpers
- Mock external API calls (OpenAI, Cohere) since these are integration tests

**Step 1:** Write test file.

**Step 2:** Run tests

```bash
pnpm -C packages/backend test
```

**Step 3:** Fix any failures.

**Step 4:** Commit

```bash
git add packages/backend/tests/pipelineActions.test.ts
git commit -m "test(backend): add integration tests for pipeline actions"
```

---

### Task 20: End-to-end verification

**Step 1:** Build everything

```bash
pnpm build && pnpm typecheck && pnpm typecheck:backend
```

**Step 2:** Deploy backend

```bash
cd packages/backend && npx convex dev --once
```

**Step 3:** Start frontend and backend

```bash
pnpm dev:backend &
pnpm dev
```

**Step 4:** Manual E2E test checklist:
- [ ] Select a KB with documents
- [ ] Create a new retriever via wizard
- [ ] Start indexing, verify progress in sidebar
- [ ] After indexing completes, click the retriever
- [ ] **Index tab:** Verify document list, click a document, see chunks with zebra striping, click a chunk pill to inspect
- [ ] **Query + Search tab:** Enter a query, verify rewriting output, verify search results grouped by query
- [ ] **Refine tab:** Verify stage pipeline stepper, click through stages
- [ ] **Playground tab:** Select multiple retrievers, run a query, verify side-by-side results with markdown rendering
- [ ] **Markdown toggle:** Verify raw/rendered works everywhere
- [ ] **Detail modal:** Click "View Full Config" on a retriever, verify full config display
- [ ] **DocumentViewer:** Check generation page still works with new markdown toggle

**Step 5:** Fix any issues found.

**Step 6:** Final commit

```bash
git add -A
git commit -m "fix(frontend): address E2E verification issues"
```

---

## Task Dependency Graph

```
Task 1 (deps)
  → Task 2 (MarkdownViewer) → Task 3 (ChunkCard)
Task 4 (backend queries)
  → Task 5 (rewriteQuery)
    → Task 6 (searchWithQueries)
      → Task 7 (refine)
        → Task 8 (retrieveWithTrace)
Task 2 + 3 → Task 9 (RetrieverListItem)
  → Task 10 (RetrieverDetailModal)
    → Task 11 (RetrieverSidebar)
Task 4 + 2 → Task 12 (IndexTab)
Task 5 + 6 + 3 → Task 13 (QuerySearchTab)
Task 7 + 3 → Task 14 (RefineTab)
Task 8 + 3 → Task 15 (PlaygroundTab)
Task 11-15 → Task 16 (Page Assembly)
Task 2 → Task 17 (DocumentViewer update)
Task 16 → Task 18 (Cleanup)
Task 8 → Task 19 (Backend tests)
Task 16-19 → Task 20 (E2E verification)
```

**Parallelizable groups:**
- Tasks 1-4 can run in parallel (no interdependencies)
- Tasks 5-8 are sequential (each builds on the previous)
- Tasks 9-11 are sequential (each depends on previous)
- Tasks 12-15 can run in parallel (independent tabs) after their deps complete
- Task 16 requires all tabs + sidebar complete
- Tasks 17-19 can run in parallel after their deps
