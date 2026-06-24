# Document-Level Images (Decoupled from Chunks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make knowledge-base images a document-level asset that is retrieved doc-gated and ranked by a context-aware alt embedding, independent of which text chunk holds the image.

**Architecture:** A new `"use node"` action `processDocImages({ docId })` runs after every document finalize (via a bounded-concurrency WorkPool), builds a context-aware embedding per image, and writes one `kbImages` row per `(sourceDocId, imageId)` (delete-and-replace reconciliation). Indexing strips all image markdown from chunks. At retrieval, the three agent tool sites fetch the matched documents' images via `by_source_doc`, rank them within each doc by cosine and round-robin across docs into a capped menu returned alongside the (clean) chunks.

**Tech Stack:** Convex (queries/mutations/actions, `@convex-dev/workpool`), TypeScript ESM, eval-lib (`@tars-inc/eval-lib`), OpenAI embeddings (`text-embedding-3-small`, 1536d), Vitest + `convex-test`, Next.js frontend (MarkdownViewer).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-document-level-images-design.md` (edge cases E1–E9).
- `MENU_IMAGE_CAP = 6`; `MAX_IMAGES_PER_TURN = 4` (unchanged).
- `imageId = imageIdFor(kbId, url)` — unchanged hash (`img_` + sha256(`kbId` + " " + normalizeUrl(url)).slice(0,16)).
- `kbImages` row identity is `(sourceDocId, imageId)` — multiple rows may share an `imageId` (E1). `by_image_id().first()` stays valid (all rows for an id share url/alt).
- `url` is NEVER returned to the model; chunk `content` returned to the model is clean text.
- Embeddings produced with the system default embedder (`createEmbedder()` → `text-embedding-3-small`, 1536). Cosine ranking only when `queryEmbedding.length === image.embedding.length`; otherwise fall back to document order within each group, still round-robin across docs (E3/E9).
- `"use node"` files contain only actions. Mutations/queries live in non-node files. eval-lib `/llm` sub-path imported only from node action files.
- No migration tooling (D8); existing KBs are reprocessed per-doc via `reprocessKbImages`.
- Constants (D10):
  - `ALT_DENYLIST = {"image","photo","figure","screenshot","logo","banner","icon","img","graphic","picture",""}`
  - `HEADING_DENYLIST = {"Overview","Introduction","Summary","Background","About","Details","More","Content","Section"}`
  - `SURROUNDING_CHARS = 300`
  - Caption keywords: `Figure`, `Fig.`, `Caption:`, `Source:`, `Photo:`

---

### Task 1: Schema — `kbImages` fields + `by_source_doc` index

**Files:**
- Modify: `packages/backend/convex/schemas/kb.schema.ts` (`kbImageValidator` ~333-343, `kbImages` table def ~432-434)
- Test: covered by `convex-test` schema validation in later tasks (no standalone test)

**Interfaces:**
- Produces: `kbImages` rows now carry `embedding?: number[]`, `description?: string`; new index `by_source_doc` on `["sourceDocId"]`.

- [ ] **Step 1: Add the two optional fields to `kbImageValidator`**

In `kbImageValidator`, after `alt: v.string(),` and before `sourceDocId`:

```ts
  alt: v.string(),
  // Context-aware embedding (text-embedding-3-small, 1536). Input is
  // caption+alt+heading, or +surrounding when all signals are weak (D10).
  embedding: v.optional(v.array(v.float64())),
  // Reserved for the future media-description pipeline; null for now.
  description: v.optional(v.string()),
  sourceDocId: v.id("documents"),
```

- [ ] **Step 2: Add the `by_source_doc` index**

Replace the `kbImages` table definition:

```ts
  kbImages: defineTable(kbImageValidator)
    .index("by_image_id", ["imageId"])
    .index("by_kb", ["kbId"])
    .index("by_source_doc", ["sourceDocId"]),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -C packages/backend typecheck` (the deploy/codegen will surface validator errors)
Expected: PASS (no usages broken yet).

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/schemas/kb.schema.ts
git commit -m "feat(kb): kbImages embedding/description fields + by_source_doc index"
```

---

### Task 2: eval-lib — `stripImageMarkdown` + `stripImageComments`

**Files:**
- Modify: `packages/eval-lib/src/file-processing/markdown-images.ts`
- Test: `packages/eval-lib/tests/markdown-images.test.ts` (create)

**Interfaces:**
- Produces:
  - `stripImageComments(content: string): string` — removes `<!--img:...-->` HTML comments only.
  - `stripImageMarkdown(content: string): string` — removes complete `![alt](url)` occurrences AND `<!--img:...-->` comments, leaving clean text.

- [ ] **Step 1: Write the failing test**

Create `packages/eval-lib/tests/markdown-images.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  stripImageComments,
  stripImageMarkdown
} from "../src/file-processing/markdown-images.js"

describe("stripImageComments", () => {
  it("removes img annotation comments only", () => {
    const input = "a ![cat](https://x/c.png)<!--img:img_abc123--> b"
    expect(stripImageComments(input)).toBe("a ![cat](https://x/c.png) b")
  })
  it("leaves non-img comments untouched", () => {
    expect(stripImageComments("x <!-- keep --> y")).toBe("x <!-- keep --> y")
  })
})

describe("stripImageMarkdown", () => {
  it("removes images and their annotations", () => {
    const input = "see ![cat](https://x/c.png)<!--img:img_abc123--> here"
    expect(stripImageMarkdown(input)).toBe("see  here")
  })
  it("removes images that have no annotation", () => {
    expect(stripImageMarkdown("a ![x](https://y/z.png) b")).toBe("a  b")
  })
  it("is a no-op on plain text", () => {
    expect(stripImageMarkdown("no images")).toBe("no images")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/eval-lib test markdown-images`
Expected: FAIL — `stripImageComments`/`stripImageMarkdown` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `packages/eval-lib/src/file-processing/markdown-images.ts`:

```ts
/** Matches the non-rendering image-id annotation `<!--img:img_xxxx-->`. */
const IMG_COMMENT_RE = /<!--img:[^>]*-->/g

/** Remove `<!--img:...-->` annotations, leaving the surrounding text intact. */
export function stripImageComments(content: string): string {
  return content.replace(IMG_COMMENT_RE, "")
}

/**
 * Remove all complete `![alt](url)` images AND `<!--img:...-->` annotations,
 * producing clean text for chunking. Order matters: drop comments first so a
 * stripped image never leaves a dangling annotation behind.
 */
export function stripImageMarkdown(content: string): string {
  return stripImageComments(content).replace(IMAGE_RE, "")
}
```

