# Multimodal Response Evaluation — Design Document

**Date:** 2026-07-06
**Status:** Design / pre-implementation
**Scope:** Images only. Extends the existing `conversationSim` evaluator framework.
**Depends on:** the multimodal-agent-responses feature on branch `vb-feat/image-inclusion-in-response`.

---

## 1. Context

The agent can now include KB images in its responses: images are parsed into a
`kbMedia` table, ranked doc-gated at retrieval time into a "menu," fetched via the
vision-gated `get_images` tool, and whitelisted on finalize. See
`docs/image-retrieval-implementation.md` and
`docs/plans/2026-06-06-multimodal-agent-responses-complete.md`.

What does **not** exist yet is any evaluation of that behavior. The existing
evaluation system (`convex/conversationSim/`) grades simulated conversation runs
with two evaluator kinds — deterministic **code checks** and an **LLM judge** — but
both are text-only. Nothing about images flows into scoring.

This design adds multimodal awareness to that framework: evaluators that grade
whether the agent showed the **right** images, didn't hallucinate them, and didn't
skip an obviously-relevant one.

### The failure modes we score

| Mode | Description | Evaluator |
|---|---|---|
| Hallucinated / invalid image | References an image not real/whitelisted | Image Hygiene (code) |
| Overuse / spam | Too many images shown | Image Hygiene (code) |
| Irrelevant image shown | A real image that doesn't answer the question (precision) | Image Relevance (vision judge) |
| Relevant image missed | An obviously-relevant menu image the agent never showed (recall) | Image Relevance (vision judge) |

Hallucination is already *prevented from reaching the user* by the finalize
whitelist; the Hygiene check is a regression guard on that boundary, not a new
safety layer.

---

## 2. How the existing framework works (relevant slice)

- **`evaluators` table** (`conversationSim/evaluators.ts`): each row is `type:
  "code" | "llm_judge"`, `scope: "session" | "turn"`, plus a `codeConfig`
  (`checkType` ∈ tool_call_match / string_contains / regex_match /
  response_format) or a `judgeConfig` (`rubric`, examples, `model`,
  `inputContext` ⊆ transcript / tool_calls / kb_documents).
- **`evaluationActions.ts → runEvaluation`**: loads a run's messages, builds an
  `EvalInput` (messages + tool calls) and a `JudgeContext` (transcript string,
  tool-calls string, kb-documents string), then dispatches each evaluator in the
  set to `runCodeEvaluator` (pure) or `runLLMJudge` (`judge.ts`, `generateText`).
- **`judge.ts → runLLMJudge`**: assembles a text prompt from the selected
  `inputContext` slices and asks the model for `{passed, justification}` JSON.

Two facts that make this feasible:

1. **The image menu is already persisted.** The sim runner
   (`conversationSim/actions.ts`) writes each retrieval tool result —
   `JSON.stringify({ chunks, images })` — into a `tool_result` message. `images`
   is exactly the menu: `[{ imageId, alt, type }]`. So "what was *available*" is
   already on disk, recoverable from `tool_result` rows.
2. **What was *shown* is not persisted.** `runAgentLoop` returns `shownImages`
   (`[{ imageId, url, alt }]`) but `actions.ts` drops it when saving the assistant
   message. The shown images survive only as rewritten `![alt](realUrl)` markdown
   in the text, and the menu carries no URL — so shown-cannot-be-mapped-back-to-
   menu. This is the one plumbing gap.

---

## 3. Part 1 — Data plumbing (prerequisite)

Add `shownImages` to the `messages` table, mirroring the field already on
`agentExperimentResults`:

```ts
shownImages: v.optional(
  v.array(v.object({ imageId: v.string(), url: v.string(), alt: v.string() }))
)
```

`conversationSim/actions.ts` (the assistant-message insert around line 254) passes
`agentResult.shownImages` through. `insertMessage` in `crud/conversations.ts` gains
the optional arg.

The **menu** needs no new storage — the judge/action reads it back from the
`tool_result` rows already saved. `runEvaluation` parses each `tool_result.result`
JSON and unions its `images` arrays into the turn's menu.

**Scoring level:** turn. Each assistant turn is scored against *its own* menu and
its own `shownImages`. A turn with no menu (no images available) is skipped by
both image evaluators so text-only turns never drag the score.

---

## 4. Part 2 — Two evaluators

### 4.1 Image Hygiene (code check, `scope: turn`)

New `checkType: "image_hygiene"` added to `codeConfigValidator` and to
`runCodeEvaluator` (`conversationSim/evaluation.ts`). Deterministic, no I/O.

Params: `{ maxImages?: number }` (default = `MAX_IMAGES_PER_TURN` = 4).

