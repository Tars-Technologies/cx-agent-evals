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

**Docs — pointer only, no ingestion (prior decision):** linked/embedded *documents*
(PDF/Doc viewers) are NOT ingested/embedded/ranked — important docs come through the
normal ingest pipeline. But an *embedded* doc iframe is stripped today (like video),
so it would vanish. This spec captures it as a **chunk-safe inline pointer** (V7)
instead — no content reading, just a resolvable link the agent can cite. Plain `<a>`
doc links are unchanged.

## Decisions (locked)

- **V1 — Unified `kbMedia`.** Rename `kbImages` → `kbMedia`, add
  `mediaType: "image" | "video" | "doc_link"`. Existing rows become `"image"`.
  Dev-stage, no data migration (re-scrape). The id field and its `img_<hash>` format
  are **kept as-is** (opaque, deterministic `imageIdFor(kbId, url)`) so the
  media-agnostic answer marker, whitelist regex, and `get_images` resolution keep
  working unchanged and saved answers stay stable. (Cosmetic field rename is optional
  cleanup, not required.)
- **V2 — Capture scope.** (a) `<iframe>` players on an **allowlist** of domains
  (YouTube, Vimeo, Loom, Wistia) and (b) HTML5 `<video>`/`<source>` with direct
  `.mp4`/`.webm` URLs. Everything else ignored.
- **V3 — Markdown representation.** A normalized token
  `[embed:video](url "title")` carries the video through `documents.content`
  (markdown has no native video syntax). Parses cleanly and reuses the existing
  strip/annotate machinery.
- **V4 — Model sees context only (v1).** The retrieval menu entry carries
  `{mediaId, type:"video", label}`; the model decides relevance from the **text
  context** and emits a marker. No pixel/frame fetch to the model — a single frame is
  a weak, often misleading video signal, so ranking/selection stays text-context
  based.
- **V5 — Rendered as a sandboxed iframe/`<video>`, domain-allowlisted.** The answer
  marker resolves to the stored embed URL; the frontend renderer picks the element by
  URL, and only allowlisted domains are iframed.
- **V6 — Thumbnail preview (frontend only, Q1 use-B).** For YouTube embeds the
  frontend derives the poster image from the embed URL
  (`img.youtube.com/vi/<id>/hqdefault.jpg`) and shows a **click-to-load** placeholder
  instead of auto-loading the tracking iframe (faster, more private). `<video>` uses
  native `controls` (already shows a first-frame preview + play). This is purely a
  `MarkdownViewer` enhancement — **no schema, scrape, backend, or model change**, and
  scoped to the free/derivable case only (no Vimeo/Loom API calls, no ffmpeg frame
  extraction).
- **V7 — Embedded docs → chunk-safe pointer (Q2 option B).** An embedded doc-viewer
  iframe (Google Docs/Sheets/Slides, Office/OneDrive viewers, or an iframe whose src
  is a `.pdf`) is captured as a `[embed:doc](url "title")` token, then rewritten by
  processing into an **inline `[title](doc_id)` link** carrying an opaque `kbMedia`
  id. The short id survives chunking intact (a raw URL can be split mid-string by the
  recursive chunker — see edge cases), and the finalize whitelist resolves the id back
  to the real URL. doc_link rows are **not embedded, ranked, or in the media menu** —
  purely a resolvable pointer the agent may cite inline.

## Data model — `kbMedia` (was `kbImages`)

Add:
- `mediaType: v.union(v.literal("image"), v.literal("video"), v.literal("doc_link"))`.

Unchanged: `imageId` (opaque media id, `img_<hash>`), `kbId`, `orgId`, `url`,
`alt` (holds the video/doc *title/label* for non-images), `embedding`,
`embeddingInputHash`, `sourceDocId`, `description` (reserved). Indexes unchanged
(`by_image_id`, `by_kb`, `by_source_doc`).

For videos, `url` stores the **embed-form** URL (e.g. `youtube.com/embed/ID`), so
answer-time and the frontend can iframe it directly.

