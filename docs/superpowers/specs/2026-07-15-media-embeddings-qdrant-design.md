# Media Embeddings → Qdrant Migration

**Date:** 2026-07-15
**Status:** Approved, implementing

## Goal

Move `kbMedia` (image/video) context embeddings out of Convex (`kbMedia.embedding`
inline vectors) into Qdrant, mirroring the existing document-chunk Qdrant path.
Text-only embeddings (no visual/multimodal change). Full cutover — Qdrant is the
only storage path for media vectors; no dual-mode toggle, no backfill (the table
is effectively empty).

## Constraints (from the user)

1. **Same Qdrant instance**, a *separate collection* — not a second Qdrant.
   Reuse `QDRANT_URL` / `QDRANT_API_KEY` and `backendConfig.qdrant`.
2. **No backfill** — DB is empty; ship the cutover directly.
3. **No behavior changes** — the doc-gated image menu output is byte-identical
   to today. Only the *storage location* of the vectors changes.

## Non-goals

- Visual/multimodal embedding (embedding actual pixels). Media vectors stay
  text-derived via `buildImageEmbeddingInput` + the default OpenAI embedder
  (`text-embedding-3-small`, 1536). Noted as future work.
- A per-KB / per-retriever media-backend toggle.

## Current state

- `processDocImages` (`kb/images_actions.ts`) builds a text embedding input per
  media item, embeds with `createEmbedder()` (default OpenAI 1536), and writes
  the vector inline into `kbMedia.embedding` via `upsertDocImages`.
- Skip-reembed: `embeddingInputHash = sha256("<model>:<input>")`; unchanged items
  reuse the prior vector (read from `kbMedia`) and skip the OpenAI call.
- Read path: `rankedImagesForDocs` (`kb/images.ts`, an `internalQuery`) reads each
  retrieved doc's `kbMedia` rows, ranks images by cosine to the query embedding
  **inside the query** via `rankDocImagesForQuery`, returns `[{imageId, alt, type}]`.
  Called from 3 `"use node"` actions: `lib/agentLoop.ts`, `agents/actions.ts`,
  `experiments/agentActions.ts`.

## Design

### 1. eval-lib: `QdrantMediaStore` (new)

`packages/eval-lib/src/vector-stores/qdrant-media.ts`. A small, dense-only Qdrant
store, independent from the chunk-shaped `QdrantVectorStore` (different point-id
scheme, different payload, and it exposes **fetch-by-id** rather than ANN search —
which the chunk store does not need). Reuses the shared `requestJSON` HTTP core
(retry, redirect-safety) exactly like `QdrantVectorStore`.

API:

- `ensureCollection()` — create if absent (Cosine, configured dimension,
  on-disk + int8 quant hardening like the chunk store); create payload indexes on
  `kbId` (tenant key, `is_tenant`) and `sourceDocId` (for filtered delete).
- `upsert(items, scope)` — `items: {imageId, embedding, alt, mediaType}[]`,
  `scope: {kbId, orgId, sourceDocId}`. Point id = `mediaPointId(imageId)` (UUID
  from `sha256(imageId)`; `imageId` already encodes `kbId+url`, so it is globally
  unique without extra scope). Payload carries `imageId, kbId, orgId, sourceDocId,
  alt, mediaType`.
- `fetchByIds(imageIds, {kbId})` — Qdrant `POST /points` retrieve by point id with
  `with_vector: true`; returns `{imageId, embedding}[]`, dropping any row whose
  payload `kbId` ≠ the requested `kbId` (defense-in-depth tenant scoping).
- `deleteByIds(imageIds)` — targeted `points/delete` by point id, so a re-scrape
  removes exactly the media it no longer references while leaving unchanged
  points (and their vectors) intact. `deleteBySourceDoc(sourceDocId, {kbId})` is
  also provided (filtered delete) for future whole-document cleanup.
- Tolerates an unprovisioned collection: `fetchByIds`/`deleteBySourceDoc` treat
  404 as empty/no-op, matching the chunk store.

