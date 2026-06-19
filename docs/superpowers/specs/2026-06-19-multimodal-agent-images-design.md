# Multimodal Agent Images — Design Spec

**Date:** 2026-06-19
**Status:** Design / approved → ready for plan
**Source design doc:** `docs/plans/2026-06-06-multimodal-agent-responses-complete.md`
**Verified vs:** HEAD `3b4fae7`

> Encoded caveman. Prose sections (Goal, Background) normal English.

---

## Goal

Agent answers include images from the knowledge base, placed where the agent decides they belong, and **only** images that genuinely exist in the KB. No hallucinated URLs, no images from outside the KB.

POC scope: images only, source = crawled HTML + Markdown uploads. PDF, video, audio out of scope.

## Background

Verified against current code (162 commits past the source design doc; claims still hold):
- `eval-lib/src/file-processing/html-to-markdown.ts` resolves only anchor `href`s, **not** `<img src>` — relative image URLs survive into stored content.
- turndown preserves `<img>` as inline `![alt](url)` → crawled `documents.content` already carries image refs.
- Agent retrieval tool maps only `content/documentId/start/end`, discards `metadata`. Duplicated ×3: `agents/actions.ts`, `experiments/agentActions.ts`, `lib/agentLoop.ts`.
- `messages` table is `content: v.string()` only — POC adds **no** field to it.
- `resolveModel` has no vision check. 2 copies: `lib/agentLoop.ts` (shared, imported by `agents/actions.ts`), `experiments/agentActions.ts` (own copy).
- `kb/indexing_actions.ts` writes chunk `metadata` at `insertChunkBatch` — ingestion hook for `metadata.images`.

Approach: Option A (metadata-linked chunks) + `get_images` active fetch + C-1 vision at answer time.

---

## §D Decisions

```
#   decision              choice (POC)
D1  passive|active        active only — get_images, ⊥ upfront pixels
D2  positioning           inline ![alt](img_id), ⊥ messages schema change
D3  image storage         keep source url, B-compatible via resolveImageUrl()
D4  image id              deterministic sha256(kbId + normUrl) → stable ∀ re-index
D5  existing-KB backfill  manual "re-index for images" action
D6  multimodal            agent-level toggle: agents.enableMultimodal?
D7  SVG | data-URI        skip @ ingestion
D8  experiments           record shownImages only, ⊥ scoring
D9  maxSteps              5 → 8 + recovery pass in live chat (agents/actions.ts)
D10 PDF images            ⊥ out of scope
cap menu | fetch          dedup menu (no cap), get_images ≤ 4/turn, skip if ⊥ images
```

## §V Invariants

```
V1: chunk content keeps image inline → ![alt](url) rewritten ![alt](img_id), ⊥ pixels in tool result
V2: pixels sent ⟺ agent calls get_images([id]) → bytes once, on demand
V3: get_images ! validate id ∈ kbImages ∧ row.orgId = ctx.orgId → reject hallucinated|cross-org id
V4: finalize → ∀ ![...](x) in response: x ∈ get_images result set → rewrite real url; else DROP whole image
V5: agent.model ∉ VISION_CAPABLE_MODELS → text only, ⊥ error (degrade silent)
V6: image-instruction section ∈ system prompt ⟺ hasVision = true
V7: get_images ≤ 4 imgs/turn; ⊥ retrieved chunk has image → skip vision path (text turn cheap)
V8: id deterministic = sha256(kbId + normalizeUrl(src)) → re-index → same id (§9.2)
V9: whitelist authoritative ⊥ override by KB context (prompt-injection guard §9.5)
```

## §S Schema

`messages` table ⊥ changed (D2).

```
kbImages (new table):
  {id: string, kbId: Id<knowledgeBases>, orgId: string,
   url?: string, storageId?: Id<_storage>, alt: string,
   sourceDocId: Id<documents>, createdAt: number}
  index: by_id(["id"]), by_kb(["kbId"]), by_org(["orgId"])
  # POC writes url; storageId path stubbed for D3→B switch

agents: + enableMultimodal?: v.boolean()    # D6

documentChunks.metadata: + images?: Array<{id: string, alt: string}>
  # metadata already free-form bag, ⊥ schema migration

agentExperimentResults: + shownImages?: Array<{id: string, url: string}>
  # D8 record-only, ⊥ scoring; separate table ≠ messages, D2 rule holds
```

## §F Flow

**Ingest** (`kb/indexing_actions.ts` + `eval-lib` html-to-markdown):
```
F1: htmlToMarkdown(html, {baseUrl}) → resolve <img src> vs baseUrl BEFORE turndown (§9.1, gates crawl path)
F2: per chunk → parse ![alt](url) w/ regex tolerant of chunk-boundary split (skip partial match §9.1)
F3: skip src ∈ {svg, data:} (V7-adjacent, §9.12, §6.1)
F4: id = sha256(kbId + normalizeUrl(url))     # V8; normalizeUrl = eval-lib scraper/link-extractor
F5: upsert kbImages row {id, kbId, orgId, url, alt, sourceDocId}   # url only, storageId nil (D3)
F6: rewrite chunk content ![alt](url) → ![alt](id)   # V1
F7: set documentChunks.metadata.images = dedup([{id, alt}])   # cap/dedup by id
```