Note: `IMAGE_RE` is the module-level `/!\[([^\]]*)\]\(([^)\s]+)\)/g`. Because it is a global regex used by `.replace` here and `.matchAll` elsewhere, this is safe — `.replace` does not rely on `lastIndex` persistence.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/eval-lib test markdown-images`
Expected: PASS.

- [ ] **Step 5: Build eval-lib (backend imports from dist)**

Run: `pnpm -C packages/eval-lib build`
Expected: tsup succeeds; `dist/file-processing/markdown-images.js` updated.

- [ ] **Step 6: Commit**

```bash
git add packages/eval-lib/src/file-processing/markdown-images.ts packages/eval-lib/tests/markdown-images.test.ts
git commit -m "feat(eval-lib): stripImageMarkdown + stripImageComments"
```

---

### Task 3: backend `visionShared` — context extraction + round-robin ranking + prompt

**Files:**
- Modify: `packages/backend/convex/lib/visionShared.ts`
- Test: `packages/backend/tests/vision.test.ts`

**Interfaces:**
- Consumes: `parseMarkdownImages`, `MarkdownImage` from `@tars-inc/eval-lib/file-processing/markdown-images`.
- Produces:
  - `MENU_IMAGE_CAP = 6`
  - `interface DocImage { imageId: string; alt: string; embedding?: number[] }`
  - `buildImageEmbeddingInput(content: string, img: MarkdownImage): { alt: string; input: string; usedSurrounding: boolean }`
  - `rankDocImagesForQuery(queryEmbedding: number[], docGroups: DocImage[][], cap: number): ImageMenuEntry[]` — `docGroups` already ordered by doc rank; ranks within each group by cosine (falling back to input order), round-robins across groups, dedups by `imageId`, caps.
  - Removes `buildImageMenuFromChunks`.
  - `IMAGE_INSTRUCTIONS` reworded (Component 6).

- [ ] **Step 1: Write the failing tests**

Add to `packages/backend/tests/vision.test.ts`:

```ts
import {
  buildImageEmbeddingInput,
  rankDocImagesForQuery,
  MENU_IMAGE_CAP
} from "../convex/lib/visionShared"

describe("buildImageEmbeddingInput", () => {
  const img = (overrides: Partial<{ alt: string; index: number; raw: string }>) => ({
    alt: "",
    url: "https://x/i.png",
    raw: `![${overrides.alt ?? ""}](https://x/i.png)`,
    index: overrides.index ?? 0,
    ...overrides
  })

  it("strong alt → no surrounding text", () => {
    const content = `## Pricing tiers\n![Comparison of pricing plans](https://x/i.png)\nbody text here`
    const r = buildImageEmbeddingInput(content, img({
      alt: "Comparison of pricing plans",
      index: content.indexOf("![")
    }))
    expect(r.usedSurrounding).toBe(false)
    expect(r.input).toContain("Comparison of pricing plans")
    expect(r.input).toContain("Pricing tiers")
  })

  it("empty alt → placeholder and all-weak → surrounding included", () => {
    const content = `## More\n![](https://x/i.png)\nthe quick brown fox jumps`
    const r = buildImageEmbeddingInput(content, img({ alt: "", index: content.indexOf("![") }))
    expect(r.alt).toBe("image")
    expect(r.usedSurrounding).toBe(true)
    expect(r.input).toContain("quick brown fox")
  })

  it("weak alt + strong italic caption → no surrounding", () => {
    const content = `## x\n![logo](https://x/i.png)\n*Figure 2: the revenue dashboard*\nmore`
    const r = buildImageEmbeddingInput(content, img({ alt: "logo", index: content.indexOf("![") }))
    expect(r.usedSurrounding).toBe(false)
    expect(r.input).toContain("revenue dashboard")
  })
})

