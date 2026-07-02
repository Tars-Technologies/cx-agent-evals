# Videos as Media (+ doc_link pointers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface embedded videos on scraped pages to the agent (doc-gated, ranked, rendered as sandboxed iframe/`<video>`), generalize the image registry to `kbMedia`, and capture embedded docs as chunk-safe inline pointers — no doc ingestion.

**Architecture:** Generalize the existing doc-level image pipeline to media types. `html-to-markdown` stops stripping media and emits normalized tokens; the eval-lib parser recognizes them; `kbImages`→`kbMedia` gains `mediaType`; `processDocMedia` embeds image/video and mints no-embedding `doc_link` pointers; ranking excludes `doc_link`; finalize resolves both image markers and doc-id links; the frontend renders by type.

**Tech Stack:** Convex, TypeScript ESM, eval-lib (`@tars-inc/eval-lib`), turndown + linkedom (HTML→md), Vitest + convex-test, Next.js + react-markdown.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-01-videos-as-media-design.md` (decisions V1–V7).
- Media id format unchanged: `imageIdFor(kbId, url)` → `img_<16 hex>`; opaque, deterministic, media-agnostic.
- `mediaType: "image" | "video" | "doc_link"`. Existing rows are `"image"`. Dev-stage: **no data migration** (re-scrape).
- Video `url` = **embed-form** (`youtube.com/embed/ID`). `doc_link` rows have **no `embedding`** and are never ranked/menu'd.
- Video-embed domain allowlist: **YouTube, Vimeo, Loom, Wistia**. Doc-viewer allowlist: **docs.google.com, view.officeapps.live.com / onedrive, `.pdf` iframe src**.
- Annotation comment: `<!--media:id-->` (generalizes `<!--img:id-->`).
- Chunks are clean text: image + video tokens stripped; `[title](doc_id)` doc pointers **kept**.
- Finalize link-form pass is **resolve-known-only** — never drop/mangle the agent's real hyperlinks.
- Thumbnails (V6): frontend-only, YouTube-derived, click-to-load; no schema/scrape/backend/model change.
- `MENU_IMAGE_CAP=6`, `PER_DOC_IMAGE_CAP=2`, `MIN_IMAGE_SIMILARITY=0.2` (from B4/B5, unchanged).

---

### Task 1: eval-lib — generalize the markdown media parser

**Files:**
- Modify: `packages/eval-lib/src/file-processing/markdown-images.ts`
- Modify: `packages/eval-lib/src/file-processing/index.ts` (export new symbols)
- Test: `packages/eval-lib/tests/markdown-images.test.ts`

**Interfaces:**
- Produces:
  - `type MediaType = "image" | "video" | "doc_link"`
  - `interface MarkdownMedia { type: MediaType; alt: string; url: string; raw: string; index: number }`
  - `parseMarkdownMedia(content: string): MarkdownMedia[]` — images `![alt](url)`, videos `[embed:video](url "title")`, docs `[embed:doc](url "title")`.
  - `stripMediaMarkdown(content: string): string` — removes image + video tokens + `<!--media:...-->` comments; **leaves** `[embed:doc]`/plain links intact.
  - Keep `parseMarkdownImages` as a thin wrapper (filters `type==="image"`), and keep `stripImageComments`; add `<!--media:...-->` to the comment regex.

- [ ] **Step 1: Write the failing tests** — append to `markdown-images.test.ts`:

```ts
import { parseMarkdownMedia, stripMediaMarkdown } from "../src/file-processing/markdown-images.js"

describe("parseMarkdownMedia", () => {
  it("parses image, video, and doc tokens with types", () => {
    const md =
      "a ![cat](https://x/c.png) b [embed:video](https://youtube.com/embed/ID \"Demo\") c [embed:doc](https://x/s.pdf \"Spec\")"
    const out = parseMarkdownMedia(md)
    expect(out.map((m) => [m.type, m.alt, m.url])).toEqual([
      ["image", "cat", "https://x/c.png"],
      ["video", "Demo", "https://youtube.com/embed/ID"],
      ["doc_link", "Spec", "https://x/s.pdf"]
    ])
  })
  it("skips unsupported image targets (svg/data) as before", () => {
    expect(parseMarkdownMedia("![x](data:foo) ![y](https://a/b.svg)")).toEqual([])
  })
})

