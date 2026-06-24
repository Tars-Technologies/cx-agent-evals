# Document-Level Images (Decoupled from Chunks) — Design

**Date:** 2026-06-22
**Status:** Approved design / pre-implementation
**Supersedes:** the chunk-coupled image model from `docs/superpowers/plans/2026-06-19-multimodal-agent-images.md` (implemented; this is a structural rework of it)

## Goal

Make knowledge-base images a **document-level** asset that is retrieved and ranked
**independently of which text chunk** contains them, while staying **doc-gated** so
document context guards relevance. Alt text is the single source of truth for image
relevance for now; a future media-description pipeline will enrich it without changing
this architecture.

## Why (the two load-bearing ideas)

1. **Decouple from chunks.** Today an image only surfaces if the exact chunk holding its
   `![alt](url)` ranks in top-k. That misses relevant images and couples image recall to
   text-chunk boundaries. Images should be associated with the **document**.
2. **Keep doc-gating as a relevance guard.** Two images with similar alt/caption (e.g. two
   "dashboard" screenshots) can mean different things in different documents. Restricting
   the candidate pool to the documents that text-retrieval actually matched ensures an
   image belongs to the answer's context — not just superficially similar by caption.
   Ranking *within* that pool by alt-vector then picks the best image.

Net model: **doc-gated pool + alt-vector ranking within the pool + hard cap.**

## Decisions (locked)

- **D1 — Doc-gated + context-aware embedding ranked.** Candidate images = images of the
  documents the retrieved chunks belong to; ranked by cosine(query, image.embedding); top-N
  kept. Image embeddings are context-aware — built from alt + caption + heading + optionally
  surrounding text (see D10, Component 1).
