# Extract multimodal-retrieval helpers into eval-lib

**Date:** 2026-07-14
**Scope:** Phase A only — extraction. No version bump, no `npm publish`, no `tars-monorepo` edits.

## Goal

Move the pure multimodal media-retrieval helpers out of the backend
(`packages/backend/convex/lib/visionShared.ts`) into the shared library
`@tars-inc/eval-lib`, so they can later be consumed by `tars-monorepo`. The
functions are pure (no Convex/Node deps), so the move is clean.

## What moves

The **entire contents** of `packages/backend/convex/lib/visionShared.ts`:

- Models: `VISION_CAPABLE_MODELS`, `isVisionCapable`
- Prompt: `IMAGE_INSTRUCTIONS`
- Embedding input: `buildImageEmbeddingInput` (+ private helpers/denylists)
- Ranking: `rankDocImagesForQuery`, `DocImage`, `ImageMenuEntry`, `cosine`
- Markers: `parseRenderedMediaIds`, `whitelistImageMarkdown`
- Constants: `MAX_IMAGES_PER_TURN`, `MENU_IMAGE_CAP`, `PER_DOC_IMAGE_CAP`,
  `MIN_IMAGE_SIMILARITY`

Its only external dependency (`rewriteMarkdownImages`, `MarkdownImage` from
`@tars-inc/eval-lib/file-processing/markdown-images`) already lives inside
eval-lib, so it becomes a relative import (`../file-processing/markdown-images.js`).

## What does NOT move

`packages/backend/convex/lib/vision.ts` (`"use node"`, Convex-coupled):
`imageIdFor`, `isLikelyDecorativeImage`, `fetchImageAsBase64`,
`buildGetImagesTool`, `resolveAnswerImageMarkers`. Stays in the backend.

## Target location (eval-lib)

- New file: `packages/eval-lib/src/multimodal/index.ts`
- New subpath: `@tars-inc/eval-lib/multimodal`
- Wiring (2 of the 3 HANDOFF places; root barrel intentionally skipped, matching
  the subpath-only `file-processing` convention):
  1. `package.json` → `exports` map: add `"./multimodal": { types, import }`
  2. `tsup.config.ts` → `entry[]`: add `src/multimodal/index.ts`

## Backend seam — clean repoint (delete the old file)

- Delete `packages/backend/convex/lib/visionShared.ts`.
- Repoint consumers from `../lib/visionShared` (or `./visionShared`) to
  `@tars-inc/eval-lib/multimodal`:
  - `agents/actions.ts`, `agents/promptTemplate.ts`,
    `experiments/agentActions.ts`, `kb/images.ts`, `kb/images_actions.ts`,
    `lib/agentLoop.ts`, `conversationSim/actions.ts`,
    `conversationSim/evaluation.ts`
- `lib/vision.ts`: replace `export * from "./visionShared"` and its
  `MAX_IMAGES_PER_TURN` import with `@tars-inc/eval-lib/multimodal`.

## Tests

- Add `packages/eval-lib/tests/unit/multimodal.test.ts` covering the moved pure
  fns (`buildImageEmbeddingInput`, `rankDocImagesForQuery`,
  `whitelistImageMarkdown`, `parseRenderedMediaIds`, `isVisionCapable`), ported
  from backend cases.
- Backend `tests/vision.test.ts` keeps node-only cases (`imageIdFor`,
  `isLikelyDecorativeImage`, `resolveAnswerImageMarkers`) and imports the pure
  symbols it still asserts from `@tars-inc/eval-lib/multimodal`.
- Backend `tests/images.test.ts` repoints `rankDocImagesForQuery` import.

## Verification (green gate)

1. `pnpm -C packages/eval-lib build` (must run before backend typecheck —
   backend resolves the workspace `dist/`)
2. `pnpm -C packages/eval-lib test && pnpm -C packages/eval-lib typecheck`
3. `pnpm -C packages/backend typecheck && pnpm -C packages/backend test`

## Non-goals

- No version bump / publish / tars-monorepo re-pin (phase B).
- No refactor/splitting of the moved logic — it moves as one cohesive module.