describe("rankDocImagesForQuery", () => {
  const q = [1, 0]
  it("round-robins across docs (one doc can't fill all slots)", () => {
    const docA = [
      { imageId: "img_a1", alt: "a1", embedding: [1, 0] },
      { imageId: "img_a2", alt: "a2", embedding: [0.9, 0.1] }
    ]
    const docB = [{ imageId: "img_b1", alt: "b1", embedding: [0.8, 0.2] }]
    const menu = rankDocImagesForQuery(q, [docA, docB], 2)
    expect(menu.map((m) => m.imageId)).toEqual(["img_a1", "img_b1"])
  })

  it("dedups a shared imageId across docs (first occurrence wins)", () => {
    const docA = [{ imageId: "img_x", alt: "x", embedding: [1, 0] }]
    const docB = [{ imageId: "img_x", alt: "x", embedding: [1, 0] }]
    const menu = rankDocImagesForQuery(q, [docA, docB], 6)
    expect(menu.map((m) => m.imageId)).toEqual(["img_x"])
  })

  it("falls back to input order when embeddings are missing/mismatched", () => {
    const docA = [
      { imageId: "img_a1", alt: "a1" },
      { imageId: "img_a2", alt: "a2", embedding: [1, 2, 3] }
    ]
    const menu = rankDocImagesForQuery(q, [docA], 6)
    expect(menu.map((m) => m.imageId)).toEqual(["img_a1", "img_a2"])
  })

  it("caps at MENU_IMAGE_CAP", () => {
    const group = Array.from({ length: 10 }, (_, i) => ({
      imageId: `img_${i}`,
      alt: `${i}`,
      embedding: [1 - i / 100, 0]
    }))
    expect(rankDocImagesForQuery(q, [group], MENU_IMAGE_CAP).length).toBe(MENU_IMAGE_CAP)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C packages/backend test vision`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement helpers in `visionShared.ts`**

At the top, extend the eval-lib import (the existing `rewriteMarkdownImages` import stays — it backs `whitelistImageMarkdown` — just add the `MarkdownImage` type) and add `MENU_IMAGE_CAP`:

```ts
import {
  rewriteMarkdownImages,
  type MarkdownImage
} from "@tars-inc/eval-lib/file-processing/markdown-images"

export const MAX_IMAGES_PER_TURN = 4
export const MENU_IMAGE_CAP = 6
```

Add the D10 constants and context-extraction helper:

```ts
const ALT_DENYLIST = new Set([
  "image", "photo", "figure", "screenshot", "logo",
  "banner", "icon", "img", "graphic", "picture", ""
])
const HEADING_DENYLIST = new Set([
  "Overview", "Introduction", "Summary", "Background",
  "About", "Details", "More", "Content", "Section"
])
const SURROUNDING_CHARS = 300
const CAPTION_KEYWORD_RE = /^(Figure|Fig\.|Caption:|Source:|Photo:)/i
const HEADING_RE = /^(#{2,3})\s+(.+)$/gm

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/** Nearest `##`/`###` heading text above `pos`, or "". */
function nearestHeadingAbove(content: string, pos: number): string {
  let heading = ""
  for (const m of content.matchAll(HEADING_RE)) {
    if ((m.index ?? 0) < pos) heading = m[2].trim()
    else break
  }
  return heading
}

/**
 * The caption line immediately after the image (skipping at most one blank
 * line). Returns { text, strong } — strong when italic / caption-keyword /
 * <figcaption>; weak otherwise (a short single-sentence plain line).
 */
function captionAfter(content: string, img: MarkdownImage): { text: string; strong: boolean } {
  const after = content.slice(img.index + img.raw.length)
  const lines = after.split("\n")
  // lines[0] is the remainder of the image's own line (usually empty).
  let i = 1
  if (i < lines.length && lines[i].trim() === "") i++ // skip one blank line
  const line = (lines[i] ?? "").trim()
  if (!line) return { text: "", strong: false }
  const isItalic = /^\*[^*].*\*$/.test(line) || /^_[^_].*_$/.test(line)
  const isKeyword = CAPTION_KEYWORD_RE.test(line)
  const isFigcaption = /^<figcaption>/i.test(line)
  if (isItalic || isKeyword || isFigcaption) {
    return { text: line.replace(/^[*_]|[*_]$/g, "").replace(/<\/?figcaption>/gi, "").trim(), strong: true }
  }
  // weak: short single-sentence plain line
  if (line.length < 100 && !/[.!?].+[.!?]/.test(line)) return { text: line, strong: false }
  return { text: "", strong: false }
}

/** N chars before+after the image, bounded to the current section. */
function surrounding(content: string, img: MarkdownImage): string {
  // Section bounds: from the heading above to the next heading below.
  let sectionStart = 0
  let sectionEnd = content.length
  for (const m of content.matchAll(HEADING_RE)) {
    const at = m.index ?? 0
    if (at <= img.index) sectionStart = at
    else { sectionEnd = at; break }
  }
  const before = content.slice(Math.max(sectionStart, img.index - SURROUNDING_CHARS), img.index)
  const afterStart = img.index + img.raw.length
  const after = content.slice(afterStart, Math.min(sectionEnd, afterStart + SURROUNDING_CHARS))
  return stripImageMarkdownInline(`${before} ${after}`).replace(/\s+/g, " ").trim()
}

// Local lightweight strip so surrounding text never carries image syntax.
function stripImageMarkdownInline(s: string): string {
  return s.replace(/<!--img:[^>]*-->/g, "").replace(/!\[[^\]]*\]\([^)\s]+\)/g, "")
}

export function buildImageEmbeddingInput(
  content: string,
  img: MarkdownImage
): { alt: string; input: string; usedSurrounding: boolean } {
  const alt = img.alt.trim() === "" ? "image" : img.alt.trim()
  const caption = captionAfter(content, img)
  const heading = nearestHeadingAbove(content, img.index)

  const altOk = wordCount(alt) >= 2 && !ALT_DENYLIST.has(alt.toLowerCase())
  const captionOk = caption.strong
  const headingOk = wordCount(heading) >= 3 && !HEADING_DENYLIST.has(heading)

  // weak caption is only used when alt is also weak (per D10)
  const captionText = captionOk || !altOk ? caption.text : ""
  const parts = [captionText, alt, heading].filter(Boolean)

  if (altOk || captionOk || headingOk) {
    return { alt, input: parts.join(". "), usedSurrounding: false }
  }
  const surr = surrounding(content, img)
  return { alt, input: [...parts, surr].filter(Boolean).join(". "), usedSurrounding: true }
}
```

Add the ranking helper (and remove `buildImageMenuFromChunks`):

```ts
export interface DocImage {
  imageId: string
  alt: string
  embedding?: number[]
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

/**
 * Build the doc-gated image menu. `docGroups` are pre-ordered by document
 * relevance (best retrieved-chunk rank first). Within each group images are
 * ranked by cosine to `queryEmbedding` when the embedding exists and dimensions
 * match (E3); otherwise input order is preserved. Selection is round-robin
 * across groups (E9) with dedup by imageId, capped at `cap`.
 */
export function rankDocImagesForQuery(
  queryEmbedding: number[],
  docGroups: DocImage[][],
  cap: number
): ImageMenuEntry[] {
  const ranked = docGroups.map((group) =>
    [...group].sort((x, y) => {
      const xs =
        x.embedding && x.embedding.length === queryEmbedding.length
          ? cosine(queryEmbedding, x.embedding)
          : -Infinity
      const ys =
        y.embedding && y.embedding.length === queryEmbedding.length
          ? cosine(queryEmbedding, y.embedding)
          : -Infinity
      return ys - xs // higher cosine first; -Infinity ties keep input order (stable)
    })
  )
  const out: ImageMenuEntry[] = []
  const seen = new Set<string>()
  const maxLen = Math.max(0, ...ranked.map((g) => g.length))
  for (let rank = 0; rank < maxLen && out.length < cap; rank++) {
    for (const group of ranked) {
      if (out.length >= cap) break
      const img = group[rank]
      if (!img || seen.has(img.imageId)) continue
      seen.add(img.imageId)
      out.push({ imageId: img.imageId, alt: img.alt })
    }
  }
  return out
}
```

Delete the `buildImageMenuFromChunks` function block.

- [ ] **Step 4: Reword the prompt (Component 6)**

Replace the `IMAGE_INSTRUCTIONS` opening paragraph:

```ts
export const IMAGE_INSTRUCTIONS = `# Images
The search results include a ranked list of images drawn from the relevant documents — each entry has an \`imageId\` and \`alt\` text. Every real imageId begins with \`img_\` (e.g. \`img_3f9a2c1b4d5e6f70\`).
```

(Keep the rest of the existing instructions — the get_images flow, id discipline, decorative/off-topic guards, inline-marker requirement — unchanged, except remove the sentence "the chunk text shows where the image sits as `![alt](imageId)`" since chunks are now clean text.)

- [ ] **Step 5: Run tests**

Run: `pnpm -C packages/backend test vision`
Expected: PASS (new tests). Existing `vision.test.ts` cases referencing `buildImageMenuFromChunks`/`extractChunkImages` will be addressed in Task 7/10 — temporarily expect compile errors only in those describe blocks; if the file fails to compile, comment out the obsolete `extractChunkImages`/`buildImageMenuFromChunks` describe blocks now and delete them in Task 10.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/lib/visionShared.ts packages/backend/tests/vision.test.ts
git commit -m "feat(kb): context-aware embedding input + round-robin image ranking"
```

---

### Task 4: backend `kb/images.ts` — `imagesForDocs` + `upsertDocImages` (delete-and-replace)

**Files:**
- Modify: `packages/backend/convex/kb/images.ts`
- Test: `packages/backend/tests/images.test.ts`

**Interfaces:**
- Produces:
  - `imagesForDocs({ kbId, documentIds }) -> Array<{ documentId: Id<"documents">; imageId: string; alt: string; embedding?: number[] }>` (skips rows with no `url`; E9).
  - `upsertDocImages({ kbId, orgId, sourceDocId, images: Array<{ imageId; url; alt; embedding? }> })` — delete-and-replace per `sourceDocId` (E1/E2).
- Removes: `upsertImagesForChunk`, `listChunkIdsForKb`, `imageUrlMapForKb`, `deleteKbImagesByIds`, `patchChunkImages`, `reindexForImages` (chunk-coupled).
- Keeps: `getImagesByIds`, `countForKb`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/backend/tests/images.test.ts`:

```ts
describe("kb.images.upsertDocImages (delete-and-replace)", () => {
  it("inserts, then reconciles removed images on re-run", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const docId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        orgId, kbId, docId: "d1", title: "t", content: "c",
        contentLength: 1, metadata: {}, parseStatus: "done", createdAt: Date.now()
      })
    )
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId, orgId, sourceDocId: docId,
      images: [
        { imageId: "img_a", url: "https://x/a.png", alt: "a", embedding: [1, 0] },
        { imageId: "img_b", url: "https://x/b.png", alt: "b" }
      ]
    })
    let rows = await t.query(internal.kb.images.imagesForDocs, { kbId, documentIds: [docId] })
    expect(rows.map((r) => r.imageId).sort()).toEqual(["img_a", "img_b"])

    // Re-run without img_b → it must be deleted (E2). img_a alt updated.
    await t.mutation(internal.kb.images.upsertDocImages, {
      kbId, orgId, sourceDocId: docId,
      images: [{ imageId: "img_a", url: "https://x/a.png", alt: "a2", embedding: [0, 1] }]
    })
    rows = await t.query(internal.kb.images.imagesForDocs, { kbId, documentIds: [docId] })
    expect(rows.map((r) => r.imageId)).toEqual(["img_a"])
    expect(rows[0].alt).toBe("a2")
    expect(rows[0].embedding).toEqual([0, 1])
  })

  it("allows one row per (sourceDocId, imageId) for a shared url (E1)", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const mk = (d: string) =>
      t.run((ctx) =>
        ctx.db.insert("documents", {
          orgId, kbId, docId: d, title: d, content: "c",
          contentLength: 1, metadata: {}, parseStatus: "done", createdAt: Date.now()
        })
      )
    const docA = await mk("a"); const docB = await mk("b")
    const shared = { imageId: "img_s", url: "https://x/s.png", alt: "s" }
    await t.mutation(internal.kb.images.upsertDocImages, { kbId, orgId, sourceDocId: docA, images: [shared] })
    await t.mutation(internal.kb.images.upsertDocImages, { kbId, orgId, sourceDocId: docB, images: [shared] })
    const rowsB = await t.query(internal.kb.images.imagesForDocs, { kbId, documentIds: [docB] })
    expect(rowsB.map((r) => r.imageId)).toEqual(["img_s"])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -C packages/backend test images`
Expected: FAIL — `upsertDocImages` / `imagesForDocs` not defined.

- [ ] **Step 3: Implement the new functions; remove chunk-coupled ones**

In `packages/backend/convex/kb/images.ts`, delete `upsertImagesForChunk`, `listChunkIdsForKb`, `imageUrlMapForKb`, `deleteKbImagesByIds`, `patchChunkImages`, and `reindexForImages`. Add:

```ts
const docImageInputValidator = v.object({
  imageId: v.string(),
  url: v.string(),
  alt: v.string(),
  embedding: v.optional(v.array(v.float64()))
})

/**
 * Delete-and-replace a document's images (E1/E2). Rows are keyed by
 * (sourceDocId, imageId): rows for this doc whose imageId is not in `images`
 * are deleted, the rest are inserted or patched (alt/url/embedding).
 */
export const upsertDocImages = internalMutation({
  args: {
    kbId: v.id("knowledgeBases"),
    orgId: v.string(),
    sourceDocId: v.id("documents"),
    images: v.array(docImageInputValidator)
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("kbImages")
      .withIndex("by_source_doc", (q) => q.eq("sourceDocId", args.sourceDocId))
      .collect()
    const keep = new Set(args.images.map((i) => i.imageId))
    for (const row of existing) {
      if (!keep.has(row.imageId)) await ctx.db.delete(row._id)
    }
    const byId = new Map(existing.map((r) => [r.imageId, r]))
    for (const img of args.images) {
      const prev = byId.get(img.imageId)
      if (prev) {
        await ctx.db.patch(prev._id, {
          url: img.url,
          alt: img.alt,
          embedding: img.embedding
        })
      } else {
        await ctx.db.insert("kbImages", {
          imageId: img.imageId,
          kbId: args.kbId,
          orgId: args.orgId,
          url: img.url,
          alt: img.alt,
          embedding: img.embedding,
          sourceDocId: args.sourceDocId,
          createdAt: Date.now()
        })
      }
    }
  }
})

/** Doc-gated image pool for retrieval: a document's images (E9 skips url-less). */
export const imagesForDocs = internalQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    documentIds: v.array(v.id("documents"))
  },
  handler: async (ctx, args) => {
    const out: Array<{
      documentId: Id<"documents">
      imageId: string
      alt: string
      embedding?: number[]
    }> = []
    for (const documentId of args.documentIds) {
      const rows = await ctx.db
        .query("kbImages")
        .withIndex("by_source_doc", (q) => q.eq("sourceDocId", documentId))
        .collect()
      for (const r of rows) {
        if (r.kbId !== args.kbId || !r.url) continue
        out.push({ documentId, imageId: r.imageId, alt: r.alt, embedding: r.embedding })
      }
    }
    return out
  }
})
```

Add `Id` to the dataModel import at the top:

```ts
import type { Id } from "../_generated/dataModel"
```

- [ ] **Step 4: Run tests**

Run: `pnpm -C packages/backend test images`
Expected: PASS (new tests). Old `upsertImagesForChunk` test block will fail to compile — delete that describe block now.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/kb/images.ts packages/backend/tests/images.test.ts
git commit -m "feat(kb): upsertDocImages (delete-and-replace) + imagesForDocs"
```

---

### Task 5: backend `kb/images_actions.ts` — `processDocImages` action

**Files:**
- Modify: `packages/backend/convex/kb/images_actions.ts` (replace `backfillImagesForKb`)
- Modify: `packages/backend/convex/kb/images.ts` (add `setDocImageAnnotations` internal mutation)
- Test: `packages/backend/tests/images.test.ts`

**Interfaces:**
- Consumes: `documents.getInternal`, `imageIdFor`, `isLikelyDecorativeImage`, `parseMarkdownImages`, `stripImageComments`, `buildImageEmbeddingInput`, `upsertDocImages`, `setDocImageAnnotations`, `createEmbedder`.
- Produces:
  - `processDocImages({ docId })` internalAction.
  - `setDocImageAnnotations({ docId, content })` internalMutation in `images.ts` — patches `documents.content`.

- [ ] **Step 1: Add `setDocImageAnnotations` to `images.ts`**

```ts
/** Patch a document's content with re-annotated image markers (E5). */
export const setDocImageAnnotations = internalMutation({
  args: { docId: v.id("documents"), content: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.docId)
    if (!doc) return
    await ctx.db.patch(args.docId, {
      content: args.content,
      contentLength: args.content.length
    })
  }
})
```

- [ ] **Step 2: Write the failing test**

Add to `packages/backend/tests/images.test.ts`. Use a mock embedder via `vi.mock` on `@tars-inc/eval-lib/llm` returning deterministic vectors:

```ts
import { vi } from "vitest"
vi.mock("@tars-inc/eval-lib/llm", () => ({
  createEmbedder: () => ({
    name: "mock",
    dimension: 2,
    embed: async (texts: readonly string[]) => texts.map((_t, i) => [i + 1, 0]),
    embedQuery: async () => [1, 0]
  })
}))

describe("kb.images_actions.processDocImages", () => {
  it("parses images, writes rows with embeddings, annotates content, skips decorative", async () => {
    const t = setupTest()
    const userId = await seedUser(t)
    const kbId = await seedKB(t, userId)
    const orgId = TEST_ORG_ID
    const content =
      `## Revenue dashboard\n` +
      `![Quarterly revenue chart](https://x/rev.png)\n` +
      `*Figure 1: revenue by quarter*\n` +
      `![](https://x/12px-Red_pog.svg.png)\n` // decorative → skipped
    const docId = await t.run((ctx) =>
      ctx.db.insert("documents", {
        orgId, kbId, docId: "d1", title: "t", content,
        contentLength: content.length, metadata: {}, parseStatus: "done", createdAt: Date.now()
      })
    )
    await t.action(internal.kb.images_actions.processDocImages, { docId })

    const rows = await t.query(internal.kb.images.imagesForDocs, { kbId, documentIds: [docId] })
    expect(rows.length).toBe(1)
    expect(rows[0].alt).toBe("Quarterly revenue chart")
    expect(rows[0].embedding).toEqual([1, 0])

    const doc = await t.run((ctx) => ctx.db.get(docId))
    expect(doc!.content).toContain(`![Quarterly revenue chart](https://x/rev.png)<!--img:${rows[0].imageId}-->`)
    // decorative image kept visible, but not annotated (E4)
    expect(doc!.content).toContain("![](https://x/12px-Red_pog.svg.png)")
    expect(doc!.content).not.toContain("12px-Red_pog.svg.png)<!--img")
  })

  it("is idempotent (E5): second run does not duplicate annotations", async () => {
    // ... seed as above, run processDocImages twice, assert single <!--img--> per image
  })
})
```

(Implement the second test body fully when writing: run the action twice, then assert `doc.content.match(/<!--img:/g)!.length === 1`.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm -C packages/backend test images`
Expected: FAIL — `processDocImages` not defined.

- [ ] **Step 4: Implement `processDocImages` (replace `backfillImagesForKb`)**

Replace the body of `packages/backend/convex/kb/images_actions.ts`:

```ts
"use node"

import { createEmbedder } from "@tars-inc/eval-lib/llm"
import {
  parseMarkdownImages,
  rewriteMarkdownImages,
  stripImageComments
} from "@tars-inc/eval-lib/file-processing/markdown-images"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { imageIdFor, isLikelyDecorativeImage } from "../lib/vision"
import { buildImageEmbeddingInput } from "../lib/visionShared"

/**
 * Document-level image processing (E1–E9). Reads the finalized document content
 * (E8), builds a context-aware embedding per menu-eligible image, writes one
 * kbImages row per image via delete-and-replace (E2), and re-annotates the
 * content with `<!--img:id-->` (strip-then-reannotate, E5). Decorative images
 * stay visible in content but get no row/annotation (E4).
 */
export const processDocImages = internalAction({
  args: { docId: v.id("documents") },
  handler: async (ctx, args) => {
    const doc = await ctx.runQuery(internal.kb.documents.getInternal, { id: args.docId })
    const kbId = doc.kbId as string
    // Step 0: strip existing annotations, parse against clean content (E5).
    const base = stripImageComments(doc.content)
    const parsed = parseMarkdownImages(base) // already skips svg/data/non-http

    // Menu-eligible = parsed minus decorative (E4). Keep insertion order.
    const eligible = parsed.filter((p) => !isLikelyDecorativeImage(p.url))

    // Build embedding inputs + mint ids (dedup by imageId within the doc).
    const seen = new Set<string>()
    const toEmbed: Array<{ imageId: string; url: string; alt: string; input: string }> = []
    for (const img of eligible) {
      const imageId = imageIdFor(kbId, img.url)
      if (seen.has(imageId)) continue
      seen.add(imageId)
      const { alt, input } = buildImageEmbeddingInput(base, img)
      toEmbed.push({ imageId, url: img.url, alt, input })
    }

    // Batched embed (E7); on failure, upsert without embeddings (E3).
    let embeddings: number[][] | null = null
    if (toEmbed.length > 0) {
      try {
        const embedder = createEmbedder()
        embeddings = await embedder.embed(toEmbed.map((e) => e.input))
      } catch {
        embeddings = null
      }
    }

    await ctx.runMutation(internal.kb.images.upsertDocImages, {
      kbId: doc.kbId,
      orgId: doc.orgId,
      sourceDocId: args.docId,
      images: toEmbed.map((e, i) => ({
        imageId: e.imageId,
        url: e.url,
        alt: e.alt,
        embedding: embeddings ? embeddings[i] : undefined
      }))
    })

    // Step 5: re-annotate menu images only (E4/E5). Map url→imageId for lookup.
    const urlToId = new Map(toEmbed.map((e) => [e.url, e.imageId]))
    const annotated = rewriteMarkdownImagesWithAnnotation(base, urlToId)
    await ctx.runMutation(internal.kb.images.setDocImageAnnotations, {
      docId: args.docId,
      content: annotated
    })
  }
})

/**
 * Re-emit each `![alt](url)` followed by `<!--img:id-->` for menu images;
 * leave decorative/unsupported images (not in `urlToId`) untouched.
 */
function rewriteMarkdownImagesWithAnnotation(
  content: string,
  urlToId: Map<string, string>
): string {
  // rewriteMarkdownImages can only change the target; we need to append a
  // comment, so do a manual replace preserving the original ![alt](url).
  return content.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (raw, _alt: string, url: string) => {
      const id = urlToId.get(url)
      return id ? `${raw}<!--img:${id}-->` : raw
    }
  )
}
```

Note: `rewriteMarkdownImages` import stays only if used; if not, drop it from the import to satisfy lint. (The manual replace above is used because annotations append after the marker, which `rewriteMarkdownImages` cannot express.)

- [ ] **Step 5: Run tests**

Run: `pnpm -C packages/backend test images`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/kb/images_actions.ts packages/backend/convex/kb/images.ts packages/backend/tests/images.test.ts
git commit -m "feat(kb): processDocImages — context-aware doc-level image processing"
```

---

### Task 6: Image-processing WorkPool + finalize wiring + `reprocessKbImages`

**Files:**
- Modify: `packages/backend/convex/convex.config.ts`
- Modify: `packages/backend/convex/kb/images.ts` (pool + `scheduleDocImageProcessing` + `reprocessKbImages`)
- Modify: `packages/backend/convex/kb/documents.ts` (call helper from 4 finalize sites)
- Modify: `packages/backend/convex/kb/crawl.ts` (frontend "Re-index images" mutation rename, if it lives there — verify)
- Modify: `packages/frontend` re-index button wiring (rename `reindexForImages` → `reprocessKbImages`)
- Test: `packages/backend/tests/images.test.ts`

**Interfaces:**
- Consumes: `processDocImages` (Task 5).
- Produces:
  - `imageProcessingPool` WorkPool component.
  - `scheduleDocImageProcessing(ctx, docId)` — enqueues `processDocImages` (callable from mutations).
  - `reprocessKbImages({ kbId })` tenantMutation — enqueues `processDocImages` for every document in the KB.

- [ ] **Step 1: Add the pool component**

In `convex.config.ts`, add:

```ts
app.use(workpool, { name: "imageProcessingPool" })
```

- [ ] **Step 2: Add pool + helper + reprocess mutation in `images.ts`**

```ts
import { Workpool } from "@convex-dev/workpool"
import { components, internal } from "../_generated/api"
import type { MutationCtx } from "../_generated/server"
import { tenantMutation } from "../lib/auth/tenant"

const imagePool = new Workpool(components.imageProcessingPool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 2000, base: 2 }
})

/** Enqueue document image processing (E7/E8). Safe to call from any mutation. */
export async function scheduleDocImageProcessing(
  ctx: MutationCtx,
  docId: Id<"documents">
): Promise<void> {
  await imagePool.enqueueAction(ctx, internal.kb.images_actions.processDocImages, { docId })
}

/** Reprocess all of a KB's documents' images (replaces the chunk backfill). */
export const reprocessKbImages = tenantMutation({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = ctx
    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) throw new Error("Knowledge base not found")
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .collect()
    let scheduled = 0
    for (const d of docs) {
      if (d.parseStatus && d.parseStatus !== "done") continue // skip placeholders
      await scheduleDocImageProcessing(ctx, d._id)
      scheduled++
    }
    return { scheduled }
  }
})
```

- [ ] **Step 3: Call the helper from the 4 finalize sites in `documents.ts`**

Import at top of `documents.ts`:

```ts
import { scheduleDocImageProcessing } from "./images"
```

Insert `await scheduleDocImageProcessing(ctx, <docRowId>)` immediately before the `return` in each:
- `create` (after the documentCount patch, before `return docRowId`) → `await scheduleDocImageProcessing(ctx, docRowId)`
- `createFromScrape` (before `return docRowId`) → same with `docRowId`
- `createParsed` (before its `return`) → same with `docRowId`
- `finishParse` — only inside the successful (`status === "ok" && content.trim() …`) branch, after the documentCount patch: `await scheduleDocImageProcessing(ctx, doc._id)`

- [ ] **Step 4: Rewire the frontend "Re-index images" button**

Find the call site of `api.kb.images.reindexForImages` in `packages/frontend` and rename to `api.kb.images.reprocessKbImages` (same args `{ kbId }`). Update the button label if it says "Re-index images" → "Reprocess images".

Run: `grep -rn "reindexForImages" packages/frontend packages/backend` — fix every hit.

- [ ] **Step 5: Write the failing test (finalize triggers processing)**

Add to `images.test.ts`:

```ts
it("createFromScrape schedules processDocImages (rows appear after scheduled fns run)", async () => {
  const t = setupTest()
  const userId = await seedUser(t)
  const kbId = await seedKB(t, userId)
  const orgId = TEST_ORG_ID
  const docId = await t.mutation(internal.kb.documents.createFromScrape, {
    orgId, kbId, title: "t",
    content: "## H\n![A revenue chart](https://x/r.png)\n"
  })
  await t.finishInProgressScheduledFunctions() // run the WorkPool action
  const rows = await t.query(internal.kb.images.imagesForDocs, { kbId, documentIds: [docId] })
  expect(rows.map((r) => r.imageId).length).toBe(1)
})
```

(If the WorkPool component does not execute under `convex-test`, assert instead that a scheduled function / work item was enqueued. Verify by running the test; if `finishInProgressScheduledFunctions` doesn't drive the pool, fall back to asserting `t.run` over the `_scheduled_functions` system table or invoke `processDocImages` directly and keep this test as a unit check of the helper being called. Decide based on observed behavior.)

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm -C packages/backend test images && pnpm -C packages/backend typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/convex/convex.config.ts packages/backend/convex/kb/images.ts packages/backend/convex/kb/documents.ts packages/frontend
git commit -m "feat(kb): WorkPool fan-out for processDocImages + reprocessKbImages + finalize wiring"
```

