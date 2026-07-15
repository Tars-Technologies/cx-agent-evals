# Integrating `@tars-inc/eval-lib/multimodal` into tars-monorepo

**Status as of 2026-07-14: NOT YET AVAILABLE to tars-monorepo.**

- The extraction is complete and fully green on branch `vb-feat/image-inclusion-in-response`
  (commit `efd92a5`) in `cx-agent-evals`, but **that branch has not been pushed to
  origin** — it doesn't exist on GitHub yet.
- Published npm `@tars-inc/eval-lib` is still `0.4.2` and does **not** contain the
  `/multimodal` subpath. `tars-monorepo`'s catalog pin (`0.4.0`) is even further behind.
- Nothing here can be `pnpm install`ed **from npm or git** by tars-monorepo today.
  But if `cx-agent-evals` is checked out on the same machine as tars-monorepo, its
  local build can be linked in directly right now — see Option 1 below. This doc
  exists so the monorepo side can prepare its integration in parallel, and drop the
  real import in the moment the package is published — no waiting on that to start
  writing code.

## What's moving and why

The pure (no-Node-dep) multimodal media-retrieval helpers that used to live only in
`cx-agent-evals`'s backend (`convex/lib/visionShared.ts`) now live in eval-lib at
`packages/eval-lib/src/multimodal/index.ts`, exported as the subpath
**`@tars-inc/eval-lib/multimodal`**. This is an **additive** change — no existing
export (root barrel, `/embedders/*`, `/pipeline/*`, `/utils/*`, `/scraper`, `/shared`,
etc.) was touched, renamed, or moved. Safe as a **minor** bump once published.

## How to start integrating now (before it's published)

Pick whichever fits your timeline:

1. **Link the local build directly, today (fastest).** If `cx-agent-evals` is
   checked out locally (same machine as tars-monorepo), you don't need npm, git, or
   a push at all — `packages/eval-lib/dist/multimodal/` is already built there.
   `pnpm link` it straight into the consuming package's `node_modules`. Full
   step-by-step (locating the checkout, linking, verifying, the catalog-strictness
   fallback, and the same API reference as below): see
   `docs/tars-monorepo-local-link-multimodal.md` in this repo — written to be
   dropped into tars-monorepo and executed by an agent there directly.
2. **Write against the interface, stub the import.** If you can't reach the local
   checkout, use the API reference below to write/port your calling code today
   against a local placeholder module (e.g.
   `// TODO(eval-lib): replace with @tars-inc/eval-lib/multimodal once published`).
   When the real package ships, delete the placeholder and repoint the import — the
   function names, signatures, and semantics below are the final contract.
3. **Once the branch is pushed** (planned for tomorrow), add it as a git dependency:
   `"@tars-inc/eval-lib": "github:Tars-Technologies/cx-agent-evals#<branch-or-commit>&path:/packages/eval-lib"`.
   eval-lib now has a `prepare` script (`"prepare": "pnpm build"`), which npm/pnpm
   runs automatically right after cloning a git dependency — so `dist/` (including
   `dist/multimodal/`) gets built on install even though it isn't committed to git.
   This should just work once the branch exists on origin.
4. **Wait for the real npm publish** (still the more durable option — proper
   versioning, no pinned commit/branch to remember to swap out) — see the checklist
   at the bottom for what has to happen upstream first.

## API reference (`@tars-inc/eval-lib/multimodal`)

### Constants
| Export | Value | Purpose |
|---|---|---|
| `MAX_IMAGES_PER_TURN` | `4` | Cap on images fetched per `get_images`-style tool call |
| `MENU_IMAGE_CAP` | `6` | Cap on the ranked image menu size |
| `PER_DOC_IMAGE_CAP` | `2` | Max images one document contributes when the pool spans >1 doc |
| `MIN_IMAGE_SIMILARITY` | `0.2` | Cosine floor below which an image is off-topic and dropped |
| `VISION_CAPABLE_MODELS` | `string[]` | Allowlist of vision-capable model ids (Claude 4.x, GPT-4.1/4o, o3/o4-mini) |
| `IMAGE_INSTRUCTIONS` | `string` | Drop-in system-prompt block explaining image/video/doc-link markers to an agent |

### Functions

**`isVisionCapable(modelId: string): boolean`**
Membership check against `VISION_CAPABLE_MODELS`.

**`buildImageEmbeddingInput(content: string, img: MarkdownImage, manualContext?: string): { alt: string; input: string; usedSurrounding: boolean }`**
Builds the context-aware text to embed for one image found in markdown `content`.
Prefers strong signals (alt text, italic/figure captions, nearby heading); falls back
to surrounding paragraph text only when all of those are weak. When `manualContext`
is given (non-blank), it's repeated and led with so it dominates the embedding
regardless of how much scraped text exists.

**`rankDocImagesForQuery(queryEmbedding: number[], docGroups: DocImage[][], cap: number): ImageMenuEntry[]`**
Builds the ranked image/video menu for a query. `docGroups` = per-document image
arrays, pre-ordered by document relevance. Drops images below
`MIN_IMAGE_SIMILARITY`, sorts by cosine similarity, applies the per-document cap
(only when the pool spans >1 document), dedups by `imageId`, caps at `cap`. Falls
back to document order (cap only, no threshold) when no image in the pool has a
usable embedding (dimension mismatch / missing).

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

**`parseRenderedMediaIds(text: string): string[]`**
Order-preserving, de-duplicated extraction of every KB media id (`img_*` / `vid_*` /
`doc_*`) actually referenced by a marker (`![alt](id)` or `[text](id)`) in `text` —
i.e. what the model actually chose to render, not everything it merely fetched.

**`whitelistImageMarkdown(text: string, resolved: Map<string, { url: string; alt: string }>): string`**
Finalize/output guard. Rewrites `![alt](id)` to the real URL only for ids present in
`resolved`; any other target (hallucinated id, raw external URL) is dropped —
this is the injection guard for model-controlled output. Separately, rewrites plain
link markers `[text](id)` to the real URL only when the id is known, leaving every
other hyperlink untouched.

### Dependency note
The module has exactly one internal import: `rewriteMarkdownImages` and the
`MarkdownImage` type from `@tars-inc/eval-lib/file-processing/markdown-images` —
already a stable, published subpath. No new runtime dependencies were introduced.

## What still has to happen before this is real (upstream, in cx-agent-evals)

1. Push `vb-feat/image-inclusion-in-response` (or its merge into `main`) to origin.
2. Add a changeset (`pnpm changeset`, minor bump — this repo now uses
   `@changesets/cli`; see `packages/eval-lib/releasing-eval-lib.md`) and let the
   release PR publish (or run the manual `npm publish` steps if not using the
   changeset flow yet).
3. In `tars-monorepo`: bump the `@tars-inc/eval-lib` pin in `pnpm-workspace.yaml`
   (catalog) and `packages/backend/package.json` to the new published version, then
   `pnpm install`.
4. Only after step 3 does `import { rankDocImagesForQuery, ... } from
   "@tars-inc/eval-lib/multimodal"` resolve in tars-monorepo.
