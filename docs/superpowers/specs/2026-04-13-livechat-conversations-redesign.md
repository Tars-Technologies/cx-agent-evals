# Livechat Conversations Redesign — Design Spec

**Status:** Draft
**Date:** 2026-04-13
**Author:** Vinit + Claude
**Related:** [2026-04-09 Livechat Convex Storage Migration Design](./2026-04-09-livechat-convex-storage-migration-design.md)

---

## 1. Background

The livechat analysis feature was recently migrated to Convex storage (see related spec). It currently has three tabs (Stats, Transcripts, Microtopics) and runs the full analysis pipeline — including AI-powered message type classification — automatically on every upload. This works at small scale (~100 conversations) but has several problems:

1. **"Microtopics" is a misleading name.** The feature classifies message exchanges by *type* (question, request, greeting, etc.), not by *topic*. "Topic" is reserved for future topic-level analysis.
2. **Automatic classification on upload is too costly at scale.** At 60k–100k conversations, running Claude-based classification on every conversation is prohibitively expensive and slow.
3. **No translation capability.** Many conversations are in Arabic or other languages. Users need to translate non-English messages to English for review.
4. **The raw transcripts blob doesn't scale.** At 100k conversations, the single JSON blob can be hundreds of megabytes — too large to load in the browser.
5. **Two separate tabs (Transcripts + Microtopics) create friction.** Users switch between raw messages and classified messages for the same conversation.

This spec redesigns the feature to address all five problems.

## 2. Goals and non-goals

### Goals

- Rename "microtopics" → "message types" across UI and codebase.
- Merge Transcripts and Microtopics tabs into a single "Conversations" tab.
- Store conversations as individual Convex rows (not a single blob) for 100k-scale access.
- Make message type classification manual/batch (not automatic on upload).
- Add per-conversation and batch translation with caching.
- Support batch selection with a 100-conversation cap and incremental "select next 10" UX.
- Show real-time progress during CSV parsing (conversation count).
- Paginated conversation list in the sidebar for large uploads.

### Non-goals

- **Topic-level analysis** (what is the conversation about) — reserved for a future feature.
- **Changing the classification algorithm/prompt** — the existing Claude-based classifier stays as-is.
- **Real-time streaming of classification results** — reactive Convex queries provide progress, but not token-by-token streaming.
- **Search/filter conversations** in the sidebar — deferred.
- **Cancel in-flight batch operations** — deferred.

## 3. Architecture overview

### 3.1 Data flow changes

**Current flow (single-blob):**
```
CSV upload → parse all → store rawTranscripts.json blob → run extractMicrotopics on ALL → store microtopics.json blob
```

**New flow (per-conversation rows):**
```
CSV upload → parse all → insert rows into livechatConversations (batched, 500/mutation)
                          → basicStats inline on upload row (unchanged)
                          → NO automatic classification
                          → user manually triggers classification per conversation or batch (max 100)
                          → user manually triggers translation per conversation or batch (max 100)
```

### 3.2 Tab structure

**Before:** Stats | Transcripts | Microtopics
**After:** Stats | Conversations

The Conversations tab is a merge of the old Transcripts and Microtopics tabs. It retains the secondary sidebar with "By Conversation" and "By Message Type" sub-tabs.

### 3.3 Conversation view states

Each conversation has independent states for classification and translation. The header buttons change based on the combined state:

| Classification | Translation | Header buttons | Main pane |
|---|---|---|---|
| Not done | Not done | `Classify Message Types` · `Translate` · `Export JSON` | Raw chat bubbles |
| Not done | Done | `Classify Message Types` · `Export JSON` | Raw bubbles with inline translations |
| Running | Any | Spinner + "Classifying..." (other buttons disabled) | Spinner overlay on messages |
| Done | Not done | `Show Message Types` (toggle) · `Translate` · `Expand All` · `Export JSON` | Accordion or raw (toggle) |
| Done | Running | `Show Message Types` (toggle) · Spinner + "Translating..." · `Expand All` · `Export JSON` | Accordion/raw with spinner |
| Done | Done | `Show Message Types` (toggle) · `Expand All` · `Export JSON` | Accordion or raw, with inline translations |
| Failed | Any | `Classify Message Types` (retry) · error tooltip · other buttons as appropriate | Raw bubbles + error banner |
| Done | Failed | `Show Message Types` (toggle) · `Translate` (retry) · error tooltip · `Expand All` · `Export JSON` | Accordion/raw + translation error banner |

