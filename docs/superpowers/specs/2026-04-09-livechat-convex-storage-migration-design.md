# Livechat Analysis — Convex Storage Migration Design

**Status:** Draft
**Date:** 2026-04-09
**Author:** Vinit + Claude
**Related:** [2026-04-02 Livechat Transcript Analysis Design](./2026-04-02-livechat-transcript-analysis-design.md)

---

## 1. Background

The livechat transcript analysis feature currently stores all data on the local filesystem:

- Uploaded CSVs land in `data/uploads/<id>.csv`
- Pipeline outputs (`basic-stats-*.json`, `raw-transcripts-*.json`, `microtopics-*.json`) land in `data/output/`
- A JSON `data/uploads/manifest.json` tracks upload metadata and status
- Three Next.js API routes (`/api/livechat/upload`, `/manifest`, `/data/[id]`) shell out to `npx tsx` CLIs in `packages/eval-lib/src/data-analysis/` via `execSync`

This works in local development but **will not work in production** on Vercel + Convex:

1. **Vercel serverless functions have no persistent filesystem.** `data/` doesn't exist in the deployed bundle; `/tmp` is ephemeral and per-invocation.
2. **`execSync` with `npx tsx`** can't run in serverless — no dev toolchain, no source tree, 10 s–60 s time limit.
3. **`process.cwd()` path assumptions** break outside the monorepo layout.

This spec migrates the feature to Convex (file storage + a new table + a processing action), keeping the eval-lib data-analysis module untouched so all parsing, stats, and extraction logic is reused as library code.

## 2. Goals and non-goals

### Goals

- Livechat analysis works identically in local dev, Vercel preview, and production.
- Uploads persist across requests, deploys, and sessions.
- Stats and transcript parsing succeed even if the AI microtopics step fails.
- Real-time UI updates via Convex reactive queries (no polling).
- Reuse existing eval-lib `data-analysis` module with no API changes.
- Handle multi-tenancy correctly (org-scoped uploads).
- Support deleting uploads (including cleaning up storage blobs).

### Non-goals

- **Scaling to very large CSVs** (>25k conversations in one upload). The pipeline still runs in a single Convex action with a 10-minute budget. Larger files remain a "future problem."
- **Retrying failed microtopics analysis.** The spec describes a placeholder — implementation of a retry button is explicitly out of scope for this iteration.
- **Cancelling in-flight jobs from the UI.** The schema leaves room for cancellation (via `workIds`), but no cancel button is added now.
- **Changing eval-lib APIs.** All parsing/extraction functions stay exactly as-is.
- **Supporting uploads larger than Convex's max upload size.** We rely on the default Convex storage limits.

## 3. Architecture overview

```
┌───────────────┐     1. POST CSV      ┌──────────────────┐
│   Browser     │ ───────────────────> │  Convex Storage  │
│ LivechatView  │                      │   (CSV blob)     │
└───────┬───────┘                      └──────────────────┘
        │                                       ▲
        │ 2. create upload row                  │ 4. fetch CSV
        ▼                                       │
┌────────────────────────┐                      │
│ Convex mutation:       │                      │
│ livechat.orchestration │                      │
│   .create              │                      │
└───────┬────────────────┘                      │
        │ enqueues                              │
        ▼                                       │
┌────────────────────────┐                      │
│ WorkPool:              │                      │
│ livechatAnalysisPool   │                      │
└───────┬────────────────┘                      │
        │ runs                                  │
        ▼                                       │
┌────────────────────────────────────────────┐  │
│ livechat/actions.ts  ("use node")          │  │
│                                            │  │
│  runAnalysisPipeline (single action)       │──┘
│    ├─ fetch CSV from storage               │
│    ├─ computeBasicStats  (eval-lib)        │
│    ├─ parseTranscript + assemble raw JSON  │
│    ├─ upload rawTranscripts.json → storage │────> ┌──────────────────┐
│    ├─ patch row: status="ready"            │      │ Convex Storage   │
│    ├─ extractMicrotopics (eval-lib)        │      │  (rawTransc.json)│
│    ├─ upload microtopics.json → storage    │────> │  (microtop.json) │
│    └─ patch row: microtopicsStatus="ready" │      └──────────────────┘
└────────────────────────────────────────────┘
        │
        │ reactive updates
        ▼
┌───────────────────────┐
│   Browser (polling-   │
│    free via useQuery) │
└───────────────────────┘
```