describe("stripMediaMarkdown", () => {
  it("removes image + video tokens and media comments, keeps doc/plain links", () => {
    const md =
      "i ![c](https://x/c.png)<!--media:img_a--> v [embed:video](https://y/e \"T\") d [Spec](img_doc1) k"
    expect(stripMediaMarkdown(md)).toBe("i  v  d [Spec](img_doc1) k")
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`parseMarkdownMedia` undefined):

Run: `pnpm -C packages/eval-lib test markdown-images`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** in `markdown-images.ts`. Add below the existing `IMAGE_RE`:

```ts
export type MediaType = "image" | "video" | "doc_link"

export interface MarkdownMedia {
  type: MediaType
  alt: string
  url: string
  raw: string
  index: number
}

// [embed:video](url "optional title")  /  [embed:doc](url "optional title")
const EMBED_RE = /\[embed:(video|doc)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g

/** Parse every image, video, and doc-embed occurrence, in document order. */
export function parseMarkdownMedia(content: string): MarkdownMedia[] {
  const out: MarkdownMedia[] = []
  for (const m of content.matchAll(IMAGE_RE)) {
    if (isUnsupportedImageUrl(m[2])) continue
    out.push({ type: "image", alt: m[1], url: m[2], raw: m[0], index: m.index ?? 0 })
  }
  for (const m of content.matchAll(EMBED_RE)) {
    out.push({
      type: m[1] === "video" ? "video" : "doc_link",
      alt: m[3] ?? "",
      url: m[2],
      raw: m[0],
      index: m.index ?? 0
    })
  }
  return out.sort((a, b) => a.index - b.index)
}
```

Update the comment regex + add `stripMediaMarkdown` (leave `stripImageMarkdown` as-is for chunk callers that will move to `stripMediaMarkdown`):

```ts
// generalize: match <!--img:...--> AND <!--media:...-->
const IMG_COMMENT_RE = /<!--(?:img|media):[^>]*-->/g

/** Strip image + video tokens and media comments; keep doc/plain links. */
export function stripMediaMarkdown(content: string): string {
  return content
    .replace(IMG_COMMENT_RE, "")
    .replace(IMAGE_RE, "")
    .replace(/\[embed:video\]\([^)\s]+(?:\s+"[^"]*")?\)/g, "")
}
```

Export both from `index.ts`.

- [ ] **Step 4: Run — expect PASS**, then build:

Run: `pnpm -C packages/eval-lib test markdown-images && pnpm -C packages/eval-lib build`
Expected: PASS; dist rebuilt.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/file-processing/markdown-images.ts packages/eval-lib/src/file-processing/index.ts packages/eval-lib/tests/markdown-images.test.ts
git commit -m "feat(eval-lib): parseMarkdownMedia + stripMediaMarkdown (image/video/doc)"
```

---

### Task 2: eval-lib — capture media in HTML→markdown

**Files:**
- Modify: `packages/eval-lib/src/file-processing/html-to-markdown.ts`
- Test: `packages/eval-lib/tests/unit/file-processing/html-to-markdown.test.ts`

**Interfaces:**
- Consumes: token forms from Task 1 (`[embed:video](url "title")`, `[embed:doc](url "title")`).
- Produces: scraped markdown that carries allowlisted video embeds, `<video>`, and doc-viewer/`.pdf` iframes as tokens; non-allowlisted iframes still removed.

- [ ] **Step 1: Write failing tests** — add to the html-to-markdown test file:

```ts
it("captures a YouTube iframe as a video token (embed form)", async () => {
  const html = `<body><iframe src="https://www.youtube.com/embed/abc123" title="Demo"></iframe></body>`
  const { content } = await htmlToMarkdown(html)
  expect(content).toContain('[embed:video](https://www.youtube.com/embed/abc123 "Demo")')
})
it("captures <video> with mp4 source as a video token", async () => {
  const html = `<body><video title="Clip"><source src="https://x/v.mp4"></video></body>`
  const { content } = await htmlToMarkdown(html)
  expect(content).toContain('[embed:video](https://x/v.mp4 "Clip")')
})
it("captures a docs.google.com iframe as a doc token", async () => {
  const html = `<body><iframe src="https://docs.google.com/document/d/XYZ/preview" title="Policy"></iframe></body>`
  const { content } = await htmlToMarkdown(html)
  expect(content).toContain('[embed:doc](https://docs.google.com/document/d/XYZ/preview "Policy")')
})
it("still removes a non-allowlisted iframe (e.g. ad)", async () => {
  const html = `<body><iframe src="https://ads.example.com/x"></iframe><p>hi</p></body>`
  const { content } = await htmlToMarkdown(html)
  expect(content).not.toContain("ads.example.com")
})
```

- [ ] **Step 2: Run — expect FAIL** (iframes stripped today):

Run: `pnpm -C packages/eval-lib test html-to-markdown`
Expected: FAIL — video/doc tokens absent.

- [ ] **Step 3: Implement.** In `html-to-markdown.ts`:

(a) Remove `"iframe"` from `BOILERPLATE_SELECTORS` (line 30) so iframes survive to the media pass.

(b) Add allowlists + a media-capture pass **before** `htmlForConversion = doc.body?.innerHTML` (mirrors the existing `<img>` src pass). Insert after the `<img>` absolutization block:

```ts
const VIDEO_EMBED_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|loom\.com|wistia\.com|wistia\.net)$/i
const DOC_VIEWER_HOSTS = /(^|\.)(docs\.google\.com|view\.officeapps\.live\.com|onedrive\.live\.com)$/i

function hostOf(u: string): string {
  try { return new URL(u).hostname } catch { return "" }
}
function titleOf(el: any): string {
  return (el.getAttribute("title") || el.getAttribute("aria-label") || "").trim()
}
// Replace an element with a text node carrying the token, so turndown emits it verbatim.
function replaceWithToken(doc: any, el: any, token: string) {
  el.replaceWith(doc.createTextNode(`\n\n${token}\n\n`))
}

if (baseUrl !== undefined || true) {
  for (const frame of doc.querySelectorAll("iframe")) {
    const raw = frame.getAttribute("src")
    if (!raw) { frame.remove(); continue }
    let abs = raw
    try { abs = baseUrl ? new URL(raw, baseUrl).href : raw } catch { /* keep */ }
    const host = hostOf(abs)
    if (VIDEO_EMBED_HOSTS.test(host)) {
      replaceWithToken(doc, frame, `[embed:video](${abs} "${titleOf(frame)}")`)
    } else if (DOC_VIEWER_HOSTS.test(host) || abs.split(/[?#]/)[0].toLowerCase().endsWith(".pdf")) {
      replaceWithToken(doc, frame, `[embed:doc](${abs} "${titleOf(frame)}")`)
    } else {
      frame.remove() // non-allowlisted (ads/maps/etc.) — unchanged behavior
    }
  }
  for (const vid of doc.querySelectorAll("video")) {
    let src = vid.getAttribute("src")
    if (!src) src = vid.querySelector("source")?.getAttribute("src") || ""
    if (!src) { vid.remove(); continue }
    let abs = src
    try { abs = baseUrl ? new URL(src, baseUrl).href : src } catch { /* keep */ }
    if (/\.(mp4|webm)(\?|#|$)/i.test(abs)) {
      replaceWithToken(doc, vid, `[embed:video](${abs} "${titleOf(vid)}")`)
    } else {
      vid.remove()
    }
  }
}
```

(Note: the `|| true` guard just keeps the pass unconditional; drop the `baseUrl !== undefined ||` and use a plain block if preferred.)

- [ ] **Step 4: Run — expect PASS**, rebuild:

Run: `pnpm -C packages/eval-lib test html-to-markdown && pnpm -C packages/eval-lib build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/eval-lib/src/file-processing/html-to-markdown.ts packages/eval-lib/tests/unit/file-processing/html-to-markdown.test.ts
git commit -m "feat(eval-lib): capture video/doc embeds as markdown tokens in html-to-markdown"
```

---

### Task 3: backend — `kbImages` → `kbMedia` + `mediaType`

**Files:**
- Modify: `packages/backend/convex/schemas/kb.schema.ts`
- Modify: `packages/backend/convex/kb/images.ts`, `kb/images_actions.ts`, `lib/vision.ts` (table-name references)
- Modify: `packages/backend/tests/images.test.ts`, `tests/vision.test.ts` (references)

**Interfaces:**
- Produces: table `kbMedia` (was `kbImages`) with new field `mediaType: v.union(v.literal("image"), v.literal("video"), v.literal("doc_link"))` (optional to tolerate old rows in dev; default treated as `"image"`); indexes `by_image_id`, `by_kb`, `by_source_doc` unchanged.

- [ ] **Step 1: Rename validator + table.** In `kb.schema.ts`:
  - Rename `kbImageValidator` → `kbMediaValidator`, `KbImage` → `KbMedia`.
  - Add `mediaType: v.optional(v.union(v.literal("image"), v.literal("video"), v.literal("doc_link")))` to the validator.
  - Rename the table key `kbImages:` → `kbMedia:` (keep the three indexes).

- [ ] **Step 2: Update table-name references.** Replace every `ctx.db.query("kbImages")` / `.insert("kbImages"` with `"kbMedia"` in `images.ts`, `images_actions.ts`, `lib/vision.ts`, and the two test files. (`grep -rn '"kbImages"' packages/backend` must return nothing.)

- [ ] **Step 3: Regenerate + typecheck.**

Run: `cd packages/backend && npx convex codegen && cd - && pnpm -C packages/backend typecheck`
Expected: PASS. Revert any incidental `_generated/ai/` churn (`git checkout packages/backend/convex/_generated/ai/`).

- [ ] **Step 4: Run tests** (rename is behavior-preserving):

Run: `pnpm -C packages/backend test images vision`
Expected: PASS (tests updated to `kbMedia` in Step 2).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/schemas/kb.schema.ts packages/backend/convex/kb/images.ts packages/backend/convex/kb/images_actions.ts packages/backend/convex/lib/vision.ts packages/backend/convex/_generated/api.d.ts packages/backend/tests
git commit -m "refactor(kb): rename kbImages->kbMedia, add mediaType"
```

---

### Task 4: backend — media upsert/query with types + doc_link exclusion

**Files:**
- Modify: `packages/backend/convex/kb/images.ts`
- Test: `packages/backend/tests/images.test.ts`

**Interfaces:**
- Consumes: `rankDocImagesForQuery` (unchanged), `kbMedia` table (Task 3).
- Produces:
  - `upsertDocImages` gains a `mediaType` per image input and stores it (default `"image"`).
  - `imagesForDocs` and `rankedImagesForDocs` **filter to `mediaType` in {image, video}** (skip `doc_link`, skip missing-embedding rows already handled downstream).
  - `getImagesByIds` returns `mediaType` alongside `{imageId,url,alt}` (finalize needs it to pick marker form).

- [ ] **Step 1: Write failing tests** — add to `images.test.ts`:

```ts
it("doc_link rows are excluded from rankedImagesForDocs", async () => {
  const t = setupTest(); const userId = await seedUser(t)
  const kbId = await seedKB(t, userId); const orgId = TEST_ORG_ID
  const docId = await t.run((ctx) => ctx.db.insert("documents", {
    orgId, kbId, docId: "d1", title: "t", content: "c", contentLength: 1,
    metadata: {}, parseStatus: "done", createdAt: Date.now() }))
  await t.mutation(internal.kb.images.upsertDocImages, {
    kbId, orgId, sourceDocId: docId, images: [
      { imageId: "img_i", url: "https://x/i.png", alt: "i", embedding: [1, 0], mediaType: "image" },
      { imageId: "img_d", url: "https://x/s.pdf", alt: "Spec", mediaType: "doc_link" }
    ]
  })
  const menu = await t.query(internal.kb.images.rankedImagesForDocs, {
    kbId, documentIds: [docId], queryEmbedding: [1, 0], cap: 6 })
  expect(menu.map((m) => m.imageId)).toEqual(["img_i"]) // doc_link excluded
})
```

- [ ] **Step 2: Run — expect FAIL** (mediaType arg unknown / doc_link leaks):

Run: `pnpm -C packages/backend test images`
Expected: FAIL.

- [ ] **Step 3: Implement** in `images.ts`:
  - Add `mediaType: v.optional(v.union(v.literal("image"), v.literal("video"), v.literal("doc_link")))` to `docImageInputValidator`; store it on insert/patch (default `"image"`).
  - In `imagesForDocs` and `rankedImagesForDocs`, change the row filter from `r.kbId === args.kbId && r.url` to also require `(r.mediaType ?? "image") !== "doc_link"`.
  - In `getImagesByIds`, include `mediaType: row.mediaType ?? "image"` in each returned object.

- [ ] **Step 4: Run — expect PASS**:

Run: `pnpm -C packages/backend test images && pnpm -C packages/backend typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/kb/images.ts packages/backend/tests/images.test.ts
git commit -m "feat(kb): media upsert carries mediaType; ranking excludes doc_link"
```

---

### Task 5: backend — `processDocImages` → media-aware processing

**Files:**
- Modify: `packages/backend/convex/kb/images_actions.ts`
- Test: `packages/backend/tests/images.test.ts`

**Interfaces:**
- Consumes: `parseMarkdownMedia`, `stripImageComments` (Task 1); `upsertDocImages` w/ `mediaType` (Task 4); `imageIdFor`, `isLikelyDecorativeImage`, `buildImageEmbeddingInput`.
- Produces: `processDocImages({docId})` now handles images+videos (embedded, `mediaType` set) and `doc_link`s (no embedding, token rewritten inline to `[title](doc_id)`); annotation uses `<!--media:id-->`.

- [ ] **Step 1: Write failing test** — add to the `processDocImages` describe (mock embedder already present):

```ts
it("embeds video, and rewrites doc embed to an inline [title](id) pointer", async () => {
  const t = setupTest(); const userId = await seedUser(t)
  const kbId = await seedKB(t, userId); const orgId = TEST_ORG_ID
  const content =
    `## Guides\n[embed:video](https://youtube.com/embed/ID "Setup demo")\n` +
    `[embed:doc](https://x/spec.pdf "Full spec")\n`
  const docId = await t.run((ctx) => ctx.db.insert("documents", {
    orgId, kbId, docId: "d1", title: "t", content, contentLength: content.length,
    metadata: {}, parseStatus: "done", createdAt: Date.now() }))
  await t.action(internal.kb.images_actions.processDocImages, { docId })

  const rows = await t.run((ctx) => ctx.db.query("kbMedia")
    .withIndex("by_source_doc", (q) => q.eq("sourceDocId", docId)).collect())
  const video = rows.find((r) => r.mediaType === "video")!
  const docLink = rows.find((r) => r.mediaType === "doc_link")!
  expect(video.embedding).toEqual([1, 0])      // video embedded
  expect(docLink.embedding).toBeUndefined()     // doc_link not embedded

  const doc = await t.run((ctx) => ctx.db.get(docId))
  expect(doc!.content).toContain(`[Full spec](${docLink.imageId})`) // inline pointer
  expect(doc!.content).toContain(`<!--media:${video.imageId}-->`)   // video annotated
})
```

- [ ] **Step 2: Run — expect FAIL**:

Run: `pnpm -C packages/backend test images`
Expected: FAIL.

- [ ] **Step 3: Implement.** Rewrite the body of `processDocImages` in `images_actions.ts`:
  - Import `parseMarkdownMedia` (replace `parseMarkdownImages`).
  - `const media = parseMarkdownMedia(base)`.
  - **images + videos** (`type !== "doc_link"`): decorative filter applies to `type==="image"` only; build embedding input via `buildImageEmbeddingInput` (video `alt`=title acts as alt); embed changed ones (existing skip-reembed logic); push upsert rows with `mediaType: type`.
  - **doc_links**: mint `imageId = imageIdFor(kbId, url)`; push upsert row `{ imageId, url, alt, mediaType: "doc_link" }` (no embedding, no hash).
  - Upsert all via `upsertDocImages`.
  - **Annotate/rewrite** `documents.content`: for image/video, keep behavior (`![alt](url)`/`[embed:video]...` + append `<!--media:id-->`); for doc_link, **replace** the `[embed:doc](url "title")` token with `[title](doc_id)`. Implement as a single `parseMarkdownMedia`-driven rebuild or a targeted replace keyed by `raw`.

Reference rewrite for the doc-token → pointer replacement:

```ts
let annotated = base
for (const m of media) {
  if (m.type === "doc_link") {
    annotated = annotated.replace(m.raw, `[${m.alt}](${idByUrl.get(m.url)})`)
  }
}
// then run the existing image/video annotation pass (append <!--media:id-->)
```

Use `<!--media:${id}-->` as the annotation comment everywhere.

- [ ] **Step 4: Run — expect PASS**:

Run: `pnpm -C packages/backend test images && pnpm -C packages/backend typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/kb/images_actions.ts packages/backend/tests/images.test.ts
git commit -m "feat(kb): processDocImages handles video embeds + doc_link pointers"
```

---

### Task 6: backend — finalize resolves doc-id links + prompt

**Files:**
- Modify: `packages/backend/convex/lib/vision.ts` (`resolveAnswerImageMarkers`, `whitelistImageMarkdown`)
- Modify: `packages/backend/convex/lib/visionShared.ts` (`whitelistImageMarkdown`, `IMAGE_INSTRUCTIONS`)
- Test: `packages/backend/tests/vision.test.ts`

**Interfaces:**
- Consumes: `getImagesByIds` returning `mediaType` (Task 4).
- Produces: finalize resolves `![alt](id)` (drop unknown — unchanged) AND `[text](id)` doc links (**resolve-known-only, never drop unknown**).

- [ ] **Step 1: Write failing tests** — add to `vision.test.ts` `whitelistImageMarkdown` block:

```ts
it("resolves a known doc-id link but leaves real hyperlinks untouched", () => {
  const resolved = new Map([["img_d", { url: "https://x/s.pdf", alt: "Spec" }]])
  const text = "see [Spec](img_d) and [our blog](https://blog.com/post)"
  expect(whitelistImageMarkdown(text, resolved)).toBe(
    "see [Spec](https://x/s.pdf) and [our blog](https://blog.com/post)"
  )
})
```

- [ ] **Step 2: Run — expect FAIL** (link form not handled):

Run: `pnpm -C packages/backend test vision`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `whitelistImageMarkdown` (`visionShared.ts`): after the existing image-marker rewrite, add a **link-form** pass that rewrites `[text](target)` only when `resolved.has(target)`:

```ts
// after the image-marker rewrite:
out = out.replace(/(?<!\!)\[([^\]]*)\]\(([^)\s]+)\)/g, (raw, text: string, target: string) => {
  const hit = resolved.get(target)
  return hit ? `[${text}](${hit.url})` : raw // resolve-known-only; never drop
})
```

(The `(?<!\!)` negative lookbehind avoids matching image markers already handled.) Ensure `resolveAnswerImageMarkers` also collects `[text](img_*)` link targets (not just `![..](img_*)`) into its `missing` set so they get resolved from the registry. Update `IMAGE_INSTRUCTIONS` to mention: video menu entries → emit marker, don't call `get_images`; inline `[title](img_...)` doc links may be included as links.

- [ ] **Step 4: Run — expect PASS**:

Run: `pnpm -C packages/backend test vision && pnpm -C packages/backend typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/vision.ts packages/backend/convex/lib/visionShared.ts packages/backend/tests/vision.test.ts
git commit -m "feat(agents): finalize resolves doc-id links (resolve-known-only) + prompt"
```

---

### Task 7: backend — retrieval menu carries `type`; chunks use `stripMediaMarkdown`

**Files:**
- Modify: `packages/backend/convex/kb/indexing_actions.ts` (chunk strip)
- Modify: `agents/actions.ts`, `lib/agentLoop.ts`, `experiments/agentActions.ts` (menu `type`)
- Modify: `packages/backend/convex/kb/images.ts` (`rankedImagesForDocs` returns `type`)
- Test: `packages/backend/tests/indexing.test.ts`

**Interfaces:**
- Produces: chunk content stripped via `stripMediaMarkdown` (keeps doc pointers); menu entries `{imageId, alt, type}`.

- [ ] **Step 1: Write failing test** — in `indexing.test.ts` add:

```ts
import { stripMediaMarkdown } from "@tars-inc/eval-lib/file-processing/markdown-images"
it("chunk strip removes image+video, keeps doc pointer", () => {
  const s = "a ![c](https://x/c.png)<!--media:img_a--> b [embed:video](https://y/e \"T\") c [Spec](img_d) d"
  expect(stripMediaMarkdown(s)).toBe("a  b  c [Spec](img_d) d")
})
```

- [ ] **Step 2: Run — expect FAIL/compile error** until wired:

Run: `pnpm -C packages/backend test indexing`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `indexing_actions.ts`: replace `stripImageMarkdown` import + calls with `stripMediaMarkdown`.
  - `rankedImagesForDocs` (`images.ts`): include `type: r.mediaType ?? "image"` in the objects passed to `rankDocImagesForQuery` output — i.e. return `{ imageId, alt, type }` (extend `ImageMenuEntry` usage). Keep dedup/threshold/cap.
  - The 3 retrieval sites: the returned `images` menu now carries `type`; pass it through in the tool result (`images: [{imageId, alt, type}]`). No other change (they already call `rankedImagesForDocs`).

- [ ] **Step 4: Run — expect PASS**:

Run: `pnpm -C packages/backend test && pnpm -C packages/backend typecheck`
Expected: PASS (full suite).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/kb/indexing_actions.ts packages/backend/convex/kb/images.ts packages/backend/convex/agents/actions.ts packages/backend/convex/lib/agentLoop.ts packages/backend/convex/experiments/agentActions.ts packages/backend/tests/indexing.test.ts
git commit -m "feat(kb): chunks use stripMediaMarkdown; retrieval menu carries media type"
```

---

### Task 8: frontend — render media by type (+ YouTube thumbnail)

**Files:**
- Modify: `packages/frontend/src/components/MarkdownViewer.tsx`
- Verify: `pnpm -C packages/frontend build`

**Interfaces:**
- Consumes: finalized answer markdown where image/video markers resolve to URLs and doc pointers to real doc URLs.
- Produces: `<img>` for images (unchanged), sandboxed `<iframe>` (click-to-load YouTube thumbnail) for video-embed domains, `<video controls>` for `.mp4`/`.webm`, `<a>` for docs.

- [ ] **Step 1: Implement** the `img` component branch in `markdownComponents` (no unit-test harness in frontend; verify via build + manual). Detect by resolved `src`:

```tsx
img: ({ src, alt, ...props }) => {
  const url = typeof src === "string" ? src : ""
  const host = (() => { try { return new URL(url).hostname } catch { return "" } })()
  const isYouTube = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(host)
  const isEmbed = isYouTube || /(^|\.)(vimeo\.com|player\.vimeo\.com|loom\.com|wistia\.(com|net))$/i.test(host)
  const isFile = /\.(mp4|webm)(\?|#|$)/i.test(url)
  if (isFile) return <video src={url} controls className="max-w-full rounded-md border border-border my-3" />
  if (isEmbed) return <VideoEmbed url={url} title={alt} youtube={isYouTube} />
  return <img alt={alt} src={url} className="max-w-full h-auto rounded-md border border-border my-3" {...props} />
}
```

Add a small `VideoEmbed` component: for YouTube, show the derived poster (`img.youtube.com/vi/<id>/hqdefault.jpg`, id parsed from the embed URL) with a play overlay; on click swap to a `<iframe sandbox="allow-scripts allow-same-origin allow-presentation" allowFullScreen>`. Non-YouTube allowlisted → iframe directly. (Doc links are plain `[text](url)` → the existing `a` renderer handles them; no change.)

- [ ] **Step 2: Build + manual verify**

Run: `pnpm -C packages/frontend build`
Expected: PASS. Manually confirm a YouTube marker shows a thumbnail that loads the player on click, an `.mp4` shows a `<video>`, an image is unchanged, and a doc link is a normal anchor.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/MarkdownViewer.tsx
git commit -m "feat(frontend): render video embeds (click-to-load) + mp4 + doc links by type"
```

---

### Task 9: preview annotation generalization + full verification

**Files:**
- Modify: `packages/frontend/src/components/MarkdownViewer.tsx` (comment strip regex)
- Verify: whole repo

**Interfaces:**
- Produces: rendered preview strips `<!--media:...-->` (and legacy `<!--img:...-->`).

- [ ] **Step 1: Implement** — in `MarkdownViewer.tsx` widen the strip regex used for rendered mode from `/<!--img:[^>]*-->/g` to `/<!--(?:img|media):[^>]*-->/g`.

- [ ] **Step 2: Full verification**

Run:
```bash
pnpm -C packages/eval-lib build && pnpm -C packages/eval-lib test
pnpm -C packages/backend test && pnpm -C packages/backend typecheck
pnpm -C packages/frontend build
grep -rn '"kbImages"' packages/backend || echo "no kbImages refs"
```
Expected: all PASS; no `kbImages` references remain.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/MarkdownViewer.tsx
git commit -m "feat(frontend): strip <!--media--> annotations in rendered preview"
```

---

## Notes for the implementer

- **eval-lib rebuild** after Tasks 1–2 (`pnpm -C packages/eval-lib build`) so backend/frontend resolve the new exports.
- **Convex codegen** after the table rename (Task 3) and any new function; revert incidental `_generated/ai/` churn.
- **Behavior-preserving for images:** every existing image test must stay green through Tasks 3–9 — the generalization must not change image behavior.
- **No doc ingestion anywhere** — doc_link is a pointer only (no embedding, no chunks, no `documents` rows).
- **Order:** 1→2 (eval-lib) → 3 (rename) → 4→7 (backend) → 8→9 (frontend). Tasks 4-6 are independent-ish after 3; do in order for green commits.
