# Image Ranking: Relevance Threshold + Per-Doc Cap — Design

**Date:** 2026-06-25
**Status:** Approved design / pre-implementation
**Builds on:** `2026-06-22-document-level-images-design.md` (doc-level images, E1–E9)

## Goal

Improve image *menu* quality by (B4) suppressing images that aren't actually
relevant to the query, and (B5) replacing round-robin selection with a global
cosine ranking that caps how many images any single document can contribute.
Both changes are isolated to one pure function and two constants.

## Why

- **B4 — relevance threshold.** Today the menu always returns up to
  `MENU_IMAGE_CAP` images even when every candidate is a weak match, so off-topic
  images surface when the document simply has no relevant image. A minimum cosine
  floor removes them (precision win).
- **B5 — global sort + per-doc cap.** Round-robin biases toward *document
  coverage* over *image relevance*: a weakly-matched doc's best image can be
  chosen before a strongly-matched doc's second (higher-cosine) image. Sorting all
  candidates by cosine and capping per document keeps the genuinely best images on
  top while still preventing one document from monopolizing the menu.

Net conceptual shift: from "doc-rank first, image-cosine second" (round-robin) to
"image-cosine first, per-doc cap for diversity."

## Scope

Single pure function `rankDocImagesForQuery` in
`packages/backend/convex/lib/visionShared.ts`, plus two constants there. No schema
change, no retrieval-site change, no query change — the DB-side caller
(`rankedImagesForDocs` in `kb/images.ts`) already passes `queryEmbedding`,
`documentIds` (in doc-rank order), and `cap`, and receives `[{imageId, alt}]`.
Round-robin logic is deleted.

## Algorithm (new `rankDocImagesForQuery`)

Input unchanged: `(queryEmbedding: number[], docGroups: DocImage[][], cap: number)`,
where `docGroups` are pre-ordered by document relevance (best retrieved-chunk rank
first). Output unchanged: `ImageMenuEntry[]` = `[{imageId, alt}]`.

Define "usable embedding" = `image.embedding` present AND
`image.embedding.length === queryEmbedding.length`.

1. **Score.** Flatten all images, tagging each with its document index (for the
   per-doc cap) and its first-occurrence order (for dedup + stable fallback). For
   each image compute `score = cosine(query, embedding)` when usable; otherwise
   mark it unscored.
2. **Branch on whether ANY image is usable:**
   - **At least one usable (normal path):**
     a. Drop images with `score < MIN_IMAGE_SIMILARITY` (B4).
     b. Drop unscored images entirely (Q6 — an un-scoreable image never jumps
        ahead of a scored one).
     c. Sort survivors by `score` desc (stable; ties keep first-occurrence order).
     d. Compute the **effective per-doc cap** (see below) from the surviving pool.
     e. Walk the sorted list, skipping any image whose document already has the
        effective cap selected and any duplicate `imageId`; stop at `cap`.
   - **None usable (fallback, Q4b — e.g. non-default retriever dim mismatch, or
     embeds failed):** ignore the threshold (cosine is meaningless), and select in
     document order — walk `docGroups` in order, within each doc keep input order,
     applying the effective per-doc cap and dedup, until `cap`. This preserves the
     pre-change "show something sensible" behavior rather than showing nothing.

**Effective per-doc cap (Q-followup, option b).** The per-doc cap exists only to
stop one document beating others, so it is applied **only when the candidate pool
spans more than one document**. Count the distinct documents that contribute at
least one *eligible* image (post-threshold in the normal path; all images in the
fallback path). If that count is `1`, the effective cap is `MENU_IMAGE_CAP` (no
limit — a single relevant document may fill all six slots). If it is `> 1`, the
effective cap is `PER_DOC_IMAGE_CAP`.

Dedup by `imageId` is global across documents in both paths (a shared image counts
once; first occurrence wins).

## Constants (in `visionShared.ts`, beside `MENU_IMAGE_CAP`)

```
MENU_IMAGE_CAP       = 6     // total images shown to the agent (unchanged)
PER_DOC_IMAGE_CAP    = 2     // max images one document may contribute (B5)
MIN_IMAGE_SIMILARITY = 0.2   // cosine floor; below this an image is off-topic (B4)
```

`MIN_IMAGE_SIMILARITY = 0.2` is a deliberately conservative starting floor for
`text-embedding-3-small` alt embeddings (better to occasionally pass a marginal
image than to hide a relevant one). It is explicitly a tuning knob to revisit once
image-retrieval metrics (feature C8) exist; raising it trades recall for precision.
Likewise `PER_DOC_IMAGE_CAP = 2` lets an image-rich document contribute a pair
without dominating six slots.

## Edge cases

- **Empty result is valid.** If all candidates fall below the threshold, the menu
  is empty and the agent shows no image — the desired B4 outcome.
- **Fewer than `cap` survivors.** Return what passes; never pad with sub-threshold
  images.
- **Per-doc cap larger than a doc's image count.** No effect — the doc just
  contributes all it has.
- **Mixed pools** (some usable, some not, with ≥1 usable): unscored images are
  dropped (Q6); only the normal path runs.
- **Single matched document (option b):** the per-doc cap is **not** applied — a
  lone relevant document may fill up to `MENU_IMAGE_CAP`. The cap only guards
  against cross-document domination, which can't happen with one document. (This
  is the common single-relevant-doc query, so under-showing there would hurt.)

## Testing (extend `tests/vision.test.ts`)

`rankDocImagesForQuery` unit tests (pure, deterministic vectors):
- threshold: an image below `MIN_IMAGE_SIMILARITY` is excluded; one at/above is kept.
- all-below-threshold → empty menu.
- per-doc cap (multi-doc pool): with images from >1 doc, any single doc
  contributes at most `PER_DOC_IMAGE_CAP`; remaining slots go to other docs.
- single-doc pool (option b): when all eligible images come from one document,
  the cap is NOT applied — it may fill up to `MENU_IMAGE_CAP`.
- global ordering: a strongly-matched doc's high-cosine image outranks a
  weakly-matched doc's lower-cosine image (the round-robin regression case).
- dedup: a shared `imageId` across docs counts once.
- fallback (no usable embeddings): doc-order selection with per-doc cap, threshold
  ignored, non-empty.
- mixed pool: unscored images dropped when a usable one exists.

Existing round-robin tests are replaced by the above (round-robin is removed).
The DB-side `rankedImagesForDocs` convex-test continues to assert the menu shape;
update its expected ordering to the new algorithm.

## Out of scope

- OCR / media-description pipeline (A1/A2) — pending senior sign-off, later.
- Image-retrieval metrics (C8) — needed to *tune* `MIN_IMAGE_SIMILARITY`
  empirically, but not part of this change.
- Per-KB configurability of the constants — YAGNI for now.
