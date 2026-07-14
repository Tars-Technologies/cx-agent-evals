# Image/Media Retrieval — End-to-End Implementation Spec

Self-contained spec for implementing knowledge-base image (and video/doc-link) retrieval
in a RAG agent system. No vision model runs at ingest; images are embedded from
surrounding text context, ranked at query time within already-retrieved documents, and
a vision-capable agent inspects actual pixels on demand before deciding to show one.

Written to be implementable standalone in any repo with: a document store, a text
embedding model, a text vector search, and an LLM agent loop with tool-calling.

---

## 1. Design principles

1. **No vision cost at ingest (initially).** Images are embedded from text *around*
   them, not their pixel contents. Cheap, fast, no per-image API call. A vision-caption
   signal (reading the actual pixels once at ingest) is an intended *future* extension —
   the design reserves a clean insertion point for it (§7, §15) but it is **not built in
   the initial version**.
2. **Doc-gating, not global image search.** An image is only ever a candidate if its
   parent document already won on text relevance. This trades some recall (a great
   image in a weakly-matched doc is invisible) for precision (no random unrelated image
   ever surfaces).
3. **The agent looks before it shows.** A ranked "menu" of candidate images is surfaced
   to the agent as metadata only (id + label). The agent must explicitly fetch pixels
   via a tool before it can decide an image is actually relevant — this is a second,
   semantic quality gate beyond the embedding-based rank.
4. **Untrusted output, whitelisted at the boundary.** The model's final answer is never
   trusted as-is. Every media reference it emits is resolved against the real registry
   before being shown to the user; anything that doesn't resolve is dropped.
5. **Human override always wins.** A curator can set explicit context for any image that
   dominates its embedding and survives re-ingestion of the source document.
6. **Everything is idempotent and cheap to re-run.** Re-scraping/re-parsing a document
   must not re-call the embedding API for unchanged images, must not create duplicate
   rows, and must clean up rows for images that no longer exist in the doc.

---

## 2. Architecture overview

```
                              ┌─ INGEST (per document) ───────────────────────┐
Source HTML/doc               │                                                │
   │                          │  1. Decorative filter (Tier 0, HTML layer)     │
   ▼                          │  2. Convert to markdown                        │
HTML → Markdown ──────────────┤  3. Parse media occurrences from markdown      │
   │                          │  4. Decorative filter (Tier 2, URL layer)      │
   ▼                          │  5. Deterministic ID per media item            │
Markdown content               │  6. Build embedding input (context-derived)   │
   │                          │  7. Embed (skip if input unchanged — hash)     │
   ▼                          │  8. Upsert media rows (delete-and-replace)     │
Media table (per KB)          │  9. Re-annotate document content              │
                               └────────────────────────────────────────────────┘

                              ┌─ QUERY TIME (per agent turn) ─────────────────┐
User query                    │                                                │
   │                          │  1. Text search → ranked chunks/documents      │
   ▼                          │  2. Doc-gated image ranking (cosine, capped)   │
Retrieval tool result          │  3. Return {chunks, images: menu} to agent    │
   │                          │                                                │
   ▼                          │  4. Agent calls get_images(ids) to see pixels  │
Agent reasoning                │  5. Agent writes ![alt](imageId) markers       │
   │                          │  6. Finalize: whitelist markers → real URLs    │
   ▼                          └────────────────────────────────────────────────┘
Answer to user (real image URLs, hallucinated/unknown ids stripped)
```

---

## 3. Data model

One new table, `kbMedia` (or equivalent), one row per `(sourceDocumentId, imageId)`:

```
imageId: string              # deterministic, see §5. Type-prefixed: img_/vid_/doc_
kbId: id                     # knowledge base scope
orgId: string                # tenant scope
mediaType: "image" | "video" | "doc_link"
url: string                  # source URL (or storage id, once blob storage is added)
alt: string                  # effective label (never empty — placeholder if source had none)
embedding: number[]?         # absent for doc_link (never ranked); absent if embed failed
embeddingInputHash: string?  # sha256(model + ":" + input) — re-embed-skip key
manualContext: string?       # human override, dominates embedding, survives re-ingest
visionCaption: string?       # RESERVED for the future caption step (§15); null initially
captionInputHash: string?    # RESERVED — re-caption-skip key; null initially
sourceDocumentId: id
createdAt: number
```