**Key properties:**

- **One action per upload.** Runs stats → transcripts → microtopics sequentially. If microtopics fails, the row is already marked `status: "ready"` from the transcripts phase, so the user can still view stats and transcripts.
- **eval-lib stays pure.** The action imports `parseTranscript`, `computeBasicStats`, `extractMicrotopics` and friends from `rag-evaluation-system/data-analysis` and feeds them in-memory data instead of filesystem paths.
- **Reactive UI.** The sidebar and tab content both use `useQuery` on Convex — no polling loops, no flicker.
- **Row patched in stages** so the frontend sees progress without streaming:
  1. Created → `status: "pending"`
  2. Pipeline starts → `status: "parsing"`, `startedAt` set
  3. Stats + transcripts done → `status: "ready"`, `basicStats` filled, `rawTranscriptsStorageId` filled, `conversationCount` filled
  4. Microtopics running → `microtopicsStatus: "running"`
  5. Microtopics done → `microtopicsStatus: "ready"`, `microtopicsStorageId` filled, `processedConversations` filled, `completedAt` set
  6. On any failure the corresponding `status` / `microtopicsStatus` flips to `"failed"` and an `error` / `microtopicsError` is stored.

## 4. Storage strategy (Option 3)

Per the bandwidth/size analysis done earlier, the three output files split like this:

| Artifact             | Typical size         | Storage location                      | Rationale                                                    |
|----------------------|----------------------|-----------------------------------------|--------------------------------------------------------------|
| Original CSV         | ~5–50 MB             | Convex file storage (`csvStorageId`)    | Too large for a row; needed only for reprocessing/archival.  |
| `basicStats`         | ~2–5 KB              | Inline in the `livechatUploads` row     | Instant, reactive, tiny. Drives the Stats tab.               |
| `rawTranscripts`     | ~5–50 MB             | Convex file storage                     | Too large for a row; fetched only when user opens an upload. |
| `microtopics`        | ~5–50 MB             | Convex file storage                     | Same reason; plus it may not exist (failed / skipped).       |

**Why not inline `rawTranscripts` or `microtopics`?**

Convex has a 1 MB hard limit per document field, and the sidebar's `useQuery` over `livechatUploads` would transfer the full blob on every update even if the user isn't looking at it. Inline storage would blow both the size limit and the bandwidth budget.

**How clients fetch the large files.** Two public queries (`getDownloadUrl` for `rawTranscripts` and `microtopics`) verify org ownership and return a signed Convex storage URL via `ctx.storage.getUrl(storageId)`. The frontend fetches the URL when the user actually opens an upload, then parses the JSON in the browser.

## 5. Data model

### 5.1 New table: `livechatUploads`

