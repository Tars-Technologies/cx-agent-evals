# Videos as Media — Design

**Date:** 2026-07-01
**Status:** Approved design / pre-implementation
**Builds on:** `2026-06-22-document-level-images-design.md` (doc-level images) and
`2026-06-25-image-ranking-threshold-perdoc-cap-design.md` (B4/B5 ranking).

## Goal

Let embedded **videos** on scraped webpages be surfaced to the agent the same way
images are: doc-gated, ranked by query relevance, and rendered in the answer — as a
sandboxed iframe/`<video>` rather than pixels. This generalizes the image system to
generic media without changing the ranking substrate.

## Why

Webpages embed videos (YouTube/Vimeo/Loom/Wistia players, HTML5 `<video>`), but the
scraper **strips them today** — `<iframe>` is in `BOILERPLATE_SELECTORS` (removed
before HTML→markdown), and `<video>`/`<source>` aren't handled, so they never reach
`documents.content`. Images survive only because `<img>` is special-cased. Videos are
therefore *lost entirely*, unlike linked docs (plain `<a>` links survive as markdown
links). Closing that gap is the real work.

**Out of scope by prior decision:** linked/embedded *documents* (PDF/Doc viewers) are
NOT ingested — important docs come through the normal ingest pipeline; a plain doc
link already survives as markdown text. This spec is videos only.

## Decisions (locked)

- **V1 — Unified `kbMedia`.** Rename `kbImages` → `kbMedia`, add
  `mediaType: "image" | "video"`. Existing rows become `"image"`. Dev-stage, no data
  migration (re-scrape). The id field and its `img_<hash>` format are **kept as-is**
  (opaque, deterministic `imageIdFor(kbId, url)`) so the media-agnostic answer marker,
  whitelist regex, and `get_images` resolution keep working unchanged and saved
  answers stay stable. (Cosmetic field rename is optional cleanup, not required.)
- **V2 — Capture scope.** (a) `<iframe>` players on an **allowlist** of domains
  (YouTube, Vimeo, Loom, Wistia) and (b) HTML5 `<video>`/`<source>` with direct
  `.mp4`/`.webm` URLs. Everything else ignored.
- **V3 — Markdown representation.** A normalized token
  `[embed:video](url "title")` carries the video through `documents.content`
  (markdown has no native video syntax). Parses cleanly and reuses the existing
  strip/annotate machinery.
- **V4 — Model sees context only (v1).** The retrieval menu entry carries
  `{mediaId, type:"video", label}`; the model decides relevance from the **text
  context** and emits a marker. No pixel fetch, no thumbnail in v1 (poster-frame
  extraction is a later add).
- **V5 — Rendered as a sandboxed iframe/`<video>`, domain-allowlisted.** The answer
  marker resolves to the stored embed URL; the frontend renderer picks the element by
  URL, and only allowlisted domains are iframed.

## Data model — `kbMedia` (was `kbImages`)

Add:
- `mediaType: v.union(v.literal("image"), v.literal("video"))`.

Unchanged: `imageId` (opaque media id, `img_<hash>`), `kbId`, `orgId`, `url`,
`alt` (holds the video *title/label* for videos), `embedding`, `embeddingInputHash`,
`sourceDocId`, `description` (reserved). Indexes unchanged (`by_image_id`, `by_kb`,
`by_source_doc`).

For videos, `url` stores the **embed-form** URL (e.g. `youtube.com/embed/ID`), so
answer-time and the frontend can iframe it directly.

## Component 1 — Scrape preservation + representation (`html-to-markdown.ts`)

Currently `iframe` is removed via `BOILERPLATE_SELECTORS` and `<video>` is dropped.
Change:
1. Remove `iframe` from the blanket boilerplate removal; instead, **before**
   turndown, convert media elements to the V3 token via a targeted pass (mirrors the
   existing `<img>` src-absolutization pass):
   - `<iframe src>` whose host is on the **video-embed allowlist** → normalize to the
     embed URL form and emit `[embed:video](embedUrl "title")` (title from
     `title`/`aria-label`/nearby text). Non-allowlisted iframes are still removed
     (unchanged behavior for ads/maps/etc.).
   - `<video>` (use `src` or first `<source src>`, `.mp4`/`.webm`) → emit
     `[embed:video](fileUrl "title")`.
   - Resolve relative URLs against `baseUrl`, like `<img>`.
2. Everything else in the pipeline is unchanged.

Rationale for a pre-turndown DOM pass (not a turndown rule): it matches the existing
`<img>` handling, gives access to attributes turndown discards, and centralizes the
allowlist.

## Component 2 — Parse generic media (`markdown-images.ts` → generalized)