Indexes needed:
- `by_source_document` (sourceDocumentId) — ingest upsert/cleanup, query-time doc lookup
- `by_kb` (kbId) — admin listing, diagnostics
- `by_image_id` (imageId) — resolving an id the agent references

**Why separate from the text chunk/vector table:** images must be ranked *within*
already-retrieved documents (§8), not searched globally alongside text. Mixing them
into one vector index would let an image vector compete for the same top-K as text
chunks, diluting text retrieval quality for no benefit (the agent never searches for
images directly — it only sees images belonging to documents that already won on text).

---

## 4. Stage: parsing media from markdown

Pure functions, no I/O. Given document markdown content, extract every media
occurrence in document order.

**Image**: `![alt](url)` — non-greedy, URL stops at first `)`, so partial/truncated
markdown (e.g. split across a chunk boundary) simply fails to match rather than
matching garbage.

```
IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
```

Reject as unsupported (never even reaches the media pipeline):
- `data:` URIs (not a fetchable, cacheable URL)
- anything not `http://`/`https://`
- `.svg` (most vision/preview paths can't render these usefully; strip query/fragment
  before checking the extension)

**Video / doc embeds**: since standard markdown has no native video/doc syntax, use a
normalized token written during HTML→markdown conversion (or your ingest source's
equivalent): `[embed:video](url "optional title")`, `[embed:doc](url "optional title")`.

**Processed-marker annotation**: after an item is embedded/indexed, append a
non-rendering comment after its occurrence: `<!--media:{imageId}-->`. On every
re-parse, **strip all such comments first**, then re-parse — otherwise stale
annotations pointing at dead ids accumulate across re-scrapes.

**Chunking must never see media markup.** Before text is chunked for the main text
vector index, strip:
- all `![alt](url)` occurrences
- all `<!--media:...-->` annotations
- video embed tokens

Keep plain link pointers `[title](doc_id)` in chunk text if you want the agent able to
cite embedded documents inline — these aren't part of the ranked image menu, just
ordinary text the agent can reference.

---

## 5. Stage: deterministic IDs

```
imageId = "{prefix}_" + sha256(kbId + " " + normalizeUrl(url)).slice(0, 16)
prefix  = "img" | "vid" | "doc"   (by mediaType)
```

- **Deterministic and stable across re-index**: the same image at the same URL always
  gets the same id, so a previously-generated/cached answer's `![alt](img_xxx)` marker
  keeps resolving after a re-scrape, as long as the URL is unchanged.
- **Type-prefixed** so both your code and the agent can branch on id shape alone
  without a lookup (e.g. "don't try to fetch pixels for a `vid_` id").
- **Space separator** between kbId and URL in the hash input avoids accidental
  collisions from string concatenation (`kb1` + `abc` vs `kb1a` + `bc`).
- Normalize the URL before hashing (strip default ports, sort/trim irrelevant query
  params if you have a normalizer) so trivial URL variations of the same image don't
  mint different ids.

---

## 6. Stage: decorative image filtering

**Goal:** exclude icons, logos, pins, spacers, tracking pixels, and other UI chrome
from ever getting a media row — before spending any embedding (or future vision) cost
on them, and before they can pollute the agent's menu.

**Do not rely on one signal.** A single URL heuristic (e.g. "width encoded in path")
only works on CDNs that happen to encode width that way. Layer independent, cheap
signals; fire decorative if **any** tier matches.

### Tier 0 — HTML layer (do this first if you control HTML→markdown conversion)

This is the richest signal because HTML→markdown conversion (turndown, readability,
etc.) typically **discards** `class`, `role`, `aria-*`, and pixel `width`/`height`
attributes — so if you don't catch decorative images here, that information is gone
forever for every later stage.

Run this as part of your existing "strip boilerplate" pass (alongside removing
`<nav>`/`<header>`/`<footer>`/`<aside>`), walking every `<img>` and removing it from
the DOM (before conversion) if **any** of these decisive signals fire:

```
isDecorativeImgElement(img):
  if img.aria-hidden == "true": return true
  if img.role == "presentation": return true
  if img.class or img.id matches /\b(icons?|logos?|avatars?|emojis?|badges?|sprites?|pictograms?|favicons?)\b/i:
    return true
  w = parseIntAttr(img.width)   # numeric only — "100%" is NOT a decorative signal
  h = parseIntAttr(img.height)
  if w == 1 and h == 1: return true          # tracking pixel
  if w is present and 0 < w < 100: return true
  if h is present and 0 < h < 100: return true
  return false
```