Collection name: `mediaCollectionName(provider, model)` → `kb_media_<provider>_<model>`
(distinct `kb_media_` prefix so it never collides with chunks' `kb_vec_`). Derived
from the fixed media embedder identity (openai / text-embedding-3-small today).

### 2. Backend: media runtime (`kb/media_runtime.ts`, `"use node"`)

- `buildQdrantMediaStore()` — mirrors `buildQdrantStore`; reads `backendConfig.qdrant`,
  throws the same "QDRANT_URL not set" error when absent (media has no fallback now).
- `rankMediaForDocs(ctx, {kbId, documentIds, queryEmbedding, cap})` — plain helper
  (not a Convex function): runs the metadata query, fetches vectors from Qdrant,
  assembles `DocImage[][]`, and calls the **unchanged** `rankDocImagesForQuery`.
  Output identical to today's `rankedImagesForDocs`.

### 3. Backend: write path (`kb/images_actions.ts`)

`processDocImages` changes:
- Load prior `{imageId, embeddingInputHash}` (no `embedding` — it's gone from
  `kbMedia`).
- Diff: unchanged (hash matches) → skip embed *and* skip re-upsert (point already
  in Qdrant). Changed/new → embed + upsert. Removed (prior − current) →
  `deleteByIds(removedIds)`, leaving unchanged points untouched so their vectors
  persist and the skip optimization holds.
- The store is built at the **embedder's** dimension (not a hardcoded 1536) so
  the collection is created to fit whatever vectors the media embedder produces.
- On embed failure: do **not** persist `embeddingInputHash` for that item (leave
  undefined) so the next run recomputes — preserving today's "hash present ⟺
  vector exists" invariant (previously guaranteed by `&& prev.embedding`).
- `upsertDocImages` mutation + `kbMedia` schema: **remove** the `embedding` field.

### 4. Backend: read path

- `kb/images.ts`: new `mediaMetaForDocs` `internalQuery` returning
  `{documentId, imageId, alt, mediaType}[]` (no vectors). Remove `embedding` from
  `imagesForDocs` / `docImageEmbeddings` / `upsertDocImages`. Delete the old
  in-query `rankedImagesForDocs` (ranking moves to the node helper).
- 3 call sites swap `ctx.runQuery(internal.kb.images.rankedImagesForDocs, …)` →
  `rankMediaForDocs(ctx, …)` (direct helper call; all 3 are already `"use node"`).

### 5. Schema

`kbMedia`: **keep `embedding` as `v.optional`** but stop writing/reading it.
(The dev DB turned out NOT to be empty — it holds legacy rows with inline 1536-d
vectors, e.g. Perseverance imagery — so removing the field outright fails Convex
schema validation. Widen-not-remove is the safe path.) `upsertDocImages` sets
`embedding: undefined` on patch so a re-scraped row sheds its dead vector over
time. Keep `embeddingInputHash`, `manualContext`, everything else.

### 5a. Existing-data caveat (ranking regression until re-scrape)

Legacy rows have inline vectors but NO Qdrant point. After the cutover, reads
fetch vectors from Qdrant only, so a legacy image's cosine score is unavailable
and it falls back to doc-order ranking until its document is re-scraped (which
upserts its vector to Qdrant). Backfill was deprioritized; if that regression
matters, a one-off action can copy `kbMedia.embedding` → the media collection
(no re-embedding cost) to restore cosine ranking immediately.

## Testing

- **eval-lib** (`tests/unit/vector-stores/qdrant-media.test.ts`, fetch-mocked like
  `qdrant.test.ts`): `mediaPointId` determinism, collection naming, `ensureCollection`
  create + payload indexes, `upsert` payload/point shape, `fetchByIds` (vector
  round-trip + cross-tenant drop + 404→[]), `deleteBySourceDoc` (filter + 404 no-op).
- **backend** (`tests/images.test.ts`, rework): a `FakeQdrant` fetch handler
  (in-memory) stubbed via `vi.stubGlobal("fetch")` + `QDRANT_URL` env, asserting
  `processDocImages` embeds only changed items (embed-call count), removed media are
  deleted from Qdrant, and `rankMediaForDocs` reproduces the prior ranked-menu output.

## Future work

- Multimodal/visual media embedding (Cohere `embed-v4` / Voyage `voyage-multimodal-3`)
  into the same media collection — additive, per-image cost, new embedder seam.