`doc_link` rows store `{ mediaType:"doc_link", url, alt:title }` with **no
`embedding`** (they are never ranked). They exist only so the finalize whitelist can
resolve the inline `doc_id` pointer back to the real URL.

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
   - `<iframe src>` whose host is on a **doc-viewer allowlist** (docs.google.com,
     view.officeapps / onedrive, or a src ending in `.pdf`) → emit
     `[embed:doc](url "title")` (V7). Still no ingestion — this is a pointer only.
   - Resolve relative URLs against `baseUrl`, like `<img>`.
2. Everything else in the pipeline is unchanged (non-allowlisted iframes still
   removed).

Rationale for a pre-turndown DOM pass (not a turndown rule): it matches the existing
`<img>` handling, gives access to attributes turndown discards, and centralizes the
allowlist.

## Component 2 — Parse generic media (`markdown-images.ts` → generalized)

Generalize `parseMarkdownImages` to also recognize the video token, returning a
tagged shape:
- `parseMarkdownMedia(content): Array<{ type: "image" | "video" | "doc_link"; alt: string; url: string; raw: string; index: number }>`
  - images: existing `![alt](url)` (unsupported-target skip unchanged).
  - videos: `[embed:video](url "title")` → `{ type:"video", alt: title, url }`.
  - docs: `[embed:doc](url "title")` → `{ type:"doc_link", alt: title, url }`.
