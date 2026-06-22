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

- **D1 — Doc-gated + alt-vector ranked.** Candidate images = images of the documents the
  retrieved chunks belong to; ranked by cosine(query, alt-embedding); top-N kept.
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
- **D8 — Migration deferred** (development only). Existing KBs can be re-scraped /
  reprocessed; no migration tooling in this change.
- **D9 — Hard caps are constants, easily tuned.** `MENU_IMAGE_CAP = 6` (candidates shown
  to the agent), `MAX_IMAGES_PER_TURN = 4` (get_images pixel fetch — unchanged).

## Data model — `kbImages`

Existing fields: `imageId, kbId, orgId, url, storageId?, alt, sourceDocId, createdAt`.

Add:
- `embedding: v.optional(v.array(v.float64()))` — alt-text embedding (text-embedding-3-small,
  1536 dims). The future description pipeline re-embeds `alt + description` into this field.
- `description: v.optional(v.string())` — reserved for the media pipeline; null for now.

Indexes:
- `by_image_id` (existing) — get_images resolution.
- `by_kb` (existing).
- **`by_source_doc` (`["sourceDocId"]`)** — new; fetch a document's images.

Removed: `documentChunks.metadata.images` (stop writing; drop from schema — dev, no migration).

## Component 1 — Post-scrape image processing (new)

A `"use node"` action `processDocImages({ docId })` (needs `node:crypto` for ids + OpenAI
embeddings). Scheduled whenever a document's content is **finalized**.

Steps over `documents.content`:
1. `parseMarkdownImages` (eval-lib) → complete `![alt](url)`; skip svg/`data:`/non-http and
   decorative (`isLikelyDecorativeImage`, unchanged).
2. Per image: mint `imageId = imageIdFor(kbId, url)` (unchanged hash); placeholder alt if
   empty; **embed alt text** (one batched embed call for the doc's images).
3. Upsert `kbImages` row `{ imageId, kbId, orgId, sourceDocId: docId, url, alt, embedding }`
   (idempotent by imageId; updates embedding/alt if changed).
4. Annotate `documents.content`: insert `<!--img:img_id-->` immediately after each
   `![alt](url)` (url kept). Idempotent — skip images already annotated.

Does **not** touch `documentChunks`; does **not** depend on indexing.

**Trigger points (centralize):** every path that finalizes a document's content schedules
`processDocImages`:
- crawl content store,
- in-process parse (`documents_actions.parseDocument` inprocess branch),
- Tarser callback (`http.ts` parse_done),
- Asimov poll-done.
Implement a single internal helper the doc-finalize sites call, so the trigger is in one place.

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
1. Collect unique `documentId`s from the returned chunks.
2. Fetch those docs' images via a new internalQuery `imagesForDocs({ kbId, documentIds })`
   (uses `by_source_doc`); returns `{ imageId, alt, embedding }` per image.
3. Rank by **cosine(queryEmbedding, image.embedding)** — reuse the embedding the tool already
   computed for the chunk search — sort desc; dedup by imageId across docs.
4. Cap to `MENU_IMAGE_CAP`.
5. Return the menu `[{ imageId, alt }]` alongside the chunks. **url is never returned to the
   model.** Chunk `content` is clean text.

New shared helper `rankDocImagesForQuery(queryEmbedding, images, cap)` (pure, in
`lib/visionShared.ts`; cosine + sort + cap). Replaces `buildImageMenuFromChunks`.

**Embedding-space consistency.** Alt embeddings are produced at scrape time with the system
default model (`text-embedding-3-small`, 1536). Cosine ranking is only meaningful if the
retriever's query embedding is the same model/dimension. So: rank only when
`queryEmbedding.length === image.embedding.length` (same space); otherwise fall back to
document order (first `MENU_IMAGE_CAP`) and skip cosine. This avoids a dimension-mismatch bug
when a retriever uses a non-default embedder, at the cost of unranked images for that case.
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
- "Re-index images" backfill → **per-doc reprocess**: runs `processDocImages` over the KB's
  documents (replaces the chunk-rewrite backfill).

## Constants

```
MENU_IMAGE_CAP = 6        // images shown to the agent per turn (tunable)
MAX_IMAGES_PER_TURN = 4   // get_images pixel fetch cap (unchanged)
```

## Testing

- eval-lib: `parseMarkdownImages` / decorative filter unchanged (existing tests stand).
- backend (convex-test):
  - `processDocImages`: parses a doc with images → kbImages rows with embedding + alt;
    annotates content with `<!--img:id-->`; idempotent; placeholder alt for empty alt;
    decorative skipped.
  - chunk stripping: chunk content has no `![..](..)` or `<!--img-->`.
  - `imagesForDocs` + `rankDocImagesForQuery`: doc-gated pool, cosine ordering, cap, dedup.
  - `getImagesByIds` multi-KB (existing) still passes.
  - finalize whitelist / resolveAnswerImageMarkers (existing) unchanged.
- Mock embeddings in tests (deterministic vectors) for ranking assertions.

## Out of scope (future)

- **Media description pipeline** — OCR/vision captions populate `description`; re-embed
  `alt + description` into `kbImages.embedding`. Drop-in: no architecture change.
- **Independent (KB-wide) image search** — would add a Convex vector index on `kbImages`;
  intentionally not built (doc-gating is the relevance guard).
- **Migration of existing KBs** — re-scrape / per-doc reprocess instead.
- **PDF images** — built-in PDF parse is text-only; unchanged.
