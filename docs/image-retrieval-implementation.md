# Implementing Image Retrieval (this repo's method) — Porting Guide

Context-derived embedding + doc-gated ranking + agent-side pixel inspection. No vision
model runs at ingest; the agent looks at pixels only when it decides to. Port order
below is dependency-ordered — each step needs the previous one.

## 1. Schema — one new table

Add a `kbMedia` table (see `packages/bx`ackend/convex/schemas/kb.schema.ts:335`):

```
imageId: string            // deterministic id, see §3
kbId, orgId: scope
mediaType?: "image" | "video" | "doc_link"
url?: string                // storageId later; url is fine for now
alt: string
embedding?: number[]         // absent for doc_link (never ranked)
embeddingInputHash?: string  // sha256(model:input) — skip re-embed if unchanged
manualContext?: string       // human override, survives re-scrape
sourceDocId: id
createdAt: number
```

Indexes: `by_source_doc` (sourceDocId), `by_kb` (kbId), `by_image_id` (imageId).

**Why a separate table, not chunks:** images are ranked *within* already-retrieved
docs, not searched globally. Keeping them out of the text vector index means text
retrieval quality is never diluted by image vectors competing for the same top-K.

## 2. Parsing — pull media out of markdown before chunking

Three regexes, pure functions, no I/O (`packages/eval-lib/src/file-processing/markdown-images.ts`):

- `![alt](url)` → images. Reject `data:` URIs, non-http(s), `.svg` (vision can't
  consume/fetch these usefully).
- A normalized embed token for non-native markdown media, e.g. `[embed:video](url "title")`.
- `<!--media:img_xxx-->` — a non-rendering annotation appended after each media
  occurrence once processed, so re-parses can identify "already handled" vs new.

**Critical ordering rule:** strip existing `<!--media:...-->` annotations *before*
re-parsing on every re-scrape, or you'll accumulate stale annotations pointing at
dead ids.

Chunking must strip all image/video markup so pixels/tokens never leak into text
chunks — keep a `stripMediaMarkdown()` used only at chunk-time (doc-link pointers are
deliberately kept in chunk text so the agent can cite them).

## 3. Deterministic IDs — stable across re-index

```
imageId = "{img|vid|doc}_" + sha256(kbId + " " + normalizeUrl(url)).slice(0, 16)
```

Type-prefixed so the agent (and your code) can branch on id shape alone. Deterministic
so a saved/cached answer's `![alt](img_xxx)` marker still resolves after a re-scrape,
as long as the URL didn't change.

## 4. Embedding input — context, not vision

No vision call. Build the embedding input from text *around* the image
(`buildImageEmbeddingInput` in `visionShared.ts`):

Signal priority, strongest wins:
1. **alt text** — only if ≥2 words and not a generic placeholder ("image", "photo",
   "screenshot", "icon", …) — reject a denylist of these.
2. **caption immediately after the image** — italic line, `Figure:`/`Caption:`/`Source:`
   prefix, or `<figcaption>` — "strong" if styled/prefixed, "weak" if just a short
   plain sentence.
3. **nearest `##`/`###` heading above the image** — reject generic ones ("Overview",
   "Introduction", "Summary", …) and anything under 3 words.
4. **surrounding text** (~300 chars before/after, bounded to the current section) —
   **only** used when *none* of the above are strong (avoids diluting a good signal
   with noisy prose).

`manualContext`, if set, becomes the **dominant** signal: repeat it N× (e.g. 3×) ahead
of the scraped signal, and cap the scraped support to the manual text's own length —
so a human's context always wins by volume regardless of how long the scraped
signal is. This is what makes curation actually work and survive re-scrapes.

Hash the final input together with the embedding model name
(`sha256("{model}:{input}")`) — this hash is your re-embed-skip key (§6) and it must
include the model so switching embedders forces a re-embed instead of silently
reusing a wrong-dimension vector.

## 5. Decorative-image filter — before anything else runs