**Button lifecycle rules:**
- `Classify Message Types` appears when `classificationStatus` is `"none"` or `"failed"`. Disappears when `"done"` or `"running"`. Replaced by `Show Message Types` toggle when `"done"`.
- `Translate` appears when `translationStatus` is `"none"` or `"failed"`. Disappears when `"done"`. No toggle — translations are always shown inline once done.
- `Expand All` / `Collapse All` appears only when `Show Message Types` toggle is active (on).
- During `"running"` states, the relevant button is replaced by a spinner + label. Other buttons are disabled to prevent conflicting operations.

## 4. Data model changes

### 4.1 New table: `livechatConversations`

Stores one row per conversation per upload. Replaces the `rawTranscriptsStorageId` blob.

```typescript
livechatConversations: defineTable({
  uploadId: v.id("livechatUploads"),
  orgId: v.string(),

  // Conversation identity (from CSV columns)
  conversationId: v.string(),
  visitorId: v.string(),
  visitorName: v.string(),
  visitorPhone: v.string(),
  visitorEmail: v.string(),
  agentId: v.string(),
  agentName: v.string(),
  agentEmail: v.string(),
  inbox: v.string(),
  labels: v.array(v.string()),
  status: v.string(),                 // CSV "Status" column (open/closed/etc.)

  // Raw messages (always present after parsing)
  messages: v.array(v.object({
    id: v.number(),
    role: v.union(v.literal("user"), v.literal("human_agent"), v.literal("workflow_input")),
    text: v.string(),
  })),

  // Metadata from CSV
  metadata: v.any(),                  // The metadata object (messageCount, dates, etc.)

  // Bot flow input (extracted from first workflow_input message, if structured)
  botFlowInput: v.optional(v.object({
    intent: v.string(),
    language: v.string(),
  })),

  // Message type classification (empty until classified)
  messageTypes: v.optional(v.any()),  // Array of MessageType objects from classifier
  classificationStatus: v.union(
    v.literal("none"),
    v.literal("running"),
    v.literal("done"),
    v.literal("failed"),
  ),
  classificationError: v.optional(v.string()),

  // Translation (empty until translated)
  translatedMessages: v.optional(v.array(v.object({
    id: v.number(),
    text: v.string(),
  }))),
  translationStatus: v.union(
    v.literal("none"),
    v.literal("running"),
    v.literal("done"),
    v.literal("failed"),
  ),
  translationError: v.optional(v.string()),
})
  .index("by_upload", ["uploadId"])
  .index("by_upload_classification", ["uploadId", "classificationStatus"])
  .index("by_org", ["orgId"])
```

**Document size consideration:** Convex has a 1 MB hard limit per document. A typical conversation row with ~20 messages, classification results, and translations is well under 50 KB. Even a very long conversation (200+ messages) stays under 200 KB. This is not a concern at expected conversation lengths.

### 4.2 Changes to `livechatUploads`

**Remove these fields** (no longer needed — data lives in per-conversation rows):
- `rawTranscriptsStorageId`
- `microtopicsStorageId`
- `microtopicsStatus`, `microtopicsError`
- `processedConversations`, `failedConversationCount`

**Add:**
- `parsedConversations: v.optional(v.number())` — progress counter updated during CSV parsing batch inserts

**Modify:**
- `status` union: add `"deleting"` literal (for cascade delete state). New union: `"pending" | "parsing" | "ready" | "failed" | "deleting"`.

**Keep unchanged:**
- `csvStorageId` — original CSV blob stays in storage (archival)
- `basicStats` — inline on the upload row (small, drives the Stats tab)
- `error`, `createdAt`, `startedAt`, `completedAt` — pipeline status for parsing
- `orgId`, `createdBy`, `filename`, `conversationCount`

