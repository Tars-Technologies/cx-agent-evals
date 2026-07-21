# eval-lib handoff: readying the package for moved-in functions

**Repo:** `cx-agent-evals` · **Package:** `packages/eval-lib` (`@tars-inc/eval-lib`)
**Task for the receiving agent:** move / consolidate functions **into** this package and make them importable — without silently breaking the downstream consumer.

---

## 1. What this package is, and who consumes it

- This is the **source repo** for the published npm package **`@tars-inc/eval-lib`** (`publishConfig.access: public`).
- Published on npm: `0.1.0 → 0.4.2` (latest published = **0.4.2**).
- **Two consumers, two mechanisms:**
  - **cx-agent-evals** `packages/frontend` + `packages/backend` — consume via `workspace:*` (local link). Your changes hit them immediately.
  - **tars-monorepo** `packages/backend` — consumes the **published npm tarball**, pinned to **`0.4.0`** via its pnpm catalog (`tars-monorepo/pnpm-workspace.yaml`). NOT a link. **Your local edits do not reach it until publish + re-pin.**

---

## 2. ⚠️ Version state — READ BEFORE ANY BUMP

- Local `package.json` says **`0.3.0`**; local git tags stop at `eval-lib@0.3.0`.
- But npm already has **0.4.0 / 0.4.1 / 0.4.2**, and tars-monorepo already runs **0.4.0**.
- → **0.4.x was published from `main`; the current feature branch is BEHIND it.**
- **Rebase onto `main` before touching versions or publishing**, or you will regress live 0.4.x changes.

---

## 3. The exports wiring — where a moved-in function must be registered

A function existing in `src/` is **NOT importable by consumers** until it's wired in **three coordinated places**. Miss one and it builds locally but fails for consumers.

1. **`src/index.ts`** — the root barrel. Add here if it should be reachable via the root import `@tars-inc/eval-lib`. Keep the `export type { ... }` vs `export { ... }` split intact (types-only vs value exports).
2. **`package.json` → `exports` map** — add a **new subpath** (e.g. `"./your-thing": { "types": "./dist/your-thing/index.d.ts", "import": "./dist/your-thing/index.js" }`) if you want `@tars-inc/eval-lib/your-thing`. The `exports` map is explicit/closed — unlisted paths are unreachable.
3. **`tsup.config.ts` → `entry[]`** — add the new file as an entrypoint **only if** it's a new subpath (root-barrel-only exports don't need their own entry). Also check `external[]` if the moved code pulls a new heavy/native dep.

Existing subpath entrypoints for reference: `embedders/*`, `rerankers/*`, `pipeline/{internals,llm-openai}`, `utils`, `utils/parent-swap`, `langsmith`, `llm`, `shared`, `file-processing`, `file-processing/markdown-images`, `scraper`, `scraper/link-extractor`, `registry`, `data-analysis`.

> Note the existing "moved to" comments in `src/index.ts` (e.g. `InMemoryVectorStore moved to "@tars-inc/eval-lib/pipeline/internals"`). Follow that convention: when you relocate an export, leave a breadcrumb comment at its old spot.

---

## 4. Do NOT break these — tars-monorepo depends on them at runtime

From `tars-monorepo/packages/backend`:

| Import path | Symbols |
|---|---|
| `@tars-inc/eval-lib` (root barrel) | `makeVectorStore`, `VectorStore`, `computeIndexConfigHash`, pipeline/index config **types** |
| `@tars-inc/eval-lib/embedders/make-embedder` | `makeEmbedder` |
| `@tars-inc/eval-lib/rerankers/make-reranker` | reranker factory |
| `@tars-inc/eval-lib/pipeline/llm-openai` | pipeline LLM |
| `@tars-inc/eval-lib/utils/parent-swap` | `parentSwap` |
| `@tars-inc/eval-lib/scraper` | `assertPublicHttpUrl`, `isBlockedHost` |
| `@tars-inc/eval-lib/shared` | `JobStatus` (type), `CLEANUP_BATCH_SIZE`, `EMBED_BATCH_SIZE` |

**Compile-time contract:** `tars-monorepo/.../validators/retriever_config.ts` is a type-only mirror of eval-lib's **pipeline / index config union** (`IndexConfig`, `PipelineConfig`, and the index-strategy members). Changing that shape **breaks the monorepo build** on drift. Treat it as a frozen public contract; extend additively, don't rename/remove.

---

## 5. Safe vs. breaking

- ✅ **Adding** exports / new subpaths = backward-compatible → bump **minor** (→ `0.5.0`).
- ⛔ Moving a symbol **out of** a path in §4, renaming it, or changing its signature = **breaking** → requires a coordinated tars-monorepo catalog re-pin. Prefer leaving a **re-export shim** at the old path over a hard removal.
- ⛔ Any change to the pipeline/index config **type shape** = breaks the monorepo build (§4).

---

## 6. Release checklist (only when intentionally shipping)

1. `git rebase main` (see §2).
2. Wire exports in all three places (§3).
3. `pnpm --dir packages/eval-lib build` (tsup) — confirm `dist/` has the new entry + `.d.ts`.
4. `pnpm --dir packages/eval-lib test` and `typecheck`.
5. Bump version + `npm publish`.
6. Update `tars-monorepo` catalog pin (`pnpm-workspace.yaml` → `@tars-inc/eval-lib@<new>`) and `packages/backend/package.json`, then reinstall.