Drop obvious chrome so it never gets a row, never enters the menu:
- CDN thumb paths encoding rendered width (e.g. `/123px-...`) below a floor (~100px).
- A filename denylist: location pins, flags, disambig icons, edit/magnify icons,
  wiki chrome, padlocks, etc. — whatever your source corpus's junk looks like.

Doing this early is the cheapest cost control in the whole system — it's a pure
regex check, no API call, and it's what keeps the "quality-max" embedding step (or
any future vision step) from wasting spend on non-content images.

## 6. Ingest pipeline — delete-and-replace per document

One action, run per document after it's finalized/re-scraped:

1. Strip old annotations, re-parse the clean content → media list.
2. Load prior rows for this doc (by `sourceDocId`) to recover `manualContext` (must
   survive re-scrape) and prior `embeddingInputHash`/`embedding` (re-embed skip).
3. For each media item: skip decorative, skip duplicates (dedup by `imageId` within
   the same call), route `doc_link` to a no-embedding pointer, everything else through
   `buildImageEmbeddingInput`.
4. **Skip re-embedding** when `embeddingInputHash` is unchanged from the prior row —
   only call the embedder for new/changed items, batched in one call. On embed
   failure, still upsert the row without an embedding (retried next run, never blocks
   the doc).
5. **Upsert via delete-and-replace**, keyed by `(sourceDocId, imageId)`: rows for this
   doc whose `imageId` is no longer present get deleted; the rest are patched/inserted.
   Also collapse any duplicate rows sharing an `imageId` (defensive against a prior
   race) — always keep exactly one row per `(sourceDocId, imageId)`.
6. Re-annotate the document content: append `<!--media:{imageId}-->` after each
   handled occurrence; rewrite embed-doc tokens to a chunk-safe inline pointer
   `[title](doc_id)`. Persist the annotated content back onto the document.

Wrap step 4's embed call (and the whole action) in a bounded-concurrency work pool
(e.g. max 4-5 parallel) with retries — a bulk reprocess or crawl finalizing many docs
at once must not slam your embedding provider.

## 7. Query-time ranking — doc-gated, not global

At retrieval time you already have a ranked list of matched chunks/documents from
text search. Do **not** run a separate global image vector search. Instead:

1. Take the **distinct documents**, in the order their best chunk ranked.
2. Pull each document's media rows (skip `doc_link` — it's never a menu item, no
   embedding to rank by).
