# Image-Retrieval Evaluation — Design

**Date:** 2026-07-12
**Status:** Design / pre-implementation
**Scope:** Extend the span-based RAG *retrieval* evaluation (eval-lib + `convex/experiments`) so knowledge-base **images** are a first-class scored dimension, fed by synthetic image-answerable questions with labeled ground-truth images.

This is deliberately **not** the multimodal *agent-response* plan (`docs/plans/2026-06-06-multimodal-agent-responses-complete.md`), which is about the chatbot showing images. That work is already largely built on this branch and is set aside here. This spec is about **measuring image retrieval quality**.

---

## 1. Background — what exists today

The span-based retrieval eval (`experiments/agentActions.ts → evaluateAgentQuestion`) runs the agent per question and scores **text only**:

- Ground truth is `question.relevantSpans` — character spans in text documents.
- Metrics `recall / precision / iou / f1` are computed over `retrievedChunks` (from the agent's retriever tool calls) vs. those spans.
- The vision path already runs during eval (`get_images`, `shownImages` recorded on the result) but images are **record-only, never scored** (the agent-response plan's decision D8).

Image data lives entirely in Convex:

- `kbMedia` rows — keyed by deterministic `imageId` (`img_` + `sha256(kbId+url).slice(0,16)`), with `sourceDocId`, `alt`, `manualContext`, a **context-derived** `embedding` (text-embedding-3-small, 1536), `mediaType` (`image | video | doc_link`). Indexes: `by_image_id`, `by_kb`, `by_source_doc`.
- Retrieval surfaces images via `kb/images.ts → rankedImagesForDocs`, which calls the pure `lib/visionShared.ts → rankDocImagesForQuery(queryEmbedding, docGroups, cap)`. This is **doc-gated**: an image is only a candidate if its source doc already won on text relevance. Output is an `ImageMenuEntry[] = { imageId, alt, type }`, capped at `MENU_IMAGE_CAP`.
- After image annotation, `documents.content` contains inline markers `![alt](img_...)` (media id, not URL). Marker shape: `MEDIA_MARKER_RE = /!?\[[^\]]*\]\(((?:img|vid|doc)_[0-9a-f]+)\)/g`.

## 2. Goal

When an experiment runs on a multimodal KB, report an **image-retrieval metric** alongside the text span metrics: *did the retrieval layer surface the image(s) that actually answer the question?* Fed by a synthetic dataset of image-answerable questions whose correct image(s) are labeled.

Decisions locked during brainstorming:

- **A — score image retrieval** (a real metric), **+ D — generate image-answerable questions + ground truth**.
- Metric target is **candidacy** (the `rankedImagesForDocs` menu), not selection (what the agent showed). Clean parallel to text-span recall; deterministic; independent of LLM non-determinism.
- Generation is **image-first, text-only**: iterate images, generate a question each one answers from its `alt` + `manualContext` + surrounding text. No pixels at generation time. No relevance-judging step.

## 3. Non-goals

- **Selection scoring.** The agent's `shownImages` stays record-only (the deferred "B" path).
- **Vision at generation or scoring time.** Everything runs off text/context and context-derived embeddings.
- **Video / doc-link ground truth.** `doc_link` has no embedding; videos are out of scope. Only `mediaType === "image"` rows with an `embedding` are eligible.
- **A new vector index or multimodal embedder.** Reuses the existing 1536-dim text index and the existing `rankDocImagesForQuery` primitive.

## 4. Architectural placement

Image data (`kbMedia`, doc content markers, chunks) is Convex-native; eval-lib has no concept of it. Therefore:

- **Generation (D):** Convex-native action in `convex/generation/`. Only the pure prompt-builder is extracted for unit testing. Not forced into an eval-lib `Strategy` (would require plumbing image rows through the `Corpus` interface — off-pattern).
- **Metric (A):** the recall/precision math is pure and set-based → lives in **eval-lib** (`evaluation/metrics/image.ts`), unit-tested there, invoked from `evaluateAgentQuestion`.

## 5. Data model change

Add one optional field to `questionValidator` (`schemas/kb.schema.ts`):

```ts
relevantImageIds: v.optional(v.array(v.string()))  // deterministic img_ ids
```

- Optional ⇒ backward compatible; existing text-only questions untouched.
- A question may carry **both** `relevantSpans` and `relevantImageIds`; image-first generation emits both, so the same question scores on text *and* images.

## 6. Generation (D) — image-first, text-only

New action `convex/generation/imageQuestions.ts` (wired into the existing generation orchestration / WorkPool so it reports progress like other strategies).

Per run, given a target dataset + KB:

1. **Select images.** Load `kbMedia` for the KB where `mediaType === "image"` and `embedding` is present. (No embedding ⇒ unrankable ⇒ un-scoreable ⇒ skip.)
2. **Build context** for each image: `manualContext ?? ""` + `alt` + a text window around its `![alt](imageId)` marker in the source doc's `content`. Prefer the containing chunk's text (locate the marker offset, find the chunk whose `[start,end)` contains it); fall back to a ±N-char window.
3. **Generate** one question via the existing OpenAI client (`resolveModel`), prompt → strict JSON `{ question }`: "Write a natural user question that this image answers."
4. **Insert** a question row: `{ queryText, sourceDocId, relevantImageIds: [imageId], relevantSpans: [surroundingSpan], source: "image_generated" }`.
   - `surroundingSpan` = the containing chunk's span (or the ±N window offsets), so text metrics also apply.
5. **Guards:** skip images whose combined `alt` + `manualContext` + context is empty (unanswerable → junk question); cap N questions per run; dedup by `imageId`.

Only the prompt-builder (context → prompt string) and the marker-locating helper are pure and unit-tested; the action orchestrates.

## 7. Metric (A) — candidacy recall/precision, deterministic

### 7.1 Pure functions (eval-lib)

`eval-lib/src/evaluation/metrics/image.ts`, set-based over `imageId`s:

```
imageRecall(menu, relevant)    = |menu ∩ relevant| / |relevant|
imagePrecision(menu, relevant) = |menu ∩ relevant| / |menu|
```

- `relevant` = `question.relevantImageIds`; `menu` = the deterministic scoring menu (§7.2).
- Edge cases: `relevant` empty ⇒ metric is **not applicable** (return `undefined`/skip, do not count); `menu` empty with non-empty `relevant` ⇒ recall 0, precision 0 (or precision undefined — define precision as 0 when menu empty for a question that has relevant images, else n/a).
- Recall is **recall@cap** — the menu is capped at `MENU_IMAGE_CAP`. This is stated explicitly so the number is interpreted correctly.

### 7.2 Deterministic scoring menu (in `evaluateAgentQuestion`)

Compute the menu **independently of the agent's tool calls** so scores are reproducible and measure the retriever, not the LLM. Per the agent's ready retrievers:

1. Embed `queryText` with the retriever's `embeddingModel`.
2. `vectorSearchWithFilter(topK = defaultK)` → chunks → `docOrder` (docs by best chunk rank).
3. `rankedImagesForDocs(kbId, docOrder, queryEmbedding, cap = MENU_IMAGE_CAP)`.
4. **Union** menus across the agent's retrievers/KBs, dedup by `imageId`.

This mirrors exactly what the retriever tool does at answer time, but runs once per question for scoring, decoupled from whether/how the LLM searched or whether `hasVision` was on.

### 7.3 Where scores are stored / aggregated

- Store `imageRecall` / `imagePrecision` on the per-question result's `scores` **only when the question has `relevantImageIds`**. Text-only questions omit them (not penalized, not diluting averages).
- Experiment-level aggregation: average text metrics over **all** questions; average image metrics over the **image-bearing subset** only. Report both subsets' counts so a mixed dataset is legible ("image metrics over N of M questions").

### 7.4 Load-bearing consequence (intended)

Because images are **doc-gated**, if the relevant image's source doc does not win text retrieval, image recall is 0 for that question. The eval therefore **exposes the recall cost of doc-gating** — precisely the thing worth measuring. This is a feature, not a bug, and is called out so nobody "fixes" it by ungating.

## 8. Reporting / UI

Store the two new scores and surface them in the experiment results view next to `recall/precision/iou/f1`, with the image-subset count. Minimal — a couple of extra numbers, no new views.

## 9. Testing

- **eval-lib unit:** `imageRecall` / `imagePrecision` — overlap, empty-menu, empty-GT / not-applicable, cap behavior.
- **backend integration:** generation produces questions with `relevantImageIds` (+ a `relevantSpans` span); `evaluateAgentQuestion` computes image recall from a mocked deterministic menu; mixed dataset aggregates text over all, image over the subset.
- Update existing agent-experiment test mocks to tolerate the new optional field.

## 10. Build order

1. Schema: add optional `relevantImageIds` to `questionValidator`.
2. eval-lib: `evaluation/metrics/image.ts` + unit tests + exports.
3. Generation: `generation/imageQuestions.ts` (pure prompt-builder + marker locator + action) wired into orchestration.
4. Scoring: deterministic menu computation + image metrics in `evaluateAgentQuestion`; store on results.
5. Aggregation: experiment-level image-subset averaging + counts.
6. Reporting: surface in experiment results UI.
7. Tests: backend integration + mock updates.

## 11. Open questions (none blocking)

- Exact `imagePrecision` convention when a question's `relevantImageIds` is non-empty but the menu is empty (0 vs n/a). Default: recall 0, precision n/a for that question.
- Default N (questions per run) and context-window size N chars — pick sane defaults during implementation, expose as config.