The pipeline action now only does: parse CSV → batch-insert conversation rows → compute basicStats → markReady. No classification or translation step.

### 4.3 Rename: "microtopic" → "messageType"

Full rename across the codebase:

| Before | After |
|---|---|
| `MicrotopicType` | `MessageTypeCategory` |
| `Microtopic` | `MessageType` |
| `MicrotopicsFile` | removed (no longer a blob) |
| `ConversationMicrotopics` | removed (data lives in conversation row) |
| `extractMicrotopics()` | `classifyMessageTypes()` |
| `MicrotopicsTab.tsx` | removed (merged into `ConversationsTab.tsx`) |
| `microtopicsStatus` field | removed from upload row |
| `MicrotopicCard.tsx` | `MessageTypeCard.tsx` |
| `MicrotopicsByType` | `MessagesByType` |
| `MicrotopicByTypeItem` | `MessageTypeItem` |
| `TopicTypeFeed.tsx` | `MessageTypeFeed.tsx` |
| `ExportButton` data format | Updated to export from conversation row instead of blob |

The eval-lib types file (`data-analysis/types.ts`) renames the types. The existing `extractMicrotopics` function is renamed to `classifyMessageTypes`. Its internal logic stays the same, but it is adapted to accept a **single** `RawConversation` (not an array) — see section 5.2.

## 5. Backend changes

### 5.1 Pipeline action changes (`livechat/actions.ts`)

The `runAnalysisPipeline` action is simplified — it only parses and inserts conversations:

1. `markParsing({ uploadId })`
2. Fetch CSV from storage → `blob.text()` → full CSV string
3. First pass: `computeBasicStats(parseCSVFromString(csvText))`
4. Second pass: iterate `parseCSVFromString(csvText)` and build `RawConversation[]` array with all fields (same mapping as current action). For each conversation, also extract `botFlowInput` by calling `preprocessConversation()` — the intent/language are stored on the conversation row during parsing, not deferred to classification.
5. **Batch-insert** into `livechatConversations`: chunk the array into batches of 500, call `insertConversationBatch` internal mutation for each. Each row includes the extracted `botFlowInput` (if present). After each batch, call `markParsingProgress({ uploadId, processed: batchEnd, total: conversations.length })`.
6. `markReady({ uploadId, basicStats, conversationCount })`

No classification. No translation. No blob upload. The `rawTranscriptsStorageId` and `microtopicsStorageId` fields are gone.

### 5.2 Adapted eval-lib function: `classifyMessageTypes()`

The existing `extractMicrotopics()` is renamed to `classifyMessageTypes()` and adapted:

**Current signature:** `extractMicrotopics(conversations: RawConversation[], options) → MicrotopicsFile`
**New signature:** `classifyMessageTypes(conversation: RawConversation, options) → MessageType[]`

The function processes a **single** conversation and returns the array of `MessageType` objects directly (no wrapping `MicrotopicsFile`). Internally, it calls the same `preprocessConversation` → `classifyConversation` → `assembleConversation` pipeline. The batch loop that was inside `extractMicrotopics` moves to the Convex action (which handles concurrency via `Promise.all` with a limit).

### 5.3 New actions: classify and translate

**`classifyConversations({ conversationIds })`** — internal action (`"use node"`):
1. Validate `conversationIds.length <= 100`
2. Process with concurrency limit of 10 (using a semaphore/pool pattern with `Promise.all` on sliding windows):
   a. Read conversation row via `ctx.runQuery`
   b. Patch row: `classificationStatus: "running"` via `ctx.runMutation`
   c. Call `classifyMessageTypes(conversation, { claudeClient, source: "" })` for this single conversation
   d. Patch row: `classificationStatus: "done"`, `messageTypes: result`, `classificationError: undefined`
   e. On error: patch `classificationStatus: "failed"`, `classificationError: message`
3. Each row updates reactively — the frontend sees per-conversation progress.