- **D2 — Ranking substrate = stored embedding + in-JS cosine** (no KB-wide vector index).
  The pool is small (matched docs' images), so JS cosine is sufficient. A vector index is
  only needed for KB-wide independent image search, which doc-gating intentionally avoids.
- **D3 — Image processing runs after every scrape/parse**, as its own step, fully
  decoupled from indexing.
- **D4 — Chunks are stripped** of image markdown and annotations (clean text). No
  `documentChunks.metadata.images`.
- **D5 — Doc markdown keeps `![alt](url)`** plus a non-rendering `<!--img:img_id-->`
  annotation (id only; url preserved). Hidden in rendered preview, shown in raw.
- **D6 — Menu delivered in the retrieval tool result**, alongside text chunks (no extra
  tool-call step).
- **D7 — Empty alt → placeholder** (e.g. `"image"`); the future media pipeline supplies a
  real description.
- **D10 — Context-aware embedding input.** Embedding input is built from document context
  extracted at `processDocImages` time (caption, heading, surrounding text). Signal strength
  determines whether surrounding text is included. Any one strong signal skips surrounding
  text; all signals weak falls back to including it. See Component 1 for extraction logic.
- **D8 — Migration deferred** (development only). Existing KBs can be re-scraped /
  reprocessed; no migration tooling in this change.
- **D9 — Hard caps are constants, easily tuned.** `MENU_IMAGE_CAP = 6` (candidates shown
  to the agent), `MAX_IMAGES_PER_TURN = 4` (get_images pixel fetch — unchanged).

## Resolved edge cases (brainstorm 2026-06-24)

These pin down behavior the original draft left implicit. They are reflected in the
component sections below.

- **E1 — One row per `(sourceDocId, imageId)`.** A URL shared across documents (common in
  crawled sites) gets a separate `kbImages` row per document it appears in, not one global
  row. This is what makes `by_source_doc` doc-gating correct: each matched document can
  surface its own images. `getImagesByIds` (`by_image_id().first()`) is unaffected — all rows
  for an id share url/alt. The context-aware embedding legitimately differs per document
  (different caption/heading/surrounding), so per-doc rows are also semantically correct.
  This replaces the old global-per-KB dedup in `upsertImagesForChunk`.
- **E2 — Delete-and-replace per `sourceDocId` on re-process.** At the end of
  `processDocImages`, delete `kbImages` rows for that `sourceDocId` whose `imageId` is not in
  the current parse, then upsert the current set. A re-scrape that removes an image or changes
  its URL leaves **no dead rows** (a changed URL mints a new id + row; the old id's row is
  deleted because it is no longer in the doc). Scoped per `sourceDocId`, so removing a shared
  image from docA never touches docB's row.
- **E3 — Embed failure degrades gracefully.** If the batched embed call fails (or for a
  description-only future row), still upsert the rows with `embedding` undefined.
  `rankDocImagesForQuery` treats missing or dimension-mismatched embeddings as the fallback
  case (document order, no cosine).
- **E4 — Decorative images stay visible in preview.** Decorative images
  (`isLikelyDecorativeImage`) keep their `![alt](url)` in `documents.content` so the preview
  reflects the real page, but get **no `kbImages` row and no `<!--img:…-->` annotation**, so
  they never enter the menu.
- **E5 — Strip-then-reannotate, every run.** `processDocImages` first removes *all*
  `<!--img:…-->` comments from `documents.content`, then re-adds fresh ones from the current
  parse. This keeps annotations correct across re-scrapes (changed alt/url) and makes the
  step fully idempotent — no fragile "already annotated?" detection. Pairs with E2 (content
  side + DB side of the same idempotent re-process).
- **E6 — Saved-answer caveat.** A previously saved agent answer that referenced an imageId
  whose URL later changed will stop resolving (`getImagesByIds` returns nothing; finalize
  whitelist drops the marker). This is inherent to URL churn and accepted for the POC — the
  deterministic-id "stable across re-index" guarantee only holds while the URL is stable.
- **E7 — `processDocImages` runs via a bounded-concurrency WorkPool** (same pattern as
  indexing/generation, `lib/workpool.ts`) rather than a raw `scheduler.runAfter` per doc, so a
  crawl finalizing many docs at once does not slam OpenAI, and transient embed failures retry.
  Within each doc, all images are embedded in one batched call.
- **E8 — Action reads content by `docId`.** The finalize helper schedules `processDocImages`
  with only `{ docId }`; the action re-reads `documents.content` from the DB (current
  committed content, no stale-copy race, no large scheduler args).
- **E9 — Round-robin menu selection.** The menu is built by round-robin across the matched
  documents (visit docs by their best retrieved-chunk rank), taking each doc's best image,
  then second-best, …, deduping by `imageId`, until `MENU_IMAGE_CAP`. This prevents a single
  document from filling all menu slots. Within a doc, images are ranked by cosine (or
  doc-order under E3). `imagesForDocs` skips rows with no resolvable url.

## Data model — `kbImages`

Existing fields: `imageId, kbId, orgId, url, storageId?, alt, sourceDocId, createdAt`.

Add:
- `embedding: v.optional(v.array(v.float64()))` — context-aware embedding (text-embedding-3-small,
  1536 dims). Input is `caption + alt + heading` when any signal is strong, or
  `caption + alt + heading + surrounding` when all signals are weak (see D10). The future
  description pipeline re-embeds `alt + description` into this field.
- `description: v.optional(v.string())` — reserved for the media pipeline; null for now.

**Row identity (E1).** Rows are keyed by `(sourceDocId, imageId)`, not `(kbId, imageId)`.
The same image URL appearing in multiple documents gets one row per document. The old
global-per-KB dedup in `upsertImagesForChunk` is removed. `getImagesByIds` keeps using
`by_image_id().first()` (any row for an id resolves the same url/alt).

Indexes:
- `by_image_id` (existing) — get_images resolution. No longer treated as unique; multiple
  rows may share an `imageId` (one per source doc). `.first()` is intentional and correct.
- `by_kb` (existing).
- **`by_source_doc` (`["sourceDocId"]`)** — new; fetch a document's images, and drive the
  E2 delete-and-replace reconciliation.

Removed: `documentChunks.metadata.images` (stop writing; drop from schema — dev, no migration).

## Component 1 — Post-scrape image processing (new)

A `"use node"` action `processDocImages({ docId })` (needs `node:crypto` for ids + OpenAI
embeddings). Scheduled whenever a document's content is **finalized**, with only `{ docId }`;
the action re-reads `documents.content` from the DB (E8). Runs via a bounded-concurrency
WorkPool, not a raw per-doc schedule (E7).

Steps over `documents.content`:
0. **Strip all existing `<!--img:…-->` comments** from the content before parsing, so
   annotation is rebuilt from the current parse (E5).
1. `parseMarkdownImages` (eval-lib) → complete `![alt](url)`; skip svg/`data:`/non-http.
   Decorative images (`isLikelyDecorativeImage`, unchanged) are skipped for menu purposes —
   no `kbImages` row, no annotation — but their `![alt](url)` stays in `documents.content` so
   the preview still shows them (E4).
2. Per image: mint `imageId = imageIdFor(kbId, url)` (unchanged hash); placeholder alt if
   empty; **build context-aware embedding input** then embed in one batched call per doc:
   - **Caption**: check the line immediately after `![alt](url)` (skip at most one blank
     line). Strong signal: italic formatting (`*...*` / `_..._`), starts with a caption
     keyword (`Figure`, `Fig.`, `Caption:`, `Source:`, `Photo:`), or is a `<figcaption>`
     tag. Weak signal: short plain line (<100 chars, single sentence) — only used as caption
     when alt is also weak.
   - **Heading**: nearest `##` / `###` above the image position in `documents.content`.
   - **Surrounding text**: N chars before and after the image, bounded by the current section
     (between the heading above and next heading below) to prevent cross-section bleed.
   - **Signal check** (any one strong → skip surrounding text):
     - `alt_ok`: `word_count(alt) >= 2` AND `alt` not in `ALT_DENYLIST`
     - `caption_ok`: caption detected via strong signal
     - `heading_ok`: `word_count(heading) >= 3` AND `heading` not in `HEADING_DENYLIST`
   - **Embedding input**: `caption + alt + heading` if `alt_ok OR caption_ok OR heading_ok`;
     otherwise `caption + alt + heading + surrounding` (all signals weak).
3. Upsert `kbImages` row `{ imageId, kbId, orgId, sourceDocId: docId, url, alt, embedding }`
   keyed by `(sourceDocId, imageId)` (E1). If the embed call failed, upsert with `embedding`
   undefined (E3).
4. **Reconcile (E2):** delete `kbImages` rows for this `sourceDocId` whose `imageId` is not in
   the current parse, so removed/URL-changed images leave no dead rows.
5. Re-annotate `documents.content`: insert `<!--img:img_id-->` immediately after each menu
   image's `![alt](url)` (url kept). Decorative images are not annotated (E4). Combined with
   step 0, annotation is rebuilt fresh every run (E5).

Does **not** touch `documentChunks`; does **not** depend on indexing.

**Trigger points (centralize):** every path that finalizes a document's content schedules
`processDocImages` (via the WorkPool, E7):
- crawl content store,
- in-process parse (`documents_actions.parseDocument` inprocess branch),
- Tarser callback (`http.ts` parse_done),
- Asimov poll-done.
Implement a single internal helper the doc-finalize sites call, so the trigger is in one place.
The helper takes `{ docId }` only; the action re-reads content (E8).

## Component 2 — Chunking change

In `kb/indexing_actions.ts` Phase A:
- Remove `extractChunkImages` / `metadata.images` writing.
- Add `stripImageMarkdown(content)` (removes `![alt](url)` occurrences and `<!--img:...-->`
  comments) and apply it to chunk content for both plain and parent-child branches → chunks
  are clean text. (Parents and plain chunks both stripped; child chunks already aren't
  returned as content.)

## Component 3 — Retrieval + ranking (3 tool sites)

`agents/actions.ts`, `lib/agentLoop.ts`, `experiments/agentActions.ts`. After
`vectorSearchWithFilter` returns text chunks:
1. Collect the matched `documentId`s **in retrieved-chunk-rank order** (the doc of the
   highest-ranked chunk first; dedup keeping first occurrence).
2. Fetch those docs' images via a new internalQuery `imagesForDocs({ kbId, documentIds })`
   (uses `by_source_doc`); returns `{ imageId, alt, embedding }` per image, **skipping rows
   with no resolvable url** (E9).
3. **Within each doc**, rank its images by `cosine(queryEmbedding, image.embedding)` — reuse
   the embedding the tool already computed for the chunk search — sort desc (or doc-order under
   the fallback below / E3).
4. **Round-robin across docs (E9):** visit docs in the order from step 1; take each doc's #1
   image, then each doc's #2, … deduping by `imageId` across docs (a shared image counted
   once, first occurrence wins), until `MENU_IMAGE_CAP`. This stops one document from filling
   every slot.