Only fires on **decisive** signals — a real content image (product photo, chart,
screenshot) carries none of these, so false positives are rare. Skip this tier
entirely if `onlyMainContent`/boilerplate-stripping is disabled for a given run (some
callers may want the raw, unfiltered document).

### Tier 2 — URL/markdown layer (always available, no HTML needed)

Runs on the parsed markdown `url`, after Tier 0 has already run (so this only needs to
catch what Tier 0 couldn't — non-HTML sources, or sources where sizing is CSS-only).

```
MIN_WIDTH_PX = 100

isLikelyDecorativeImage(url):
  # (a) CDN thumb-path width encoding, e.g. MediaWiki "/thumb/.../12px-Foo.png"
  m = url.match(/\/(\d+)px-/)
  if m and int(m[1]) < MIN_WIDTH_PX: return true

  # (b) path segments that conventionally hold chrome — EXCLUDE "thumb" deliberately,
  #     since some CDNs (MediaWiki) serve real content images from /thumb/ paths.
  if url matches /\/(icons?|logos?|sprites?|emojis?|avatars?|badges?|favicons?|pictograms?)\//i:
    return true

  # (c) filename denylist — accumulate entries specific to your source corpus
  if url matches /(favicon|sprite|spacer|placeholder|1x1|pixel\.|location_dot|
                    disambig|padlock|edit-icon|magnify-clip|question_book|ambox|
                    wiki_letter|...)/i:
    return true

  # (d) small width/height query params many CDNs honor
  for key in [w, width, h, height]:
    val = url.queryParam(key)
    if val is a number and 0 < val < MIN_WIDTH_PX: return true

  return false
```

Apply this filter at ingest, right after parsing (§4), before an item is allowed to
become a media row:

```
if mediaType == "image" and isLikelyDecorativeImage(url):
    skip  # no row, no annotation, no embedding — but the image markup itself
          # is left in the document body untouched (not deleted from content)
```

### Tier 1 — real pixel dimensions (optional, not required to ship)

If Tiers 0+2 leave visible gaps in practice (CSS-sized images with no HTML attrs and a
generic, unpredictable URL), the next signal is a real dimension check: range-fetch
the first few KB of the image, parse width/height out of the PNG/JPEG/GIF/WebP header
(no full download, no decode), and apply the same `< 100px` / `~1:1 tiny` / `1×1`
rules as Tier 0 but against ground truth instead of markup.

**Trade-off:** this is the first network call in the ingest path (today's pipeline
does zero fetching at ingest). Defer this until you add image blob storage — at that
point you're fetching bytes anyway, so reading real dimensions off that same fetch is
free. Building it standalone first is new infrastructure for a case you may not have
confirmed is common in your corpus. Ship without it; add only if data shows a gap.

### Tier 4 — cross-document frequency (optional, needs a second pass)

The strongest signal for exactly what Tiers 0–2 miss: **an image with no decorative
markup and no decorative URL, but which is site chrome** (header logo, footer badge)
— detectable because it's the *same image appearing on every document*, which no
per-image heuristic can see.

```
# Requires counting over a STABLE source — do NOT count already-filtered media
# rows (a naive "skip decorative → count what's left" loop undercounts, since
# rows that got skipped for other reasons never enter the count). Run a
# separate pass over ALL raw parsed image URLs across the KB's documents,
# before any decorative decision:
freq[normalizeUrl(url)] += 1   for every image in every document, unfiltered

# Then, when deciding whether to filter:
if freq[normalizeUrl(url)] >= N:   # tune N, start ~3-5
    treat as decorative
```

This needs a KB-wide pre-pass (or an incrementally maintained frequency table), not a
per-document decision — a single document doesn't know if its logo repeats elsewhere.
**Defer until you have real ingested data** to run this pass against; adding it
speculatively risks the exact undercounting bug described above if implemented
carelessly.

### Recommended shipping scope

Ship **Tier 0 + Tier 2** first — both are zero-network, decisive-signal-only, and
cover the two most common decorative patterns (well-marked-up HTML; predictable CDN/
path conventions). Instrument actual image menus after real crawls; add Tier 1 or
Tier 4 only if repeat-offender chrome is visibly leaking through in practice — they
fix different failure modes (unmarked-but-small vs. unmarked-but-repeated), so which
to add next should be evidence-driven.

---

## 7. Stage: embedding input construction

No vision call (initially) — the embedding input is built from text **around** the
image in the source document. Priority order, strongest signal wins:

0. **Manual context** (if set) — dominates everything, see the weighting block below.
   *(Future) **Vision caption** — when the §15 caption step exists, it slots in right
   below manual context and above alt/caption/heading, and it replaces the surrounding-
   text fallback (signal 4). This is the single insertion point; nothing else in the
   builder changes. Absent in the initial version.*
1. **Alt text** — only counts as strong if ≥2 words and not a generic placeholder.
   Denylist: `image, photo, figure, screenshot, logo, banner, icon, img, graphic,
   picture, ""`.
2. **Caption immediately after the image** — look at the line(s) right after the
   image markup (skip at most one blank line). Classify:
   - **strong**: italic (`*text*`/`_text_`), prefixed with `Figure:`/`Fig.`/
     `Caption:`/`Source:`/`Photo:`, or wrapped in `<figcaption>`.
   - **weak**: a short (<100 char), single-sentence plain line.
   A weak caption is only used if alt is *also* weak.
3. **Nearest heading above the image** (`##`/`###` in the same section) — strong only
   if ≥3 words and not generic (`Overview, Introduction, Summary, Background, About,
   Details, More, Content, Section`).
4. **Surrounding text** (~300 chars before + after, bounded to the current section,
   media markup stripped out) — **only** used as a fallback when none of 1–3 are
   strong. This avoids diluting a good signal (a real caption) with noisy prose.

```
buildEmbeddingInput(content, image, manualContext?):
  alt = image.alt.trim() or "image"
  caption = captionAfter(content, image)          # {text, strong}
  heading = nearestHeadingAbove(content, image.index)

  altOk = wordCount(alt) >= 2 and alt not in ALT_DENYLIST
  captionOk = caption.strong
  headingOk = wordCount(heading) >= 3 and heading not in HEADING_DENYLIST

  captionText = caption.text if (captionOk or not altOk) else ""
  parts = filter_nonempty([captionText, alt, heading])

  if altOk or captionOk or headingOk:
      scraped = parts.join(". ")
  else:
      scraped = filter_nonempty([...parts, surroundingText(content, image)]).join(". ")

  if not manualContext:
      return { alt, input: scraped }

  # Manual context must DOMINATE regardless of how long the scraped text is:
  #  (1) drop the bulky surrounding-text fallback entirely when manual is present —
  #      keep only the short strong signals as light support.
  #  (2) cap that support to manual's own length, then repeat manual W times
  #      (e.g. W=3) so manual is always >= W/(W+1) of the input by volume (~75%).
  support = parts.join(". ").slice(0, manualContext.length)
  weighted = repeat(manualContext, W).join(". ")
  return { alt, input: [weighted, support].filter_nonempty().join(". ") }
```

Hash the **final input together with the embedding model name**:
`sha256("{modelName}:{input}")`. This hash is the re-embed-skip key (§8) — including
the model name is required so switching embedding models forces a re-embed instead of
silently reusing a vector of the wrong dimension/space.

---

## 8. Stage: ingest pipeline (per document)

Runs once per document, triggered on finalize/re-scrape. Delete-and-replace semantics
keyed by `(sourceDocumentId, imageId)`.

```
processDocumentMedia(docId):
  doc = loadDocument(docId)
  cleanContent = stripAllMediaAnnotations(doc.content)        # §4
  mediaList = parseMarkdownMedia(cleanContent)                # §4

  prior = loadPriorMediaRows(sourceDocumentId=docId)          # for manualContext + hash reuse
  priorById = indexBy(prior, "imageId")

  embedItems = []
  docLinkItems = []
  seen = set()

  for item in mediaList:
    if item.type == "image" and isLikelyDecorativeImage(item.url): continue   # §6
    id = imageIdFor(kbId, item.url, item.type)                                # §5
    if id in seen: continue
    seen.add(id)

    if item.type == "doc_link":
      docLinkItems.append({ id, url: item.url, alt: item.alt or "document" })
      continue

    manualContext = priorById[id]?.manualContext     # survives re-scrape
    { alt, input } = buildEmbeddingInput(cleanContent, item, manualContext)     # §7
    hash = sha256(f"{embedderModel}:{input}")
    embedItems.append({ id, url: item.url, alt, type: item.type, input, hash, manualContext })

  # Skip re-embedding unchanged items; batch-embed only new/changed ones.
  embeddings = new array(len(embedItems))
  toCompute = []
  for i, item in enumerate(embedItems):
    prev = priorById[item.id]
    if prev and prev.embeddingInputHash == item.hash and prev.embedding:
      embeddings[i] = prev.embedding                 # reuse — no API call
    else:
      toCompute.append(i)

  if toCompute:
    try:
      fresh = embedder.embed([embedItems[i].input for i in toCompute])   # ONE batch call
      for j, i in enumerate(toCompute): embeddings[i] = fresh[j]
    except:
      pass   # leave those embeddings undefined — upserted without a vector,
             # retried automatically on the next ingest run; never blocks the doc

  upsertMediaRows(kbId, docId, [
    *[{ id: e.id, url: e.url, alt: e.alt, type: e.type,
        embedding: embeddings[i], embeddingInputHash: e.hash,
        manualContext: e.manualContext } for i, e in enumerate(embedItems)],
    *[{ id: d.id, url: d.url, alt: d.alt, type: "doc_link" } for d in docLinkItems]
  ])

  # Re-annotate content: append <!--media:id--> after each handled occurrence;
  # rewrite doc-embed tokens to a chunk-safe inline pointer.
  annotated = rewriteContentWithAnnotations(cleanContent, embedItems, docLinkItems)
  saveDocumentContent(docId, annotated)
```

**`upsertMediaRows` delete-and-replace semantics:**

```
upsertMediaRows(kbId, sourceDocId, items):
  existing = loadRows(sourceDocId)
  existingById = groupBy(existing, "imageId")     # may have duplicate rows from a past race
  inputById = dedupeLastWins(items, "imageId")    # one input call can't insert twice

  for id, rows in existingById:
    if id not in inputById:
      deleteAll(rows)                              # image removed from doc — clean up
      continue
    keep = rows[0]
    deleteAll(rows[1:])                            # collapse any duplicate survivors

  for id, item in inputById:
    if existing_survivor := survivorFor(id):
      patch(survivor, item)                         # url/alt/embedding/manualContext
    else:
      insert(item)
```

**Concurrency:** wrap the whole per-document action in a bounded-concurrency work
pool (e.g. max 4–5 parallel documents) with retries — a bulk reprocess or a crawl
finalizing many documents at once must not slam your embedding provider or trip rate
limits.

---

## 9. Stage: query-time doc-gated ranking

At retrieval time you already have a ranked list of matched chunks/documents from
your normal text vector search — **reuse that ranking and that query embedding**,
don't re-embed the query or run a second global search.

```
rankImagesForQuery(kbId, orderedDocumentIds, queryEmbedding, cap):
  docGroups = []
  for docId in orderedDocumentIds:                       # preserves text-search rank order
    rows = loadMediaRows(sourceDocId=docId)
    docGroups.append([r for r in rows if r.kbId == kbId and r.url and r.type != "doc_link"])

  candidates = []
  order = 0
  for docIdx, group in enumerate(docGroups):
    for img in group:
      usable = img.embedding exists and len(img.embedding) == len(queryEmbedding)
      candidates.append({ ...img, docIdx, order: order++, 
                           score: cosine(queryEmbedding, img.embedding) if usable else None })

  anyUsable = any(c.score is not None for c in candidates)
  if anyUsable:
    pool = [c for c in candidates if c.score is not None and c.score >= MIN_SIMILARITY]
    pool.sort(by: -score, then: order)
  else:
    # No comparable embeddings at all (dimension mismatch from a different retriever
    # config, or every embed call failed) — cosine is meaningless; fall back to
    # document order rather than returning an empty menu.
    pool = candidates.sort(by: order)

  distinctDocs = count(unique(c.docIdx for c in pool))
  perDocCap = PER_DOC_CAP if distinctDocs > 1 else cap    # exempt single-doc pools —
                                                            # let one great doc fill the menu
  out = []
  seen = set()
  perDocCount = {}
  for c in pool:
    if len(out) >= cap: break
    if c.imageId in seen: continue
    if perDocCount.get(c.docIdx, 0) >= perDocCap: continue
    seen.add(c.imageId)
    perDocCount[c.docIdx] = perDocCount.get(c.docIdx, 0) + 1
    out.append({ imageId: c.imageId, alt: c.alt, type: c.type or "image" })

  return out     # menu: {imageId, alt, type}[] ONLY — never ship embedding/url here
```

Tunable constants: `MIN_SIMILARITY` (start conservative, ~0.2, retune once you have
real query/click data), `PER_DOC_CAP` (e.g. 2), `cap` / menu size (e.g. 6).

**Do the ranking DB-side / server-side**, returning only `{imageId, alt, type}` to
whatever layer builds the tool result — never ship raw embeddings or URLs to that
layer; keep the vector math where the data lives.

Wire the menu into the retrieval tool's result, in the **same turn** as the retrieved
text chunks:

```
toolResult = {
  chunks: [...],                     # normal retrieved text passages
  images: rankImagesForQuery(...)    # the menu
}
```

---

## 10. Stage: agent tool contract

### A. Gate on vision capability

Keep an explicit allowlist of model ids known to be multimodal — don't assume. Only
append image instructions to the system prompt, and only register the `get_images`
tool, when the active model is on that list.

### B. `get_images` tool

```
tool get_images(imageIds: string[]):
  capped = imageIds[:4]                          # hard cap — a burst of large images
                                                    # blows the model's context window
  resolved = lookupMediaRows(kbIds=agentScope.kbIds, orgId=agentScope.orgId, ids=capped)
                                                    # scope to EVERY kb the agent can search,
                                                    # not just one — an agent may span kbs
  recordResolved(resolved)                        # for finalize whitelisting, §11

  for r in resolved:
    if r.type != "image": continue                # video/doc: no pixels to fetch, ever
    bytes = fetchImageBytesGuarded(r.url)          # see below
    if bytes: cachePixels(r.imageId, bytes)

  return resolved.map(r => ({ imageId: r.imageId, url: r.url, alt: r.alt, mediaType: r.type }))
    # SMALL result only — no base64 — this is what gets persisted in tool-call history.
    # Full pixel bytes are mapped into the multimodal content block sent to the model
    # via a separate content-formatting step, then discarded — never returned/stored.
```

`fetchImageBytesGuarded(url)`:
- **SSRF guard**: only public `http(s)` hosts; block loopback/private/link-local/
  metadata-service IP ranges; do not follow redirects (or re-validate each hop).
- Clamp CDN-honored width/height query params (`w`, `h`, `width`, `height`) to a sane
  max (e.g. 1280px) before fetching, to avoid pulling a multi-megapixel original.
- Cap total bytes (e.g. ~1.5MB) — check `Content-Length` up front when present, and
  hard-cap after download as a backstop for chunked responses without that header.
- Any failure (timeout, non-2xx, wrong content-type, oversized) → return `null`; the
  tool result still includes `{imageId, alt}` so the model can still reference/embed
  the image by id even if the preview fetch failed — never fail the whole turn over
  one bad image.

For non-image types (`video`, `doc_link`), the multimodal content returned to the
model should be **text only**, explicitly telling it there are no pixels and to use
the marker syntax directly — don't let the model retry `get_images` on a video
expecting to see frames.

### C. Menu in the retrieval tool result

Already covered in §9 — `images: [{imageId, alt, type}]` alongside `chunks`.

### D. System prompt instructions (only when vision-capable)

Cover, explicitly:
- Copy `imageId`s **verbatim** from the menu — never invent, guess, abbreviate, or
  reformat one.
- To display media, write `![alt](imageId)` inline — the **id**, never a raw URL. A
  sentence alone ("here is an image") shows nothing; only the marker renders it.
- **Video**: cannot be previewed by the model at all — judge relevance from
  label/context, not pixels. Do not call `get_images` for a video id. The marker
  alone embeds a real, playable video — never say "I cannot display videos" or tell
  the user to go elsewhere.
- **Doc links**: plain `[title](doc_id)` markers found in retrieved chunk text may be
  cited verbatim; no `get_images` call needed.
- If a menu is empty / absent, don't call `get_images` and don't fabricate media.
- If `get_images` returns nothing for a requested id, that id didn't exist — never
  retry with a guessed/modified id.

---

## 11. Stage: finalize — whitelist before showing the user

Never trust the model's raw output. Rewrite every media marker against the real
registry before returning the answer.

```
finalizeAnswer(rawText, resolvedThisTurn, agentScope):
  # 1. Seed with everything get_images actually resolved this turn (pixels seen).
  resolved = copy(resolvedThisTurn)     # Map<imageId, {url, alt}>

  # 2. Additionally resolve any remaining `![alt](id)` / `[text](id)` markers the
  #    model wrote WITHOUT calling get_images (e.g. citing an id straight out of
  #    chunk text) — look these up against the registry, same org+kb scope.
  missingIds = extractMediaIdMarkers(rawText).filter(id => id not in resolved)
  if missingIds and agentScope.kbIds:
    rows = lookupMediaRows(kbIds=agentScope.kbIds, orgId=agentScope.orgId, ids=missingIds)
    for r in rows: resolved[r.imageId] = { url: r.url, alt: r.alt }

  # 3a. Image pass — DROPS unknown targets entirely (this is the injection guard:
  #     a hallucinated id, an external URL the model tried to paste, or a
  #     cross-kb id all resolve to nothing and vanish).
  text = rewriteImageMarkers(rawText, (url) => resolved.get(url)?.url ?? DROP)

  # 3b. Link pass — resolve-known-only, leaves every OTHER link untouched. The model
  #     writes ordinary hyperlinks constantly; only rewrite ones whose target IS a
  #     known media id, never touch/drop anything else.
  text = rewriteLinkMarkers(text, (target) => resolved.get(target)?.url ?? KEEP_AS_IS)

  return text
```

This whitelist step is the actual security boundary of the whole system — every
marker is untrusted output until it resolves against your own table. Do this
**before** shipping to real users; treat it as non-optional, not a nice-to-have.

---

## 12. Stage: manual override (curation escape hatch)

A simple mutation + admin UI:

```
setMediaContext(kbId, imageId, manualContext):
  rows = loadRowsByImageId(imageId).filter(r => r.kbId == kbId)
  if not rows: error("not found")
  for r in rows:
    patch(r, { manualContext: manualContext.trim() or None })
  affectedDocs = unique(r.sourceDocumentId for r in rows)
  for docId in affectedDocs:
    scheduleReprocess(docId)     # re-run §8 so the new context is actually re-embedded
```

Build an admin list view: dedupe by `imageId` (the same media URL can appear on
several source documents), show which documents reference it, let a human search and
set/clear context without touching source content. This is what lets someone fix a
mis-ranked or unfindable image without re-scraping the whole site.

---

## 13. Build order

1. **Schema + parsing + deterministic ids** (§3–5) — plumbing only, no ranking yet.
2. **Decorative filter, Tier 0 + Tier 2** (§6) — cheap, ship both together, zero
   network cost.
3. **Embedding input + ingest pipeline** (§7–8) — media becomes searchable; verify
   re-scrape doesn't re-embed unchanged images and doesn't duplicate rows.
4. **Query-time doc-gated ranking** (§9) — menu exists; nothing consumes it yet.
5. **Agent wiring**: menu in tool result, `get_images` tool, system prompt (§10).
6. **Finalize whitelisting** (§11) — **do this before any real user traffic**; it's
   the security boundary.
7. **Manual override UI** (§12) — do last, it's a quality-of-life addition.
8. **Optional, evidence-driven**: Tier 1 (real dimensions) or Tier 4 (cross-doc
   frequency) — only after inspecting real image menus from real crawls shows a
   specific leak; they fix different failure modes, so pick based on what you
   actually observe.

---

## 14. Gotchas (each one is a real bug class if skipped)

- **Skip the decorative filter** → agent's inspection budget wasted on icons, menu
  fills with junk, users see garbage images.
- **Skip delete-and-replace dedup on re-scrape** → duplicate rows per `imageId`,
  ranking double-counts the same image, menu shows it twice.
- **Skip including the model name in `embeddingInputHash`** → switching embedding
  models silently reuses a vector of the wrong dimension; cosine scores become
  meaningless garbage without ever erroring.
- **Skip finalize whitelisting** → the model can hallucinate an id or paste a raw
  external URL and it renders as-is — an injection/SSRF-adjacent risk via arbitrary
  markdown image `src`.
- **Skip the per-doc-cap exemption for single-document pools** → a single highly
  relevant document can't fill the menu even when every image on it is on-topic.
- **Don't cap `get_images` ids per call (~4)** → one call can blow the model's
  context window with base64 image data.
- **Treat `/thumb/`-style paths as decorative by pattern-matching "thumb"** → drops
  legitimate content images on CDNs (e.g. MediaWiki) that serve real photos from
  thumb paths; exclude "thumb" explicitly from the decorative path regex.
- **Build Tier 4 (frequency) by counting only non-filtered rows** → creates a
  feedback loop that undercounts, since already-skipped rows never enter the count;
  it must run as a separate pass over raw, unfiltered parsed URLs.
- **Fetch pixels for video/doc types in `get_images`** → wasted work and a broken
  multimodal content block; branch on `mediaType` before ever attempting a fetch.

---

## 15. Forward compatibility: vision captions (NOT built initially)

The initial version ships **without** any ingest-time vision. Everything above works on
context-derived embeddings alone. This section documents how a vision-caption signal
plugs in **later** with no rework — build the initial version so these seams exist, but
do **not** implement the caption step now.

### Why leave it out initially

Context-derived embedding is blind to what's *inside* an image (e.g. the numbers on a
chart). A one-time vision caption at ingest closes that gap. But it adds a per-image
model call and a fetch at ingest, so it's deferred until there's evidence the corpus
needs it — the same evidence-driven stance as Tiers 1/4 in §6.