**`translateConversations({ conversationIds })`** — internal action (`"use node"`):
1. Validate `conversationIds.length <= 100`
2. Process with concurrency limit of 10:
   a. Read conversation row
   b. Patch row: `translationStatus: "running"`
   c. Filter messages: only those with non-ASCII characters (`/[^\x00-\x7F]/` test on text)
   d. If no non-English messages: patch `translationStatus: "done"`, `translatedMessages: []`
   e. Otherwise: send non-English messages to Claude for translation (see section 7.2)
   f. Patch row: `translationStatus: "done"`, `translatedMessages: [{ id, text }]` (sparse)
   g. On error: patch `translationStatus: "failed"`, `translationError: message`

### 5.4 New orchestration functions (`livechat/orchestration.ts`)

**Public mutations:**
- `classifyBatch({ uploadId, conversationIds })` — auth-gated, validates all IDs belong to the upload and org, validates `conversationIds.length <= 100`, enqueues `classifyConversations` via WorkPool. Returns `{ workId }`.
- `translateBatch({ uploadId, conversationIds })` — same pattern, enqueues `translateConversations`.
- `classifySingle({ conversationId })` — auth-gated convenience. Looks up the conversation's `uploadId`, enqueues via WorkPool with a single-element array.
- `translateSingle({ conversationId })` — same pattern.

All four mutations use the existing `livechatAnalysisPool` WorkPool (maxParallelism: 2).

**Public queries:**
- `listConversations({ uploadId, limit?, cursor? })` — paginated query using Convex's `.paginate()` API on the `by_upload` index. Returns `{ conversations, continueCursor, isDone }`. Each conversation row includes all fields needed for the sidebar: `_id`, `conversationId`, `visitorName`, `agentName`, message count (derived from `messages.length`), `classificationStatus`, `translationStatus`, `messageTypes` summary (type counts, for badges). Default limit: 200.
- `getConversation({ id })` — full conversation row. Auth-gated (org check).
- `getClassificationCounts({ uploadId })` — returns `{ total, classified, unclassified, running, failed }` by querying the `by_upload_classification` index for each status. Used for sub-tab count display.
- `listByMessageType({ uploadId, type, limit?, cursor? })` — paginated query over `by_upload_classification` index filtered to `classificationStatus === "done"`, then filters client-side for conversations containing the specified message type category. Returns conversation summaries with the relevant message type data for the `MessageTypeFeed` component. **Note:** at scale (>10k classified), a dedicated index or denormalized field may be needed — deferred optimization.

### 5.5 Internal mutations

- `markParsingProgress({ uploadId, processed, total })` — patches `parsedConversations` on the upload row.
- `insertConversationBatch({ uploadId, orgId, conversations })` — batch-inserts up to 500 `livechatConversations` rows. Each row is constructed from the `RawConversation` data plus `uploadId`, `orgId`, `classificationStatus: "none"`, `translationStatus: "none"`.
- `patchClassificationStatus({ conversationId, status, messageTypes?, error? })` — patches classification fields on a conversation row.
- `patchTranslationStatus({ conversationId, status, translatedMessages?, error? })` — patches translation fields.

### 5.6 Updated delete flow

The `remove` flow needs a cascade delete of all conversation rows. At 100k conversations, this cannot happen in a single mutation (Convex transaction write limits). Instead:

1. The `remove` **mutation** validates auth + org, rejects if busy, then marks the upload as `status: "deleting"` (new status) and schedules a `deleteUploadData` **internal action**.
2. The `deleteUploadData` action:
   a. Queries `livechatConversations` by `by_upload` index in pages of 500.
   b. For each page, calls an internal mutation `deleteConversationBatch({ ids })` that deletes up to 500 rows.
   c. After all conversation rows are deleted, calls a final internal mutation that deletes `csvStorageId` blob and the upload row itself.
3. If the delete action crashes mid-way, the upload row stays in `"deleting"` state. The user sees it as "deleting..." in the sidebar. A retry can be triggered by clicking delete again.

**Note:** There are no more `rawTranscriptsStorageId` or `microtopicsStorageId` blobs to delete. The `"deleting"` status should be added to the `livechatUploads.status` union.

