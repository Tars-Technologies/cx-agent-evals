# How the multimodal retrieval helpers were implemented in eval-lib

**Module:** `packages/eval-lib/src/multimodal/index.ts` → `@tars-inc/eval-lib/multimodal`
**Date:** 2026-07-15

This documents what moved, why it's shaped the way it is, and the reliability
bugs found and fixed once it went live. For "how do I consume this from
tars-monorepo," see `docs/multimodal-monorepo-integration.md` and
`docs/tars-monorepo-local-link-multimodal.md` instead — this doc is about the
implementation itself.

## 1. What moved, and why

The pure (no Node/Convex dependency) media-retrieval logic used to live only in
this repo's backend, at `convex/lib/visionShared.ts`. It was extracted wholesale
into eval-lib as a new subpath, `@tars-inc/eval-lib/multimodal`, so a second
consumer (tars-monorepo) could use the same logic instead of re-implementing it.

**What did NOT move:** `convex/lib/vision.ts` (`"use node"`) — `imageIdFor`,
`isLikelyDecorativeImage`, `fetchImageAsBase64`, `buildGetImagesTool`,
`resolveAnswerImageMarkers`. These are Convex/Node-coupled (fetch, crypto,
`ActionCtx`) and stayed in the backend; `vision.ts` re-exports everything from
the eval-lib subpath so its own callers didn't need to change their imports.

The move itself was mechanical — copy, fix one relative import
(`rewriteMarkdownImages`/`MarkdownImage` from `../file-processing/markdown-images.js`,
already in eval-lib), wire the subpath into `package.json` exports and
`tsup.config.ts`. The interesting part is what happened *after* the move, once
a second consumer's requirements had to be reconciled with this repo's.

## 2. Module contents (current exports)

**Constants:** `MAX_IMAGES_PER_TURN` (4), `MENU_IMAGE_CAP` (6),
`PER_DOC_IMAGE_CAP` (2), `MIN_IMAGE_SIMILARITY` (0.2), `VISION_CAPABLE_MODELS`
(deprecated allowlist, see §3.1), `IMAGE_INSTRUCTIONS` (deprecated, see §3.4).

**Functions:**
- `isVisionCapable(modelId)` — deprecated allowlist check (§3.1)
- `mediaSystemPromptRules(opts)` — the system-prompt block for media (§3.4)
- `buildImageEmbeddingInput(content, img, manualContext?)` — context-aware
  embedding input for one image (unchanged from the original; identical between
  this repo and tars-monorepo, so nothing to reconcile — see §3.5)
- `rankScoredImages(cands, cap)` — pure, storage-agnostic menu selection (§3.3)
- `rankDocImagesForQuery(queryEmbedding, docGroups, cap)` — cosine-in-JS wrapper
  over `rankScoredImages`, for consumers without server-side vector scoring (§3.3)
- `parseRenderedMediaIds(text)` — unchanged; identical between consumers
- `whitelistImageMarkdown(text, resolved, opts?)` — finalize/injection guard
  (§3.6)

**Types:** `ImageMenuEntry`, `DocImage` (both now `type?: "image" | "video" |
"doc_link"`, see §3.2).

## 3. Design decisions made while reconciling two consumers

The extraction wasn't just a copy — tars-monorepo had already evolved its own
version of this logic further in some places (Qdrant-backed ranking, a
capability-catalog vision gate, `doc_link` as a first-class type, a more
detailed prompt). Each divergence got resolved explicitly rather than picking
one side's version silently.

### 3.1 Vision gate: hardcoded allowlist demoted, not removed

`VISION_CAPABLE_MODELS`/`isVisionCapable` used to be *the* vision gate. tars-monorepo
gates on `capabilities.vision` from a live model catalog instead — no allowlist
to keep in sync as new models ship. Both are now marked `@deprecated` in
eval-lib: **"fallback for consumers without a capability catalog."** This repo
still uses `isVisionCapable` as its primary gate (`agents/actions.ts`,
`conversationSim/actions.ts`) since it has no catalog; tars-monorepo can ignore
it entirely. Nothing was removed — a hard removal would've been a breaking
change for this repo's live gate.

