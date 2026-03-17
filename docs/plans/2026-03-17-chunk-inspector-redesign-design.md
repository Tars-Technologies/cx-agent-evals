# Chunk Inspector Redesign — Design Document

**Goal:** Redesign the Chunk Inspector UX for clarity and usability, fix two bugs, implement proper parent-child backend support, and add index→search interaction notes.

**Scope:**
1. Chunk Inspector UX redesign (stats banner, click-to-highlight document view, improved chunk list/details)
2. Bug fix: `<last>` tag error in MarkdownViewer
3. Bug fix: RecursiveCharacterChunker overlap duplication
4. Parent-child backend implementation (indexing, retrieval, schema)
5. Index→search interaction notes in wizard and config UI

---

## 1. Stats Banner

**Replaces:** `IndexConfigBanner` in `IndexTab.tsx:798-821` (currently hardcodes "recursive").

**New design:** Two-row banner at the top of the Index tab.

**Row 1 — Config info:** Actual chunker name from registry (not hardcoded), chunk size/overlap, embedding model. For parent-child: shows "child: 200/0, parent: 1000/100".

**Row 2 — Metric cards:** Four inline cards:
- Total chunks (number)
- Average chunk size (chars)
- Min/max chunk size range
- Overlap % (computed from adjacent chunk overlap / avg chunk size)

**Collapsible histogram:** "Show distribution" toggle expands a bar chart of chunk size distribution. Buckets of ~100 chars. Rendered with plain `<div>` bars (no charting library). Hidden by default to avoid cognitive overload.

**For parent-child retrievers:** Additional note: "Searched: child chunks (200 chars) → Returns: parent chunks (1000 chars)".

**Stats computation:** Runs client-side over the loaded chunks. For large chunk sets, compute incrementally as pages load.

---

## 2. Clean Document View with Click-to-Highlight

**Replaces:** Current annotated document view with numbered pills `[1]`, `[2]` and zebra-striped backgrounds (`IndexTab.tsx:490-539`).

### Default state

The document renders exactly as uploaded — no pills, no stripes, no inline modifications. The text looks natural and unmodified.

### Chunk boundary markers

Thin vertical hairline markers appear in a narrow left margin (outside the document content) at chunk boundary positions. These are subtle, always visible, and don't disturb reading. Similar to line numbers in a code editor but thinner.

### Click interaction

1. **Click anywhere** in the document text.
2. System finds which chunk(s) contain that character position (binary search over sorted `start`/`end` ranges).
3. **Single chunk hit:** The chunk's span highlights with `bg-accent/10`. The right panel scrolls to show that chunk's details.
4. **Overlap region hit** (two chunks share this position): Both chunks highlight — earlier chunk in `bg-accent/10`, later chunk in `bg-blue-400/10`, overlap intersection in `bg-yellow-500/15`. Right panel shows both chunks.
5. **Click elsewhere or press Escape:** Clears the highlight.

### Scroll-to-chunk

When selecting a chunk from the right panel's list, the document auto-scrolls to center that chunk and highlights it.

### View modes

Keep Raw/Rendered toggle. In Rendered mode (markdown), chunk highlighting still works via character position mapping. The hairline markers are hidden in rendered mode (markdown rendering changes positions).

---

## 3. Right Panel — Chunk List & Details

**Replaces:** Current `ChunkInspectorPanel` (`IndexTab.tsx:545-792`) with its "List All" toggle, diff detection badges, and overlap arrows.

### Chunk list (top section, always visible)

Compact scrollable list with:
- **Search box:** Filters chunks by text content match.
- **Jump-to:** Type a chunk number to jump directly.
- Each row: `#N` + char count + proportional size bar (relative to largest chunk).
- Click a row → highlights chunk in document, shows details below.
- **For parent-child:** Grouped view — parent rows (collapsible) with indented child rows.
- **Virtualized rendering** for performance with large chunk counts (14k+).

### Chunk detail (bottom section, when chunk selected)

**Header:** "Chunk #42 · 582 chars · chars 24,180→24,762"

**Primary content — Extra content (if any):**
- **Contextual prefix** (for contextual indexing): Shown prominently with a label "Contextual Prefix" and a subtle blue background. This is the mini-summary that was prepended before embedding.
- **Summary replacement** (for summary indexing): Shown with a label "Embedded Summary" and a note "This summary was embedded instead of the original text."
- **Parent-child info:** If child is selected, shows "Part of Parent #N (1000 chars)" with a link. If parent selected, shows "Contains N child chunks" with links.

**Divider:** "— chunk content follows —"

**Collapsible original chunk text:** "▶ Show chunk text (582 chars)" — collapsed by default since it's already visible highlighted in the document view. Expandable on click.

**Collapsible sections:**
- **Metadata** (accordion): Key-value pairs, only if metadata exists.
- **Overlap info** (accordion): Which adjacent chunks overlap and by how many chars. Low priority since overlap is visible in the document view.

**Navigation:** `[← Prev] 42/1752 [Next →]` at the bottom.

**Removed from current design:**
- Diff detection badges (match/prefix/summary) — replaced by the extra content section above.
- Overlap directional arrows — visible in document view instead.
- "Original Text" section — redundant, visible in the document.

---

## 4. Bug Fix: `<last>` Tag Error in MarkdownViewer

**Root cause:** Document content (e.g., legal documents) contains non-standard HTML/XML tags like `<last>`, `<first>`. The `rehypeRaw` plugin parses these as valid HTML elements. Since `markdownComponents` has no mapping, React creates native DOM elements, triggering browser warnings.

**Fix:** Add `rehype-sanitize` after `rehypeRaw` in the plugin chain in `MarkdownViewer.tsx:294-297`:

