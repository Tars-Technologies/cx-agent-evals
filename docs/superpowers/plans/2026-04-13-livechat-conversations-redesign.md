# Livechat Conversations Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the livechat feature: rename "microtopics" → "message types", merge Transcripts + Microtopics into a single "Conversations" tab, store conversations as individual Convex rows (not blobs) for 100k-scale, make classification manual/batch (max 100), add per-conversation translation with caching, and support paginated sidebar with batch selection UX.

**Architecture:** Per-conversation Convex rows replace the single-blob storage. The upload pipeline only parses CSV → batch-inserts conversation rows → computes basicStats. Classification and translation are triggered manually (per-conversation or batch up to 100) via separate Convex actions. The frontend uses `usePaginatedQuery` for the conversation list, reactive queries for per-conversation status, and a selection mode with "Select next 10 unclassified" incremental batching capped at 100.

**Tech Stack:** Convex (database, file storage, WorkPool, paginated queries), TypeScript, `@anthropic-ai/sdk` (Node actions for classification + translation), React `useQuery`/`useMutation`/`usePaginatedQuery`, existing `eval-lib/data-analysis` module (renamed).

**Spec:** `docs/superpowers/specs/2026-04-13-livechat-conversations-redesign.md`

---

## File Map

### eval-lib (modified)

| File | Change |
|------|--------|
| `packages/eval-lib/src/data-analysis/types.ts` | Rename `MicrotopicType` → `MessageTypeCategory`, `Microtopic` → `MessageType`, remove `MicrotopicsFile`/`ConversationMicrotopics`, keep `Exchange`/`ExtractedInfo`/`BotFlowInput` |
| `packages/eval-lib/src/data-analysis/microtopic-extractor.ts` → `message-type-classifier.ts` | Rename file, rename `extractMicrotopics` → `classifyMessageTypes` (single-conversation signature), keep internal helpers |
| `packages/eval-lib/src/data-analysis/claude-client.ts` | Rename tool `classify_microtopics` → `classify_message_types`, update prompt wording |
| `packages/eval-lib/src/data-analysis/index.ts` | Update re-exports |
| `packages/eval-lib/src/data-analysis/translator.ts` | **New** — `translateMessages()` helper for non-English message translation |
| `packages/eval-lib/tests/unit/data-analysis/message-type-classifier.test.ts` | **New** — test for single-conversation `classifyMessageTypes` signature |

### Backend (modified)

| File | Change |
|------|--------|
| `packages/backend/convex/schema.ts` | Modify `livechatUploads` (remove blob fields, add `parsedConversations`, add `"deleting"` status), add `livechatConversations` table |
| `packages/backend/convex/livechat/orchestration.ts` | Rewrite: remove microtopics mutations, add classify/translate orchestration, add conversation queries, add cascade delete |
| `packages/backend/convex/livechat/actions.ts` | Rewrite: simplify pipeline to parse-only, add `classifyConversations` and `translateConversations` actions |
| `packages/backend/tests/livechat.test.ts` | Rewrite tests for new schema and functions |
| `packages/backend/tests/helpers.ts` | No change (livechatAnalysisPool already registered) |

### Frontend (modified/new/deleted)

| File | Change |
|------|--------|
| `packages/frontend/src/components/livechat/types.ts` | Rewrite: new types for message types, remove old microtopic types |
| `packages/frontend/src/components/livechat/MicrotopicCard.tsx` → `MessageTypeCard.tsx` | Rename file, update prop types |
| `packages/frontend/src/components/livechat/TopicTypeFeed.tsx` → `MessageTypeFeed.tsx` | Rename file, update prop types |
| `packages/frontend/src/components/livechat/ConversationList.tsx` | Modify: add checkbox support, status dots, message type badges |
| `packages/frontend/src/components/livechat/ConversationsTab.tsx` | **New** — merged tab with By Conversation / By Message Type sub-views, selection mode, batch actions |
| `packages/frontend/src/components/livechat/LivechatView.tsx` | Modify: two tabs (Stats + Conversations), remove blob fetching |
| `packages/frontend/src/components/livechat/TabBar.tsx` | Modify: two tabs instead of three |
| `packages/frontend/src/components/livechat/TranscriptsTab.tsx` | **Delete** |
| `packages/frontend/src/components/livechat/MicrotopicsTab.tsx` | **Delete** |

---

## Task 1: eval-lib — Rename types

**Files:**
- Modify: `packages/eval-lib/src/data-analysis/types.ts`

- [ ] **Step 1: Rename types in types.ts**

Read the current file, then apply these renames:

```typescript
// Line 45-52: Rename MicrotopicType → MessageTypeCategory
export type MessageTypeCategory =
  | "identity_info"
  | "question"
  | "request"
  | "confirmation"
  | "greeting"
  | "closing"
  | "uncategorized";

// Line 54-58: Rename MicrotopicMessage → MessageTypeMessage
export interface MessageTypeMessage {
  id: number;
  role: MessageRole;
  text: string;
}

// Line 70-74: Rename Microtopic → MessageType
export interface MessageType {
  type: MessageTypeCategory;
  exchanges: Exchange[];
  extracted?: ExtractedInfo[];
}
```

Remove `ConversationMicrotopics` (lines 83-88) and `MicrotopicsFile` (lines 90-98) — these are no longer needed (data lives in Convex rows, not blobs).

Remove `TopicTypeExportItem` (lines 156-163) and `TopicTypeExport` (lines 165-171) — export format will be rebuilt in the frontend.

Keep `Exchange` (change its `messages` type to `MessageTypeMessage[]`), `ExtractedInfo`, `BotFlowInput`, `LLMExchangeResult`, `LLMMicrotopicResult`, `LLMExtractionResult`, `BasicStats`, `AgentStats`, `RawMessage`, `RawConversation`, `RawTranscriptsFile`, `MessageRole` — all unchanged.