### 3.2 `doc_link` widened into the type union

`ImageMenuEntry.type`/`DocImage.type` went from `"image" | "video"` to
`"image" | "video" | "doc_link"`, matching tars-monorepo's third media kind
(a document pointer, not pixels). `MEDIA_MARKER_RE`/`parseRenderedMediaIds`
already matched the `doc_` id prefix, so no regex changes were needed — only
the type union.

### 3.3 Ranking split into a storage-agnostic core + a convenience wrapper

This is the most structurally significant change. tars-monorepo scores images
**server-side via Qdrant**; this repo stores embeddings inline on the Convex
`kbMedia` row and scores with **in-JS cosine similarity** (confirmed: image
embeddings are not in Qdrant in this repo — only text chunks are; Qdrant and
image scoring are on entirely separate paths here).

Rather than force one consumer's scoring strategy on the other, the ranking
logic was split in two:

- **`rankScoredImages(cands, cap)`** — the actual selection algorithm (drop
  below `MIN_IMAGE_SIMILARITY`, sort by score, apply the per-document cap
  unless the pool is single-document, dedup, cap). Its candidate shape is
  `{ imageId, alt, type?, docIdx, order, score: number | null }` —
  **no `embedding` field, no storage assumption.** It only needs a score,
  wherever that score came from.
- **`rankDocImagesForQuery(queryEmbedding, docGroups, cap)`** — this repo's
  convenience wrapper: pulls `DocImage[]` (which *does* carry `embedding`),
  computes cosine in JS, builds candidates, then calls `rankScoredImages`.

tars-monorepo skips `rankDocImagesForQuery` entirely and calls
`rankScoredImages` directly with candidates it already scored via its own
Qdrant index. Neither consumer's storage/scoring choice leaks into the other —
that's the point of the split.

### 3.4 Prompt: static block → parameterized function

`IMAGE_INSTRUCTIONS` was a fixed string. tars-monorepo's prompt had evolved
further: "search before refusing," `doc_link` verbatim-citation guidance, and
gating the `get_images` mention on whether the model is actually vision-capable.
`mediaSystemPromptRules({ menuPresent, visionCapable })` replaces it:

- Returns `""` when `menuPresent` is false (no media this turn → no media
  instructions at all).
- Appends the `get_images(imageIds)` line only when `visionCapable` is true.
- `IMAGE_INSTRUCTIONS` is kept as a `@deprecated` alias
  (`mediaSystemPromptRules({ menuPresent: true, visionCapable: true })`) so
  nothing broke that still imported the old constant directly.

This prompt was later hardened further after a live reliability bug — see §4.

### 3.5 `buildImageEmbeddingInput` / constants / `parseRenderedMediaIds` — no change needed

These were already functionally identical between the two codebases (same
denylists, same manual-context weighting, same regexes) — confirmed by
comparison rather than assumed, so eval-lib didn't change; tars-monorepo just
adopts them as-is.

### 3.6 `whitelistImageMarkdown` — strip policy made opt-in

tars-monorepo's finalize step builds a message as `{ text, parts }` — for a
resolved video/doc, it wants the marker **stripped out of the text** and
replaced by a separate structured `ContentPart` (a real player/chip). This
repo's frontend renders media straight from markdown text and has no
ContentPart concept — it wants a resolved video/doc marker rewritten to its
**inline URL**, exactly like an image.

Initially the shared function was changed to always strip non-image types,
which broke this repo's rendering (see §4). The fix: stripping is opt-in.

```ts
whitelistImageMarkdown(text, resolved, { stripNonImages?: boolean })
  → { text: string; strippedIds: string[] }
```

- `stripNonImages: false` (default) — video/doc resolve to inline URLs, same
  as images. This repo's callers pass no third argument, so they get this.
