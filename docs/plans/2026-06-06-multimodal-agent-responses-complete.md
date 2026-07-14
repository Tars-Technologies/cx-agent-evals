# Multimodal Agent Responses — Complete Design Document

**Date:** 2026-06-06
**Status:** Design / pre-implementation
**Scope of POC:** Images only (no video/audio). Source: knowledge base only.
**Decided with:** Ankit

---

## Table of Contents

1. [How the current system works](#1-how-the-current-system-works)
2. [The requirement](#2-the-requirement)
3. [Strategy options for adding media](#3-strategy-options-for-adding-media)
4. [Preventing hallucinated image URLs](#4-preventing-hallucinated-image-urls)
5. [Recommended approach](#5-recommended-approach)
6. [Implementation details](#6-implementation-details)
7. [Positioning images in the response](#7-positioning-images-in-the-response)
8. [PDF images](#8-pdf-images)
9. [Additional risks and considerations](#9-additional-risks-and-considerations)
10. [Open decisions](#10-open-decisions)
11. [Suggested build order](#11-suggested-build-order)

---

## 1. How the current system works

### Stage 1 — Knowledge base creation

`knowledgeBases` is an org-scoped container for documents. Documents come from two sources:

**Web crawling:** a URL is crawled, pages are scraped using `linkedom` + `turndown` (`eval-lib/src/file-processing/html-to-markdown.ts`). The HTML is parsed, boilerplate is removed via `BOILERPLATE_SELECTORS` (`nav`, `header`, `footer`, `aside`, `script`, `style`, `noscript`, `iframe`, cookie/GDPR banners), and the remaining body is converted to **Markdown** via turndown. `crawl_actions.ts` stores `scraped.markdown` as the document's `content`.

> ✅ **Critical, plan-changing fact:** turndown has **no image-removal rule**, so `<img>` tags in the main content are preserved as inline Markdown **`![alt](src)`**. **Crawled documents already contain image references in `content`.** Boilerplate images (logos, nav icons in `header`/`footer`/`nav`) are stripped along with their containers, which conveniently reduces image noise. This means the "capture images before extraction" work assumed in earlier drafts is largely unnecessary for the crawl path — see §6.1 and §9.1.

**Direct upload:** the file uploader (`FileUploader.tsx`) accepts `.md`, `.txt`, `.html`, `.htm`, `.pdf` but reads every file the same way — `file.text()` in the browser. This means:
- `.md` / `.txt` → clean text ✅ (Markdown uploads already contain `![alt](url)` inline)
- `.html` → stored as **raw HTML markup with tags included** ⚠️ (the upload path does NOT run `htmlToMarkdown` — only the *crawl* path does. So uploaded HTML keeps `<img>` tags, not Markdown syntax — a different parse target than crawled content.)
- `.pdf` → **garbled binary bytes** — there is no PDF parser. `file.text()` on a PDF returns junk. PDFs are accepted by the file picker but produce unusable content ❌

> **Key correction:** uploads are NOT all "converted to text." Only `.md` and `.txt` work cleanly. The crawl path is the reliable ingestion source — and it produces Markdown with images already inline.

Each `documents` row stores:
- `content` — the full raw text string (the **only thing that gets chunked, embedded, and searched**)
- `title`, `docId`, `sourceUrl`, `sourceType`, `priority` (1–5, manual importance tag)
- `fileId` — pointer to the original file in Convex `_storage` (kept for download/delete, **not used for retrieval**)
- `metadata` — a free-form bag, currently always `{}`

The KB container itself has labels (`name`, `description`, `industry`, `company`, `tags`) but these are organizational metadata, not searched content.

---

### Stage 2 — Indexing, chunking, and embedding

An **index hash (`indexConfigHash`)** is computed from the **index config** (strategy + chunk size + overlap + embedding model) — NOT from the KB itself. Chunks are keyed by `(kbId, indexConfigHash)`, so **two retrievers whose index config is identical share the same chunks** — no re-chunking or re-embedding needed.

Each document is processed in two phases for resumability and idempotency:

**Phase A — Chunk and store (pure compute, atomic):**
The document text is split into **position-aware chunks** — each chunk knows its exact `start` and `end` character offset within `documents.content`. All chunks are inserted **without embeddings** in one atomic mutation. Two indexing strategies are implemented:

- **Plain:** `RecursiveCharacterChunker` splits the doc at natural boundaries. Default chunk size 1000 chars, overlap 200.
- **Parent-child:** two levels of chunking. Small `childChunkSize` (200) chunks are embedded for precise matching; large `parentChunkSize` (1000) chunks are stored for context return. Each child chunk carries a `metadata.parentChunkId`. At retrieval time, matched child chunks are swapped for their parent (more context returned).

> ⚠️ **Contextual** (LLM rewrites each chunk before embedding) and **Summary** (LLM summarizes each chunk) are defined as config types in eval-lib but are **NOT implemented** in the Convex backend indexer (`kb/indexing_actions.ts`). Do not list them as working.

**Phase B — Embed in batches (API calls, resumable):**
Unembedded chunks are pulled via paginated queries (to stay under Convex's 16MB read limit — embedded chunks carry 12KB vectors each), embedded via OpenAI (`text-embedding-3-small`, 1536 dimensions) in batches, and patched back. Fully idempotent — a retry skips already-embedded chunks. Retries on `TooManyWrites` with exponential backoff.

Result: `documentChunks` rows each with a 1536-dim `embedding`, `content`, `start`, `end`, `kbId`, `indexConfigHash`, `metadata`.

---

### Stage 3 — Retriever creation and deduplication

Two hashes avoid redundant work:

- **`indexConfigHash`** = hash of chunking strategy + chunk size + overlap + embedding model. Expensive to recompute (involves re-chunking and re-embedding the whole KB). Reused whenever possible. Two retrievers with the same index config **share all their chunks**.
- **`retrieverConfigHash`** = hash of the **entire** config (all four stages) + `k`. Deduplifies retriever rows — creating an identical retriever returns the existing one rather than duplicating.

A `retrievers` row is a named `PipelineConfig` bound to a KB, with status (`configuring → indexing → ready → error`), `defaultK`, and a pointer to its `indexingJobId`.

---

### Stage 4 — RAG pipeline

> ⚠️ **Critical fact:** this entire pipeline is used by the **playground and retriever experiments only — NOT by the chatbot agent.** The agent uses a simpler direct path (see Stage 5). This is the single most important thing to understand when adding media.

The pipeline has four configurable stages (`kb/retrieve_actions.ts → retrieve`):

**Stage 4.1 — Index** (decided at indexing time, affects the `indexConfigHash`):
| Strategy | How it works |
|---|---|
| `plain` | Standard recursive character chunking ✅ implemented |
| `parent-child` | Small child chunks for matching, large parent returned ✅ implemented |
| `contextual` | LLM rewrites each chunk before embedding ⚠️ config only, not implemented |
| `summary` | LLM summarizes each chunk ⚠️ config only, not implemented |

**Stage 4.2 — Query** (query transformation at search time):
1. `identity` — search the raw query as-is
2. `hyde` — LLM generates N hypothetical answer documents, embeds those, RRF-fuses results
3. `multi-query` — LLM generates N paraphrases, searches each, fuses
4. `step-back` — LLM produces a more abstract question, searches both
5. `rewrite` — LLM cleans up the query once

**Stage 4.3 — Search:**
- `dense` — pure vector search (default)
- `bm25` — pure lexical (builds in-memory BM25 index over all chunks for the config)
- `hybrid` — runs both, fuses via weighted scores or Reciprocal Rank Fusion (RRF)

**Stage 4.4 — Refinement** (ordered post-processing):
- `rerank` — Cohere reranker, optional `topN` cap
- `threshold` — drop chunks below a minimum score
- `dedup` — exact or overlap-ratio deduplication
- `mmr` — maximal marginal relevance (relevance vs. diversity trade-off)
- `expand-context` — pad each chunk with surrounding chars (skipped in playground — needs full corpus in memory)

**The shared search primitive (`lib/vectorSearch.ts → vectorSearchWithFilter`):**
Convex vector filters only support `eq`/`or` on a single field — not AND across fields. So:
1. `ctx.vectorSearch` filtered by `kbId`, **over-fetching 4× (capped at 128)** to compensate
2. Hydrate chunk records
3. **Post-filter `indexConfigHash` in JS** to get the right config
4. For parent-child: batch-fetch all parent chunks, swap matched children for their parents
5. Hydrate `docId` for survivors

---

### Stage 5 — AI chatbot agent

**What an agent is:** a `agents` row is structured config — NOT a free-text prompt. Contains:
- `identity` (agentName, companyName, companyContext, roleDescription, brandVoice)
- `guardrails` (outOfScope, escalationRules, compliance)
- `responseStyle` (formatting, length, formality, language)
- `model` — which LLM to call (not part of the prompt text)
- `enableReflection` — adds a self-evaluation section to the prompt
- `additionalInstructions`
- `retrieverIds[]` — which retrievers this agent can search

`agents/promptTemplate.ts → composeSystemPrompt` is a **pure function** that renders all of the above into a sectioned system prompt: Identity → Response Style → Guardrails → Tools → Self-Evaluation → Additional Instructions. Same function used by live chat, simulation, and experiments.

**The conversation flow:**
1. User calls `agents/orchestration.ts → sendMessage` (mutation)
2. User message inserted into `messages` table
3. Placeholder assistant message inserted with `status: "streaming"`
4. `agents/actions.ts → runAgent` scheduled immediately

**What `runAgent` does:**
1. Loads agent config + all **ready** retrievers with KB info
2. Builds system prompt
3. Builds **one AI SDK tool per retriever** — each tool: embeds the query → calls `vectorSearchWithFilter` → returns top-K chunks. Tool name is `slugify(retriever.name)`.
4. Loads conversation history, converts to AI SDK message format (reconstructing tool-call/tool-result pairs)
5. Calls `streamText` with `maxSteps: 5`
6. Streams via `result.fullStream`:
   - `text-delta` → buffered and flushed to `streamDeltas` table (~50 chars or 200ms intervals) for real-time UI rendering
   - `tool-call` → persisted as a `tool_call` message row (with `retrieverId`)
   - `tool-result` → persisted as a `tool_result` message row
7. Finalizes the assistant message (full text + token usage)
8. Schedules `cleanupStreamDeltas` after 5s

**What the tool actually does vs Stage 4:**
The agent's retrieval tool does **only**:
```
embed query → plain dense vectorSearchWithFilter → parent-child swap if applicable → return top-K text chunks
```
**No** query rewriting. **No** hybrid/BM25. **No** reranking. The full Stage-4 pipeline is bypassed. Fast and simple, but less sophisticated than what the playground can do.

**The three runners — same brain, different I/O:**
| Runner | File | LLM call | maxSteps | Records |
|---|---|---|---|---|
| Live chat | `agents/actions.ts → runAgent` | `streamText` | 5 | Streamed deltas + message rows |
| Single-turn eval | `experiments/agentActions.ts → evaluateAgentQuestion` | `generateText` | 5 | Tool calls + chunks for scoring |
| Multi-turn simulation | `lib/agentLoop.ts → runAgentLoop` | `generateText` | 12 | Tool calls + usage |

> ⚠️ **The tool dictionary is duplicated in all three files.** Any change to what tools the agent has must be made in **all three**: `agents/actions.ts`, `experiments/agentActions.ts`, `lib/agentLoop.ts`.

**The model router (`resolveModel`):** `gpt-/o1/o3/o4` → OpenAI provider; everything else → Anthropic. Also duplicated in multiple files.

---

## 2. The requirement

Today the agent's response is **text only**. It should include **media from the knowledge base** in its responses — placed where the agent decides they're relevant, and **only** media that genuinely exists in the KB. No hallucinated URLs. No media from outside the KB.

**POC scope:** images only. Source: KB only (crawled pages and uploaded files where images exist). Not in scope: video, audio, PDFs (see §8).

---

## 3. Strategy options for adding media

The core pipeline today is a one-lane road:
```
document text → chunks (text) → embeddings → vector search → tool returns text → agent writes text → UI shows text
```
Every option below is about getting media to ride this road. They differ in *where* media joins and *how much new infrastructure* is needed.

---

### Option A — Media as metadata linked to chunks (lowest effort)

Each image is a **passenger** attached to its nearest text. When that text gets retrieved, the image comes along.

**What makes this work (and it mostly already works):** crawled content is **Markdown with `![alt](url)` inline**, and chunks are slices of that content. So an image already physically lives inside whatever chunk's `[start, end)` span contains its Markdown syntax — *no separate offset tracking or scraper change needed*. The agent's retrieval tool already returns chunk `content`, which already contains the `![alt](url)` text. The model **already sees image references today**; it just isn't instructed to use them, the URLs aren't resolved, and the frontend doesn't render them.

**Flow:**
1. At ingestion: parse `![alt](url)` out of each chunk's content; resolve relative URLs to absolute; optionally record `metadata.images = [{ id, url, alt }]` for clean access (or just let the agent read the inline Markdown directly)
2. At search time: matched chunks already carry the image syntax in their content
3. At answer time: agent sees image references and includes them; resolve + whitelist on finalize

**What's left to build:** (a) resolve relative image URLs (turndown emits raw `src` — it does NOT resolve image URLs against the page base URL, only anchor `href`s); (b) tell the agent it may surface images (prompt); (c) render Markdown images in the frontend; (d) whitelist for safety; (e) for vision (Option C-1), fetch the image and pass it as an image block. See §6.1.

**Effort:** Low. The previously-assumed "hardest piece" (capturing images from the scraper) is already done by turndown. The real remaining work is URL resolution + chunk-boundary handling (§9.1) + frontend rendering.

**Trade-off:**
- Images only surface when their surrounding text matches the question
- "What does the dashboard look like?" won't surface a dashboard image if nearby text doesn't match well
- Media is second-class — it can only follow text, never lead

---

### Option B — Media as a first-class, independently searchable entity (medium effort)

Each image is made independently findable using its description (alt text + caption + surrounding text) as a document, embedded with the existing text embedder. No image-understanding model needed.

**Flow:**
1. At ingestion: for each image, create a record `{ url, alt: "annual revenue dashboard", caption: "Fig 3: Q4", sourceDoc }`
2. Embed the description text with existing `text-embedding-3-small` → lands in the same 1536-dim vector index. **No new infrastructure.**
3. At search time: the image's description competes directly with text chunks. "Show me the revenue dashboard" matches the caption even if no body paragraph mentions it.
4. Agent gets the image back as a retrieval result and presents it.

**Effort:** Medium — a `mediaAssets` table, ingestion writing descriptions, embedding step. Optionally a separate `search_images` tool.

**Trade-off:**
- Quality depends entirely on good alt text / captions. Garbage or missing captions = unfindable images.
- For most real web/doc KBs, captions and alt text exist.
- Media becomes a true peer of text — still only text search, no new index.

---

### Option C — True visual understanding (highest effort)

Two distinct capabilities:

#### C-1 — Vision at answer time
Pass the actual image pixels into the vision model alongside the text. The agent can reason *about* the picture.

> "Based on the wiring diagram, the red cable connects to terminal 3."

Both Claude and GPT-4o already accept image URLs or base64 bytes. In the AI SDK (already used in this codebase) the message shape changes from a string to an array of parts:
```ts
messages: [{
  role: "user",
  content: [
    { type: "text",  text: question.queryText },
    { type: "image", image: new URL("https://example.com/diagram.png") }
  ]
}]
```
The model fetches and sees the URL at inference time — no base64 needed.

**Cost:** moderate. You're already retrieving the image (from Option A/B); you just also hand it to the model. More tokens, slightly more complexity building the message.

#### C-2 — Retrieval by visual similarity
Find images by what they *look like*, with no caption needed. Requires a multimodal embedding model (CLIP, Voyage multimodal) that turns pixels → vectors.

**The hard part:** the Convex vector index is **hard-locked to 1536 dimensions** (the OpenAI text embedding size). Multimodal models produce different-sized vectors. You'd need:
- A **second separate vector index** (different dimensions)
- A new embedder branch in indexing
- Ingestion that embeds image bytes
- A new search path

**Cost:** high — new index, new model, new ingestion path, new search path. Only worth building if visual-similarity search is a genuine product requirement.

#### How the model decides which image to show (both C variants)

"Which image to show" is **two separate decisions** at two points:

**Candidacy (which images reach the model)** — decided by **retrieval**, not the model. The model never sees the whole KB. It only ever chooses from the handful that retrieval surfaced.

**Selection (which candidate is actually shown)** — the model's judgment, expressed via an attach/whitelist mechanism so it can only surface images that were genuinely retrieved.

**In C-1:**
- Retrieval narrows the field (e.g. 5 chunks, 2 with images → 2 are candidates)
- The new step: pass the **actual pixels**, not just the caption text, into the model
- The model judges **visually** — can tell the wiring diagram answers the question and the product photo doesn't, based on what the image *depicts*, not how well it was captioned
- It expresses its pick by writing an inline reference; the whitelist guarantees only retrieved images can be shown

**In C-2:**
- The **candidacy** decision itself changes: images are retrieved by how they **look** (pixel embeddings)
- Selection is model judgment or a simple top-K / threshold cutoff

**Two practical constraints (both):**
- Never feed every KB image to the model — too expensive and blows the context. Retrieval is the cost/scale filter; the model is the fine-grained chooser.
- "The model decides" is **probabilistic, not deterministic.** For predictability, override with rules (e.g. always show the top image above score X). Common pattern: model proposes, a rule enforces floor/ceiling.

---

## 4. Preventing hallucinated image URLs

Without a safety layer, the LLM will happily invent image URLs inside its prose — plausible-looking external links that don't exist or don't belong to the KB.

### Whitelist filtering
Every turn, collect the set of media references that came back from retrieved chunks / the `get_images` tool. After the agent answers, scan the response for media references and **drop any not on the whitelist.** The agent physically cannot show media it didn't retrieve.

> ⚠️ If using inline Markdown (Option A positioning), you must strip **all** Markdown images whose target isn't whitelisted — not just custom tokens. The model can write `![alt](https://anyurl.com/x.png)` in its prose, bypassing a token-only whitelist. Option B (sentinel tokens) is safer because only `[[IMAGE:id]]` tokens render as images.

### `get_images` tool
Add a tool the agent explicitly calls to fetch images by ID. The tool **validates each ID exists and belongs to the org/KB**, then returns URLs. IDs the model didn't see in retrieval (hallucinated or guessed) are rejected server-side. This is the strongest grounding guarantee.

---

## 5. Recommended approach

**Decided with Ankit:** images only for the POC. Link images to their nearest chunks. Send all selected chunks' images to the agent. Let the agent decide which fit the query. This is **Option A (metadata-linked chunks) + Option C-1 (vision at answer time).**

**The four steps:**
1. **Ingestion** — crawled chunk content already contains `![alt](url)`. Parse those out per chunk, **resolve relative URLs to absolute**, and (recommended) record them as `documentChunks.metadata.images = [{ id, url/storageId, alt }]` for clean programmatic access. (You *could* skip metadata and have the agent read inline Markdown, but a parsed list is cleaner for capping/dedup/whitelisting and for fetching pixels.)
2. **Retrieval** — surface the image list from retrieved chunks. The agent tool currently maps only `content/docId/start/end` and discards `metadata` — start passing `metadata.images` through. Change in **all three runners.**
3. **Answer time** — gather images from retrieved chunks, pass them as image blocks to the vision model, let it decide which to include
4. **Output** — model references images it wants; whitelist-check against passed set; render

### Passive vs. active — the key design decision

Two flows were discussed. **Pick one for the POC:**

**Passive (matches the Ankit decision):**
```
retrieve text chunks
→ all images from those chunks sent upfront to the model
→ model picks from what it sees
→ writes answer with inline references
```
Simpler. One fewer round-trip. Model sees everything at once.

**Active (`get_images` tool):**
```
retrieve text chunks
→ chunk metadata carries image IDs (the "menu")
→ model calls get_images([id1, id2]) for only what it wants
→ model sees those images
→ writes answer with inline references
→ finalize whitelists against what get_images actually returned
```
More targeted. Model only fetches images it explicitly decided it needs. Better cost control. Better grounding. Costs an extra tool-call step (eats into `maxSteps: 5`).

**Recommendation:** build **passive** for the POC (fewer moving parts, matches the decision), but design the metadata/ID shape so `get_images` can be layered on later without rework. They are not mutually exclusive — metadata holds the image menu; `get_images` is an optional active pickup mechanism.

### Image-to-chunk assignment rule

Because crawled content is Markdown, an image's `![alt](url)` syntax physically lives inside the chunk content. **An image belongs to a chunk if its Markdown syntax appears in that chunk's content** — equivalently, its offset falls within `[chunk.start, chunk.end)`. You get this for free by parsing each chunk's `content` for `![...](...)`; no separate offset bookkeeping required.

Four important consequences:
1. **No coordinate-space reconciliation needed (crawl path).** The image is *in* the chunk text, so parsing the chunk content is authoritative. (The raw-HTML upload path is the exception — see §6.1.)
2. **Overlapping chunks → same image in two chunks.** With 200-char default overlap, an image near a chunk boundary appears in both adjacent chunks. **Dedupe at answer time** by image ID/URL.
3. **Chunk-boundary splits.** A `![alt](url)` (~50–200 chars) can be cut in half by a chunk boundary, leaving a broken/partial Markdown image in one or both chunks. Parsing must tolerate partial syntax (skip incomplete matches) — see §9.1.
4. **Parent-child falls out automatically.** Parent chunks have wider spans and contain all images in their children's spans. When retrieval swaps a child for its parent, the parent's images come along. No special-case logic.

---

## 6. Implementation details

### 6.1 Mapping images to chunks at ingestion
Images are **NOT dropped** — turndown preserves `<img>` as inline Markdown `![alt](url)` in the crawled content, which is what gets chunked. So this is mostly a parsing + URL-resolution task, not a scraper rewrite.

- **Crawled pages & Markdown uploads** (`![alt](url)` inline): parse each chunk's `content` with a Markdown-image regex, extract `alt` + `url`, dedupe, attach to the chunk. The position is inherent (the syntax is in the chunk).
- **Raw-HTML uploads** (the `.html` upload path stores raw HTML, not Markdown): images are `<img src>` tags, not Markdown. Either run these through `htmlToMarkdown` on upload (recommended — unifies the path) or parse `<img>` tags directly. Low priority; HTML upload is a minor path.

The real work at ingestion:
- **Resolve relative URLs (primary gap).** turndown emits the raw `src` attribute and does **NOT** resolve image URLs against the page base URL (only anchor `href`s are resolved, in `extractLinks`). So crawled Markdown will contain `![](/images/x.png)` or `![](../a.png)`. You must resolve these to absolute URLs using the page URL (available at crawl time as `baseUrl`). This is the single most important ingestion change. Ideally fix it in `htmlToMarkdown` (resolve `<img src>` against `baseUrl` before turndown runs, or add a turndown rule) so stored content has absolute URLs.
- **Tolerate chunk-boundary splits.** A `![alt](url)` can be cut across a chunk boundary. The parser must skip incomplete `![...](...)` matches rather than emit a broken URL.
- **Data URIs** — `![](data:image/png;base64,...)` can't be passed as a URL to the model and bloats content + embeddings. Strip at ingestion or store to `_storage`.
- **SVGs** — Claude and GPT-4o do not accept SVGs as vision inputs (they need rasterized JPEG/PNG/WebP). Skip at ingestion for the POC or flag them to be skipped at answer time.

### 6.2 Where images live and how the model receives them
The LLM needs either a **fetchable URL** or **base64 bytes.**

**Option: keep crawled image URLs as-is**
- Cheap. Works immediately since crawled images are on public pages.
- Risk: links rot, some hosts block external fetches from model provider servers.
- Failure mode: if the model can't fetch the URL it sometimes **invents what the image looks like** rather than saying it failed.

**Option: re-host into Convex `_storage`**
- Safer and permanent. Costs a fetch + storage at ingest time.
- Convex storage URLs are **not public by default** — call `ctx.storage.getUrl(storageId)` to get a short-lived fetchable URL at answer time before passing to the model.

**For this codebase:**
- Crawled page images → already public URLs → send directly ✅
- Uploaded files stored in Convex `_storage` → need `ctx.storage.getUrl(storageId)` first ✅

Both Anthropic and OpenAI accept URLs or base64. URL is simpler; base64 is necessary if the image isn't publicly accessible.

### 6.3 Volume and cost controls
"Send all images from all retrieved chunks" can balloon fast: 5 chunks × 3 images each = 15 images/turn. Vision tokens are expensive (~1–2k tokens per image depending on size) and slow.

Guardrails:
- **Hard cap** on images per turn (3–5 for POC)
- **Dedupe** across overlapping chunks — same image ID/URL appearing twice, send once
- **Only top-scoring chunks** contribute images (e.g. top 2–3 chunks, not all K)
- **Skip the vision path entirely** when no retrieved chunks have images — plain text turns stay cheap and fast
- **Downscale images** before sending — resize to ~800px wide (providers downsample anyway but bill for what you send)
- **Agent-level multimodal toggle** — so customers can opt out for fast/cheap text-only agents

### 6.4 Parent-child interaction
When the retriever swaps a matched child chunk for its parent, use the **parent's span** for image assignment — it covers the full context including the child's region. Same `[start,end)` rule; no special case needed.

### 6.5 How the model expresses its pick and the message record
Assign each passed image a **stable ID** (`img_0`, `img_1`, ...) before sending. Instruct the model to reference images by that ID inline in its response. On finalize:
1. Parse all image references out of the response
2. **Whitelist** — drop any ID the model invented (not in the set you passed)
3. Resolve IDs → real URLs/storageIds
4. Store what was actually shown in a structured `messages.attachments = [{ id, url, alt }]` field

Image position in the response is a **free byproduct** of where the model writes the reference — top, between steps, at the bottom. No separate positioning mechanism needed.

### 6.6 Vision-capable model check
`resolveModel` routes by model ID but has no vision check. Define an explicit allowlist:
```ts
const VISION_CAPABLE_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo"
]
```
If the configured `agent.model` is not on the list → **silently skip the vision path, send text only.** Never error — degrade gracefully.

Also thread a `hasVision: boolean` flag into `composeSystemPrompt` and only include the image instructions section when true. Otherwise text-only models will emit `[[IMAGE:...]]` tokens that never resolve.

### 6.7 `get_images` tool (optional, phase 2)
A tool alongside the retriever tools in the same `tools` dictionary:

```ts
tools["get_images"] = tool({
  description: "Fetch images from the knowledge base by their IDs to include in your response",
  parameters: z.object({
    imageIds: z.array(z.string()).describe("Image IDs from chunk metadata to fetch")
  }),
  execute: async ({ imageIds }) => {
    // 1. validate each ID belongs to this org + KB
    // 2. resolve storageId → ctx.storage.getUrl() or return direct URL
    // return [{ id, url, alt }]
  }
})
```

**Requires a queryable `kbImages` table** — image IDs nested in `documentChunks.metadata.images` JSON can't be queried by index in Convex. Structure:
```
kbImages: { id, kbId, orgId, url, storageId, alt, chunkId, createdAt }
         index: by_id(id), by_kb(kbId), by_org(orgId)
```
The `id` stored in chunk metadata is a foreign key into this table. The tool looks up by `id` + validates `orgId` matches.

**With this tool, the active flow becomes:**
```
retrieve text chunks (metadata has image IDs — the "menu")
→ model calls get_images([id1, id2]) for the ones it wants
→ model sees those images as vision blocks
→ writes answer with [[IMAGE:id]] references placed where it wants them
→ finalize: whitelist refs against what get_images returned → resolve → store attachments
```

**Trade-off vs. passive:** costs one extra tool-call round-trip (eats one of `maxSteps: 5` in live chat). With retrieve text (1) + get_images (2) + answer (3) = 3 steps, still fine. But `lib/agentLoop.ts` has a recovery pass if the budget runs out before text is produced — **`agents/actions.ts` (live chat) does not.** May need `maxSteps` bumped or a recovery pass added.

---

## 7. Positioning images in the response

The model places images by **where it writes the reference in its text** — no separate positioning mechanism needed. Because it generates top-to-bottom, placing a reference "between step 2 and step 3" is just writing it there.

### Option A — Inline Markdown
Model writes standard Markdown image syntax:
```
To reset your password, go to Settings → Security.

![settings screen](img_1)

Click the Reset button highlighted above, then check your email.

![email confirmation](img_2)
```

**Flow:**
1. Model calls `get_images(["img_1", "img_2"])` → gets URLs
2. Model writes answer with `![alt](id)` placed wherever it wants
3. On finalize:
   - Regex scan for `![...](id)` patterns
   - Whitelist: drop any ID not in the `get_images` result set
   - Resolve IDs → real URLs, rewrite `![alt](id)` → `![alt](real_url)`
4. Frontend renders as standard Markdown — images appear inline

**What to tell the model:**
```
When you include images, use standard Markdown: ![alt text](imageId)
where imageId is an ID returned by get_images. Place it exactly where
you want the image to appear. Do not invent IDs.
```

**Streaming:** raw Markdown streams live. On finalize, do one regex pass to rewrite IDs → real URLs. No schema change to messages.

**Trade-offs:**
- No schema change — lowest effort
- Fragile: regex can break on malformed Markdown
- Harder to audit (images buried in text string)
- Weaker against injection — model could write `![alt](https://external.com/x.png)` bypassing the token whitelist; must strip **all** non-whitelisted Markdown images

---

### Option B — Sentinel tokens → structured parts (recommended)
Model uses a custom placeholder token:
```
To reset your password, go to Settings → Security.

[[IMAGE:img_1]]

Click the Reset button highlighted above, then check your email.

[[IMAGE:img_2]]
```

On finalize the message is **split into an ordered parts array** and stored structurally:
```ts
[
  { type: "text",  content: "To reset your password, go to Settings → Security." },
  { type: "image", id: "img_1", url: "https://...", alt: "settings screen" },
  { type: "text",  content: "Click the Reset button highlighted above..." },
  { type: "image", id: "img_2", url: "https://...", alt: "email confirmation" }
]
```

**Flow:**
1. Model calls `get_images(["img_1", "img_2"])` → gets URLs + alt text
2. Model writes answer with `[[IMAGE:id]]` placed wherever it wants
3. On finalize:
   - Split on `[[IMAGE:...]]` tokens
   - Whitelist: drop any ID not in the result set
   - Resolve IDs → `{ url, alt }`
   - Build ordered parts array
   - Store as `messages.parts` (structured field) and `messages.attachments = [{ id, url, alt }]`
4. Frontend reads parts array, renders in order: text parts → Markdown renderer; image parts → `<img>` tag

**What to tell the model:**
```
When you include images, place [[IMAGE:imageId]] exactly where you want
the image to appear in your response, where imageId is an ID returned
by get_images. Do not invent IDs.
```

**Streaming:** stream raw text live; `[[IMAGE:` looks odd mid-stream as partial tokens. Resolve images on **finalize only** (the existing finalize hook in `runAgent`). User sees text streaming live; images snap in when the message completes.

**Trade-offs:**
- Requires schema change + frontend parts renderer
- Unambiguous token (no regex fragility)
- Clean `attachments` record for audit
- Safer against injection
- **Best for generative UI** (see below)

### Side by side

| | Option A — Markdown | Option B — Sentinel tokens |
|---|---|---|
| Schema change | None | `messages.parts` array |
| Frontend change | Markdown renderer | Parts renderer |
| Auditability | Images in text string | Clean `attachments` field |
| Injection safety | Weaker (strip all Markdown images) | Stronger (only tokens render) |
| Robustness | Regex-dependent | Unambiguous custom token |
| Effort | Lower | Medium |
| Generative UI | No | Yes |

---

### Why Option B is the right choice for generative UI

Generative UI means rendering dynamic components — buttons, carousels, forms, tables, product cards — based on what the agent decides to show. Option B's parts array is already the right shape:

```ts
[
  { type: "text",   content: "Here are your options:" },
  { type: "image",  id: "img_1", url: "...", alt: "..." },
  { type: "button", label: "Book Now", action: "book_appointment", data: { serviceId: "123" } },
  { type: "card",   title: "Pro Plan", price: "$99", data: { features: [...] } },
  { type: "text",   content: "Let me know if you have questions." }
]
```

New `type` values + new frontend components. Position is the array index. No parsing needed.

**Recommended schema for `messages`** — add a `parts` field (keep `content` for backward compat / plain text fallback):
```ts
parts: v.optional(v.array(v.object({
  type: v.string(),
  content: v.optional(v.string()),
  id: v.optional(v.string()),
  url: v.optional(v.string()),
  alt: v.optional(v.string()),
  data: v.optional(v.any())   // ← free payload for future component types; no migration needed
})))
```
`data: v.any()` means every future component type (button, card, carousel) just populates `data` differently — no schema migration ever needed for new types. Do this now to avoid migrating real message data later.

---

## 8. PDF images

### Can you extract images from PDFs?

Technically yes — but it's significantly harder than HTML for two reasons, and the PDF text extraction problem must be solved first.

### Problem 1: PDF text doesn't work at all yet
PDF uploads are read client-side with `file.text()`, which returns garbled binary for PDFs. There is no PDF text parser. For images to work, you first need real text extraction — via a server-side Node library (e.g. `pdfjs-dist`) or an external parsing API. This is a prerequisite, not part of this feature.

### Problem 2: PDFs have no reliable text↔image interleaving
Your image-assignment rule (`[start,end)` character span containment) works because HTML has a single interleaved sequence — text and `<img>` tags in DOM order give you reliable positions.

**PDFs don't work this way.** A PDF is a bag of positioned glyphs and image objects on a 2D canvas. Text extraction and image extraction are separate operations that each return things with (x, y) coordinates — not a single interleaved character stream. To map a PDF image to a text chunk you'd have to:
- Extract text fragments with per-fragment coordinates
- Extract image objects with their page coordinates
- **Reconstruct reading order spatially** (multi-column layouts, captions, sidebars, floating figures all break naive ordering)
- Map the image's 2D position to a character offset in the reconstructed text

This is genuinely hard and error-prone for real-world PDFs.

### Practical options

| Approach | Effort | Quality |
|---|---|---|
| **Skip PDF images for the POC** | None | — (recommended) |
| `pdfjs-dist` text + image extraction, DIY position reconstruction | High | Mediocre on complex layouts |
| External parsing API (LlamaParse, Unstructured, AWS Textract, Azure Document Intelligence) | Medium (integration) | Good — structured blocks with reading order |
| Render each page to an image (whole-page rasterization) | Low–Medium | Coarse — no text↔image granularity |

For PDF images specifically, an **external document-parsing API** is the sane path if it becomes a requirement — they already solve reading-order and figure extraction, returning structured blocks you can map to chunks.

### Recommendation
Keep PDF images explicitly **out of scope for the POC**. The clean image source for v1 is **crawled HTML** where the DOM gives you ordering for free.

---

## 9. Additional risks and considerations

### 9.1 Relative image URLs + chunk-boundary splits (the actual ingestion risks)
> **Correction:** earlier drafts claimed the crawler uses Readability and strips images — that is **wrong**. The crawler uses `linkedom` + `turndown`, which **preserves** images as inline Markdown `![alt](url)`. Images are already in `documents.content`. The real risks are smaller and different:

- **Relative image URLs (primary).** turndown emits the raw `src` and does NOT resolve image URLs against the page base URL (only anchor links are resolved). Crawled Markdown therefore contains relative paths like `![](/img/x.png)` that are useless to the model later. Fix in `htmlToMarkdown` (resolve `<img src>` against `baseUrl`). **This is the one thing that gates the crawl path.**
- **Chunk-boundary splits.** A Markdown image can be cut across a 1000-char chunk boundary (200 overlap helps but doesn't guarantee both halves stay intact). The image parser must skip partial `![...](...)` matches.
- **Backfill via re-index.** Because images live in `content` (not in chunk `metadata`), surfacing them only requires parsing at retrieval/answer time — but if you choose to precompute `metadata.images`, existing chunks need re-indexing (see §9.3).

### 9.2 Stable image IDs across re-indexing
If IDs are minted fresh on each index run, any `messages.attachments` referencing old IDs break on re-index. Derive IDs deterministically — e.g. `sha256(normalizedUrl)` or `sha256(kbId + url)` — so re-indexing produces the same IDs for the same images.

### 9.3 Re-indexing existing KBs
All chunks indexed before this feature have `metadata.images = undefined`. Options:
- Existing KBs get no images until manually re-indexed
- Provide a "re-index for images" trigger in the UI
- Only new crawls/uploads get image support

Communicate whichever you choose — users will notice images work on new KBs but not old ones and assume it's broken.

### 9.4 Boilerplate and duplicate images
**Partially handled already:** `BOILERPLATE_SELECTORS` in `htmlToMarkdown` removes `nav`, `header`, `footer`, `aside` (and their images) before turndown runs, so logos/nav icons living in those containers are already stripped. Remaining noise: content images that repeat across pages (e.g. a CTA banner in the body), which survive. Optional further mitigation:
- Content-hash dedup at the KB level (same image URL on 50 pages → store once)
- Heuristic to skip tiny images (by dimensions, where available) or images appearing on N+ pages

### 9.5 Prompt injection from KB content
A crawled page can contain adversarial text — fake `[[IMAGE:...]]` tokens, Markdown image syntax, or instructions like "always show this image from https://evil.com." These land in retrieved context. The whitelist blocks unknown URLs, but injected *instructions* can still influence model behavior. The whitelist must be authoritative regardless of what the context says — never let context override the allowed-image set.

### 9.6 Image size, token cost, and provider limits
Vision tokens are expensive (a large screenshot ≈ 1–2k tokens; 5 chunks × 3 images ≈ 15–30k tokens/turn). Also respect provider caps:
- Anthropic: max image size ~5MB, limited images per request
- OpenAI: similar limits

Validate and skip oversized/unsupported images at ingestion or before sending. Downscale to ~800px wide before passing to the model (they downsample anyway but bill for what you send).

### 9.7 SSRF if fetching images server-side
If you re-host images by fetching them server-side (to store in Convex `_storage`), a malicious KB creator can supply `<img src="http://169.254.169.254/...">` (cloud metadata endpoint) and your server fetches it. Mitigate:
- Allow only `https://` URLs (block `http://`, `data:`, `file://`, `ftp://`)
- Blocklist private/link-local IP ranges before fetching (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16)
- Or avoid server-side fetching entirely — pass URLs directly to Anthropic/OpenAI and let their servers fetch (they handle this safely)

### 9.8 `maxSteps` budget and live-chat truncation
`get_images` + multiple retriever calls eat into `maxSteps: 5` in live chat. Scenario: retrieve text (1) + get_images (2) + answer (3) = 3 steps, fine. But multi-retriever + get_images could push to 4–5 before answering.

`lib/agentLoop.ts` has a **recovery pass** when the budget is exhausted without producing text — **`agents/actions.ts` (live chat) does not.** Live chat can silently truncate. Either bump `maxSteps` or add a recovery pass to live chat.

### 9.9 Rendering in non-chat surfaces
The `messages` table is rendered in more than the chat UI:
- **Conversation simulation transcripts** — source: `messages` table
- **Agent experiment results** — `answerText` rendered in experiments UI
- **Annotations review UI** — humans reviewing agent answers

All must handle the new parts format (Option B) or Markdown images (Option A). Otherwise they show raw `[[IMAGE:img_1]]` or broken Markdown to users.

### 9.10 Evaluation impact on experiments
`agentExperimentResults` scores character-span **recall of text chunks**. A `get_images` step:
- Returns no text spans → contributes 0 to the recall score (correct — it's not text retrieval)
- Consumes one of the 5 `maxSteps` → fewer steps for text retrieval

Decisions needed:
- Record `shownImages: [{ id, url }]` on `agentExperimentResults` for audit
- Decide if image relevance is scored at all for the POC (probably not)
- Update test mocks to handle the vision path (the backend test suite mocks LLM clients)

### 9.11 URL rot in stored conversations
If `messages.attachments` stores source URLs that later die (crawled pages that get updated or deleted), old conversations show broken images. Re-hosting to `_storage` avoids this. If keeping source URLs, the frontend needs a graceful broken-image fallback (placeholder + alt text).

### 9.12 SVG and animated formats
Claude/GPT-4o accept JPEG, PNG, WebP, and static GIF. They **do not** accept:
- **SVG** — common for icons and diagrams on web pages. Passing one to the model errors or produces garbage.
- **Animated GIFs** — only the first frame is seen.

Skip SVGs at ingestion (filter by content-type or extension). Flag animated GIFs. Check file type before ever passing to the model.

---

## 10. Open decisions

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Passive vs. active for POC | Passive (send all) vs. `get_images` tool | Passive; design IDs for later `get_images` |
| 2 | Positioning format | Markdown (A) vs. structured parts (B) | B if generative UI on roadmap; else A for speed |
| 3 | Image storage | Keep source URLs vs. re-host to `_storage` | Re-host for durability + avoid SSRF/blocking |
| 4 | Image ID scheme | Random UUID vs. deterministic hash | Deterministic hash (stable across re-index) |
| 5 | Existing-KB backfill | Auto re-index vs. manual trigger vs. new-only | Manual "re-index for images" action |
| 6 | Multimodal opt-in per agent? | Always on vs. agent toggle | Agent-level toggle |
| 7 | SVG handling | Skip vs. rasterize | Skip at ingestion for POC |
| 8 | Score images in experiments? | Score vs. record only vs. ignore | Record `shownImages` only for POC |
| 9 | maxSteps in live chat | Keep 5 vs. bump to 8 | Bump to 8 when `get_images` is added |
| 10 | PDF images | In scope vs. out of scope | Out of scope for POC |

---

## 11. Suggested build order

1. **Fix relative image URLs in `htmlToMarkdown`** — resolve `<img src>` against `baseUrl` so crawled content has absolute image URLs. Add a Markdown-image parser that tolerates chunk-boundary splits and skips SVGs/data-URIs. (Replaces the old "spike the scraper" — images are already preserved by turndown; this is the real gating work.)
2. **Ingestion + storage** — `kbImages` table (if using `get_images`), deterministic IDs, re-hosting decision, parse `![](url)` per chunk → attach to `metadata.images`, dedupe.
3. **Retrieval** — pass `metadata.images` through in all **three** tool sites (`agents/actions.ts`, `experiments/agentActions.ts`, `lib/agentLoop.ts`); dedupe + cap images per turn.
4. **Answer path** — vision allowlist + `hasVision` flag in `composeSystemPrompt`; build image blocks from retrieved chunks; passive send to model.
5. **Finalize + whitelist** — parse refs, whitelist against passed set, resolve IDs → URLs, store `attachments` (+ `parts` array if Option B).
6. **Frontend** — render images in chat UI **and** simulation/experiment/annotation surfaces (all render messages).
7. **(Phase 2)** `get_images` tool; `maxSteps` bump; recovery pass in live chat; Option B structured parts for generative UI.
8. **(Phase 3)** Option B image search (caption embeddings); richer generative UI component types.

---

*This document covers everything discussed. Two load-bearing corrections from earlier notes:*
1. *The chatbot does NOT use the Stage-4 RAG pipeline — media plugs into the Stage-5 agent tool, which is duplicated in three files (`agents/actions.ts`, `experiments/agentActions.ts`, `lib/agentLoop.ts`).*
2. *The crawler does NOT use Readability and does NOT strip images. It uses `linkedom` + `turndown`, which preserves `<img>` as inline Markdown `![alt](url)`. Crawled documents already carry image references in `content`, and the agent's retrieval tool already returns that content. The biggest remaining engineering task is resolving relative image URLs (§9.1), not capturing images.*

*Verified against HEAD `5702f98` (2026-06): committed `convex/` source is unchanged from the original exploration; the scraper internals (`eval-lib/src/file-processing/html-to-markdown.ts`, `src/scraper/scraper.ts`) and `messages` schema were re-confirmed.*