3. Score each image by cosine similarity to the **same query embedding** used for
   text search (reuse it — don't re-embed the query).
4. **Threshold:** drop anything below a minimum similarity floor (start conservative,
   e.g. 0.2, and tune once you have data) — this excludes genuinely off-topic images
   whose only presence is being in a matched-but-mostly-irrelevant document.
5. **Fallback path:** if *no* candidate has a usable/comparable embedding (dimension
   mismatch from a different retriever config, or embeds failed), skip the threshold
   entirely and rank by document order — cosine is meaningless in that case, but you
   still want *some* menu rather than none.
6. **Per-document cap** (e.g. 2) so one document can't fill the whole menu — but
   **exempt this cap when the eligible pool spans only one document** (a single
   highly-relevant doc should be allowed to fill the menu).
7. Round-robin/dedup down to a global cap (e.g. 6) → this is "the menu": `{imageId,
   alt, type}` only. **Never** ship the embedding or URL to the caller here — do the
   ranking DB-side and return only what the agent needs to decide.

This is the precision lever: an image only ever surfaces if its parent document
already won on text relevance. Recall on "image whose parent doc didn't match" is a
known, accepted trade-off — same doc-gating.

## 8. Agent contract — menu → inspect → embed

Two things the agent needs, wired at the point you build its tool list / system
prompt:

**A. The menu goes into the tool result**, alongside chunk text, so the model sees
it in the same turn as the retrieved passages: `{ chunks: [...], images: [{imageId,
alt, type}] }`.

**B. A `get_images` tool**, gated behind a vision-capable-model check (keep an
explicit allowlist of model ids known multimodal — don't assume):
- Input: `imageIds` (cap at ~4 per call — a burst of large images blows the context).
- Validates ids against the media table, scoped to org **and every KB the agent can
  search** (an agent may span multiple KBs/retrievers — don't scope to just one).
- Fetches actual pixels server-side (SSRF-guarded: public http(s) only, no
  redirects, block loopback/private/metadata ranges), clamps CDN width/height query
  params, caps total bytes (~1.5MB) before base64-encoding into the model's context.
- Returns a **small** result (`{imageId, url, alt}` only — no base64) for whatever
  gets persisted as tool-call history; keep the actual base64 pixels in an
  in-memory map local to that single tool-call, mapped into the multimodal
  content block the SDK sends to the model, then discard. This keeps stored
  conversation history small even though the model saw full images.
- Non-image types (video/doc) return **no pixels** — return a text hint instead
  telling the model there's nothing to fetch and to use the marker directly.

**C. System prompt instructions** (only appended when the model is vision-capable),
covering:
- Copy `imageId`s verbatim from the menu — never invent/reformat one.
- To actually display media, write `![alt](imageId)` inline — id, not URL.
- Video: cannot be previewed — judge relevance from label/context only, and the
  marker alone is what embeds a *playable* video; never say "I can't show videos."
- If a tool call returns nothing, that id didn't exist — never retry with a
  guessed id.

## 9. Finalize — whitelist, never trust raw model output

Before returning the model's answer to the user, rewrite every media marker:

1. Seed a `resolved` map from whatever `get_images` actually returned this turn
   (ids the model *saw* pixels for).
2. Additionally resolve any remaining `![alt](imageId)`/`[text](imageId)` markers the
   model wrote **without** calling the tool (it may cite an id straight from chunk
   text) — look these up against the media table, same org+KB scope.
3. Rewrite: an image marker whose target resolves → real URL. Anything that doesn't
   resolve (hallucinated id, raw external URL, cross-KB id) → **dropped entirely**
   (image pass). A plain link marker `[text](id)` that resolves → rewritten to the
   real URL; one that doesn't resolve is left **untouched** (link pass is
   resolve-known-only — the model writes ordinary hyperlinks constantly and those
   must never be mangled).

This whitelist step is the actual security boundary — treat every marker the model
outputs as untrusted until it resolves against your own table.

## 10. Manual override — the curation escape hatch

A simple mutation: set/clear `manualContext` on every row sharing an `imageId` within
a KB (same media may appear on several source docs), then re-trigger step 6's ingest
action for each affected document so the new context actually gets re-embedded. Build
a UI list (dedup by `imageId`, showing which docs reference it) so a human can search
and fix a mis-ranked or unfindable image without touching source content.

## Build order (if porting incrementally)

1. Schema + parsing + deterministic ids (§1–3) — no behavior yet, just plumbing.
2. Embedding input + decorative filter + ingest pipeline (§4–6) — media becomes
   searchable.
3. Query-time doc-gated ranking (§7) — menu exists but nothing consumes it yet.
4. Agent wiring: menu in tool result, `get_images`, prompt instructions (§8).
5. Finalize whitelisting (§9) — do this **before** shipping to real users; it's the
   security boundary.
6. Manual override UI (§10) — nice-to-have, do last.

## Things that will bite you if skipped

- Skipping the decorative filter → menu fills with icons/pins, agent's inspection
  budget wasted, user sees garbage images.
- Skipping delete-and-replace dedup on re-scrape → duplicate rows per `imageId`,
  ranking double-counts the same image.
- Skipping the embeddingInputHash model-name inclusion → silent dimension mismatch
  after switching embedders, cosine scores become meaningless.
- Skipping finalize whitelisting → model can hallucinate an id or paste a raw
  external URL and it renders as-is (XSS/SSRF-adjacent risk via arbitrary markdown
  image src).
- Skipping the per-doc cap exemption for single-doc pools → a single highly relevant
  document can't fill the menu even when it should.
- Not capping `get_images` to ~4 ids → a large multi-image call can blow the model's
  context window with base64.
