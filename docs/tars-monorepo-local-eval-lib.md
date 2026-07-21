# Using `@tars-inc/eval-lib` directly from local source (tars-monorepo)

**Goal:** make this monorepo resolve `@tars-inc/eval-lib` from a **local working
copy** of the `cx-agent-evals` repo instead of the published npm tarball — so you
can integrate against unreleased code (new subpaths, fixes, WIP) today, without a
publish + catalog re-pin cycle.

This is **local-only, throwaway setup.** By default it touches no committed file.
Revert instructions are at the bottom.

> Copy this file into the tars-monorepo (e.g. `docs/`) and follow it there.

---

## Background: how this monorepo normally gets eval-lib

- `@tars-inc/eval-lib` is published to npm (`publishConfig.access: public`).
- This monorepo pins it through the **pnpm catalog**
  (`pnpm-workspace.yaml` → `@tars-inc/eval-lib`), consumed by
  `packages/backend` (and any other package importing it).
- So normally your local edits in `cx-agent-evals` **do not reach here** until you
  publish a new version and re-pin. This guide bypasses that with a local link.

The package is ESM (`"type": "module"`), and its `exports` map is **explicit and
closed** — only listed subpaths are importable. This guide (and its API
reference below) covers `@tars-inc/eval-lib/multimodal`; swap the subpath in the
examples below if you're integrating a different part of the package.

---

## Prerequisite: locate and build the local source

Expected path: `/home/vaibhav/projects/cx-agent-evals`
(If different, find the dir whose `packages/eval-lib/package.json` has
`"name": "@tars-inc/eval-lib"`, and use that path throughout.)

The consumer resolves **built output** (`dist/`), not `src/`. Build it first:

```bash
cd /home/vaibhav/projects/cx-agent-evals/packages/eval-lib
pnpm build            # tsup → dist/
```

Verify the subpath you need actually built (example: `/multimodal`):

```bash
ls dist/multimodal/   # expect index.js  index.cjs  index.d.ts  index.d.cts
```

`pnpm link`/`file:` do **not** build for you — a missing `dist/<subpath>/` is the
#1 cause of "module not found" after linking.

---

## Option A — `pnpm link` (preferred; no tracked file changes)

From each package that imports eval-lib (likely `packages/backend`):

```bash
cd packages/backend
pnpm link /home/vaibhav/projects/cx-agent-evals/packages/eval-lib
```

This symlinks `node_modules/@tars-inc/eval-lib` → the local folder. Confirm:

```bash
ls -la node_modules/@tars-inc/eval-lib
# expect a symlink (->) to .../cx-agent-evals/packages/eval-lib, not a real dir
```

## Option B — `file:` dependency (if the catalog stomps the link)

Some strict catalog setups re-resolve on every `pnpm install` and drop the link.
If Option A won't stick, pin a `file:` dependency in the consuming package's
`package.json` (the line currently reading `"@tars-inc/eval-lib": "catalog:"`):

```jsonc
"@tars-inc/eval-lib": "file:/home/vaibhav/projects/cx-agent-evals/packages/eval-lib"
```

then `pnpm install`. Reliable, but it **is a tracked file change** — revert before
committing (see bottom).

## Option C — root `pnpm.overrides` (force it monorepo-wide)

To override every workspace package at once, add to the **root** `package.json`:

```jsonc
"pnpm": {
  "overrides": {
    "@tars-inc/eval-lib": "file:/home/vaibhav/projects/cx-agent-evals/packages/eval-lib"
  }
}
```

then `pnpm install` at the root. Also a tracked change — revert before committing.

---

## Verify the import resolves and runs