Add backward-compat aliases at the bottom (temporary, for incremental migration):

```typescript
/** @deprecated Use MessageTypeCategory */
export type MicrotopicType = MessageTypeCategory;
/** @deprecated Use MessageType */
export type Microtopic = MessageType;
/** @deprecated Use MessageTypeMessage */
export type MicrotopicMessage = MessageTypeMessage;
```

- [ ] **Step 2: Verify eval-lib compiles**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test 2>&1 | tail -5
```

Expected: Tests pass (some may need tweaks if they reference removed types — fix any import errors).

- [ ] **Step 3: Commit**

```bash
git add packages/eval-lib/src/data-analysis/types.ts
git commit -m "refactor(data-analysis): rename microtopic types to message type"
```

---

## Task 2: eval-lib — Rename extractor → classifier (single-conversation)

**Files:**
- Rename: `packages/eval-lib/src/data-analysis/microtopic-extractor.ts` → `message-type-classifier.ts`
- Modify: `packages/eval-lib/src/data-analysis/message-type-classifier.ts`

- [ ] **Step 1: Rename the file**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && \
  mv packages/eval-lib/src/data-analysis/microtopic-extractor.ts packages/eval-lib/src/data-analysis/message-type-classifier.ts
```

- [ ] **Step 2: Adapt to single-conversation signature**

Read the renamed file. The current `extractMicrotopics` function takes an array of conversations and returns `MicrotopicsFile`. Refactor it into:

1. **`classifyMessageTypes(conversation, options)`** — processes a single conversation, returns `MessageType[]`
2. **Keep** `preprocessConversation`, `assembleConversation`, `detectLanguage`, `isSystemMessage` as internal helpers (unchanged logic)
3. **Remove** the batch loop and `MicrotopicsFile` construction that was inside `extractMicrotopics`

The new `classifyMessageTypes` function:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { classifyConversation } from "./claude-client.js";
import type {
  RawConversation,
  MessageType,
  BotFlowInput,
} from "./types.js";

/**
 * Classify message types for a single conversation.
 * Returns the array of MessageType objects (sorted by message order).
 * Also returns botFlowInput if detected.
 */
export async function classifyMessageTypes(
  conversation: RawConversation,
  options: {
    claudeClient: Anthropic;
  },
): Promise<{ messageTypes: MessageType[]; botFlowInput?: BotFlowInput }> {
  const preprocess = preprocessConversation(conversation);

  let llmResult: LLMExtractionResult;
  if (preprocess.skipLLM) {
    llmResult = { microtopics: [] };
  } else {
    llmResult = await classifyConversation(
      options.claudeClient,
      preprocess.llmInputMessages,
    );
  }

  const assembled = assembleConversation(conversation, preprocess, llmResult);
  return {
    messageTypes: assembled.microtopics, // assembleConversation returns the sorted array
    botFlowInput: preprocess.botFlowInput ?? undefined,
  };
}
```

Keep `preprocessConversation` and `assembleConversation` unchanged internally — they already work on a single conversation. The only change is removing the outer batch loop that was `extractMicrotopics`.

Also keep the old `extractMicrotopics` as a deprecated wrapper that calls `classifyMessageTypes` in a loop (for backward compatibility during incremental migration):

```typescript
/** @deprecated Use classifyMessageTypes for single conversations */
export async function extractMicrotopics(
  conversations: RawConversation[],
  options: {
    claudeClient: Anthropic;
    source: string;
    limit?: number;
    concurrency?: number;
  },
): Promise<MicrotopicsFile> {
  // ... keep existing implementation for now, will be removed in a later task
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test 2>&1 | tail -10
```

Fix any import path issues (the file was renamed from `microtopic-extractor.ts` to `message-type-classifier.ts`).

- [ ] **Step 4: Commit**

```bash
git add packages/eval-lib/src/data-analysis/microtopic-extractor.ts packages/eval-lib/src/data-analysis/message-type-classifier.ts
git commit -m "refactor(data-analysis): rename extractor to classifier, add single-conversation signature"
```

---

## Task 3: eval-lib — Update claude-client and add translator

**Files:**
- Modify: `packages/eval-lib/src/data-analysis/claude-client.ts`
- Create: `packages/eval-lib/src/data-analysis/translator.ts`

- [ ] **Step 1: Update claude-client.ts**

Rename the tool from `classify_microtopics` to `classify_message_types` in the TOOL_SCHEMA (line 32). Update SYSTEM_PROMPT references from "microtopics" to "message types" (lines 7-29). The prompt content and classification logic stay the same — this is a cosmetic rename.

Key changes in SYSTEM_PROMPT:
- "segment the conversation into microtopics" → "segment the conversation into message types"
- "Microtopic types:" → "Message type categories:"
- All other rules stay identical

Key change in TOOL_SCHEMA:
- `name: "classify_microtopics"` → `name: "classify_message_types"`
- `description: "Classify conversation messages into microtopics"` → `"Classify conversation messages into message types"`
- Property name inside: `microtopics` → `messageTypes` (the array field)

Update `classifyConversation` to look for the new tool name in the response and return the renamed field.

- [ ] **Step 2: Create translator.ts**

Create `packages/eval-lib/src/data-analysis/translator.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const TRANSLATION_SYSTEM_PROMPT = `You are translating customer support chat messages to English.
Translate each message preserving the meaning and conversational tone.
Return translations using the translate_messages tool.`;

const TRANSLATION_TOOL_SCHEMA = {
  name: "translate_messages",
  description: "Return English translations for the given messages",
  input_schema: {
    type: "object" as const,
    properties: {
      translations: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            id: { type: "number" as const },
            text: { type: "string" as const },
          },
          required: ["id", "text"],
        },
      },
    },
    required: ["translations"],
  },
};

interface TranslationResult {
  translations: Array<{ id: number; text: string }>;
}

/**
 * Check if a message contains non-ASCII characters (likely non-English).
 */