```typescript
livechatUploads: defineTable({
  // Ownership
  orgId: v.string(),
  createdBy: v.id("users"),

  // File identity
  filename: v.string(),
  csvStorageId: v.id("_storage"),

  // Overall pipeline status
  status: v.union(
    v.literal("pending"),   // Row created, not yet picked up
    v.literal("parsing"),   // computeBasicStats + transcript parse running
    v.literal("ready"),     // Stats + transcripts available; microtopics may still be running / failed
    v.literal("failed"),    // Stats or transcripts failed — nothing usable
  ),
  error: v.optional(v.string()),

  // AI microtopics status (independent)
  microtopicsStatus: v.union(
    v.literal("pending"),   // Not yet started
    v.literal("running"),   // Extractor is running now
    v.literal("ready"),     // microtopicsStorageId is set
    v.literal("failed"),    // Extraction failed; see microtopicsError
    v.literal("skipped"),   // User chose not to analyze (future retry UI)
  ),
  microtopicsError: v.optional(v.string()),

  // Output blobs (optional until filled by the action)
  rawTranscriptsStorageId: v.optional(v.id("_storage")),
  microtopicsStorageId: v.optional(v.id("_storage")),

  // Inline metadata (small)
  conversationCount: v.optional(v.number()),
  basicStats: v.optional(v.any()),   // eval-lib BasicStats object, ~2–5 KB
  processedConversations: v.optional(v.number()),
  failedConversationCount: v.optional(v.number()),

  // Timestamps
  createdAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),

  // WorkPool tracking (future-proof for cancellation)
  workIds: v.optional(v.array(v.string())),
})
  .index("by_org", ["orgId"])
  .index("by_org_created", ["orgId", "createdAt"]);
```

### 5.2 Design notes