- `stripNonImages: true` — video/doc markers are stripped and their ids
  collected in `strippedIds`; the **caller** (tars-monorepo) builds the
  ContentParts. The library stays render-agnostic either way — it doesn't
  hardcode one consumer's UI policy.

## 4. Reliability bugs found after rollout, and how they were fixed

Two classes of bugs surfaced once this was exercised live in the chat UI —
neither was a wiring mistake; both were genuine interaction effects between
streaming UI and LLM behavior.

### 4.1 Frontend: images flashing then vanishing (later: crashing)

**Symptom:** an image would render for a moment during streaming, then
disappear — and in one case crashed the page with `NotFoundError: Failed to
execute 'removeChild' on 'Node'`.

**Root cause:** during streaming, the chat UI renders the model's raw,
*unresolved* text (`![alt](img_xxx)` — the imageId marker, not yet resolved to
a URL; resolution only happens once the turn finalizes). That renders as
`<img src="img_xxx">`, which always 404s, firing `onError` on every per-token
re-render. Two different `onError` implementations were tried and both broke
under that churn: an imperative `el.replaceWith(...)` fought React's own
reconciliation (the crash), and a `useState` latch permanently hid the image on
the first spurious error even once a valid URL arrived.

**Fix:** in `MarkdownViewer.tsx`, the `img` renderer now gates on the src being
a loadable `http(s)` URL *before* mounting anything — during streaming (raw
marker, not yet a URL) it renders a lightweight text placeholder, no `<img>`,
no `onError`, no crash. Once finalized (real URL), a dedicated `LoadableImage`/
`VideoFile` component renders it, degrading via React state (never DOM
mutation) if the URL later fails to load.

### 4.2 Backend: models fabricating plausible-looking media URLs

**Symptom:** "Here are photos of X" followed by real-looking Wikipedia image
URLs — that then silently disappeared from the final message.

**Root cause, confirmed via targeted logging (not guessed):** the whitelist's
injection guard (`whitelistImageMarkdown`) was working exactly as designed —
it strips any media reference that isn't a real, retrieved `imageId`. The
model, despite an explicit real `images` menu with real ids, would sometimes
fabricate a plausible-looking URL from its own training knowledge (e.g. a
Wikipedia-style path) instead of copying the given id. Confirmed non-random:
the *same* conversation, same retrieval menu, correctly used a real
`img_xxxx` marker once and fabricated a URL twice later — a model
reliability/instruction-following gap, not a data leak or a wiring bug
(retrieved chunk content was verified clean of any leaked image markup).

**Fix (defense in depth, in `agents/actions.ts`):**
1. **Prompt hardening** (`mediaSystemPromptRules`, eval-lib): added an explicit
   WRONG/RIGHT example showing a fabricated URL vs. the real imageId marker.
2. **Corrective retry:** if the model attempts media but references no real
   menu id, one forced rewrite pass tells it exactly which ids are valid this
   turn, before finalizing.
3. **Code-level backstop (doesn't depend on model cooperation):** a model can
   evade a text-only instruction by downgrading a fabricated *image* marker
   into a fabricated plain *link* citation instead — which the whitelist
   deliberately never touches (it must not mangle legitimate hyperlinks a
   model writes all the time). So the exact fabricated targets from the
   model's original attempt are tracked, and any later reference to those
   *same* strings — image or link — is neutralized regardless of what the
   retry produces. This only ever matches strings the model itself already
   produced and already proved fake in this turn, so real, unrelated
   citations are never touched.

## 5. Tests

`packages/eval-lib/tests/unit/multimodal.test.ts` — unit tests for every pure
function: `buildImageEmbeddingInput`, `rankDocImagesForQuery`,
`isVisionCapable`, `mediaSystemPromptRules`, `rankScoredImages`,
`whitelistImageMarkdown` (including both the default inline-URL behavior and
the opt-in `stripNonImages` strip behavior). The corrective-retry/backstop
logic in §4.2 is backend-specific orchestration (not a pure function) and is
covered by manual verification against live logs rather than a unit test —
worth adding a `convex-test` case if this needs to stay regression-safe.