5. Return the menu `[{ imageId, alt }]` alongside the chunks. **url is never returned to the
   model.** Chunk `content` is clean text.

New shared helper `rankDocImagesForQuery(queryEmbedding, docImages, cap)` (pure, in
`lib/visionShared.ts`): takes per-doc image groups in doc order, ranks within each group by
cosine, round-robins across groups with dedup, caps. Replaces `buildImageMenuFromChunks`.

**Embedding-space consistency.** Alt embeddings are produced at scrape time with the system
default model (`text-embedding-3-small`, 1536). Cosine ranking is only meaningful if the
retriever's query embedding is the same model/dimension. So: rank only when
`queryEmbedding.length === image.embedding.length` (same space); otherwise (mismatch, or a
missing embedding under E3) fall back to **document order within each group** and skip cosine,
still round-robining across docs (E9). This avoids a dimension-mismatch bug when a retriever
uses a non-default embedder, at the cost of unranked images for that case.
(A later improvement could embed alt with the retriever's model, but images are processed
before/independently of retriever choice, so the default is the pragmatic POC choice.)

## Component 4 — Answer time (unchanged)

- `get_images` (`lib/vision.ts`): validate ids across the agent's KBs (`getImagesByIds`,
  `kbIds[]`), fetch pixels in-memory (base64, not persisted), cap `MAX_IMAGES_PER_TURN`.