Generalize `parseMarkdownImages` to also recognize the video token, returning a
tagged shape:
- `parseMarkdownMedia(content): Array<{ type: "image" | "video"; alt: string; url: string; raw: string; index: number }>`
  - images: existing `![alt](url)` (unsupported-target skip unchanged).
  - videos: `[embed:video](url "title")` → `{ type:"video", alt: title, url }`.
- `stripMediaMarkdown(content)` extends `stripImageMarkdown` to also remove the video
  token and the (generalized) annotation comment, so chunks stay clean text.
- Annotation comment generalizes to `<!--media:id-->` (was `<!--img:id-->`); the
  rendered-preview strip and the raw/rendered behavior extend accordingly.

Existing `parseMarkdownImages` callers keep working (kept as a thin wrapper or
migrated).

## Component 3 — Processing (`processDocImages` → `processDocMedia`)

Generalize the post-finalize action:
- Iterate `parseMarkdownMedia` results (images + videos).
- **Embedding input is media-agnostic** and reuses `buildImageEmbeddingInput` (the
  video `title` acts as the "alt"; caption/heading/surrounding logic unchanged). The
  input stays a **list of signals** so future manual-context slots in as the highest
  one.
- Upsert `kbMedia` rows with `mediaType`; delete-and-replace + `embeddingInputHash`
  skip-reembed logic unchanged.
- Re-annotate `documents.content` with `<!--media:id-->` after each media token.
- Decorative filter still applies to **images only**; videos are not decorative-
  filtered (V1 assumption).

## Component 4 — Retrieval + ranking (reuse)

`rankedImagesForDocs` / `rankDocImagesForQuery` are **type-agnostic** and unchanged —
they rank on embeddings. The only change: the returned menu entry carries
`type` (`"image" | "video"`) so the agent knows how to use it. Threshold + per-doc
cap (B4/B5) apply uniformly across media types.

## Component 5 — Answer time + frontend rendering

- **Marker:** the agent writes `![alt](media_id)` for any media (unchanged). The
  finalize whitelist resolves `media_id → url` exactly as today (media-agnostic).
- **Prompt:** `IMAGE_INSTRUCTIONS` reworded to cover video — for a `type:"video"`
  entry the model should emit the marker if relevant but **not** call `get_images`
  (there are no pixels to view).
- **`get_images`:** unchanged, images-only. A video id passed to it fetches nothing
  and degrades to id+alt — harmless, but the prompt steers away.
- **Frontend (`MarkdownViewer`):** the `img` renderer branches on the resolved URL:
  - known **video-embed domain** (allowlist) → sandboxed `<iframe>` (embed form,
    `sandbox`, `allowfullscreen`).
  - direct `.mp4`/`.webm` → `<video controls>`.
  - otherwise → `<img>` (unchanged).
  The **domain allowlist is enforced here** (defense in depth on top of the capture
  allowlist): a non-allowlisted URL never becomes an iframe.

## Edge cases

- **Non-allowlisted iframe** (ads, maps, trackers): removed at scrape, as today —
  never becomes media.
- **Same video embedded on multiple pages:** one `kbMedia` row per (doc, media),
  per E1 — unchanged.
- **Video with no title/label and thin surrounding text:** embedding input is weak →
  it ranks low / falls below the B4 threshold and simply doesn't surface. Acceptable;
  manual-context (next feature) is the fix.
- **watch-URL vs embed-URL:** normalize to embed form at capture so the frontend can
  iframe without transformation; store the embed URL.
- **Mixed image+video in one doc:** ranked together by cosine; per-doc cap counts all
  media of that doc uniformly.

## Forward compatibility

The embedding input is built from an ordered **list of signals** so the upcoming
**manual media context** feature adds one highest-priority signal without reworking
this. `description` + `embeddingInputHash` remain the async-enrichment path.

## Out of scope (future)

- **Poster/thumbnail extraction** so the model can glance at a video frame (V4 → b).
- **Linked/embedded documents** — not ingested (prior decision).
- **True multimodal (pixel/frame) embeddings** — bigger quality lever, separate.
- **Providers beyond the initial allowlist** — add domains as needed.

## Testing

- eval-lib: `parseMarkdownMedia` (image + video token), `stripMediaMarkdown` (removes
  both + `<!--media-->`). `html-to-markdown`: allowlisted iframe → video token;
  `<video>`/`<source>` → video token; non-allowlisted iframe removed; relative URL
  resolved; images still work.
- backend: `processDocMedia` writes `mediaType` rows for images and videos; annotation
  uses `<!--media:id-->`; ranking menu carries `type`; existing image behavior
  regression-safe.
- frontend: `MarkdownViewer` renders allowlisted embed → iframe, `.mp4` → `<video>`,
  image → `<img>`, non-allowlisted → not iframed.
- Existing image/ranking tests continue to pass (generalization is behavior-preserving
  for images).
