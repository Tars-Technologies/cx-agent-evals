# Task: locally link `@tars-inc/eval-lib` to get `/multimodal` working today

**Context for the agent executing this:** `@tars-inc/eval-lib`'s published npm
version (and this monorepo's current pin, `0.4.0`) does **not** contain a new
subpath, `@tars-inc/eval-lib/multimodal`, that was just built in the sibling repo
`cx-agent-evals`. It is not yet published — this doc sets up a **temporary local
link** to that repo's working copy so you can start integrating against the real
code today, without waiting for a real npm publish. This is throwaway/local-only
setup: it does not touch this repo's committed `pnpm-workspace.yaml` catalog pin
(unless you use the `file:` fallback in Step 2b, in which case revert it later —
see "Reverting" at the bottom).

## Prerequisite: locate `cx-agent-evals` on this machine

Expected path: `/home/vaibhav/projects/cx-agent-evals`

Verify it's there and has the built subpath:
```bash
ls /home/vaibhav/projects/cx-agent-evals/packages/eval-lib/dist/multimodal/
# expect: index.js  index.d.ts  index.cjs  index.d.cts  ...
```
If that directory is missing or empty, build it:
```bash
cd /home/vaibhav/projects/cx-agent-evals/packages/eval-lib && pnpm build
```
If `/home/vaibhav/projects/cx-agent-evals` doesn't exist, search for it: find a
directory containing `packages/eval-lib/package.json` whose `"name"` field is
`@tars-inc/eval-lib`, and use that path in place of the one above throughout.

## Step 1 — link from the consuming package (simplest path)

Find which package(s) in this monorepo actually import `@tars-inc/eval-lib`
(likely `packages/backend`, given the existing import paths: root barrel,
`/embedders/make-embedder`, `/rerankers/make-reranker`, `/pipeline/llm-openai`,
`/utils/parent-swap`, `/scraper`, `/shared`). From that package's directory:

```bash
cd <path-to-consuming-package>   # e.g. packages/backend
pnpm link /home/vaibhav/projects/cx-agent-evals/packages/eval-lib
```

This creates a symlink `node_modules/@tars-inc/eval-lib` → the local
`cx-agent-evals/packages/eval-lib` folder. No changes to any tracked
`package.json` or the pnpm catalog.

## Step 2 — verify the link took

```bash
ls -la node_modules/@tars-inc/eval-lib
# expect a symlink (->) pointing at .../cx-agent-evals/packages/eval-lib, not a
# real directory copied into node_modules
```

**If this monorepo's strict pnpm-catalog setup refuses the override** (some
catalog configs re-resolve on every install and stomp the link), fall back to an
explicit `file:` dependency instead:

```jsonc
// in the package.json currently listing "@tars-inc/eval-lib": "catalog:"
"@tars-inc/eval-lib": "file:/home/vaibhav/projects/cx-agent-evals/packages/eval-lib"
```
then `pnpm install`. This is more reliable but is a tracked file change — remember
to revert it once the real version is published (see "Reverting").

## Step 3 — smoke-test the import

Write/run a throwaway script or a one-off test that imports the new subpath and
confirms it resolves and executes:

```ts
import { isVisionCapable, rankDocImagesForQuery } from "@tars-inc/eval-lib/multimodal"

console.log(isVisionCapable("gpt-4o")) // expect: true
```

If this throws a module-resolution error, re-check Step 2's symlink and confirm
`dist/multimodal/index.js` actually exists in the linked target (Prerequisite
step) — pnpm link does not build the package for you if `dist/` is missing.

## Step 4 — import and use the API

```ts
import {
  // functions
  isVisionCapable,
  buildImageEmbeddingInput,
  rankDocImagesForQuery,
  parseRenderedMediaIds,
  whitelistImageMarkdown,
  // constants
  MAX_IMAGES_PER_TURN,
  MENU_IMAGE_CAP,
  PER_DOC_IMAGE_CAP,
  MIN_IMAGE_SIMILARITY,
  VISION_CAPABLE_MODELS,
  IMAGE_INSTRUCTIONS,
  // types
  type DocImage,
  type ImageMenuEntry
} from "@tars-inc/eval-lib/multimodal"
```

### API reference

**Constants**
| Export | Value | Purpose |
|---|---|---|
| `MAX_IMAGES_PER_TURN` | `4` | Cap on images fetched per `get_images`-style tool call |
| `MENU_IMAGE_CAP` | `6` | Cap on the ranked image menu size |
| `PER_DOC_IMAGE_CAP` | `2` | Max images one document contributes when the pool spans >1 doc |
| `MIN_IMAGE_SIMILARITY` | `0.2` | Cosine floor below which an image is off-topic and dropped |
| `VISION_CAPABLE_MODELS` | `string[]` | Allowlist of vision-capable model ids (Claude 4.x, GPT-4.1/4o, o3/o4-mini) |
| `IMAGE_INSTRUCTIONS` | `string` | Drop-in system-prompt block explaining image/video/doc-link markers to an agent |

**Functions**

- `isVisionCapable(modelId: string): boolean` — membership check against `VISION_CAPABLE_MODELS`.

- `buildImageEmbeddingInput(content: string, img: MarkdownImage, manualContext?: string): { alt: string; input: string; usedSurrounding: boolean }` —
  builds the context-aware text to embed for one image found in markdown `content`.
  Prefers strong signals (alt text, italic/figure captions, nearby heading); falls
  back to surrounding paragraph text only when all of those are weak. When
  `manualContext` is given (non-blank), it's repeated and led with so it dominates
  the embedding regardless of how much scraped text exists. (`MarkdownImage` is
  from `@tars-inc/eval-lib/file-processing/markdown-images`, already published.)

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

## Live-reload note

This is a symlink to source-built output, not a watcher. If cx-agent-evals'
source changes, re-run `pnpm build` there for this monorepo to see the update —
or run `pnpm --dir packages/eval-lib dev` (tsup `--watch`) in cx-agent-evals while
you're actively testing here.

## Reverting once the real package is published

1. If you used `pnpm link` (Step 1): just `pnpm install` again in the consuming
   package once the real version is pinned — pnpm will replace the symlink with
   the real resolved package. No tracked file to clean up.
2. If you used the `file:` fallback (Step 2b): change that dependency line back
   to `"catalog:"` (or the pinned version), bump the catalog entry in
   `pnpm-workspace.yaml` to the real published version, then `pnpm install`.