```tsx
rehypePlugins={[rehypeRaw, rehypeSanitize]}
```

This strips unknown/non-standard HTML tags while preserving their text content, and also provides XSS protection.

**Files:**
- Install: `rehype-sanitize` package
- Modify: `packages/frontend/src/components/MarkdownViewer.tsx`

---

## 5. Bug Fix: RecursiveCharacterChunker Overlap Duplication

**Root cause:** In `packages/eval-lib/src/chunkers/recursive-character.ts`, the `_splitTextWithPositions` method's overlap retention logic (lines 129-135) retains entire paragraphs that exceed the overlap threshold. When the retained content + next paragraph exceeds `chunkSize`, `emitCurrent()` recursively re-splits content that was already emitted, producing duplicate and near-duplicate chunks.

**Impact:** With 400/80 chunkSize/overlap (OpenClaw preset), this produces an 8x chunk inflation (14,109 chunks vs expected ~4,500). The 1000/200 default is less affected because paragraphs rarely exceed the chunk size.

**Fix approach:** After `emitCurrent()`, cap the retained overlap content so it cannot trigger recursive re-splitting of already-emitted text. The overlap retention should truncate retained content to exactly `chunkOverlap` characters rather than retaining entire paragraphs.

**Files:**
- Modify: `packages/eval-lib/src/chunkers/recursive-character.ts` (lines 100-147)
- Add/modify tests: `packages/eval-lib/tests/unit/chunkers/recursive-character.test.ts`

---

## 6. Parent-Child Backend Implementation

**Current limitation:** Backend always uses `strategy: "plain"` (`retrieverActions.ts:107`), ignoring parent-child config. No parent/child relationship stored in DB.

### Schema approach

Use `metadata` field on `documentChunks` (no schema migration needed since `metadata` is `v.any()`):
- Parent chunks: `metadata.level = "parent"`, no embedding
- Child chunks: `metadata.level = "child"`, `metadata.parentChunkId = <convex_id_of_parent>`, has embedding

### Backend indexing (`retrieverActions.ts`)

When `strategy === "parent-child"`:
1. Create parent chunks with `RecursiveCharacterChunker(parentChunkSize, parentOverlap)`
2. Create child chunks with `RecursiveCharacterChunker(childChunkSize, childOverlap)`
3. Insert parent chunks first (to get Convex `_id`s back)
4. Map each child to its enclosing parent (containment check: `parent.start <= child.start && parent.end >= child.end`)
5. Insert child chunks with `metadata.parentChunkId` set
6. Embed only child chunks (parents skip embedding)

### Backend retrieval (`experiments/actions.ts`)

After vector search returns scored child chunks:
1. For each child, read `metadata.parentChunkId` and fetch parent chunk
2. Deduplicate by parent `_id` (keep highest child score)
3. Return parent chunks with child's score

### Chunk count

Store both `childChunkCount` and `parentChunkCount` on the retriever record, or compute from metadata at display time.

---

## 7. Index→Search Interaction Notes

**Problem:** The search config UI (dense/BM25/hybrid) doesn't communicate what's actually being searched, which varies by index strategy.

### Solution

Add a contextual info box below the search strategy selector in the wizard's Search step and the QuerySearchTab. The note changes based on the selected index strategy:

| Index Strategy | Note |
|---|---|
| Plain | No note (or "Search runs directly on chunks.") |
| Parent-child | "Search runs on child chunks ({childSize} chars). Matching children are automatically mapped to their parent chunks ({parentSize} chars)." |
| Contextual | "Search runs on chunks with a contextual prefix — a few sentences situating the chunk in its document." |
| Summary | "Search runs on LLM-generated summaries. Matching summaries return the original chunk content." |

Show this note in:
- Wizard Search step
- QuerySearchTab config panel
- Review step (summary section)
- Chunk Inspector stats banner (for parent-child)

---

## 8. Chunker × Index Strategy Compatibility

All 7 chunkers (recursive-character, sentence, token, markdown, semantic, cluster-semantic, LLM-semantic) implement `PositionAwareChunker` and produce `PositionAwareChunk` with universal `start/end/content/metadata` fields. The Chunk Inspector design uses only these universal fields, so **all chunker types work without design changes**.

The chunker determines *where* to split. The index strategy determines *what to do* with chunks after splitting. These are orthogonal. The Chunk Inspector handles both:
- Chunker differences → visible in boundaries, sizes, distribution (stats + document view)
- Index strategy differences → visible in extra content (chunk detail panel)

---

## File Impact Summary

| File | Change Type | Purpose |
|---|---|---|
| `packages/frontend/src/components/tabs/IndexTab.tsx` | Major rewrite | Stats banner, click-to-highlight, chunk list/details |
| `packages/frontend/src/components/MarkdownViewer.tsx` | Minor | Add rehype-sanitize |
| `packages/eval-lib/src/chunkers/recursive-character.ts` | Bug fix | Fix overlap duplication |
| `packages/eval-lib/tests/unit/chunkers/recursive-character.test.ts` | Test update | Test overlap fix |
| `packages/backend/convex/retrieval/retrieverActions.ts` | Feature | Parent-child indexing |
| `packages/backend/convex/retrieval/indexingActions.ts` | Feature | Parent-child chunk insertion |
| `packages/backend/convex/experiments/actions.ts` | Feature | Parent-child retrieval swap |
| `packages/frontend/src/components/wizard/steps/*.tsx` | Minor | Index→search notes |
| `packages/frontend/src/components/tabs/QuerySearchTab.tsx` | Minor | Index→search notes |

---

## Tech Stack

- React, TypeScript, Tailwind CSS (existing)
- `rehype-sanitize` (new dependency)
- Convex (existing backend)
- No charting library — histogram uses plain `<div>` bars