---

### Task 7: Component 2 — strip image markdown from chunks during indexing

**Files:**
- Modify: `packages/backend/convex/kb/indexing_actions.ts` (lines ~119-156 parent branch; ~218-240 plain branch; import at ~21)
- Test: `packages/backend/tests/indexing.test.ts`

**Interfaces:**
- Consumes: `stripImageMarkdown` from `@tars-inc/eval-lib/file-processing/markdown-images`.
- Produces: chunk `content` is clean text; no `metadata.images` written.

- [ ] **Step 1: Write the failing test**

Add to `indexing.test.ts` (a unit test of the strip, mirroring existing chunk tests):

```ts
import { stripImageMarkdown } from "@tars-inc/eval-lib/file-processing/markdown-images"

it("chunk content is stripped of image markdown + annotations", () => {
  const input = "intro ![cat](https://x/c.png)<!--img:img_abc--> body"
  expect(stripImageMarkdown(input)).toBe("intro  body")
})
```

(If `indexing.test.ts` exercises Phase A end-to-end, add an assertion there that an inserted chunk's `content` contains no `![` and `metadata.images` is undefined.)

- [ ] **Step 2: Run to verify failure / baseline**

Run: `pnpm -C packages/backend test indexing`
Expected: the new unit test FAILS until import resolves (rebuild eval-lib if needed) — actually it should pass since Task 2 built eval-lib; this test mainly guards the integration edit below.

- [ ] **Step 3: Edit `indexing_actions.ts`**

Replace the import:

```ts
// remove: import { extractChunkImages } from "../lib/vision"
import { stripImageMarkdown } from "@tars-inc/eval-lib/file-processing/markdown-images"
```

Parent-child branch — replace the `parentMapped` map and remove the `upsertImagesForChunk` call:

```ts
const parentMapped = parentChunks.map((c) => ({
  documentId: args.documentId,
  kbId: args.kbId,
  indexConfigHash: args.indexConfigHash,
  chunkId: c.id,
  content: stripImageMarkdown(c.content),
  start: c.start,
  end: c.end,
  metadata: { level: "parent" as const }
}))
// (delete the parentImages collection + upsertImagesForChunk call)
const parentResult = await ctx.runMutation(internal.kb.chunks.insertChunkBatch, {
  chunks: parentMapped
})
```

Plain branch — replace the `mapped` map and remove its `upsertImagesForChunk` call:

```ts
const mapped = chunks.map((c) => ({
  documentId: args.documentId,
  kbId: args.kbId,
  indexConfigHash: args.indexConfigHash,
  chunkId: c.id,
  content: stripImageMarkdown(c.content),
  start: c.start,
  end: c.end,
  metadata: { ...(c.metadata ?? {}) }
}))
```

(Verify the surrounding code that consumed `m.images`/`m.row` is updated to the flattened shape; `insertChunkBatch` now receives the plain objects directly.)

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm -C packages/backend test indexing && pnpm -C packages/backend typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/kb/indexing_actions.ts packages/backend/tests/indexing.test.ts
git commit -m "feat(kb): strip image markdown from chunks (images decoupled to doc level)"
```

---

### Task 8: Component 3 — doc-gated image menu at the 3 retrieval sites

**Files:**
- Modify: `packages/backend/convex/agents/actions.ts` (~173-197)
- Modify: `packages/backend/convex/lib/agentLoop.ts` (~108-129)
- Modify: `packages/backend/convex/experiments/agentActions.ts` (~274-296)
- Test: `packages/backend/tests/vision.test.ts` (integration of imagesForDocs + ranking) and/or existing agentLoop tests

**Interfaces:**
- Consumes: `imagesForDocs` (Task 4), `rankDocImagesForQuery`, `MENU_IMAGE_CAP`, `DocImage` (Task 3).
- Produces: each retrieval tool returns `{ chunks: CleanChunk[], images: ImageMenuEntry[] }`; `url` never present; chunk `content` clean.

- [ ] **Step 1: Shared snippet (apply at each site, adapting variable names)**

After `vectorSearchWithFilter` returns `{ chunks }`, replace the per-chunk `metadata.images` mapping with:

```ts
// Doc-gated image menu (E9): docs ordered by best retrieved-chunk rank.
const docOrder: Id<"documents">[] = []
const seenDoc = new Set<string>()
for (const c of chunks) {
  const id = c.documentId as Id<"documents">
  if (!seenDoc.has(id)) { seenDoc.add(id); docOrder.push(id) }
}
const docImages = await ctx.runQuery(internal.kb.images.imagesForDocs, {
  kbId: info.kbId as Id<"knowledgeBases">,
  documentIds: docOrder
})
const groups: DocImage[][] = docOrder.map((d) =>
  docImages
    .filter((r) => r.documentId === d)
    .map((r) => ({ imageId: r.imageId, alt: r.alt, embedding: r.embedding }))
)
const imageMenu = rankDocImagesForQuery(queryEmbedding, groups, MENU_IMAGE_CAP)

const cleanChunks = chunks.map((c: any) => ({
  content: c.content,
  documentId: c.documentId, // or c.docId at the experiments site — keep existing key
  start: c.start,
  end: c.end
}))
```

Then return/record `{ chunks: cleanChunks, images: imageMenu }` instead of the old per-chunk array:
- **agents/actions.ts**: `return { chunks: cleanChunks, images: imageMenu }`
- **lib/agentLoop.ts**: build `const result = { chunks: cleanChunks, images: imageMenu }`, keep the existing `collectedToolCalls.push({ ..., result: JSON.stringify(result), ... })`, then `return result`.
- **experiments/agentActions.ts**: keep the `docId` key (`cleanChunks` uses `docId: c.docId`); push to `allToolCallResults` then return `{ chunks: cleanChunks, images: imageMenu }`.

Add imports at each site:

```ts
import { rankDocImagesForQuery, MENU_IMAGE_CAP, type DocImage } from "../lib/visionShared" // adjust relative path
```

(`agents/actions.ts` and `experiments/agentActions.ts` use `../lib/visionShared`; `lib/agentLoop.ts` uses `./visionShared`.)

- [ ] **Step 2: Update the experiments site's downstream consumers**

`experiments/agentActions.ts` may post-process `mappedChunks`. Verify any code reading `result.images`/`mappedChunks[].images` is updated to read `result.images` (the top-level menu).

- [ ] **Step 3: Run to verify failure (typecheck-driven)**

Run: `pnpm -C packages/backend typecheck`
Expected: errors flagged at any remaining `c.metadata.images` reference — fix all three sites until clean.

- [ ] **Step 4: Add/adjust tests**

If `agentLoop` has a test that asserts tool-result shape, update it to assert `result.images` is an array and chunk `content` has no `![`. Otherwise add a focused integration test in `vision.test.ts` that seeds a doc + `upsertDocImages`, builds `groups` via `imagesForDocs`, and asserts the menu.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm -C packages/backend test && pnpm -C packages/backend typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/convex/agents/actions.ts packages/backend/convex/lib/agentLoop.ts packages/backend/convex/experiments/agentActions.ts packages/backend/tests
git commit -m "feat(agents): doc-gated round-robin image menu in retrieval tool results"
```

---

### Task 9: Component 5 — strip `<!--img:id-->` in rendered preview

**Files:**
- Modify: the markdown rendering component (find: `grep -rn "MarkdownViewer\|DocumentViewer" packages/frontend/src`)
- Test: frontend has no vitest harness for this per repo notes — verify visually via `pnpm -C packages/frontend build` + manual check, or add a tiny pure unit test if a util is extracted.

**Interfaces:**
- Produces: rendered markdown has `<!--img:...-->` comments removed; raw mode unchanged.

- [ ] **Step 1: Locate the renderer**

Run: `grep -rn "MarkdownViewer\|DocumentViewer\|raw" packages/frontend/src/components`
Identify where `doc.content` is passed to the markdown renderer in **rendered** mode (vs raw `<pre>` mode).

- [ ] **Step 2: Strip comments before rendering**

In the rendered branch, transform the content before passing to the markdown library:

```ts
const rendered = content.replace(/<!--img:[^>]*-->/g, "")
```

Leave the raw-mode branch untouched (shows comments verbatim). If a shared helper is cleaner, import `stripImageComments` from `@tars-inc/eval-lib/file-processing/markdown-images`.

- [ ] **Step 3: Verify build**

Run: `pnpm -C packages/frontend build`
Expected: PASS. Manually confirm in the doc viewer that images still render (preserved `url`) and no literal `<!--img-->` shows in rendered mode.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src
git commit -m "feat(frontend): strip <!--img:id--> annotations in rendered doc preview"
```

---

### Task 10: Cleanup — retire chunk-coupled image code

**Files:**
- Modify: `packages/backend/convex/lib/vision.ts` (remove `extractChunkImages`, `recleanChunkImages`)
- Modify: `packages/backend/tests/vision.test.ts` (remove obsolete describe blocks)
- Grep-sweep for any remaining references.

**Interfaces:**
- Produces: dead chunk-image code removed; `imageIdFor` / `isLikelyDecorativeImage` / `resolveAnswerImageMarkers` / `buildGetImagesTool` / `whitelistImageMarkdown` retained (Component 4 unchanged).

- [ ] **Step 1: Sweep for references**

Run:
```bash
grep -rn "extractChunkImages\|recleanChunkImages\|buildImageMenuFromChunks\|metadata.images\|upsertImagesForChunk\|reindexForImages\|backfillImagesForKb\|listChunkIdsForKb\|imageUrlMapForKb\|patchChunkImages\|deleteKbImagesByIds" packages/backend packages/frontend
```
Expected after Tasks 4–8: only `vision.ts` (functions to delete) and their tests remain.

- [ ] **Step 2: Delete the dead functions**

Remove `extractChunkImages` and `recleanChunkImages` from `lib/vision.ts`. Keep `imageIdFor`, `isLikelyDecorativeImage`, `MIN_IMAGE_WIDTH_PX`, `DECORATIVE_NAME_RE`, `resolveAnswerImageMarkers`, `buildGetImagesTool`, `whitelistImageMarkdown`, `fetchImageAsBase64`, and the `export * from "./visionShared"`. Remove now-unused imports (`isUnsupportedImageUrl` if only used by `recleanChunkImages`).

- [ ] **Step 3: Delete obsolete tests**

Remove the `extractChunkImages` and `buildImageMenuFromChunks` describe blocks from `vision.test.ts`.

- [ ] **Step 4: Full verification**

Run:
```bash
pnpm -C packages/eval-lib build
pnpm -C packages/backend test
pnpm -C packages/backend typecheck
pnpm -C packages/frontend build
```
Expected: all PASS; the reference sweep from Step 1 returns nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/convex/lib/vision.ts packages/backend/tests/vision.test.ts
git commit -m "chore(kb): remove chunk-coupled image extraction (superseded by doc-level)"
```

---

## Notes for the implementer

- **eval-lib rebuild:** after any change in `packages/eval-lib/src`, run `pnpm -C packages/eval-lib build` before backend/frontend pick it up (Task 2 already does this).
- **WorkPool under convex-test:** confirm early (Task 6 Step 5) whether `t.finishInProgressScheduledFunctions()` drives WorkPool actions in `convex-test`. If not, test `processDocImages` directly (Task 5) and assert enqueue at the finalize sites by inspecting scheduled functions; do not block the feature on the harness.
- **Component 4 is unchanged** — do not touch `get_images`, `resolveAnswerImageMarkers`, or `whitelistImageMarkdown` behavior; they already resolve `img_` ids against `kbImages` which now has per-doc rows (`by_image_id().first()` still valid, E1).
- **Order matters:** Tasks 1→6 are backend foundation; 7 (indexing) and 8 (retrieval) can be done in either order after 4; 9 is frontend-only; 10 is final cleanup once nothing references the old code.