export function hasNonAscii(text: string): boolean {
  return /[^\x00-\x7F]/.test(text);
}

/**
 * Translate non-English messages in a conversation to English.
 * Only sends messages with non-ASCII characters to Claude.
 * Returns sparse array of translations (only for messages that were translated).
 */
export async function translateMessages(
  messages: Array<{ id: number; text: string }>,
  client: Anthropic,
  retries = 3,
): Promise<Array<{ id: number; text: string }>> {
  // Filter to only non-English messages
  const nonEnglish = messages.filter((m) => hasNonAscii(m.text));

  if (nonEnglish.length === 0) {
    return []; // All messages are English
  }

  const userContent = `Translate these messages to English:\n${JSON.stringify(
    nonEnglish.map((m) => ({ id: m.id, text: m.text })),
  )}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: TRANSLATION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        tools: [TRANSLATION_TOOL_SCHEMA],
        tool_choice: { type: "tool", name: "translate_messages" },
      });

      const toolBlock = response.content.find(
        (block) => block.type === "tool_use",
      );
      if (!toolBlock || toolBlock.type !== "tool_use") {
        throw new Error("No tool_use block in translation response");
      }

      const result = toolBlock.input as TranslationResult;
      return result.translations;
    } catch (err: unknown) {
      if (
        err instanceof Anthropic.APIError &&
        err.status === 429 &&
        attempt < retries - 1
      ) {
        await new Promise((r) =>
          setTimeout(r, 1000 * Math.pow(2, attempt)),
        );
        continue;
      }
      throw err;
    }
  }

  throw new Error("Translation failed after all retries");
}
```

- [ ] **Step 3: Run tests to verify nothing is broken**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add packages/eval-lib/src/data-analysis/claude-client.ts packages/eval-lib/src/data-analysis/translator.ts
git commit -m "refactor(data-analysis): rename classification tool, add translateMessages helper"
```

---

## Task 4: eval-lib — Update index exports and rebuild

**Files:**
- Modify: `packages/eval-lib/src/data-analysis/index.ts`

- [ ] **Step 1: Update exports**

Replace the contents of `packages/eval-lib/src/data-analysis/index.ts`:

```typescript
export * from "./types.js";
export { parseTranscript, parseBotFlowInput } from "./transcript-parser.js";
export { parseCSV, parseCSVFromString } from "./csv-parser.js";
export { computeBasicStats } from "./basic-stats.js";
export {
  classifyMessageTypes,
  extractMicrotopics,
  preprocessConversation,
} from "./message-type-classifier.js";
export { createClaudeClient, classifyConversation } from "./claude-client.js";
export { translateMessages, hasNonAscii } from "./translator.js";
```

- [ ] **Step 2: Run all eval-lib tests**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test
```

Expected: All tests pass.

- [ ] **Step 3: Rebuild eval-lib**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/eval-lib/src/data-analysis/index.ts
git commit -m "refactor(data-analysis): update index exports for message type rename"
```

---

## Task 5: Backend — Schema changes

**Files:**
- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1: Modify `livechatUploads` table**

Read `packages/backend/convex/schema.ts` and find the `livechatUploads` table (lines 156-204).

Changes:
1. Add `"deleting"` to the `status` union
2. Remove: `microtopicsStatus`, `microtopicsError`, `rawTranscriptsStorageId`, `microtopicsStorageId`, `processedConversations`, `failedConversationCount`
3. Add: `parsedConversations: v.optional(v.number())`

The modified table should be:

```typescript
  livechatUploads: defineTable({
    orgId: v.string(),
    createdBy: v.id("users"),
    filename: v.string(),
    csvStorageId: v.id("_storage"),

    status: v.union(
      v.literal("pending"),
      v.literal("parsing"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("deleting"),
    ),
    error: v.optional(v.string()),

    conversationCount: v.optional(v.number()),
    parsedConversations: v.optional(v.number()),
    basicStats: v.optional(v.any()),

    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    workIds: v.optional(v.array(v.string())),
  })
    .index("by_org", ["orgId"])
    .index("by_org_created", ["orgId", "createdAt"]),
```

- [ ] **Step 2: Add `livechatConversations` table**

Add this table immediately after `livechatUploads`:

```typescript
  // ── Livechat conversations (one row per conversation per upload) ──
  livechatConversations: defineTable({
    uploadId: v.id("livechatUploads"),
    orgId: v.string(),

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
    status: v.string(),

    messages: v.array(
      v.object({
        id: v.number(),
        role: v.union(
          v.literal("user"),
          v.literal("human_agent"),
          v.literal("workflow_input"),
        ),
        text: v.string(),
      }),
    ),

    metadata: v.any(),

    botFlowInput: v.optional(
      v.object({
        intent: v.string(),
        language: v.string(),
      }),
    ),

    messageTypes: v.optional(v.any()),
    classificationStatus: v.union(
      v.literal("none"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    classificationError: v.optional(v.string()),

    translatedMessages: v.optional(
      v.array(
        v.object({
          id: v.number(),
          text: v.string(),
        }),
      ),
    ),
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
    .index("by_org", ["orgId"]),
```

- [ ] **Step 3: Verify backend typechecks**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm typecheck:backend
```

Expected: TypeScript errors in `orchestration.ts` and `actions.ts` because they reference removed fields. This is expected — Tasks 6 and 7 will fix them.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): update livechatUploads schema, add livechatConversations table"
```

---

## Task 6: Backend — Rewrite orchestration

**Files:**
- Modify: `packages/backend/convex/livechat/orchestration.ts`

- [ ] **Step 1: Rewrite the entire file**

Read the current file first for reference, then replace its contents entirely. The new file has:

**WorkPool instance** (unchanged — `livechatAnalysisPool`, maxParallelism: 2, no retries).

**Internal mutations for the parse pipeline:**
- `markParsing({ uploadId })` — unchanged
- `markParsingProgress({ uploadId, processed })` — new, patches `parsedConversations`
- `markReady({ uploadId, basicStats, conversationCount })` — simplified (no rawTranscriptsStorageId)
- `markFailed({ uploadId, error })` — unchanged
- `insertConversationBatch({ uploadId, orgId, conversations })` — new, batch-inserts up to 500 `livechatConversations` rows with default `classificationStatus: "none"`, `translationStatus: "none"`

**Internal mutations for classify/translate:**
- `patchClassificationStatus({ conversationId, status, messageTypes?, error? })` — patches classification fields on a conversation row
- `patchTranslationStatus({ conversationId, status, translatedMessages?, error? })` — patches translation fields
- `deleteConversationBatch({ ids })` — batch-deletes conversation rows (for cascade delete)

**Public mutations:**
- `generateUploadUrl()` — unchanged
- `create({ filename, csvStorageId })` — simplified (no microtopics fields in the insert)
- `remove({ id })` — marks as "deleting", schedules `deleteUploadData` action
- `classifyBatch({ uploadId, conversationIds })` — validates ≤100, enqueues `classifyConversations` via WorkPool
- `translateBatch({ uploadId, conversationIds })` — validates ≤100, enqueues `translateConversations` via WorkPool
- `classifySingle({ conversationId })` — convenience wrapper
- `translateSingle({ conversationId })` — convenience wrapper

**Public queries:**
- `list()` — unchanged (returns upload rows for org)
- `get({ id })` — unchanged
- `listConversations({ uploadId, paginationOpts })` — paginated query on `by_upload` index, returns conversation rows
- `getConversation({ id })` — returns single conversation row with org check
- `getClassificationCounts({ uploadId })` — returns `{ total, classified, running, failed }` counts
- `listByMessageType({ uploadId, type })` — returns classified conversations containing the given type

**WorkPool callbacks:**
- `onParseComplete` — catches crashes during parse pipeline
- `onClassifyComplete` — catches crashes mid-classification batch, patches stuck "running" conversations to "failed"
- `onTranslateComplete` — same for translation

The file will be large (~400-500 lines). Write it with all the functions above, following the exact patterns from the current file (auth via `getAuthContext`, `v.id()` validators, Convex mutation/query patterns).

**Key code for new functions:**

`insertConversationBatch`:
```typescript
export const insertConversationBatch = internalMutation({
  args: {
    uploadId: v.id("livechatUploads"),
    orgId: v.string(),
    conversations: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    for (const conv of args.conversations) {
      await ctx.db.insert("livechatConversations", {
        uploadId: args.uploadId,
        orgId: args.orgId,
        conversationId: conv.conversationId,
        visitorId: conv.visitorId,
        visitorName: conv.visitorName,
        visitorPhone: conv.visitorPhone,
        visitorEmail: conv.visitorEmail,
        agentId: conv.agentId,
        agentName: conv.agentName,
        agentEmail: conv.agentEmail,
        inbox: conv.inbox,
        labels: conv.labels,
        status: conv.status,
        messages: conv.messages,
        metadata: conv.metadata,
        botFlowInput: conv.botFlowInput ?? undefined,
        classificationStatus: "none",
        classificationError: undefined,
        translatedMessages: undefined,
        translationStatus: "none",
        translationError: undefined,
        messageTypes: undefined,
      });
    }
  },
});
```

`listConversations` (paginated):
```typescript
export const listConversations = query({
  args: {
    uploadId: v.id("livechatUploads"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.orgId !== orgId) return { page: [], isDone: true, continueCursor: "" };

    return await ctx.db
      .query("livechatConversations")
      .withIndex("by_upload", (q) => q.eq("uploadId", args.uploadId))
      .paginate(args.paginationOpts);
  },
});
```

`classifyBatch`:
```typescript
export const classifyBatch = mutation({
  args: {
    uploadId: v.id("livechatUploads"),
    conversationIds: v.array(v.id("livechatConversations")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    if (args.conversationIds.length > 100) {
      throw new Error("Cannot classify more than 100 conversations at once");
    }
    // Validate all IDs belong to this upload and org
    for (const convId of args.conversationIds) {
      const conv = await ctx.db.get(convId);
      if (!conv || conv.uploadId !== args.uploadId || conv.orgId !== orgId) {
        throw new Error(`Conversation ${convId} not found or access denied`);
      }
    }
    const workId = await pool.enqueueAction(
      ctx,
      internal.livechat.actions.classifyConversations,
      { conversationIds: args.conversationIds },
      {
        context: { conversationIds: args.conversationIds },
        onComplete: internal.livechat.orchestration.onClassifyComplete,
      },
    );
    return { workId };
  },
});
```

`remove` (cascade delete):
```typescript
export const remove = mutation({
  args: { id: v.id("livechatUploads") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) throw new Error("Upload not found");
    if (row.status === "pending" || row.status === "parsing") {
      throw new Error("Cannot delete upload while parsing is in progress");
    }
    await ctx.db.patch(args.id, { status: "deleting" });
    await ctx.scheduler.runAfter(0, internal.livechat.actions.deleteUploadData, {
      uploadId: args.id,
      csvStorageId: row.csvStorageId,
    });
    return { ok: true };
  },
});
```

- [ ] **Step 2: Skip typecheck (actions.ts not yet updated)**

Do NOT run typecheck — `actions.ts` still references old functions. Task 7 fixes it.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/livechat/orchestration.ts
git commit -m "feat(backend): rewrite livechat orchestration for per-conversation model"
```

---

## Task 7: Backend — Rewrite actions

**Files:**
- Modify: `packages/backend/convex/livechat/actions.ts`

- [ ] **Step 1: Rewrite the entire file**

Read the current file first. Replace with three actions:

**`runAnalysisPipeline`** (simplified — parse only, no classification):
```typescript
"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  parseCSVFromString,
  parseTranscript,
  computeBasicStats,
  preprocessConversation,
  createClaudeClient,
  classifyMessageTypes,
  translateMessages,
  hasNonAscii,
  type RawConversation,
} from "rag-evaluation-system/data-analysis";

export const runAnalysisPipeline = internalAction({
  args: {
    uploadId: v.id("livechatUploads"),
    csvStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.livechat.orchestration.markParsing, {
        uploadId: args.uploadId,
      });

      const blob = await ctx.storage.get(args.csvStorageId);
      if (!blob) throw new Error("CSV blob not found in storage");
      const csvText = await blob.text();

      // First pass: compute basic stats
      const stats = await computeBasicStats(parseCSVFromString(csvText));

      // Second pass: build conversations array
      const conversations: RawConversation[] = [];
      for await (const row of parseCSVFromString(csvText)) {
        const messages = parseTranscript(row["Transcript"] || "");
        const labels = (row["Labels"] || "")
          .split(",")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        conversations.push({
          conversationId: row["Conversation ID"] || "",
          visitorId: row["Visitor ID"] || "",
          visitorName: row["Visitor Name"] || "",
          visitorPhone: row["Visitor Phone"] || "",
          visitorEmail: row["Visitor Email"] || "",
          agentId: row["Agent ID"] || "",
          agentName: row["Agent Name"] || "",
          agentEmail: row["Agent Email"] || "",
          inbox: row["Inbox"] || "",
          labels,
          status: row["Status"] || "",
          messages,
          metadata: {
            messageCountVisitor: parseInt(row["Number of messages sent by the visitor"] || "0", 10),
            messageCountAgent: parseInt(row["Number of messages sent by the agent"] || "0", 10),
            totalDurationSeconds: parseInt(row["Total Conversation duration in Seconds"] || "0", 10),
            startDate: row["Start Date"] || "",
            startTime: row["Start Time"] || "",
            replyDate: row["Reply Date"] || "",
            replyTime: row["Reply Time"] || "",
            lastActivityDate: row["Last Activity Date"] || "",
            lastActivityTime: row["Last Activity Time"] || "",
          },
        });
      }

      // Extract botFlowInput for each conversation during parsing
      const conversationRows = conversations.map((conv) => {
        const preprocess = preprocessConversation(conv);
        return {
          ...conv,
          botFlowInput: preprocess.botFlowInput
            ? { intent: preprocess.botFlowInput.intent, language: preprocess.botFlowInput.language }
            : undefined,
        };
      });

      // Batch-insert conversation rows (500 per mutation)
      const BATCH_SIZE = 500;
      for (let i = 0; i < conversationRows.length; i += BATCH_SIZE) {
        const batch = conversationRows.slice(i, i + BATCH_SIZE);
        // Get orgId from the upload row
        const upload = await ctx.runQuery(internal.livechat.orchestration.getUploadInternal, {
          uploadId: args.uploadId,
        });
        if (!upload) throw new Error("Upload row not found");

        await ctx.runMutation(internal.livechat.orchestration.insertConversationBatch, {
          uploadId: args.uploadId,
          orgId: upload.orgId,
          conversations: batch,
        });
        await ctx.runMutation(internal.livechat.orchestration.markParsingProgress, {
          uploadId: args.uploadId,
          processed: Math.min(i + BATCH_SIZE, conversationRows.length),
        });
      }

      stats.source = "";
      await ctx.runMutation(internal.livechat.orchestration.markReady, {
        uploadId: args.uploadId,
        basicStats: stats,
        conversationCount: conversationRows.length,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await ctx.runMutation(internal.livechat.orchestration.markFailed, {
        uploadId: args.uploadId,
        error: message,
      });
    }
  },
});
```

**`classifyConversations`** action:
```typescript
export const classifyConversations = internalAction({
  args: {
    conversationIds: v.array(v.id("livechatConversations")),
  },
  handler: async (ctx, args) => {
    if (args.conversationIds.length > 100) {
      throw new Error("Cannot classify more than 100 conversations");
    }

    const client = createClaudeClient();
    const CONCURRENCY = 10;

    // Process with concurrency limit
    const queue = [...args.conversationIds];
    const processOne = async (convId: typeof queue[0]) => {
      try {
        await ctx.runMutation(internal.livechat.orchestration.patchClassificationStatus, {
          conversationId: convId,
          status: "running",
        });

        const conv = await ctx.runQuery(internal.livechat.orchestration.getConversationInternal, {
          id: convId,
        });
        if (!conv) throw new Error("Conversation not found");

        // Build RawConversation from the row
        const rawConv: RawConversation = {
          conversationId: conv.conversationId,
          visitorId: conv.visitorId,
          visitorName: conv.visitorName,
          visitorPhone: conv.visitorPhone,
          visitorEmail: conv.visitorEmail,
          agentId: conv.agentId,
          agentName: conv.agentName,
          agentEmail: conv.agentEmail,
          inbox: conv.inbox,
          labels: conv.labels,
          status: conv.status,
          messages: conv.messages,
          metadata: conv.metadata,
        };

        const result = await classifyMessageTypes(rawConv, { claudeClient: client });

        await ctx.runMutation(internal.livechat.orchestration.patchClassificationStatus, {
          conversationId: convId,
          status: "done",
          messageTypes: result.messageTypes,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Classification failed";
        await ctx.runMutation(internal.livechat.orchestration.patchClassificationStatus, {
          conversationId: convId,
          status: "failed",
          error: message,
        });
      }
    };

    // Sliding window concurrency
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      const batch = queue.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processOne));
    }
  },
});
```

**`translateConversations`** action:
```typescript
export const translateConversations = internalAction({
  args: {
    conversationIds: v.array(v.id("livechatConversations")),
  },
  handler: async (ctx, args) => {
    if (args.conversationIds.length > 100) {
      throw new Error("Cannot translate more than 100 conversations");
    }

    const client = createClaudeClient();
    const CONCURRENCY = 10;

    const processOne = async (convId: typeof args.conversationIds[0]) => {
      try {
        await ctx.runMutation(internal.livechat.orchestration.patchTranslationStatus, {
          conversationId: convId,
          status: "running",
        });

        const conv = await ctx.runQuery(internal.livechat.orchestration.getConversationInternal, {
          id: convId,
        });
        if (!conv) throw new Error("Conversation not found");

        const messagesToTranslate = conv.messages
          .filter((m: { text: string }) => hasNonAscii(m.text))
          .map((m: { id: number; text: string }) => ({ id: m.id, text: m.text }));

        if (messagesToTranslate.length === 0) {
          await ctx.runMutation(internal.livechat.orchestration.patchTranslationStatus, {
            conversationId: convId,
            status: "done",
            translatedMessages: [],
          });
          return;
        }

        const translations = await translateMessages(messagesToTranslate, client);

        await ctx.runMutation(internal.livechat.orchestration.patchTranslationStatus, {
          conversationId: convId,
          status: "done",
          translatedMessages: translations,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Translation failed";
        await ctx.runMutation(internal.livechat.orchestration.patchTranslationStatus, {
          conversationId: convId,
          status: "failed",
          error: message,
        });
      }
    };

    for (let i = 0; i < args.conversationIds.length; i += CONCURRENCY) {
      const batch = args.conversationIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processOne));
    }
  },
});
```

**`deleteUploadData`** action (cascade delete):
```typescript
export const deleteUploadData = internalAction({
  args: {
    uploadId: v.id("livechatUploads"),
    csvStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    // Delete conversation rows in batches
    let hasMore = true;
    while (hasMore) {
      const batch = await ctx.runQuery(
        internal.livechat.orchestration.getConversationBatchForDelete,
        { uploadId: args.uploadId, limit: 500 },
      );
      if (batch.length === 0) {
        hasMore = false;
        break;
      }
      await ctx.runMutation(internal.livechat.orchestration.deleteConversationBatch, {
        ids: batch.map((c: { _id: string }) => c._id),
      });
    }
    // Delete CSV blob and upload row
    await ctx.runMutation(internal.livechat.orchestration.finalizeDelete, {
      uploadId: args.uploadId,
      csvStorageId: args.csvStorageId,
    });
  },
});
```

- [ ] **Step 2: Add missing internal queries/mutations to orchestration.ts**

The actions reference some internal functions not yet in orchestration.ts. Add these to orchestration.ts:

```typescript
export const getUploadInternal = internalQuery({
  args: { uploadId: v.id("livechatUploads") },
  handler: async (ctx, args) => ctx.db.get(args.uploadId),
});

export const getConversationInternal = internalQuery({
  args: { id: v.id("livechatConversations") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const getConversationBatchForDelete = internalQuery({
  args: { uploadId: v.id("livechatUploads"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("livechatConversations")
      .withIndex("by_upload", (q) => q.eq("uploadId", args.uploadId))
      .take(args.limit);
  },
});

export const finalizeDelete = internalMutation({
  args: {
    uploadId: v.id("livechatUploads"),
    csvStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await ctx.storage.delete(args.csvStorageId);
    await ctx.db.delete(args.uploadId);
  },
});
```

Also add `internalQuery` to the imports from `../_generated/server`.

- [ ] **Step 3: Verify backend typechecks**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm typecheck:backend
```

If `rag-evaluation-system/data-analysis` can't resolve the new exports (`classifyMessageTypes`, `translateMessages`, `hasNonAscii`, `preprocessConversation`), rebuild eval-lib first: `pnpm build`.

If Convex generated types are stale, run: `cd packages/backend && npx convex dev --once`

- [ ] **Step 4: Commit**

```bash
git add packages/backend/convex/livechat/actions.ts packages/backend/convex/livechat/orchestration.ts
git commit -m "feat(backend): rewrite livechat actions for per-conversation model with classify/translate"
```

---

## Task 8: Backend — Rewrite tests

**Files:**
- Modify: `packages/backend/tests/livechat.test.ts`

- [ ] **Step 1: Rewrite test file**

Read the current file first. Replace entirely with tests for the new schema and functions. Key tests:

1. `generateUploadUrl requires auth` — unchanged
2. `create inserts upload with pending status` — updated (no microtopicsStatus)
3. `list returns only org rows` — unchanged
4. `get returns null for cross-org` — unchanged
5. `insertConversationBatch inserts rows with default statuses` — new
6. `listConversations paginates correctly` — new
7. `getClassificationCounts returns correct counts` — new
8. `classifyBatch throws on >100 conversations` — new
9. `translateBatch throws on >100 conversations` — new
10. `remove marks as deleting` — updated
11. `patchClassificationStatus updates fields correctly` — new
12. `patchTranslationStatus updates fields correctly` — new

Each test follows the existing pattern: `setupTest()`, `seedUser(t)`, `t.withIdentity(testIdentity)`, insert test data via `t.run()`, call the function, assert.

For `insertConversationBatch`, seed a blob for csvStorageId and an upload row, then call the internal mutation with a small conversation array and verify the rows are inserted with `classificationStatus: "none"`.

For `classifyBatch` cap test, create an upload, insert 101 stub conversation rows, then verify the mutation throws on `conversationIds.length > 100`.

- [ ] **Step 2: Run backend tests**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/backend test -- tests/livechat.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/tests/livechat.test.ts
git commit -m "test(backend): rewrite livechat tests for per-conversation model"
```

---

## Task 9: Frontend — Update types.ts

**Files:**
- Modify: `packages/frontend/src/components/livechat/types.ts`

- [ ] **Step 1: Replace file contents**

```typescript
import type {
  RawTranscriptsFile,
  BasicStats,
  MessageTypeCategory,
  MessageType,
  Exchange,
  ExtractedInfo,
} from "rag-evaluation-system/data-analysis";

export type LivechatTab = "stats" | "conversations";

export type UploadStatus = "pending" | "parsing" | "ready" | "failed" | "deleting";

export type ClassificationStatus = "none" | "running" | "done" | "failed";
export type TranslationStatus = "none" | "running" | "done" | "failed";

export interface MessageTypeItem {
  conversationId: string;
  visitorName: string;
  agentName: string;
  language: string;
  messageType: MessageType;
}

export type MessagesByType = Map<MessageTypeCategory, MessageTypeItem[]>;

export type {
  RawTranscriptsFile,
  BasicStats,
  MessageTypeCategory,
  MessageType,
  Exchange,
  ExtractedInfo,
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/livechat/types.ts
git commit -m "refactor(frontend): update livechat types for message type rename"
```

---

## Task 10: Frontend — Rename MicrotopicCard → MessageTypeCard

**Files:**
- Rename: `packages/frontend/src/components/livechat/MicrotopicCard.tsx` → `MessageTypeCard.tsx`
- Modify: `packages/frontend/src/components/livechat/MessageTypeCard.tsx`

- [ ] **Step 1: Rename file and update types**

```bash
mv packages/frontend/src/components/livechat/MicrotopicCard.tsx packages/frontend/src/components/livechat/MessageTypeCard.tsx
```

Update the import from `Microtopic` to `MessageType`:

```typescript
import type { MessageType } from "rag-evaluation-system/data-analysis";
```

Update the component props:

```typescript
export function MessageTypeCard({
  messageType,
  agentName,
  forceExpanded,
}: {
  messageType: MessageType;
  agentName?: string;
  forceExpanded?: boolean;
}) {
```

Replace all references to `microtopic` with `messageType` inside the component body (the prop name changes, all `microtopic.type`, `microtopic.exchanges`, `microtopic.extracted` become `messageType.type`, etc.).

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/livechat/MicrotopicCard.tsx packages/frontend/src/components/livechat/MessageTypeCard.tsx
git commit -m "refactor(frontend): rename MicrotopicCard to MessageTypeCard"
```

---

## Task 11: Frontend — Rename TopicTypeFeed → MessageTypeFeed

**Files:**
- Rename: `packages/frontend/src/components/livechat/TopicTypeFeed.tsx` → `MessageTypeFeed.tsx`
- Modify: `packages/frontend/src/components/livechat/MessageTypeFeed.tsx`

- [ ] **Step 1: Rename and update types**

```bash
mv packages/frontend/src/components/livechat/TopicTypeFeed.tsx packages/frontend/src/components/livechat/MessageTypeFeed.tsx
```

Update import from `MicrotopicByTypeItem` to `MessageTypeItem` and rename the component to `MessageTypeFeed`. Update all internal references.

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/livechat/TopicTypeFeed.tsx packages/frontend/src/components/livechat/MessageTypeFeed.tsx
git commit -m "refactor(frontend): rename TopicTypeFeed to MessageTypeFeed"
```

---

## Task 12: Frontend — Update ConversationList with selection support

**Files:**
- Modify: `packages/frontend/src/components/livechat/ConversationList.tsx`

- [ ] **Step 1: Add checkbox and status dot support**

Read the current file. Extend the component props to support:
- `selectionMode: boolean` — when true, show checkboxes
- `selectedIds: Set<string>` — which conversations are checked
- `onToggleSelect: (id: string) => void` — callback when checkbox toggled
- `maxSelected: boolean` — when true, disable unchecked items
- `showStatusDots: boolean` — show green/purple dots for classified/translated

The conversation data type changes from `RawConversation` to the Convex row shape. Add a generic `conversations` prop that accepts `Array<{ _id: string; conversationId: string; visitorName: string; agentName: string; messages: Array<{ role: string }>; classificationStatus?: string; translationStatus?: string; messageTypes?: any }>`.

Add checkbox rendering when `selectionMode` is true. Add status dot rendering. Add message type badges (Q×N, R×N, etc.) derived from `messageTypes` when present.

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/livechat/ConversationList.tsx
git commit -m "feat(frontend): add selection mode and status dots to ConversationList"
```

---

## Task 13: Frontend — Create ConversationsTab

**Files:**
- Create: `packages/frontend/src/components/livechat/ConversationsTab.tsx`

This is the largest frontend task. The component merges TranscriptsTab + MicrotopicsTab functionality.

- [ ] **Step 1: Create ConversationsTab.tsx**

The component structure:

```typescript
"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { ResizablePanel } from "../ResizablePanel";
import { ConversationList } from "./ConversationList";
import { MessageTypeCard } from "./MessageTypeCard";
import { MessageTypeFeed } from "./MessageTypeFeed";
import { ChatBubble } from "./ChatBubble";
import { ExportButton } from "./ExportButton";
import type { MessageTypeCategory, MessageTypeItem, MessagesByType } from "./types";
```

**State:**
- `view`: "conversation" | "messageType" — sub-tab
- `selectedConvId`: `Id<"livechatConversations"> | null`
- `selectedType`: `MessageTypeCategory`
- `allExpanded`: boolean (default true)
- `showMessageTypes`: boolean (default true for classified conversations)
- `selectionMode`: boolean
- `selectedIds`: `Set<string>` (for batch selection, capped at 100)

**Queries:**
- `usePaginatedQuery(api.livechat.orchestration.listConversations, { uploadId }, { initialNumItems: 200 })` for the sidebar list
- `useQuery(api.livechat.orchestration.getConversation, selectedConvId ? { id: selectedConvId } : "skip")` for the detail view
- `useQuery(api.livechat.orchestration.getClassificationCounts, { uploadId })` for sub-tab counts

**Mutations:**
- `useMutation(api.livechat.orchestration.classifySingle)` for single-conversation classify button
- `useMutation(api.livechat.orchestration.translateSingle)` for single-conversation translate button
- `useMutation(api.livechat.orchestration.classifyBatch)` for batch classify
- `useMutation(api.livechat.orchestration.translateBatch)` for batch translate

**Layout:**
- Sub-tabs header: "By Conversation (N total)" / "By Message Type (N classified)"
- "Select Conversations" / "Done Selecting" button
- ResizablePanel sidebar with ConversationList (paginated, with Load More)
- Main pane: conversation detail with header buttons + messages/accordions
- When in selection mode: floating action bar at bottom of sidebar

**Header buttons logic** (per spec section 3.3):
- If `classificationStatus === "none" || "failed"`: show "Classify Message Types" button
- If `classificationStatus === "running"`: show spinner + "Classifying..."
- If `classificationStatus === "done"`: show "Show Message Types" toggle
- If `translationStatus === "none" || "failed"`: show "Translate" button
- If `translationStatus === "running"`: show spinner + "Translating..."
- If `translationStatus === "done"`: Translate button gone, translations always inline
- "Expand All" only when Show Message Types is active
- "Export JSON" always

**Selection mode logic:**
- Max 100 selected
- "Select next 10 unclassified" picks from loaded list where `classificationStatus === "none"`, respects remaining capacity (cap - current)
- Progress bar N/100
- "Classify Message Types" and "Translate Convos" batch action buttons

**Translation display:**
- For each message, check if `translatedMessages` has an entry for that `id`
- If yes: show original text + dashed separator + translated text in purple
- If no: show original text only

This is a large file (~500-600 lines). Build it incrementally: first the layout with sub-tabs and sidebar, then the conversation detail view, then selection mode, then batch actions.

- [ ] **Step 2: Verify frontend typechecks (partial)**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/frontend exec tsc --noEmit 2>&1 | head -30
```

Expected: May show errors in LivechatView.tsx (references old tabs). Fixed in Task 14.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/livechat/ConversationsTab.tsx
git commit -m "feat(frontend): create ConversationsTab with classification, translation, batch selection"
```

---

## Task 14: Frontend — Update LivechatView, TabBar, delete old tabs

**Files:**
- Modify: `packages/frontend/src/components/livechat/LivechatView.tsx`
- Modify: `packages/frontend/src/components/livechat/TabBar.tsx`
- Delete: `packages/frontend/src/components/livechat/TranscriptsTab.tsx`
- Delete: `packages/frontend/src/components/livechat/MicrotopicsTab.tsx`

- [ ] **Step 1: Update TabBar.tsx**

Change the TABS array from three tabs to two:

```typescript
const TABS: { key: LivechatTab; label: string }[] = [
  { key: "stats", label: "Stats" },
  { key: "conversations", label: "Conversations" },
];
```

- [ ] **Step 2: Update LivechatView.tsx**

Remove imports for `TranscriptsTab`, `MicrotopicsTab`. Add import for `ConversationsTab`.

Remove the `rawTranscriptsData`, `microtopicsData`, `lastFetchedRawUrl`, `lastFetchedMicroUrl` state and the two `useEffect`s that fetch blob data — these are no longer needed (data comes from Convex queries inside ConversationsTab).

Remove the `rawTranscriptsUrl` and `microtopicsUrl` queries.

Remove the `loadedData` object construction.

Update tab rendering:

```typescript
{activeTab === "stats" && (
  <StatsTab stats={(selectedUpload?.basicStats as BasicStats | undefined) ?? null} />
)}
{activeTab === "conversations" && selectedUpload && (
  <ConversationsTab uploadId={selectedUpload._id} />
)}
```

The `ConversationsTab` receives only `uploadId` — it manages its own queries internally.

Update the sidebar's upload status badges to not show microtopics status (those fields are gone). Show `parsedConversations` progress when status is "parsing".

- [ ] **Step 3: Delete old tab files**

```bash
rm packages/frontend/src/components/livechat/TranscriptsTab.tsx
rm packages/frontend/src/components/livechat/MicrotopicsTab.tsx
```

- [ ] **Step 4: Verify frontend typechecks and builds**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/frontend exec tsc --noEmit
```

Then:

```bash
pnpm -C packages/frontend build
```

Expected: Both pass with no errors.

- [ ] **Step 5: Commit**

```bash
git add -A packages/frontend/src/components/livechat/
git commit -m "feat(frontend): update LivechatView to two tabs, delete old TranscriptsTab and MicrotopicsTab"
```

---

## Task 15: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run all eval-lib tests**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test
```

- [ ] **Step 2: Run all backend tests**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/backend test
```

- [ ] **Step 3: Typecheck backend**

```bash
pnpm typecheck:backend
```

- [ ] **Step 4: Build eval-lib and frontend**

```bash
pnpm build && pnpm -C packages/frontend build
```

- [ ] **Step 5: Deploy Convex schema to dev**

```bash
cd packages/backend && npx convex dev --once
```

Expected: Pushes new `livechatConversations` table and modified `livechatUploads` schema. If the push fails because existing `livechatUploads` rows have removed fields (`microtopicsStatus`, `rawTranscriptsStorageId`, etc.), clear the table via the Convex dashboard first, then retry.

- [ ] **Step 6: Manual smoke test**

Start dev servers and test in browser:
1. Clear any existing `livechatUploads` rows from the Convex dashboard (they have incompatible fields from the old schema)
2. Upload a small CSV (~100 conversations)
3. Verify parsing progress bar in the sidebar
4. Open Conversations tab — verify sidebar shows conversation list with "Load more"
5. Click a conversation — verify raw transcript view with "Classify Message Types" and "Translate" buttons
6. Click "Classify Message Types" — verify spinner, then accordion view
7. Toggle "Show Message Types" on/off
8. Click "Translate" on an Arabic conversation — verify translations appear inline
9. Enter selection mode, select some conversations, verify 100 cap
10. Batch classify — verify per-conversation progress
11. Check "By Message Type" sub-tab — verify grouped view