### The seams that keep it a drop-in

1. **Schema (§3):** `visionCaption` and `captionInputHash` fields are already reserved
   (null initially). No migration needed when the step lands.
2. **Embedding input (§7):** the priority stack already names the caption's slot —
   below `manualContext`, above alt/caption/heading, replacing the surrounding-text
   fallback. Adding it is a change to *one* function (`buildEmbeddingInput`), gated on
   whether `visionCaption` is present.
3. **Ingest pipeline (§8):** the caption step is an **optional pre-step** before
   embedding-input construction. It never changes the delete-and-replace, hash-skip,
   or annotation logic.
4. **Manual override (§12):** unchanged — `manualContext` still outranks the caption,
   so human curation keeps winning.
5. **Query time (§9–11):** entirely unchanged. The caption only affects what text got
   embedded; ranking, the menu, `get_images`, and finalize don't care how the vector
   was produced.

### What the future caption step does (for reference, not to build now)

```
# Optional pre-step inside §8, per image, ONLY when the KB's caption toggle is on:
if kb.captionsEnabled and item.type == "image":
  grounding = [alt, captionAfter, nearestHeading].filter_nonempty().join(" / ")
  captionHash = sha256(f"{visionModel}:{normalizeUrl(url)}:{grounding}")
  prev = priorById[item.id]
  if prev.captionInputHash == captionHash and prev.visionCaption:
    caption = prev.visionCaption                 # reuse — SKIP the vision call
  else:
    bytes = fetchImageBytesGuarded(url)          # reuse §10's guarded fetcher
    caption = bytes ? visionModel.describe(bytes, grounding, maxTokens=500, timeout=30s)
                    : None                        # failure → degrade to context-only
  # caption (if any) is passed into buildEmbeddingInput as the reserved tier.
```

Key properties that make it safe and cheap when added:
- **Two independent caches.** `captionInputHash` (model + url + grounding) skips the
  vision call on re-scrape; `embeddingInputHash` (model + final input) skips the embed
  call — same pattern, one more hash.
- **Decorative filter runs first**, so vision never pays for icons/logos (§6).
- **Per-KB toggle**, so illustrative image-heavy KBs (where prose already describes
  everything) opt out.
- **Graceful degradation.** Caption off, or fetch/model failure → the code falls back
  to *exactly* the context-derived embedding this spec already describes. The caption
  is strictly additive; nothing depends on it existing.
- **Images only.** Video/doc have no pixels at ingest and are never captioned.

### Bonus seam (also future)

Store a short one-line form of the caption and use it as the menu `alt`/label in §9, so
the agent makes a better pre-`get_images` decision. Until captions exist, the menu label
stays the source `alt` — no behavior change.