Checks, against the turn's assistant message:
- Every `![alt](img_…)` / `[text](img_…)` marker in the final text resolves to an
  entry in `shownImages` (nothing non-whitelisted survived finalize).
- `shownImages.length <= maxImages`.

`EvalInput` is extended to carry per-turn `shownImages` and the parsed markers so
this stays a pure function.

### 4.2 Image Relevance (LLM vision judge, `scope: turn`)

New `inputContext` value `"shown_images"` added to `judgeConfigValidator`. When
present, `runLLMJudge` runs its new **vision** branch (Part 3).

The judge receives:
- the user's question (the turn's preceding user message),
- the agent's answer text,
- the **shown** images as pixels + their alt,
- the **menu** (imageId + alt + type) of what was available but not necessarily
  shown — as text, so it can flag a skipped-but-relevant image (recall). Optionally
  the top N un-shown menu images are also passed as pixels for a sharper recall
  judgment (config flag; default off for cost).

Rubric (seeded template) scores precision + recall of image selection and returns
`{passed, justification}` in the existing JSON shape.

Seed both as templates in `seedTemplates` so orgs get them by default; add them to
the Default evaluator set as **non-required** (image quality shouldn't fail an
otherwise-good run during the POC).

---

## 5. Part 3 — Vision judge mechanics + token savings

`judge.ts → runLLMJudge` gains a vision branch, triggered when `inputContext`
includes `"shown_images"` and the turn has shown images.

- **Fetch:** reuse `fetchImageAsBase64` + `clampImageDimensions` + the SSRF guard
  (`assertPublicHttpUrl`) already in `lib/vision.ts`. Both files are `"use node"`,
  so `judge.ts` imports directly. `null` fetches degrade gracefully to
  alt-text-only for that image (never errors the judge).
- **Message shape:** instead of a single `prompt` string, build a `messages` array
  with a user turn whose `content` is `[{type:"text", …}, {type:"image", …}, …]`
  (AI SDK multimodal), then `generateText`.
- **Only images get pixels.** Menu entries of `type: "video" | "doc_link"` are
  passed as text labels only — no fetch (same rule as `get_images`).

### Token savings (decision: option a)

Providers bill vision by the resolution they downsample to, not the bytes sent —
so the existing byte-cap saves bandwidth, not judge tokens. A *relevance* judge is
topical (not reading fine print), so low resolution suffices.

**Chosen:** constrain the Image Relevance judge to an **OpenAI-family model** and
pass `detail: "low"` on image parts → flat ~85 tokens/image regardless of size, no
new dependency. The seeded template's `model` is a GPT-family id.

Rejected for the POC: adding `sharp` to physically downscale (model-agnostic, real
token cut, but a new dependency) — kept as a documented later upgrade if an
Anthropic judge is wanted.

---

## 6. Files touched

| File | Change |
|---|---|
| `convex/schemas/agent.schema.ts` | `messages.shownImages` optional field |
| `convex/crud/conversations.ts` | `insertMessage` accepts + writes `shownImages` |
| `convex/conversationSim/actions.ts` | pass `agentResult.shownImages` to the assistant insert |
| `convex/conversationSim/evaluators.ts` | `image_hygiene` checkType; `shown_images` inputContext; two seeded templates |
| `convex/conversationSim/evaluation.ts` | `image_hygiene` in `runCodeEvaluator`; extend `EvalInput` |
| `convex/conversationSim/evaluationActions.ts` | parse menu from tool_result rows; thread shownImages + menu into EvalInput / JudgeContext; skip image evaluators on menu-less turns |
| `convex/conversationSim/judge.ts` | vision branch: fetch pixels, multimodal message, `detail: "low"` |
| `packages/backend/tests/` | unit tests for hygiene check + a mocked vision-judge test |

No frontend changes required for the POC (evaluator results already render); a
later nice-to-have is surfacing per-turn image scores in the sim detail UI.

---

## 7. Out of scope (POC)

- Video / doc-link relevance scoring (menu passes them as labels; not judged).
- Scoring images in the LangSmith / span-recall experiment path (`agentExperimentResults`
  already records `shownImages` for audit; no judge there).
- `sharp`-based physical downscale / Anthropic vision judge (option b).
- Frontend visualization of image scores.

---

## 8. Risks

- **Menu parse fragility:** `tool_result.result` is free-form JSON; parse
  defensively (missing/renamed `images` → empty menu → turn skipped, never throws).
- **Judge cost creep:** default to shown-images-only pixels; the top-N un-shown
  menu pixels for recall is opt-in.
- **Model routing:** `resolveModel` must map the seeded GPT id to the OpenAI
  provider; `detail: "low"` is OpenAI-specific — guard so a non-OpenAI `model`
  override silently omits `detail` rather than erroring.