**Retrieve** (×3 tool sites):
```
F8: tool result content = chunk content w/ ![alt](id) markers (position+id+alt, ⊥ pixels)   # V1
F9: pass metadata.images thru in tool result map — ! all 3 sites
F10: parent-child swap → parent span covers child images (§6.4, no special case)
F11: dedup images across overlapping chunks by id
```

**Answer** (vision-capable agent, enableMultimodal=true):
```
F12: hasVision = agent.model ∈ VISION_CAPABLE_MODELS ∧ agent.enableMultimodal   # V5,V6
F13: composeSystemPrompt(..., hasVision) → image instructions ⟺ hasVision   # V6
F14: model reads menu → calls get_images([ids])
F15: get_images.execute: ∀ id → row = kbImages.by_id; ! row ∧ row.orgId = ctx.orgId   # V3
       → url = resolveImageUrl(row) → return [{id, url, alt}] as vision blocks
       → ≤ 4 imgs (V7)
F16: model writes ![alt](id) inline where it wants image
```

**Finalize** (`agents/actions.ts` + 2 other runners):
```
F17: regex scan response ∀ ![...](x)
F18: x ∈ get_images-returned set → rewrite ![alt](x) → ![alt](realUrl); else strip image   # V4,V9
F19: store finalized content string (markdown, real urls inline) — ⊥ messages field
F20: experiment runner → record agentExperimentResults.shownImages = get_images result set   # D8
```

## §I Interfaces

```
fn:  resolveImageUrl(row: kbImages) → row.storageId ? ctx.storage.getUrl(storageId) : row.url
     # D3 switch point: POC = url branch; future B = storageId branch
tool: get_images({imageIds: string[]}) → [{id, url, alt}]   # validate V3, cap V7
const: VISION_CAPABLE_MODELS = [
  "claude-opus-4-8","claude-sonnet-4-6","claude-haiku-4-5",
  "gpt-4o","gpt-4o-mini","gpt-4-turbo"]   # §6.6, single source
fn:  composeSystemPrompt(..., hasVision: boolean)   # threads V6
mut: reindexForImages(kbId)   # D5 manual backfill — re-run ingest F1-F7 ∀ existing chunks
```

## §C Consolidation (existing debt this work touches)

```
C1: resolveModel 2 copies → 1 shared; add VISION_CAPABLE_MODELS + hasVision once
C2: retrieval tool dict ×3 → metadata.images passthrough + get_images ! all 3
C3: composeSystemPrompt → hasVision param (single source agents/promptTemplate.ts)
```

## §R Render surfaces (all read `messages`, §9.9)

```
R1: chat UI — render inline markdown images
R2: simulation transcripts — same
R3: experiment results — same
R4: annotations review UI — same
# D2 inline markdown → standard md renderer ∀ surface; ⊥ parts renderer needed
```

## §B Build order

```
id status task                                                           cites
1  .      htmlToMarkdown resolve <img src> vs baseUrl + tolerant parser  F1,F2,F3,§9.1
2  .      kbImages table + sha256 id + metadata.images @ ingest          §S,F4-F7,V8,D4
3  .      retrieval: rewrite ![](url)→![](id) + pass metadata.images ×3  F6,F8,F9,F11,C2
4  .      get_images tool + VISION_CAPABLE_MODELS + hasVision in prompt  F12-F15,V3,V5,V6,C1,C3
5  .      finalize regex whitelist rewrite|drop                          F17-F19,V4,V9
6  .      frontend render md images ∀ 4 surfaces                         R1-R4
7  .      maxSteps 5→8 + recovery pass in live chat                      D9,§9.8
8  .      manual "re-index for images" action                           D5,§9.3
9  .      dedup resolveModel 2→1                                         C1
10 .      experiments: record shownImages + update LLM test mocks vision  D8,F20,§9.10
```

## §O Out of scope (POC)

```
- PDF images (D10, §8) — needs PDF text extraction first + spatial reading-order reconstruct
- D3→B re-host _storage (stubbed via resolveImageUrl, no ingest fetch yet)
- messages.parts structured array + generative UI (deferred w/ D2=A)
- passive upfront send (D1 = active only)
- image relevance scoring in experiments (D8 = record shownImages only)
- multimodal embedding / visual-similarity search (Option C-2)
- downscale images (D3=A → provider fetches url, we ⊥ touch bytes)
```

## §RK Risks

```
RK1: relative img url (§9.1) — primary gate; fixed F1
RK2: chunk-boundary split ![](url) → parser ! skip partial (F2)
RK3: prompt injection — fake [[IMAGE]]|![](evil) in KB content → V4+V9 strip non-whitelisted
RK4: provider fetch fail on source url (D3=A) → model ? hallucinate img contents (§6.2) — accepted POC risk, mitigate via D3→B later
RK5: url rot in stored conversations (§9.11) — accepted POC; frontend ! graceful broken-img fallback
RK6: maxSteps exhaust pre-text in live chat (§9.8) → recovery pass (task 7)
RK7: existing KB chunks metadata.images = nil → manual reindex (D5); communicate to users (§9.3)
```