- **`status` and `microtopicsStatus` are independent** so partial success is a first-class state. The UI uses `status` to gate stats/transcripts tabs and `microtopicsStatus` to gate the microtopics tab.
- **`basicStats: v.any()`** avoids coupling the Convex validator to the eval-lib `BasicStats` interface. The shape is already well-typed in TypeScript via the client-side cast.
- **No `kbId`.** Livechat uploads are scoped to an org, not to a specific knowledge base. (The current filesystem implementation has no scoping at all; we're adding org scoping for multi-tenant production use.) A future iteration can add KB scoping if users want to associate uploads with a specific KB.
- **`workIds` retained** mirroring the existing `generationJobs` / `indexingJobs` pattern, so future cancellation/retry work is a schema-free change.
- **`createdBy`** is a `users` ID (synced from Clerk via `users.getOrCreate` — existing pattern).

## 6. Backend layout

New directory: `packages/backend/convex/livechat/`

| File                          | Contents                                                                                                                                     |
|-------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| `livechat/orchestration.ts`   | Public mutations (`generateUploadUrl`, `create`, `remove`), public queries (`list`, `get`, `getDownloadUrl`), internal mutations patched from the action, WorkPool onComplete callback. |
| `livechat/actions.ts`         | `"use node"` actions: `runAnalysisPipeline` (internal), which imports from `rag-evaluation-system/data-analysis` and performs the full pipeline. |

**`crud/` directory?** No. The existing `crud/` subfolder is for simple CRUD tables (knowledgeBases, documents, datasets, etc.). Livechat has its own domain logic (pipeline, file storage, status transitions) so it lives in its own `livechat/` directory alongside `generation/`, `retrieval/`, `experiments/`.

### 6.1 Functions

**Public mutations (`livechat/orchestration.ts`):**

- `generateUploadUrl()` — mirrors `crud/documents.ts` `generateUploadUrl`: auth-gated, returns `ctx.storage.generateUploadUrl()`.
- `create({ filename, csvStorageId })` — auth-gated. Creates the row with `status: "pending"`, `microtopicsStatus: "pending"`, then enqueues `runAnalysisPipeline` via the new `livechatAnalysisPool` WorkPool, stores the work ID on the row, returns the upload row ID.
- `remove({ id })` — auth-gated, org-scoped. Deletes CSV + raw transcripts + microtopics blobs from storage (each optional storage ID is null-checked before calling `ctx.storage.delete`), then deletes the row. Throws if the upload is still being processed — see section 9 for the exact rule.

**Public queries (`livechat/orchestration.ts`):**

- `list()` — returns all uploads for the caller's org, sorted newest-first via `by_org_created` index.
- `get({ id })` — returns a single upload (with org check). Used when the frontend selects an upload.
- `getDownloadUrl({ id, type })` — `type` ∈ `"rawTranscripts" | "microtopics"`. Auth-gated, org-scoped. Returns the signed URL from `ctx.storage.getUrl(storageId)` or `null` if the artifact isn't ready.

**Internal mutations (`livechat/orchestration.ts`, called from the action):**

The `completedAt` field means "the pipeline has reached a terminal state" (success or failure, for either stats-or-transcripts or microtopics). It's set by any mutation that transitions to a terminal overall state.

- `markParsing({ uploadId })` — patches `status: "parsing"`, `startedAt: Date.now()`.
- `markReady({ uploadId, basicStats, rawTranscriptsStorageId, conversationCount })` — patches `status: "ready"` and fills the stats + transcripts fields. Does **not** set `completedAt` because microtopics is still about to run.
- `markFailed({ uploadId, error })` — patches `status: "failed"`, `error`, `completedAt`. Terminal state.
- `markMicrotopicsRunning({ uploadId })` — patches `microtopicsStatus: "running"`.
- `markMicrotopicsReady({ uploadId, microtopicsStorageId, processedConversations, failedConversationCount })` — patches `microtopicsStatus: "ready"`, `completedAt`. Terminal state.
- `markMicrotopicsFailed({ uploadId, error })` — patches `microtopicsStatus: "failed"`, `microtopicsError`, `completedAt`. Terminal state.

**Internal actions (`livechat/actions.ts`, `"use node"`):**

- `runAnalysisPipeline({ uploadId, csvStorageId })`:
  1. `markParsing`
  2. Fetch CSV: `const blob = await ctx.storage.get(csvStorageId)` → `await blob.text()` → full CSV text string
  3. Parse CSV rows with the new eval-lib helper `parseCSVFromString(text)` (see section 7)
  4. First pass: run `computeBasicStats` against the parsed rows
  5. Second pass: rewind the iterator (or re-parse the text — rows are parsed twice; trivial cost) and build the `RawTranscriptsFile` structure using `parseTranscript` row by row
  6. Upload `JSON.stringify(rawFile)` to storage via `ctx.storage.store(new Blob([json], { type: "application/json" }))` → returns `rawTranscriptsStorageId`
  7. Call `markReady` with `basicStats`, `rawTranscriptsStorageId`, `conversationCount`
  8. `markMicrotopicsRunning`
  9. Create Anthropic client (API key from `process.env.ANTHROPIC_API_KEY`), run `extractMicrotopics(conversations, { claudeClient, source: filename, concurrency: 10 })`. No `limit` — the full file is processed.
  10. Upload microtopics JSON to storage, call `markMicrotopicsReady` with `microtopicsStorageId`, `processedConversations`, `failedConversationCount`
  11. Error handling:
      - Any error in steps 2–7 → `markFailed` with the error message, then return (microtopics is skipped implicitly; its status stays `"pending"` but is irrelevant because `status` is `"failed"`).
      - Any error in steps 8–10 → `markMicrotopicsFailed` with the error message. `status` remains `"ready"` so stats + transcripts are still usable.

### 6.2 WorkPool

Add a new WorkPool instance in `packages/backend/convex/convex.config.ts`:

```typescript
app.use(workpool, { name: "livechatAnalysisPool" });
```

Instantiated in `livechat/orchestration.ts` with `maxParallelism: 2` (conservative — the action is long-running and Anthropic API is rate-limited). `retryActionsByDefault: false` because we don't want to silently burn Anthropic credits on transient failures; the user can delete + re-upload to retry.

An `onAnalysisComplete` internal mutation is registered as the WorkPool `onComplete` callback. In the happy path, the action has already patched the row into a terminal state (`ready` / `failed` / `microtopics ready` / `microtopics failed`) before the callback fires, and the callback is a no-op. The callback's job is to catch catastrophic failures where the action crashed *before* it could write a terminal status to the row (e.g., the action runtime itself died). In that case, it patches `status: "failed"` with a generic error message derived from the `RunResult`.

### 6.3 External packages

Update `packages/backend/convex.json` to add `@anthropic-ai/sdk` and `csv-parse` to `node.externalPackages`:

```json
"externalPackages": [
  "langsmith", "@langchain/core", "openai", "minisearch",
  "linkedom", "turndown", "unpdf",
  "ai", "@ai-sdk/anthropic", "@ai-sdk/openai", "zod",
  "cohere-ai",
  "@anthropic-ai/sdk", "csv-parse"
]
```

Both packages are already declared in `packages/eval-lib/package.json` (installed during the original livechat feature). They need to be added as direct dependencies in `packages/backend/package.json` so the Convex bundler resolves them correctly with pnpm (same pattern as the `langsmith` dependency).

### 6.4 Environment

Add `ANTHROPIC_API_KEY` to the Convex dashboard env vars (both dev and prod deployments). The existing `createClaudeClient()` helper in eval-lib reads `process.env.ANTHROPIC_API_KEY` which works from a Node action.

## 7. Pipeline implementation detail: CSV parsing

The existing eval-lib `parseCSV` is an async-streaming generator from a file path:

```typescript
export async function* parseCSV(filePath: string): AsyncIterable<Record<string, string>>
```

We can't use a file path inside a Convex action. Options:

- **Option A:** Add a sibling helper `parseCSVFromString(text: string): AsyncIterable<Record<string, string>>` that pipes the string through `csv-parse` instead of `createReadStream`. **Preferred.** Minimal, additive, doesn't break the existing CLI.
- **Option B:** Refactor `parseCSV` to take a `Readable` and let callers pass either a file stream or a string stream. More invasive.
- **Option C:** Write the fetched Blob to `/tmp` in the action and pass that path. Fragile and against the architecture principles here.

We go with **Option A**. The new helper is added to `packages/eval-lib/src/data-analysis/csv-parser.ts` and re-exported from `data-analysis/index.ts`. Existing `parseCSV(filePath)` stays for the CLI runners.

`computeBasicStats` already accepts `AsyncIterable<Record<string, string>>`, so it works with either source. The same goes for the in-memory loop in `run-parse.ts`, which will be replicated inline in the action.

## 8. Frontend layout

All existing livechat components (`StatsTab`, `TranscriptsTab`, `MicrotopicsTab`, `ChatBubble`, `ConversationList`, `MicrotopicCard`, `TopicTypeFeed`, `ExportButton`, `TabBar`) stay unchanged. Only `LivechatView.tsx` and `types.ts` are rewritten to use Convex hooks.

### 8.1 Deleted code

- `packages/frontend/src/app/api/livechat/upload/route.ts`
- `packages/frontend/src/app/api/livechat/manifest/route.ts`
- `packages/frontend/src/app/api/livechat/data/[id]/route.ts`

### 8.2 Changed code: `LivechatView.tsx`

Previous behavior: `useEffect` + `setInterval` + `fetch("/api/livechat/manifest")`, manual upload progress tracking, manual data fetching with triple `Promise.all`.

New behavior:

- `const uploads = useQuery(api.livechat.orchestration.list)` — reactive sidebar list, no polling.
- `const selectedUpload = useQuery(api.livechat.orchestration.get, selectedId ? { id: selectedId } : "skip")` — reactive detail row for stats + status gating.
- `const rawTranscriptsUrl = useQuery(api.livechat.orchestration.getDownloadUrl, selectedId && selectedUpload?.status === "ready" ? { id: selectedId, type: "rawTranscripts" } : "skip")`
- Same for `microtopicsUrl`, guarded on `microtopicsStatus === "ready"`.
- Two `useEffect`s fetch the JSON blobs when the signed URLs become available and store parsed JSON in component state (`rawTranscriptsData`, `microtopicsData`).
- **Guard against re-fetching:** each effect tracks the last fetched URL in a `useRef`. If the URL is unchanged, the effect no-ops. This prevents re-fetching the large blobs when Convex reactively re-publishes the same signed URL. (This is the same pattern we used to fix the earlier flicker bug in the filesystem implementation.)
- **Clear state on upload change:** when `selectedId` changes, immediately clear both `rawTranscriptsData` and `microtopicsData` so stale content doesn't leak between selections while new data loads.
- Upload flow:
  1. Get signed URL via `useMutation(api.livechat.orchestration.generateUploadUrl)`.
  2. POST the file to that URL directly with `fetch` (multipart is not needed — Convex signed URLs accept raw bodies).
  3. Call `useMutation(api.livechat.orchestration.create)` with `{ filename, csvStorageId }`.
- Delete flow: existing confirmation modal, but calls `useMutation(api.livechat.orchestration.remove)` instead of the API route. Delete button is disabled when `status === "pending" | "parsing"` or `microtopicsStatus === "running"`.

### 8.3 Changed code: `types.ts`

Remove the old `UploadEntry` interface (now derived from Convex). Keep `LoadedData`, `MicrotopicByTypeItem`, `MicrotopicsByType`, and the `LivechatTab` type.

`LoadedData` becomes:

```typescript
export interface LoadedData {
  basicStats: BasicStats | null;            // Inline from Convex row
  rawTranscripts: RawTranscriptsFile | null; // Fetched lazily from signed URL
  microtopics: MicrotopicsFile | null;       // Fetched lazily from signed URL, may be null
}
```

### 8.4 Microtopics tab "not ready" state

When `selectedUpload.microtopicsStatus !== "ready"`, `MicrotopicsTab` renders a placeholder:

- `pending` → "AI analysis queued. Waiting for stats and transcripts to finish first."
- `running` → "AI analysis in progress… this can take a few minutes." with a spinner.
- `failed` → "AI analysis failed: {microtopicsError}" + (future) "Retry" button (disabled, with tooltip "Not yet implemented").
- `skipped` → "AI analysis not yet run" + (future) "Analyze now" button (disabled, with tooltip "Not yet implemented").

The retry/analyze buttons are deliberately stubbed (not implemented this iteration). The placeholder copy is present so users understand why the tab is empty.

## 9. Delete flow

`remove({ id })` mutation:

1. Auth context → get `orgId`.
2. Fetch row, verify `row.orgId === orgId`, else throw.
3. Reject if busy: throw if `status === "pending"` or `status === "parsing"` or `microtopicsStatus === "running"`. Error: `"Cannot delete upload while analysis is in progress"`. The frontend disables the delete button in these states.
4. `ctx.storage.delete(row.csvStorageId)`.
5. If `row.rawTranscriptsStorageId != null` → `ctx.storage.delete(row.rawTranscriptsStorageId)`.
6. If `row.microtopicsStorageId != null` → `ctx.storage.delete(row.microtopicsStorageId)`.
7. `ctx.db.delete(row._id)`.

Cancellation via WorkPool is deferred. Users who want to stop an in-flight job must wait for completion or failure, then delete.

## 10. Auth and org scoping

Every public function calls `getAuthContext(ctx)` (existing helper). Every row has `orgId` populated from the auth context. Every query filters by `orgId`. Every mutation that acts on a specific row verifies `row.orgId === orgId` before proceeding. Same pattern as `crud/documents.ts`.

## 11. Error handling

Errors are surfaced through the row's status fields, not through thrown errors in queries:

- **CSV too big / malformed:** `status: "failed"`, `error: "Failed to parse CSV: ..."`. Stats + transcripts unusable.
- **Stats or raw-transcripts upload failure:** `status: "failed"`, `error` set, no raw transcripts blob. Row is delete-able.
- **Microtopics failure (Anthropic error, timeout, etc.):** `status: "ready"` (stats + transcripts still shown), `microtopicsStatus: "failed"`, `microtopicsError` set. The Microtopics tab shows the error; Stats + Transcripts tabs work fine.
- **Action crash before any `markXxx` call:** caught by the WorkPool `onComplete` callback, which patches the row to `status: "failed"` with a generic error message. This is a last-resort catch-all.

The frontend never throws on error statuses — it renders the error inline in the relevant tab.

## 12. Testing strategy

### Unit tests (eval-lib)

- Add tests for the new `parseCSVFromString` helper: basic parsing, quoted fields with newlines, edge cases (empty string, malformed row with `relax_column_count: true`).
- Existing `computeBasicStats` tests already cover the logic; no new tests needed there.

### Integration tests (Convex backend)

Using `convex-test`, same pattern as `packages/backend/tests/`:

- `livechatUploads.test.ts`:
  - `create` inserts a row with correct defaults and enqueues work.
  - `list` returns only the caller's org's uploads.
  - `get` enforces org scoping (throws on cross-org access).
  - `remove` deletes storage blobs and the row. Deletes with missing optional blobs (e.g., row where microtopics never started) don't throw.
  - `remove` while `status === "parsing"` throws.
  - `generateUploadUrl` requires auth.
  - `getDownloadUrl` returns null for absent blobs, signed URL for present ones.
  - Internal mutations (`markReady`, `markFailed`, etc.) patch the row correctly.

The action itself (`runAnalysisPipeline`) is not integration-tested — it calls real Anthropic and requires a real CSV. It's smoke-tested manually in dev.

### Manual smoke test

1. `pnpm dev:backend` + `pnpm dev`.
2. Upload the small 100-conversation VFQ CSV via the LivechatView.
3. Verify row appears in the sidebar with `status: "parsing"` then `"ready"`, then `microtopicsStatus` transitions to `"ready"`.
4. Click through Stats, Transcripts, Microtopics tabs — all populate.
5. Delete the upload — row and blobs disappear.
6. Negative test for microtopics failure: temporarily clear the Convex dev deployment's `ANTHROPIC_API_KEY` (via the Convex dashboard), upload another CSV, and verify the row lands in `status: "ready"` with `microtopicsStatus: "failed"`. Stats and Transcripts tabs render normally; the Microtopics tab shows the error message. Restore the key after testing.

## 13. Migration strategy

This is a clean break — no existing livechat data needs to migrate. The branch is unmerged and only the local `data/` directory holds any state, which is dev-only.

Steps:

1. Stop the dev server.
2. Delete `data/uploads/manifest.json` and `data/output/` (optional cleanup).
3. Merge this change; Convex auto-deploys the schema and the new WorkPool component.
4. Set `ANTHROPIC_API_KEY` in the Convex dashboard env vars (dev and prod deployments).
5. Re-upload CSVs via the new UI.

## 14. Open items deliberately deferred

- **Retry failed microtopics.** Schema and UI hook are in place (`microtopicsStatus: "failed"`). Implementation is a follow-up.
- **Configurable microtopics limit.** Currently the CLI supports `--limit N`; the action uses no limit. If the 10-minute action budget becomes a problem, expose a limit on `create`.
- **Cancel in-flight analysis.** `workIds` is stored; no cancel button yet.
- **Split stats + transcripts + microtopics into separate work items** for better progress reporting and partial retry. Deferred until the single-action approach hits a real limit.
- **Per-KB scoping.** Currently org-scoped only, like the CLI.

## 15. Rollback plan

If the migration causes production issues:

- The frontend changes and backend additions are all additive (except for the three deleted API routes). Reverting the branch restores the previous filesystem-based behavior.
- Rolling back the Convex schema requires:
  1. Re-add the deleted API routes (from git).
  2. Revert the schema migration (drop the `livechatUploads` table via the Convex dashboard).
  3. Revert `convex.config.ts` to remove `livechatAnalysisPool`.
- Because the current production build does not use livechat at all (feature is local-only right now), there's no actual production data to lose.