- `stripMediaMarkdown(content)` extends `stripImageMarkdown` to remove the **image and
  video** tokens and the (generalized) annotation comment, so chunks stay clean text.
  It does **not** strip the rewritten `[title](doc_id)` doc pointer — that must remain
  inline in chunks so the agent can cite it (doc_links aren't in the media menu).
- Annotation comment generalizes to `<!--media:id-->` (was `<!--img:id-->`); the
  rendered-preview strip and the raw/rendered behavior extend accordingly.

Existing `parseMarkdownImages` callers keep working (kept as a thin wrapper or
migrated).

## Component 3 — Processing (`processDocImages` → `processDocMedia`)

Generalize the post-finalize action:
- Iterate `parseMarkdownMedia` results (images + videos + doc_links).
- **Images + videos:** embedding input is media-agnostic and reuses
  `buildImageEmbeddingInput` (the video `title` acts as the "alt";
  caption/heading/surrounding logic unchanged). Input stays a **list of signals** so
  future manual-context slots in as the highest one. Upsert `kbMedia` rows with
  `mediaType`; delete-and-replace + `embeddingInputHash` skip-reembed unchanged.
  Re-annotate `documents.content` with `<!--media:id-->` after each token; chunks
  strip them.
- **doc_links (V7):** mint `doc_id = imageIdFor(kbId, url)`; upsert a `kbMedia` row
  `{ mediaType:"doc_link", url, alt:title }` with **no embedding** (no API call);
  **rewrite** the `[embed:doc](url "title")` token in `documents.content` to an inline
  `[title](doc_id)` link. This link is *not* stripped from chunks, so the agent sees a
  chunk-safe citable pointer. doc_links participate in the same delete-and-replace
  reconciliation (by `sourceDocId`).
- Decorative filter still applies to **images only**; videos and doc_links are not
  decorative-filtered (V1 assumption).

## Component 4 — Retrieval + ranking (reuse)

`rankDocImagesForQuery` is **type-agnostic** and unchanged — it ranks on embeddings.
`rankedImagesForDocs` **excludes `doc_link` rows** (they have no embedding and are not
menu items): the query filters `mediaType` to `image`/`video`. The returned menu entry
carries `type` (`"image" | "video"`) so the agent knows how to use it. Threshold +
per-doc cap (B4/B5) apply uniformly across image/video.

## Component 5 — Answer time + frontend rendering

- **Marker:** the agent writes `![alt](media_id)` for image/video (unchanged), and a
  plain `[title](doc_id)` link for a doc pointer. The finalize whitelist resolves
  **both** marker forms: image markers `![alt](id)` → image/embed URL, and link
  markers `[text](id)` → real doc URL.
  **Asymmetry (important):** the image-marker pass still *drops* unknown targets
  (injection guard — unchanged). The link-form pass is **resolve-known-only**: it
  rewrites `[text](target)` *only* when `target` is a known `kbMedia` id (org+kb
  scoped) and leaves every other link untouched — the agent writes legitimate
  hyperlinks to real URLs constantly, so this pass must never drop or mangle them.
  This is the one finalize addition — an additive second pass for doc-id links.
- **Prompt:** `IMAGE_INSTRUCTIONS` reworded to cover video and doc pointers — for a
  `type:"video"` menu entry the model emits the image marker if relevant but does
  **not** call `get_images` (no pixels); for a `[title](doc_id)` link seen inline in
  results, it may include the link if useful.
- **`get_images`:** unchanged, images-only. A video/doc id passed to it fetches
  nothing and degrades to id+alt — harmless; the prompt steers away.
- **Frontend (`MarkdownViewer`):** the `img` renderer branches on the resolved URL:
  - known **video-embed domain** (allowlist) → **V6 thumbnail placeholder**
    (YouTube poster derived from the embed id) that loads a sandboxed `<iframe>`
    (embed form, `sandbox`, `allowfullscreen`) on click; non-YouTube allowlisted
    embeds render the iframe directly.
  - direct `.mp4`/`.webm` → `<video controls>` (native first-frame preview).
  - otherwise → `<img>` (unchanged).
  Resolved **doc links** render as normal anchors. The **domain allowlist is enforced
  here** (defense in depth on top of the capture allowlist): a non-allowlisted URL
  never becomes an iframe.

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
  *rankable* media (image/video) of that doc uniformly; doc_links are excluded.
- **Why a doc pointer id, not a raw link (V7 rationale):** the recursive chunker
  splits on `\n\n`,`\n`,`. `,` `,`` — so `[title](https://…/very/long/url)` can be
  torn across a chunk boundary (mid-URL at the space level, or mid-string at the
  character level for a long slug), leaving an unrecoverable broken link the agent
  can't copy. A short, separator-free `doc_id` (`img_<16hex>`) survives inside a single
  chunk intact, so the agent can always copy a working pointer and finalize resolves
  it. Plain `<a>` doc links (out of scope) keep the pre-existing risk — no regression,
  just not protected.
- **doc_link never in the media menu:** excluded from `rankedImagesForDocs`, so it
  can't consume image/video slots or surface as a fake image.

## Forward compatibility

The embedding input is built from an ordered **list of signals** so the upcoming
**manual media context** feature adds one highest-priority signal without reworking
this. `description` + `embeddingInputHash` remain the async-enrichment path.

## Out of scope (future)

- **Model-visible video frames** — feeding a poster frame to the vision model for
  relevance (V4 keeps it text-context only; V6 thumbnails are frontend-only).
- **Non-derivable thumbnails** — Vimeo/Loom/Wistia poster via provider API, or ffmpeg
  frame extraction for `<video>` without a poster.
- **Doc content ingestion** — reading/chunking/embedding linked or embedded docs
  (prior decision); V7 is a pointer only.
- **True multimodal (pixel/frame) embeddings** — bigger quality lever, separate.
- **Providers beyond the initial allowlists** — add video/doc-viewer domains as needed.

## Testing

- eval-lib: `parseMarkdownMedia` (image + video + doc token); `stripMediaMarkdown`
  removes image+video tokens + `<!--media-->` but **preserves** `[title](doc_id)`.
  `html-to-markdown`: allowlisted video iframe → video token; `<video>`/`<source>` →
  video token; doc-viewer iframe / `.pdf` iframe → doc token; non-allowlisted iframe
  removed; relative URL resolved; images still work.
- backend: `processDocMedia` writes `image`/`video` rows (with embedding) and
  `doc_link` rows (no embedding); rewrites doc token to `[title](doc_id)` inline;
  `rankedImagesForDocs` excludes `doc_link`; annotation uses `<!--media:id-->`; ranking
  menu carries `type`; finalize resolves both `![alt](id)` and `[text](id)` markers;
  existing image behavior regression-safe.
- frontend: `MarkdownViewer` renders YouTube embed → click-to-load thumbnail → iframe,
  `.mp4` → `<video>`, resolved doc id → anchor, image → `<img>`, non-allowlisted → not
  iframed.
- Existing image/ranking tests continue to pass (generalization is behavior-preserving
  for images).