- Finalize: `resolveAnswerImageMarkers` (resolve `img_` markers against `kbImages`) +
  `whitelistImageMarkdown` (rewrite known id→url, drop unknown/external). Agent writes
  `![alt](img_id)`; id + whitelist logic unchanged.

## Component 5 — Preview rendering

Document preview strips `<!--img:id-->` comments in **rendered** mode (invisible) and shows
them verbatim in **raw** mode. The image still renders in preview via its preserved `url`.
Affected: the doc viewer (`DocumentViewer` / `MarkdownViewer`) — ensure HTML comments are
stripped in rendered output.

## Component 6 — Prompt

`IMAGE_INSTRUCTIONS` reworded: "the search results include a ranked list of images from the
relevant documents, each with an `imageId` and `alt` text." Same get_images / inline-marker
flow, id discipline, and decorative/off-topic guards.

## Removed / replaced

- `documentChunks.metadata.images` (schema + all writers/readers).
- `buildImageMenuFromChunks` → `rankDocImagesForQuery` + `imagesForDocs`.
- Image extraction during indexing (`extractChunkImages` in Phase A) → moves to
  `processDocImages`. `extractChunkImages`/`recleanChunkImages` are retired or refolded into
  the doc-processing path.
- `upsertImagesForChunk`'s global-per-KB dedup → upsert keyed by `(sourceDocId, imageId)` plus
  the E2 delete-and-replace reconciliation (a doc-scoped upsert, not a chunk-scoped one).
- "Re-index images" backfill → **per-doc reprocess**: runs `processDocImages` over the KB's
  documents (replaces the chunk-rewrite backfill).

## Constants

```
MENU_IMAGE_CAP = 6        // images shown to the agent per turn (tunable)
MAX_IMAGES_PER_TURN = 4   // get_images pixel fetch cap (unchanged)

// Context-aware embedding (D10)
ALT_DENYLIST     = {"image", "photo", "figure", "screenshot", "logo",
                    "banner", "icon", "img", "graphic", "picture", ""}
HEADING_DENYLIST = {"Overview", "Introduction", "Summary", "Background",
                    "About", "Details", "More", "Content", "Section"}
SURROUNDING_CHARS = 300   // chars before+after image for low-value context
```

## Testing

- eval-lib: `parseMarkdownImages` / decorative filter unchanged (existing tests stand).
- backend (convex-test):
  - `processDocImages`: parses a doc with images → kbImages rows with embedding + alt;
    annotates content with `<!--img:id-->`; idempotent; placeholder alt for empty alt;
    decorative skipped (no row/annotation) but its `![alt](url)` stays in content (E4).
  - context-aware embedding input: strong alt → embed without surrounding; weak alt +
    strong caption → embed without surrounding; all signals weak → embed with surrounding;
    caption detection: italic/keyword = strong, short plain line = weak.
  - E1: a URL shared across two docs → one kbImages row per `sourceDocId`.
  - E2: re-process after removing an image / changing a URL deletes the stale row(s) for that
    doc; re-process after a content edit leaves no `<!--img-->` for removed images (E5).
  - E3: embed-call failure → rows upserted with `embedding` undefined; ranking falls back.
  - chunk stripping: chunk content has no `![..](..)` or `<!--img-->`.
  - `imagesForDocs` + `rankDocImagesForQuery`: doc-gated pool, within-doc cosine ordering,
    round-robin across docs by doc rank, dedup by imageId, cap; skips rows with no url (E9).
  - round-robin (E9): one doc with many high-scoring images cannot fill all `MENU_IMAGE_CAP`
    slots when other matched docs also have images.
  - `getImagesByIds` multi-KB (existing) still passes with multiple rows per imageId (E1).
  - finalize whitelist / resolveAnswerImageMarkers (existing) unchanged.
- Mock embeddings in tests (deterministic vectors) for ranking assertions.

## Out of scope (future)

- **Media description pipeline** — OCR/vision captions populate `description`; re-embed
  `alt + description` into `kbImages.embedding`. Drop-in: no architecture change.
- **Independent (KB-wide) image search** — would add a Convex vector index on `kbImages`;
  intentionally not built (doc-gating is the relevance guard).
- **Migration of existing KBs** — re-scrape / per-doc reprocess instead.
- **PDF images** — built-in PDF parse is text-only; unchanged.