### 5.7 Updated WorkPool callback

The `onAnalysisComplete` callback is simplified. It only catches crashes during the parse-only pipeline (no microtopics phase). Same logic: if the action crashed before writing a terminal status, patch the upload row to `status: "failed"`.

Classification and translation WorkPool jobs get their own `onComplete` callbacks that handle per-conversation error recovery — if the action crashes mid-batch, any conversation left in `"running"` status is patched to `"failed"` with a generic error.

## 6. Frontend changes

### 6.1 Tab structure

Remove:
- `TranscriptsTab.tsx` — merged into ConversationsTab
- `MicrotopicsTab.tsx` — merged into ConversationsTab

Create:
- `ConversationsTab.tsx` — combines both, with sub-tabs "By Conversation" and "By Message Type"

Rename:
- `MicrotopicCard.tsx` → `MessageTypeCard.tsx`
- `TopicTypeFeed.tsx` → `MessageTypeFeed.tsx`

Update:
- `ExportButton.tsx` — export data format changes to use conversation row data instead of blob data
- `LivechatView.tsx` — update tab bar to render Stats + Conversations (remove Transcripts, Microtopics)
- `types.ts` — rename all types, remove old `UploadEntry`-related types

### 6.2 ConversationsTab layout

The layout mirrors the current MicrotopicsTab structure:

```
┌──────────────────────────────────────────────────────────┐
│ [By Conversation (1,204 total)] [By Message Type (12)]   │ ← sub-tabs with counts
├──────────────────────────────────────────────────────────┤
│ [Select Conversations]                                   │ ← enters selection mode
├──────────────┬───────────────────────────────────────────┤
│ Conv list    │ Header: Name #id | buttons               │
│ (paginated)  │                                           │
│              │ Messages area:                            │
│ ● Ahmed      │   - Raw bubbles (default)                │
│   Fatima     │   - OR accordion view (Show Message Types)│
│   Mohammed   │   - Inline translations below non-English │
│   ...        │                                           │
│              │                                           │
│ [Load more]  │                                           │
└──────────────┴───────────────────────────────────────────┘
```

### 6.3 Selection mode UX

1. Click "Select Conversations" → checkboxes appear next to each conversation, button changes to "Done Selecting".
2. Manual clicks toggle individual checkboxes (increment/decrement counter by 1).
3. **"Select next 10 unclassified"** button auto-selects the next 10 conversations in the currently loaded list where `classificationStatus === "none"`. Can be clicked multiple times (adds 10, 20, 30, ...). If fewer than 10 unclassified remain in the loaded list, it selects all of them. If the loaded list has no more unclassified, the button shows "Load more to find unclassified" (prompting the user to load more conversations first).
4. **Maximum 100 selected at any time.** When at 100:
   - "Select next 10 unclassified" is disabled
   - Unchecked items are grayed out (cannot be checked)
   - Only unchecking is allowed
5. If manually selected count is e.g. 97, "Select next 10 unclassified" selects only 3 (to hit the 100 cap).
6. Progress bar shows `N / 100` visually.
7. Action buttons in floating bar: **"Classify Message Types"** and **"Translate Convos"** — both operate on the selected set.
8. "Clear" resets all selections to zero.
9. Click "Done Selecting" exits selection mode.
10. Selection state is local to the component (not persisted). Exiting selection mode clears selections.

### 6.4 Conversation list pagination

The sidebar conversation list uses Convex's `usePaginatedQuery` hook:
- Uses `usePaginatedQuery(api.livechat.orchestration.listConversations, { uploadId }, { initialNumItems: 200 })`
- "Load more" button calls `loadMore(200)` (provided by the hook)
- Pages are reactive — when a conversation's `classificationStatus` or `translationStatus` changes, the relevant page re-renders automatically (Convex handles this)
- Each item shows: visitor name, conversation ID, message count, status dots (green ● = classified, purple ● = translated), and message type badges (Q×3, R×2, etc.) if classified
- The existing `ConversationList` component is adapted to work with the new data shape (conversation rows instead of `RawConversation` objects). It gains checkbox support for selection mode and status dot rendering.