Run a throwaway script from the consuming package (adjust the subpath/symbol to
what you're integrating):

```ts
import { isVisionCapable, rankDocImagesForQuery } from "@tars-inc/eval-lib/multimodal"

console.log(isVisionCapable("gpt-4o"), typeof rankDocImagesForQuery) // "true function"
```

```bash
pnpm exec tsx scratch.ts     # or: node --import tsx scratch.ts
```

Module-resolution error? Re-check (1) the symlink/`file:` took, and (2)
`dist/<subpath>/index.js` exists in the linked target.

---

## Live-reload while iterating

A link points at built output, not source. When you change `cx-agent-evals`
source, rebuild for the change to show up here. Either rebuild on demand:

```bash
pnpm --dir /home/vaibhav/projects/cx-agent-evals/packages/eval-lib build
```

or run the watcher in `cx-agent-evals` while you work:

```bash
pnpm --dir /home/vaibhav/projects/cx-agent-evals/packages/eval-lib dev   # tsup --watch
```

TypeScript server in this repo may cache resolved types — restart it (or the dev
server) if new exports don't show up after a rebuild.

---

## `@tars-inc/eval-lib/multimodal` — API reference

Everything the multimodal subpath exports, as of local `0.4.2`:

**Constants**
| Export | Value | Purpose |
|---|---|---|
| `MAX_IMAGES_PER_TURN` | `4` | Cap on images fetched per `get_images`-style tool call |
| `MENU_IMAGE_CAP` | `6` | Cap on the ranked image menu size |
| `PER_DOC_IMAGE_CAP` | `2` | Max images one document contributes when the pool spans >1 doc |
| `MIN_IMAGE_SIMILARITY` | `0.2` | Cosine floor below which an image is off-topic and dropped |
| `VISION_CAPABLE_MODELS` | `string[]` | Allowlist of vision-capable model ids (Claude 4.x, GPT-4.1/4o, o3/o4-mini) |
| `IMAGE_INSTRUCTIONS` | `string` | **@deprecated** — a fixed instance of `mediaSystemPromptRules({ menuPresent: true, visionCapable: true })`. Prefer calling `mediaSystemPromptRules` directly so the prompt reflects the actual turn. |

**Functions**

- `isVisionCapable(modelId: string): boolean` — membership check against `VISION_CAPABLE_MODELS`.

- `buildImageEmbeddingInput(content: string, img: MarkdownImage, manualContext?: string): { alt: string; input: string; usedSurrounding: boolean }` —
  builds the context-aware text to embed for one image found in markdown `content`.
  Prefers strong signals (alt text, italic/figure captions, nearby heading); falls
  back to surrounding paragraph text only when all of those are weak. When
  `manualContext` is given (non-blank), it's repeated and led with so it dominates
  the embedding regardless of how much scraped text exists. (`MarkdownImage` is
  from `@tars-inc/eval-lib/file-processing/markdown-images`.)

- `rankDocImagesForQuery(queryEmbedding: number[], docGroups: DocImage[][], cap: number): ImageMenuEntry[]` —
  builds the ranked image/video menu for a query. `docGroups` = per-document image
  arrays, pre-ordered by document relevance. Drops images below
  `MIN_IMAGE_SIMILARITY`, sorts by cosine similarity, applies the per-document cap
  (only when the pool spans >1 document), dedups by `imageId`, caps at `cap`.
  Falls back to document order (cap only, no threshold) when no image in the pool
  has a usable embedding.
  ```ts
  interface DocImage {
    imageId: string
    alt: string
    embedding?: number[]
    type?: "image" | "video"
  }
  interface ImageMenuEntry {
    imageId: string
    alt: string
    type?: "image" | "video"
  }
  ```

- `rankScoredImages(cands, cap: number): ImageMenuEntry[]` — the lower-level
  ranker `rankDocImagesForQuery` builds its candidate list on top of; use
  directly if you already have per-candidate scores from elsewhere (e.g. a
  vector-store lookup) instead of a raw `queryEmbedding` + `DocImage[][]`.

- `parseRenderedMediaIds(text: string): string[]` — order-preserving, de-duplicated
  extraction of every KB media id (`img_*` / `vid_*` / `doc_*`) actually referenced
  by a marker (`![alt](id)` or `[text](id)`) in `text` — i.e. what the model
  actually chose to render, not everything it merely fetched.

- `whitelistImageMarkdown(text: string, resolved: Map<string, { url: string; alt: string }>): string` —
  finalize/output guard. Rewrites `![alt](id)` to the real URL only for ids present
  in `resolved`; any other target (hallucinated id, raw external URL) is dropped —
  this is the injection guard for model-controlled output. Separately, rewrites
  plain link markers `[text](id)` to the real URL only when the id is known,
  leaving every other hyperlink untouched.

- `mediaSystemPromptRules(opts: { menuPresent: boolean; visionCapable: boolean }): string` —
  builds the "## Media" system-prompt block appended when the retrieval menu
  carries media. Returns `""` if `menuPresent` is false (nothing to instruct on
  that turn). Adds the extra `get_images` tool-usage line only when
  `visionCapable` is true. This is what `IMAGE_INSTRUCTIONS` is a frozen instance
  of — call it directly to get per-turn-accurate instructions instead.

---

## Reverting to the published package

- **Option A (`pnpm link`):** `pnpm install` again in the consuming package once
  the real version is pinned — pnpm replaces the symlink with the resolved
  package. Nothing tracked to clean up. (If needed: `pnpm unlink --dir packages/backend @tars-inc/eval-lib`.)
- **Option B (`file:`):** change the dependency back to `"catalog:"` (or the
  pinned version), bump the catalog entry in `pnpm-workspace.yaml` to the real
  published version, then `pnpm install`.
- **Option C (`pnpm.overrides`):** delete the override block from the root
  `package.json`, then `pnpm install`.

---

## When you're ready to stop linking and ship for real

Publish from `cx-agent-evals` (see `packages/eval-lib/HANDOFF.md` for the full
release checklist — rebase onto `main` first, wire exports in all three places,
build/test, bump version, `npm publish`), then re-pin this monorepo's catalog to
the new version and reinstall.