### 6.5 Translation display

Translated messages are shown inline — no toggle needed:
- Original text is displayed normally in the chat bubble
- Below the original text, a dashed border separator
- Translated English text in purple/indigo color below the separator
- Only non-English messages get the translation line; English messages show as-is
- Once translated, translations are always visible (no show/hide toggle)
- The merge logic: for each message, look up `translatedMessages` by message `id`. If found, render the translation sub-line. If not found, show original only.

### 6.6 Sidebar sub-tab counts

- **"By Conversation"** tab shows: `(N total)` where N = `conversationCount` from the upload row (instantly available, no extra query)
- **"By Message Type"** tab shows: `(N classified)` where N = count of conversations with `classificationStatus === "done"`, from `getClassificationCounts` query

## 7. Translation implementation

### 7.1 Language detection

Simple heuristic: scan each message text for non-ASCII characters (`/[^\x00-\x7F]/`). If a message is 100% ASCII, skip it (assumed English). This catches Arabic, Hindi, Urdu, Chinese, and all non-Latin scripts.

Edge case: non-English Latin-script languages (French, Spanish) are not caught. This is acceptable for the Vodafone Qatar dataset where non-English is predominantly Arabic. A more sophisticated detection can be added later.

### 7.2 Claude translation prompt

Send only non-English messages to Claude in a single API call per conversation:

```
System: You are translating customer support chat messages to English.
Translate each message preserving the meaning and conversational tone.
Return translations using the translate_messages tool.

User: Translate these messages to English:
[{ "id": 2, "text": "مرحبا، أريد الاستفسار عن باقات الإنترنت" }, ...]
```

**Tool schema** (forced tool_use, same pattern as the classifier):
```json
{
  "name": "translate_messages",
  "description": "Return English translations for the given messages",
  "input_schema": {
    "type": "object",
    "properties": {
      "translations": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "number" },
            "text": { "type": "string" }
          },
          "required": ["id", "text"]
        }
      }
    },
    "required": ["translations"]
  }
}
```

**Model:** `claude-sonnet-4-6` (same as classifier). Max tokens: 4096. Retry: 3 attempts with exponential backoff on 429.

### 7.3 Storage

`translatedMessages` on the conversation row is a sparse array — only entries for messages that were actually translated (non-English ones). English messages are not duplicated. The frontend merges at render time.

### 7.4 Cost estimate

Average conversation: ~10 messages, ~5 non-English. Translation cost per conversation: ~$0.001–0.003. At 100-conversation batches, ~$0.10–0.30 per batch. Acceptable.

## 8. Rename strategy

The rename from "microtopic" → "messageType" touches:

**eval-lib (`packages/eval-lib/src/data-analysis/`):**
- `types.ts`: `MicrotopicType` → `MessageTypeCategory`, `Microtopic` → `MessageType`, remove `MicrotopicsFile` and `ConversationMicrotopics` (no longer needed)
- `microtopic-extractor.ts` → `message-type-classifier.ts`: `extractMicrotopics` → `classifyMessageTypes`, adapt to single-conversation signature
- `claude-client.ts`: Update tool name from `classify_microtopics` to `classify_message_types`, update prompt references from "microtopics" to "message types"
- `index.ts`: Update re-exports

**Backend (`packages/backend/convex/livechat/`):**
- `orchestration.ts`: Remove microtopics-related internal mutations and status fields, add new classify/translate orchestration
- `actions.ts`: Replace full pipeline with parse-only + new classify/translate actions

**Frontend (`packages/frontend/src/components/livechat/`):**
- `MicrotopicsTab.tsx` → removed (replaced by `ConversationsTab.tsx`)
- `MicrotopicCard.tsx` → `MessageTypeCard.tsx` (update props to accept `MessageType` instead of `Microtopic`)
- `TopicTypeFeed.tsx` → `MessageTypeFeed.tsx`
- `types.ts`: Rename all types
- `LivechatView.tsx`: Update tab rendering (two tabs instead of three)
- `TabBar.tsx`: Update tab labels

## 9. Error handling

- **Classification failure** (per conversation): `classificationStatus: "failed"`, `classificationError` stored. The conversation shows raw transcript. The `Classify Message Types` button remains visible (since status is `"failed"`, not `"done"`), allowing retry. A small error indicator (red dot or tooltip) shows the error message.
- **Translation failure** (per conversation): `translationStatus: "failed"`, `translationError` stored. Conversation still readable in original language. `Translate` button remains visible for retry. Error indicator shows the error.
- **Batch failure** (action crash mid-batch): Conversations already classified/translated keep their results. The WorkPool `onComplete` callback detects the crash and patches any conversation left in `"running"` status to `"failed"` with a generic error message ("Classification action crashed unexpectedly").
- **CSV parsing failure**: Same as before — upload row goes to `status: "failed"`. Conversation rows that were already inserted stay (partial parse is visible). The user can delete and re-upload.
- **Batch size violation**: `classifyBatch` and `translateBatch` throw if `conversationIds.length > 100`. The frontend enforces this via the selection cap, so this is a defense-in-depth check.

## 10. Migration

This is a breaking change to the data model:
- `rawTranscriptsStorageId` removed from `livechatUploads`
- `microtopicsStorageId`, `microtopicsStatus`, `microtopicsError`, `processedConversations`, `failedConversationCount` removed from `livechatUploads`
- New `livechatConversations` table added
- New `parsedConversations` field on upload row
- Delete flow updated to cascade-delete conversation rows

Since the livechat feature is not yet in production (only dev data), this is a clean break — no data migration needed. Existing dev uploads should be deleted (via the UI or Convex dashboard) before deploying the schema change.

## 11. Testing strategy

### Unit tests (eval-lib)
- Rename tests to match new function names (`classifyMessageTypes` instead of `extractMicrotopics`)
- Add test for single-conversation signature (the function now takes one conversation, not an array)
- Existing `parseCSVFromString` tests stay as-is
- Add test for translation language detection heuristic (ASCII check)

### Integration tests (Convex backend)
- Update existing `livechat.test.ts` for new schema (removed fields, new conversation table)
- Add tests for:
  - `insertConversationBatch` correctly inserts rows with default `classificationStatus: "none"`, `translationStatus: "none"`
  - `listConversations` pagination (returns first page, continue cursor works)
  - `getClassificationCounts` returns correct counts by status
  - `classifyBatch` throws on `conversationIds.length > 100`
  - `translateBatch` throws on `conversationIds.length > 100`
  - `classifySingle` / `translateSingle` enqueue work and return workId
  - `remove` cascade-deletes all conversation rows for the upload
  - `getConversation` enforces org scoping

### Manual smoke test
1. Upload a small CSV (~100 conversations)
2. Verify progress bar during parsing ("Parsing conversations: 50 / 100")
3. Verify conversations appear in sidebar with "Load more" working
4. Click a conversation — raw transcript visible with `Classify Message Types` and `Translate` buttons
5. Click "Classify Message Types" — spinner, then accordion view appears
6. Toggle "Show Message Types" on/off — switches between accordion and raw
7. Click "Translate" on an Arabic conversation — spinner, then translations appear inline
8. Enter selection mode, select 10 manually, click "Select next 10 unclassified" three times (total: 40), verify counter
9. Try to exceed 100 — verify cap enforcement (button disabled, unchecked items grayed out)
10. Click "Classify Message Types" on selected batch — watch per-conversation progress dots change from pending to classified
11. Check "By Message Type" sub-tab — verify it shows classified count and correct type groupings

## 12. Open items deferred

- **Topic-level analysis** (what is the conversation *about*) — separate future feature using the word "topics"
- **Advanced language detection** for Latin-script non-English languages
- **Configurable batch size** (currently hardcoded at max 100, select-10 increment)
- **Cancel in-flight batch operations**
- **Search/filter conversations** in the sidebar
- **Dedicated index for `listByMessageType`** — currently filters client-side on classified conversations; may need optimization at scale
- **Retry all failed** button — batch-retry all conversations with `classificationStatus: "failed"`
