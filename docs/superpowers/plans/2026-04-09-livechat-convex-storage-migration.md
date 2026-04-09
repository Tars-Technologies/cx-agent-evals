# Livechat Convex Storage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the livechat transcript analysis feature from local filesystem storage (CSV + 3 JSON files in `data/`) to Convex file storage + a new `livechatUploads` table so that it works in Vercel + Convex production, while reusing the existing `eval-lib/data-analysis` module unchanged.

**Architecture:** A new `livechatUploads` Convex table holds metadata and small inline `basicStats`. Three large artifacts (original CSV, raw transcripts JSON, microtopics JSON) live in Convex file storage and are referenced by optional `_storage` IDs. A single `"use node"` action runs the pipeline via WorkPool: fetch CSV → stats + parse → upload raw transcripts → `markReady` → run microtopic extractor → upload microtopics → `markMicrotopicsReady`. The frontend uses reactive `useQuery` hooks instead of polling API routes.

**Tech Stack:** Convex (database, file storage, WorkPool), TypeScript, `@anthropic-ai/sdk` (Node action only), `csv-parse` (Node action only), React `useQuery`/`useMutation`, existing `eval-lib/data-analysis` module.

**Spec:** `docs/superpowers/specs/2026-04-09-livechat-convex-storage-migration-design.md`

---

## File Map

### eval-lib (modified)

| File | Change |
|------|--------|
| `packages/eval-lib/src/data-analysis/csv-parser.ts` | Add `parseCSVFromString(text: string): AsyncIterable<Record<string, string>>` helper |
| `packages/eval-lib/src/data-analysis/index.ts` | Re-export `parseCSVFromString` |
| `packages/eval-lib/tests/unit/data-analysis/csv-parser.test.ts` | New test file for `parseCSVFromString` |

### Backend (new files)

| File | Responsibility |
|------|---------------|
| `packages/backend/convex/livechat/orchestration.ts` | Public mutations/queries, internal mutations for status patching, WorkPool `onAnalysisComplete` callback |
| `packages/backend/convex/livechat/actions.ts` | `"use node"` `runAnalysisPipeline` action |
| `packages/backend/tests/livechat.test.ts` | convex-test integration tests for orchestration |

### Backend (modified)

| File | Change |
|------|--------|
| `packages/backend/convex/schema.ts` | Add `livechatUploads` table |
| `packages/backend/convex/convex.config.ts` | Add `livechatAnalysisPool` WorkPool component |
| `packages/backend/convex.json` | Add `@anthropic-ai/sdk` and `csv-parse` to `externalPackages` |
| `packages/backend/package.json` | Add `@anthropic-ai/sdk` and `csv-parse` as direct dependencies |
| `packages/backend/tests/helpers.ts` | Register the new `livechatAnalysisPool` in `setupTest` |

### Frontend (modified)

| File | Change |
|------|--------|
| `packages/frontend/src/components/livechat/LivechatView.tsx` | Rewrite to use Convex hooks instead of filesystem API routes |
| `packages/frontend/src/components/livechat/types.ts` | Remove `UploadEntry`, update `LoadedData` to reflect Convex row |
| `packages/frontend/src/components/livechat/MicrotopicsTab.tsx` | Accept `microtopicsStatus` + `microtopicsError` props and render placeholder states |

### Frontend (deleted)

| File | Reason |
|------|--------|
| `packages/frontend/src/app/api/livechat/upload/route.ts` | Replaced by Convex mutation |
| `packages/frontend/src/app/api/livechat/manifest/route.ts` | Replaced by reactive query |
| `packages/frontend/src/app/api/livechat/data/[id]/route.ts` | Replaced by `getDownloadUrl` query |

---

## Task 1: eval-lib — `parseCSVFromString` helper (TDD)

**Files:**
- Create: `packages/eval-lib/tests/unit/data-analysis/csv-parser.test.ts`
- Modify: `packages/eval-lib/src/data-analysis/csv-parser.ts`
- Modify: `packages/eval-lib/src/data-analysis/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/eval-lib/tests/unit/data-analysis/csv-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseCSVFromString } from "../../../src/data-analysis/csv-parser.js";

async function collect(
  iter: AsyncIterable<Record<string, string>>,
): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const row of iter) rows.push(row);
  return rows;
}

describe("parseCSVFromString", () => {
  it("should parse a simple header + rows", async () => {
    const text = "a,b,c\n1,2,3\n4,5,6\n";
    const rows = await collect(parseCSVFromString(text));
    expect(rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ]);
  });

  it("should handle quoted fields containing newlines", async () => {
    const text = 'name,note\n"Alice","line1\nline2"\n"Bob","single"\n';
    const rows = await collect(parseCSVFromString(text));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "Alice", note: "line1\nline2" });
    expect(rows[1]).toEqual({ name: "Bob", note: "single" });
  });

  it("should trim whitespace around fields", async () => {
    const text = "a,b\n  hello ,  world \n";
    const rows = await collect(parseCSVFromString(text));
    expect(rows).toEqual([{ a: "hello", b: "world" }]);
  });

  it("should skip empty lines", async () => {
    const text = "a,b\n1,2\n\n3,4\n";
    const rows = await collect(parseCSVFromString(text));
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("should tolerate rows with fewer columns than the header", async () => {
    const text = "a,b,c\n1,2\n3,4,5\n";
    const rows = await collect(parseCSVFromString(text));
    // relax_column_count: true — the short row gets parsed without throwing
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ a: "3", b: "4", c: "5" });
  });

  it("should return empty for empty string", async () => {
    const rows = await collect(parseCSVFromString(""));
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test -- tests/unit/data-analysis/csv-parser.test.ts
```

Expected: FAIL — `parseCSVFromString is not a function` (or export not found).

- [ ] **Step 3: Add the implementation**

Modify `packages/eval-lib/src/data-analysis/csv-parser.ts` — add the new function below the existing `parseCSV`. Import `Readable` at the top:

```typescript
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { parse } from "csv-parse";
```

Then append below `parseCSV`:

```typescript
/**
 * Parse a CSV string (already loaded into memory) row-by-row.
 * Used when the source is not a filesystem path — e.g., a Convex
 * file storage blob fetched as text.
 * Handles quoted fields with newlines. Yields one Record per row.
 */
export async function* parseCSVFromString(
  text: string,
): AsyncIterable<Record<string, string>> {
  const parser = Readable.from([text]).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }),
  );

  for await (const record of parser) {
    yield record as Record<string, string>;
  }
}
```

- [ ] **Step 4: Export from index**

Modify `packages/eval-lib/src/data-analysis/index.ts` — change the existing `parseCSV` export line to include `parseCSVFromString`:

```typescript
export { parseCSV, parseCSVFromString } from "./csv-parser.js";
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test -- tests/unit/data-analysis/csv-parser.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 6: Rebuild eval-lib**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/eval-lib/src/data-analysis/csv-parser.ts packages/eval-lib/src/data-analysis/index.ts packages/eval-lib/tests/unit/data-analysis/csv-parser.test.ts
git commit -m "feat(data-analysis): add parseCSVFromString helper for in-memory CSV parsing"
```

---

## Task 2: Backend dependencies and Convex config

**Files:**
- Modify: `packages/backend/package.json`
- Modify: `packages/backend/convex.json`
- Modify: `packages/backend/convex/convex.config.ts`

- [ ] **Step 1: Install @anthropic-ai/sdk and csv-parse in the backend package**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/backend add @anthropic-ai/sdk csv-parse
```

Expected: `packages/backend/package.json` now lists both in `dependencies`.

- [ ] **Step 2: Add external packages to convex.json**

Modify `packages/backend/convex.json` by replacing its contents with:

```json
{
  "$schema": "./node_modules/convex/schemas/convex.schema.json",
  "node": {
    "externalPackages": [
      "langsmith", "@langchain/core", "openai", "minisearch",
      "linkedom", "turndown", "unpdf",
      "ai", "@ai-sdk/anthropic", "@ai-sdk/openai", "zod",
      "cohere-ai",
      "@anthropic-ai/sdk", "csv-parse"
    ]
  }
}
```

- [ ] **Step 3: Register the new WorkPool component**

Modify `packages/backend/convex/convex.config.ts`:

```typescript
import { defineApp } from "convex/server";
import workpool from "@convex-dev/workpool/convex.config";

const app = defineApp();
app.use(workpool, { name: "indexingPool" });
app.use(workpool, { name: "generationPool" });
app.use(workpool, { name: "experimentPool" });
app.use(workpool, { name: "scrapingPool" });
app.use(workpool, { name: "agentExperimentPool" });
app.use(workpool, { name: "livechatAnalysisPool" });

export default app;
```

- [ ] **Step 4: Verify backend typechecks**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm typecheck:backend
```

Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/package.json packages/backend/convex.json packages/backend/convex/convex.config.ts pnpm-lock.yaml
git commit -m "chore(backend): add anthropic-ai/sdk and csv-parse, register livechatAnalysisPool"
```

---

## Task 3: Schema — `livechatUploads` table

**Files:**
- Modify: `packages/backend/convex/schema.ts`

- [ ] **Step 1: Add the table definition**

Modify `packages/backend/convex/schema.ts`. Find a logical insertion point (e.g., right after the `generationJobs` table), and add:

```typescript
  // ── Livechat uploads ──
  livechatUploads: defineTable({
    // Ownership
    orgId: v.string(),
    createdBy: v.id("users"),

    // File identity
    filename: v.string(),
    csvStorageId: v.id("_storage"),

    // Overall pipeline status
    status: v.union(
      v.literal("pending"),
      v.literal("parsing"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),

    // AI microtopics status (independent of overall status)
    microtopicsStatus: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    microtopicsError: v.optional(v.string()),

    // Output blobs (optional until filled by the action)
    rawTranscriptsStorageId: v.optional(v.id("_storage")),
    microtopicsStorageId: v.optional(v.id("_storage")),

    // Inline metadata (small)
    conversationCount: v.optional(v.number()),
    basicStats: v.optional(v.any()),
    processedConversations: v.optional(v.number()),
    failedConversationCount: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),

    // WorkPool tracking
    workIds: v.optional(v.array(v.string())),
  })
    .index("by_org", ["orgId"])
    .index("by_org_created", ["orgId", "createdAt"]),
```

- [ ] **Step 2: Verify backend typechecks**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm typecheck:backend
```

Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/schema.ts
git commit -m "feat(backend): add livechatUploads table to schema"
```

---

## Task 4: Backend orchestration — internal mutations

**Files:**
- Create: `packages/backend/convex/livechat/orchestration.ts`

- [ ] **Step 1: Create the file with imports and internal mutations**

Create `packages/backend/convex/livechat/orchestration.ts`:

```typescript
import { internalMutation, mutation, query } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import { Workpool, vOnCompleteArgs, type RunResult } from "@convex-dev/workpool";
import { getAuthContext } from "../lib/auth";
import { Id } from "../_generated/dataModel";

// ─── WorkPool Instance ───
// Low parallelism because the pipeline action is long-running (minutes)
// and the Anthropic API has strict rate limits. We don't auto-retry because
// microtopic extraction burns API credits on every attempt — if it fails,
// the user can delete and re-upload.
const pool = new Workpool(components.livechatAnalysisPool, {
  maxParallelism: 2,
  retryActionsByDefault: false,
});

// ─── Internal mutations (called from the action) ───

export const markParsing = internalMutation({
  args: { uploadId: v.id("livechatUploads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, {
      status: "parsing",
      startedAt: Date.now(),
    });
  },
});

export const markReady = internalMutation({
  args: {
    uploadId: v.id("livechatUploads"),
    basicStats: v.any(),
    rawTranscriptsStorageId: v.id("_storage"),
    conversationCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, {
      status: "ready",
      basicStats: args.basicStats,
      rawTranscriptsStorageId: args.rawTranscriptsStorageId,
      conversationCount: args.conversationCount,
    });
  },
});

export const markFailed = internalMutation({
  args: {
    uploadId: v.id("livechatUploads"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, {
      status: "failed",
      error: args.error,
      completedAt: Date.now(),
    });
  },
});

export const markMicrotopicsRunning = internalMutation({
  args: { uploadId: v.id("livechatUploads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, {
      microtopicsStatus: "running",
    });
  },
});

export const markMicrotopicsReady = internalMutation({
  args: {
    uploadId: v.id("livechatUploads"),
    microtopicsStorageId: v.id("_storage"),
    processedConversations: v.number(),
    failedConversationCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, {
      microtopicsStatus: "ready",
      microtopicsStorageId: args.microtopicsStorageId,
      processedConversations: args.processedConversations,
      failedConversationCount: args.failedConversationCount,
      completedAt: Date.now(),
    });
  },
});

export const markMicrotopicsFailed = internalMutation({
  args: {
    uploadId: v.id("livechatUploads"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, {
      microtopicsStatus: "failed",
      microtopicsError: args.error,
      completedAt: Date.now(),
    });
  },
});
```

- [ ] **Step 2: Verify backend typechecks**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm typecheck:backend
```

Expected: No TypeScript errors. The file exports internal mutations and the workpool instance; the public functions will be added in Task 5.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/livechat/orchestration.ts
git commit -m "feat(backend): add livechat internal mutations for pipeline status transitions"
```

---

## Task 5: Backend orchestration — public mutations and queries

**Files:**
- Modify: `packages/backend/convex/livechat/orchestration.ts`

- [ ] **Step 1: Append public functions and the onComplete callback**

Append to `packages/backend/convex/livechat/orchestration.ts` (below the existing internal mutations from Task 4):

```typescript
// ─── Public mutations ───

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getAuthContext(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    filename: v.string(),
    csvStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", userId))
      .unique();
    if (!user) throw new Error("User not found");

    const uploadId = await ctx.db.insert("livechatUploads", {
      orgId,
      createdBy: user._id,
      filename: args.filename,
      csvStorageId: args.csvStorageId,
      status: "pending",
      microtopicsStatus: "pending",
      createdAt: Date.now(),
    });

    // Enqueue the analysis pipeline
    const workId = await pool.enqueueAction(
      ctx,
      internal.livechat.actions.runAnalysisPipeline,
      {
        uploadId,
        csvStorageId: args.csvStorageId,
      },
      {
        context: { uploadId },
        onComplete: internal.livechat.orchestration.onAnalysisComplete,
      },
    );

    await ctx.db.patch(uploadId, { workIds: [workId as string] });

    return { uploadId };
  },
});

export const remove = mutation({
  args: { id: v.id("livechatUploads") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) {
      throw new Error("Upload not found");
    }

    // Reject if busy
    const busy =
      row.status === "pending" ||
      row.status === "parsing" ||
      row.microtopicsStatus === "running";
    if (busy) {
      throw new Error("Cannot delete upload while analysis is in progress");
    }

    await ctx.storage.delete(row.csvStorageId);
    if (row.rawTranscriptsStorageId != null) {
      await ctx.storage.delete(row.rawTranscriptsStorageId);
    }
    if (row.microtopicsStorageId != null) {
      await ctx.storage.delete(row.microtopicsStorageId);
    }
    await ctx.db.delete(row._id);

    return { ok: true };
  },
});

// ─── Public queries ───

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db
      .query("livechatUploads")
      .withIndex("by_org_created", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
    return rows;
  },
});

export const get = query({
  args: { id: v.id("livechatUploads") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) {
      return null;
    }
    return row;
  },
});

export const getDownloadUrl = query({
  args: {
    id: v.id("livechatUploads"),
    type: v.union(
      v.literal("rawTranscripts"),
      v.literal("microtopics"),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) {
      return null;
    }
    const storageId =
      args.type === "rawTranscripts"
        ? row.rawTranscriptsStorageId
        : row.microtopicsStorageId;
    if (!storageId) return null;
    return await ctx.storage.getUrl(storageId);
  },
});

// ─── WorkPool onComplete callback ───

export const onAnalysisComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      uploadId: v.id("livechatUploads"),
    }),
  ),
  handler: async (
    ctx,
    { context, result }: {
      workId: string;
      context: { uploadId: Id<"livechatUploads"> };
      result: RunResult;
    },
  ) => {
    // If the action crashed before writing any terminal status to the row,
    // patch it as failed here. If it already wrote a terminal status, this
    // callback is a no-op.
    const row = await ctx.db.get(context.uploadId);
    if (!row) return;

    const alreadyTerminal =
      row.status === "ready" ||
      row.status === "failed" ||
      row.microtopicsStatus === "ready" ||
      row.microtopicsStatus === "failed";

    if (alreadyTerminal) return;

    if (result.kind === "failed") {
      await ctx.db.patch(context.uploadId, {
        status: "failed",
        error: result.error ?? "Analysis action crashed without writing status",
        completedAt: Date.now(),
      });
    } else if (result.kind === "canceled") {
      await ctx.db.patch(context.uploadId, {
        status: "failed",
        error: "Analysis was canceled",
        completedAt: Date.now(),
      });
    }
  },
});
```

- [ ] **Step 2: Skip typecheck for now**

Do **not** run `pnpm typecheck:backend` at this point. The file references `internal.livechat.actions.runAnalysisPipeline`, which Convex generates from `_generated/api.d.ts` — and the actions file doesn't exist yet. Typecheck will fail until Task 6 creates it. This is expected.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/livechat/orchestration.ts
git commit -m "feat(backend): add livechat public mutations/queries and onComplete callback"
```

---

## Task 6: Backend action — `runAnalysisPipeline`

**Files:**
- Create: `packages/backend/convex/livechat/actions.ts`

- [ ] **Step 1: Create the action file**

Create `packages/backend/convex/livechat/actions.ts`:

```typescript
"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  parseCSVFromString,
  parseTranscript,
  computeBasicStats,
  extractMicrotopics,
  createClaudeClient,
  type RawConversation,
  type RawTranscriptsFile,
} from "rag-evaluation-system/data-analysis";

export const runAnalysisPipeline = internalAction({
  args: {
    uploadId: v.id("livechatUploads"),
    csvStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    // ── Phase 1: Parsing + stats ──
    try {
      await ctx.runMutation(internal.livechat.orchestration.markParsing, {
        uploadId: args.uploadId,
      });

      // Fetch CSV from storage
      const blob = await ctx.storage.get(args.csvStorageId);
      if (!blob) {
        throw new Error("CSV blob not found in storage");
      }
      const csvText = await blob.text();

      // First pass: compute basic stats
      const stats = await computeBasicStats(parseCSVFromString(csvText));

      // Second pass: build RawConversation[]
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
            messageCountVisitor: parseInt(
              row["Number of messages sent by the visitor"] || "0",
              10,
            ),
            messageCountAgent: parseInt(
              row["Number of messages sent by the agent"] || "0",
              10,
            ),
            totalDurationSeconds: parseInt(
              row["Total Conversation duration in Seconds"] || "0",
              10,
            ),
            startDate: row["Start Date"] || "",
            startTime: row["Start Time"] || "",
            replyDate: row["Reply Date"] || "",
            replyTime: row["Reply Time"] || "",
            lastActivityDate: row["Last Activity Date"] || "",
            lastActivityTime: row["Last Activity Time"] || "",
          },
        });
      }

      const rawFile: RawTranscriptsFile = {
        source: "",
        generatedAt: new Date().toISOString(),
        totalConversations: conversations.length,
        conversations,
      };

      // Upload rawTranscripts.json to storage
      const rawBlob = new Blob([JSON.stringify(rawFile)], {
        type: "application/json",
      });
      const rawTranscriptsStorageId = await ctx.storage.store(rawBlob);

      // Fill basicStats.source in-place before saving to row
      stats.source = "";

      await ctx.runMutation(internal.livechat.orchestration.markReady, {
        uploadId: args.uploadId,
        basicStats: stats,
        rawTranscriptsStorageId,
        conversationCount: conversations.length,
      });

      // ── Phase 2: Microtopics ──
      try {
        await ctx.runMutation(
          internal.livechat.orchestration.markMicrotopicsRunning,
          { uploadId: args.uploadId },
        );

        const client = createClaudeClient();
        const microFile = await extractMicrotopics(conversations, {
          claudeClient: client,
          source: "",
          concurrency: 10,
        });

        const microBlob = new Blob([JSON.stringify(microFile)], {
          type: "application/json",
        });
        const microtopicsStorageId = await ctx.storage.store(microBlob);

        await ctx.runMutation(
          internal.livechat.orchestration.markMicrotopicsReady,
          {
            uploadId: args.uploadId,
            microtopicsStorageId,
            processedConversations: microFile.processedConversations,
            failedConversationCount: microFile.failures.length,
          },
        );
      } catch (mtErr: unknown) {
        const message =
          mtErr instanceof Error ? mtErr.message : "Unknown microtopics error";
        await ctx.runMutation(
          internal.livechat.orchestration.markMicrotopicsFailed,
          { uploadId: args.uploadId, error: message },
        );
      }
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

- [ ] **Step 2: Verify backend typechecks**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm typecheck:backend
```

Expected: No TypeScript errors. If `rag-evaluation-system/data-analysis` can't be resolved, rerun `pnpm build` at the repo root first to ensure the eval-lib dist is up to date (Task 1 already rebuilt, but worktree drift is possible).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/convex/livechat/actions.ts
git commit -m "feat(backend): add livechat runAnalysisPipeline action"
```

---

## Task 7: Backend tests — orchestration

**Files:**
- Modify: `packages/backend/tests/helpers.ts`
- Create: `packages/backend/tests/livechat.test.ts`

- [ ] **Step 1: Register the new WorkPool in test helpers**

Modify `packages/backend/tests/helpers.ts` — in the `setupTest` function, add a registration for `livechatAnalysisPool` immediately after the `scrapingPool` registration:

```typescript
  workpoolTest.register(t, "scrapingPool");
  workpoolTest.register(t, "livechatAnalysisPool");
```

Do not touch the other registrations even if they seem incomplete (e.g., `agentExperimentPool` may or may not be registered — that's outside the scope of this task).

- [ ] **Step 2: Create the integration test file**

Create `packages/backend/tests/livechat.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setupTest, seedUser, testIdentity, TEST_ORG_ID } from "./helpers";

describe("livechat orchestration", () => {
  it("generateUploadUrl requires auth", async () => {
    const t = setupTest();
    await expect(
      t.mutation(api.livechat.orchestration.generateUploadUrl, {}),
    ).rejects.toThrow(/Unauthenticated/);
  });

  it("create inserts a row with pending status", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    // Stub a storageId by storing an empty blob
    const csvStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["a,b\n1,2\n"]));
    });

    const { uploadId } = await asUser.mutation(
      api.livechat.orchestration.create,
      { filename: "test.csv", csvStorageId },
    );

    const row = await t.run(async (ctx) => ctx.db.get(uploadId));
    expect(row).not.toBeNull();
    expect(row?.orgId).toBe(TEST_ORG_ID);
    expect(row?.status).toBe("pending");
    expect(row?.microtopicsStatus).toBe("pending");
    expect(row?.filename).toBe("test.csv");
  });

  it("list returns only rows for the caller's org", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    // Insert a row for our org and one for another org
    const ourStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["a\n1\n"])),
    );
    const otherStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["a\n1\n"])),
    );

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    await t.run(async (ctx) => {
      await ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "ours.csv",
        csvStorageId: ourStorageId,
        status: "ready",
        microtopicsStatus: "ready",
        createdAt: Date.now(),
      });
      await ctx.db.insert("livechatUploads", {
        orgId: "org_other",
        createdBy: userId,
        filename: "theirs.csv",
        csvStorageId: otherStorageId,
        status: "ready",
        microtopicsStatus: "ready",
        createdAt: Date.now(),
      });
    });

    const rows = await asUser.query(api.livechat.orchestration.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBe("ours.csv");
  });

  it("get returns null for cross-org rows", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["a\n1\n"])),
    );

    const otherUploadId = await t.run(async (ctx) =>
      ctx.db.insert("livechatUploads", {
        orgId: "org_other",
        createdBy: userId,
        filename: "other.csv",
        csvStorageId: storageId,
        status: "ready",
        microtopicsStatus: "ready",
        createdAt: Date.now(),
      }),
    );

    const result = await asUser.query(api.livechat.orchestration.get, {
      id: otherUploadId,
    });
    expect(result).toBeNull();
  });

  it("remove deletes storage blobs and the row", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv data"])),
    );
    const rawStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["raw json"])),
    );

    const uploadId = await t.run(async (ctx) =>
      ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "test.csv",
        csvStorageId,
        rawTranscriptsStorageId: rawStorageId,
        status: "ready",
        microtopicsStatus: "ready",
        createdAt: Date.now(),
      }),
    );

    await asUser.mutation(api.livechat.orchestration.remove, { id: uploadId });

    const row = await t.run(async (ctx) => ctx.db.get(uploadId));
    expect(row).toBeNull();
  });

  it("remove throws while parsing is in progress", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv data"])),
    );

    const uploadId = await t.run(async (ctx) =>
      ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "test.csv",
        csvStorageId,
        status: "parsing",
        microtopicsStatus: "pending",
        createdAt: Date.now(),
        startedAt: Date.now(),
      }),
    );

    await expect(
      asUser.mutation(api.livechat.orchestration.remove, { id: uploadId }),
    ).rejects.toThrow(/analysis is in progress/);
  });

  it("getDownloadUrl returns null when blob is absent", async () => {
    const t = setupTest();
    await seedUser(t);
    const asUser = t.withIdentity(testIdentity);

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );

    const uploadId = await t.run(async (ctx) =>
      ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "test.csv",
        csvStorageId,
        status: "failed",
        microtopicsStatus: "pending",
        createdAt: Date.now(),
      }),
    );

    const url = await asUser.query(api.livechat.orchestration.getDownloadUrl, {
      id: uploadId,
      type: "rawTranscripts",
    });
    expect(url).toBeNull();
  });

  it("markReady internal mutation patches the row correctly", async () => {
    const t = setupTest();
    await seedUser(t);

    const userId = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", testIdentity.subject))
        .unique()
        .then((u) => u!._id),
    );

    const csvStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["csv"])),
    );
    const rawStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["raw"])),
    );

    const uploadId = await t.run(async (ctx) =>
      ctx.db.insert("livechatUploads", {
        orgId: TEST_ORG_ID,
        createdBy: userId,
        filename: "test.csv",
        csvStorageId,
        status: "parsing",
        microtopicsStatus: "pending",
        createdAt: Date.now(),
      }),
    );

    await t.mutation(internal.livechat.orchestration.markReady, {
      uploadId,
      basicStats: { totalConversations: 5 },
      rawTranscriptsStorageId: rawStorageId,
      conversationCount: 5,
    });

    const row = await t.run(async (ctx) => ctx.db.get(uploadId));
    expect(row?.status).toBe("ready");
    expect(row?.conversationCount).toBe(5);
    expect(row?.rawTranscriptsStorageId).toBe(rawStorageId);
  });
});
```

- [ ] **Step 3: Run backend tests**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/backend test -- tests/livechat.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/tests/helpers.ts packages/backend/tests/livechat.test.ts
git commit -m "test(backend): add livechat orchestration integration tests"
```

---

## Task 8: Frontend — update types.ts

**Files:**
- Modify: `packages/frontend/src/components/livechat/types.ts`

- [ ] **Step 1: Replace the file contents**

Read the current file first, then replace with:

```typescript
import type {
  RawTranscriptsFile,
  MicrotopicsFile,
  BasicStats,
  MicrotopicType,
  Microtopic,
} from "rag-evaluation-system/data-analysis";

export type LivechatTab = "stats" | "transcripts" | "microtopics";

// Types mirrored from the Convex row so components don't need
// to import from the backend's _generated types.
export type UploadStatus = "pending" | "parsing" | "ready" | "failed";
export type MicrotopicsStatus =
  | "pending"
  | "running"
  | "ready"
  | "failed"
  | "skipped";

export interface LoadedData {
  basicStats: BasicStats | null;
  rawTranscripts: RawTranscriptsFile | null;
  microtopics: MicrotopicsFile | null;
}

export interface MicrotopicByTypeItem {
  conversationId: string;
  visitorName: string;
  agentName: string;
  language: string;
  microtopic: Microtopic;
}

export type MicrotopicsByType = Map<MicrotopicType, MicrotopicByTypeItem[]>;

export type {
  RawTranscriptsFile,
  MicrotopicsFile,
  BasicStats,
  MicrotopicType,
  Microtopic,
};
```

- [ ] **Step 2: Verify frontend typechecks (partial — other files will error until they're updated)**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/frontend exec tsc --noEmit 2>&1 | head -30
```

Expected: Errors only in `LivechatView.tsx` (references to the removed `UploadEntry` type). That's fine — Task 10 will fix them.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/livechat/types.ts
git commit -m "refactor(frontend): update livechat types.ts for Convex-backed data"
```

---

## Task 9: Frontend — update `MicrotopicsTab.tsx` status props

**Files:**
- Modify: `packages/frontend/src/components/livechat/MicrotopicsTab.tsx`

- [ ] **Step 1: Add status and error props**

Read the current file and modify the component signature + top of the body. Change the component declaration from:

```typescript
export function MicrotopicsTab({
  microtopicsData,
  rawData,
}: {
  microtopicsData: MicrotopicsFile | null;
  rawData: RawTranscriptsFile | null;
}) {
```

to:

```typescript
export function MicrotopicsTab({
  microtopicsData,
  rawData,
  microtopicsStatus,
  microtopicsError,
}: {
  microtopicsData: MicrotopicsFile | null;
  rawData: RawTranscriptsFile | null;
  microtopicsStatus: "pending" | "running" | "ready" | "failed" | "skipped";
  microtopicsError?: string;
}) {
```

- [ ] **Step 2: Add placeholder rendering before the existing "no data" branch**

Find the existing early return:

```typescript
  if (!microtopicsData || !rawData) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Select an upload to view microtopics
      </div>
    );
  }
```

Replace it with:

```typescript
  // Status-based placeholders take precedence over missing data.
  if (microtopicsStatus !== "ready") {
    let message = "";
    let showSpinner = false;
    let extra: React.ReactNode = null;

    if (microtopicsStatus === "pending") {
      message =
        "AI analysis queued. Waiting for stats and transcripts to finish first.";
    } else if (microtopicsStatus === "running") {
      message = "AI analysis in progress… this can take a few minutes.";
      showSpinner = true;
    } else if (microtopicsStatus === "failed") {
      message = `AI analysis failed${microtopicsError ? ": " + microtopicsError : ""}`;
      extra = (
        <button
          disabled
          title="Not yet implemented"
          className="mt-2 text-[10px] text-text-dim border border-border rounded px-2 py-0.5 cursor-not-allowed opacity-50"
        >
          Retry
        </button>
      );
    } else if (microtopicsStatus === "skipped") {
      message = "AI analysis not yet run";
      extra = (
        <button
          disabled
          title="Not yet implemented"
          className="mt-2 text-[10px] text-text-dim border border-border rounded px-2 py-0.5 cursor-not-allowed opacity-50"
        >
          Analyze now
        </button>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-full text-text-dim text-xs px-4 text-center">
        {showSpinner && (
          <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-2" />
        )}
        <div>{message}</div>
        {extra}
      </div>
    );
  }

  if (!microtopicsData || !rawData) {
    return (
      <div className="flex items-center justify-center h-full text-text-dim text-xs">
        Select an upload to view microtopics
      </div>
    );
  }
```

- [ ] **Step 3: Verify the file compiles in isolation**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/frontend exec tsc --noEmit 2>&1 | grep MicrotopicsTab
```

Expected: No errors in `MicrotopicsTab.tsx` itself. (LivechatView will still have errors from Task 8; those are fixed in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/livechat/MicrotopicsTab.tsx
git commit -m "feat(frontend): add microtopics status placeholder states to MicrotopicsTab"
```

---

## Task 10: Frontend — rewrite `LivechatView.tsx`

**Files:**
- Modify: `packages/frontend/src/components/livechat/LivechatView.tsx`

- [ ] **Step 1: Replace the file contents entirely**

Read the current file first for context, then replace its entire contents with:

```typescript
"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convex";
import type { Id } from "@convex/_generated/dataModel";
import { TabBar } from "./TabBar";
import { StatsTab } from "./StatsTab";
import { TranscriptsTab } from "./TranscriptsTab";
import { MicrotopicsTab } from "./MicrotopicsTab";
import type {
  LivechatTab,
  LoadedData,
  RawTranscriptsFile,
  MicrotopicsFile,
  BasicStats,
} from "./types";

function DeleteConfirmModal({
  filename,
  onConfirm,
  onCancel,
}: {
  filename: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-bg-elevated border border-border rounded-lg p-5 w-[400px] shadow-xl">
        <h3 className="text-sm font-semibold text-text mb-2">
          Delete upload?
        </h3>
        <p className="text-xs text-text-muted mb-1">
          This will permanently delete the uploaded CSV and all processed output
          files for:
        </p>
        <p className="text-xs text-accent mb-3 truncate">{filename}</p>
        <p className="text-xs text-text-dim mb-2">
          Type <span className="text-red-400 font-semibold">delete</span> to
          confirm.
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="delete"
          className="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm text-text focus:border-accent outline-none mb-3"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-text-muted hover:text-text border border-border rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmText !== "delete"}
            className="px-3 py-1.5 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export function LivechatView() {
  const [activeTab, setActiveTab] = useState<LivechatTab>("stats");
  const [selectedUploadId, setSelectedUploadId] =
    useState<Id<"livechatUploads"> | null>(null);
  const [deleteTargetId, setDeleteTargetId] =
    useState<Id<"livechatUploads"> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Large blob state — fetched lazily via signed URLs
  const [rawTranscriptsData, setRawTranscriptsData] =
    useState<RawTranscriptsFile | null>(null);
  const [microtopicsData, setMicrotopicsData] =
    useState<MicrotopicsFile | null>(null);
  const lastFetchedRawUrl = useRef<string | null>(null);
  const lastFetchedMicroUrl = useRef<string | null>(null);

  // Reactive Convex queries
  const uploads = useQuery(api.livechat.orchestration.list) ?? [];
  const selectedUpload = useQuery(
    api.livechat.orchestration.get,
    selectedUploadId ? { id: selectedUploadId } : "skip",
  );
  const rawTranscriptsUrl = useQuery(
    api.livechat.orchestration.getDownloadUrl,
    selectedUploadId && selectedUpload?.status === "ready"
      ? { id: selectedUploadId, type: "rawTranscripts" as const }
      : "skip",
  );
  const microtopicsUrl = useQuery(
    api.livechat.orchestration.getDownloadUrl,
    selectedUploadId && selectedUpload?.microtopicsStatus === "ready"
      ? { id: selectedUploadId, type: "microtopics" as const }
      : "skip",
  );

  // Mutations
  const generateUploadUrl = useMutation(
    api.livechat.orchestration.generateUploadUrl,
  );
  const createUpload = useMutation(api.livechat.orchestration.create);
  const removeUpload = useMutation(api.livechat.orchestration.remove);

  // Clear blob state when selection changes
  useEffect(() => {
    setRawTranscriptsData(null);
    setMicrotopicsData(null);
    lastFetchedRawUrl.current = null;
    lastFetchedMicroUrl.current = null;
  }, [selectedUploadId]);

  // Fetch raw transcripts JSON when URL is available
  useEffect(() => {
    if (!rawTranscriptsUrl) return;
    if (lastFetchedRawUrl.current === rawTranscriptsUrl) return;
    lastFetchedRawUrl.current = rawTranscriptsUrl;
    fetch(rawTranscriptsUrl)
      .then((r) => r.json())
      .then((data: RawTranscriptsFile) => setRawTranscriptsData(data))
      .catch((err) => {
        console.error("Failed to fetch raw transcripts:", err);
        lastFetchedRawUrl.current = null;
      });
  }, [rawTranscriptsUrl]);

  // Fetch microtopics JSON when URL is available
  useEffect(() => {
    if (!microtopicsUrl) return;
    if (lastFetchedMicroUrl.current === microtopicsUrl) return;
    lastFetchedMicroUrl.current = microtopicsUrl;
    fetch(microtopicsUrl)
      .then((r) => r.json())
      .then((data: MicrotopicsFile) => setMicrotopicsData(data))
      .catch((err) => {
        console.error("Failed to fetch microtopics:", err);
        lastFetchedMicroUrl.current = null;
      });
  }, [microtopicsUrl]);

  async function handleUpload(file: File) {
    try {
      const uploadUrl = await generateUploadUrl({});
      const postRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "text/csv" },
        body: file,
      });
      if (!postRes.ok) {
        throw new Error(`Upload failed with status ${postRes.status}`);
      }
      const { storageId } = (await postRes.json()) as { storageId: string };
      await createUpload({
        filename: file.name,
        csvStorageId: storageId as Id<"_storage">,
      });
    } catch (err) {
      console.error("Upload failed:", err);
    }
  }

  async function handleDelete(id: Id<"livechatUploads">) {
    try {
      await removeUpload({ id });
      if (selectedUploadId === id) {
        setSelectedUploadId(null);
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  const loadedData: LoadedData = {
    basicStats: (selectedUpload?.basicStats as BasicStats | undefined) ?? null,
    rawTranscripts: rawTranscriptsData,
    microtopics: microtopicsData,
  };

  const deleteTargetUpload = uploads.find((u) => u._id === deleteTargetId) ?? null;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Upload Sidebar */}
      <div className="w-[360px] border-r border-border flex flex-col bg-bg-elevated">
        <div className="p-3 border-b border-border">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs bg-accent text-bg-elevated rounded hover:bg-accent/90 transition-colors whitespace-nowrap"
          >
            + Upload CSV
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {uploads.length === 0 && (
            <div className="p-4 text-xs text-text-dim">
              No uploads yet. Upload a CSV file to get started.
            </div>
          )}
          {uploads.map((upload) => {
            const isBusy =
              upload.status === "pending" ||
              upload.status === "parsing" ||
              upload.microtopicsStatus === "running";
            return (
              <div
                key={upload._id}
                onClick={() => setSelectedUploadId(upload._id)}
                className={`group flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
                  selectedUploadId === upload._id
                    ? "bg-accent/10 border-l-2 border-l-accent"
                    : "hover:bg-bg-hover"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text truncate">
                    {upload.filename}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-text-dim mt-0.5">
                    {upload.conversationCount != null && (
                      <span>
                        {upload.conversationCount.toLocaleString()} convos
                      </span>
                    )}
                    <span
                      className={`px-1 py-0.5 rounded text-[9px] ${
                        upload.status === "ready"
                          ? "bg-accent/10 text-accent"
                          : upload.status === "failed"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-yellow-500/10 text-yellow-400"
                      }`}
                    >
                      {upload.status}
                    </span>
                    {upload.status === "ready" && (
                      <span
                        className={`px-1 py-0.5 rounded text-[9px] ${
                          upload.microtopicsStatus === "ready"
                            ? "bg-accent/10 text-accent"
                            : upload.microtopicsStatus === "failed"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-yellow-500/10 text-yellow-400"
                        }`}
                      >
                        mt:{upload.microtopicsStatus}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isBusy) setDeleteTargetId(upload._id);
                  }}
                  disabled={isBusy}
                  className={`opacity-0 group-hover:opacity-100 text-text-dim transition-all p-1 ${
                    isBusy
                      ? "cursor-not-allowed"
                      : "hover:text-red-400"
                  }`}
                  title={
                    isBusy
                      ? "Cannot delete while analysis is in progress"
                      : "Delete upload"
                  }
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="flex-1 overflow-hidden">
          {activeTab === "stats" && (
            <StatsTab stats={loadedData.basicStats} />
          )}
          {activeTab === "transcripts" && (
            <TranscriptsTab data={loadedData.rawTranscripts} />
          )}
          {activeTab === "microtopics" && (
            <MicrotopicsTab
              microtopicsData={loadedData.microtopics}
              rawData={loadedData.rawTranscripts}
              microtopicsStatus={
                selectedUpload?.microtopicsStatus ?? "pending"
              }
              microtopicsError={selectedUpload?.microtopicsError}
            />
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTargetId && deleteTargetUpload && (
        <DeleteConfirmModal
          filename={deleteTargetUpload.filename}
          onConfirm={() => {
            handleDelete(deleteTargetId);
            setDeleteTargetId(null);
          }}
          onCancel={() => setDeleteTargetId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend typechecks**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/frontend exec tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/livechat/LivechatView.tsx
git commit -m "refactor(frontend): rewrite LivechatView to use Convex hooks"
```

---

## Task 11: Delete old Next.js API routes

**Files:**
- Delete: `packages/frontend/src/app/api/livechat/upload/route.ts`
- Delete: `packages/frontend/src/app/api/livechat/manifest/route.ts`
- Delete: `packages/frontend/src/app/api/livechat/data/[id]/route.ts`

- [ ] **Step 1: Delete the three route files**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && \
  rm packages/frontend/src/app/api/livechat/upload/route.ts && \
  rm packages/frontend/src/app/api/livechat/manifest/route.ts && \
  rm packages/frontend/src/app/api/livechat/data/\[id\]/route.ts
```

- [ ] **Step 2: Delete the now-empty parent directories**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && \
  rmdir packages/frontend/src/app/api/livechat/upload && \
  rmdir packages/frontend/src/app/api/livechat/manifest && \
  rmdir packages/frontend/src/app/api/livechat/data/\[id\] && \
  rmdir packages/frontend/src/app/api/livechat/data && \
  rmdir packages/frontend/src/app/api/livechat
```

(Some of these may already be gone. `rmdir` will silently no-op on the missing ones; if it errors, ignore the error for missing directories and only care about the ones that actually had files.)

- [ ] **Step 3: Remove the now-obsolete `.gitignore` negation**

Read `.gitignore`, find the line:
```
!packages/frontend/src/app/api/livechat/data/
```
Delete that line. The negation was added to work around a collision with the `data/` blanket ignore, but the directory no longer exists.

- [ ] **Step 4: Verify frontend builds**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/frontend build
```

Expected: Build succeeds. None of the three deleted API routes should appear in the build output's route list.

- [ ] **Step 5: Commit**

```bash
git add -A packages/frontend/src/app/api/livechat .gitignore
git commit -m "refactor(frontend): remove filesystem-backed livechat API routes"
```

---

## Task 12: Final full-system verification

**Files:** None (verification only)

- [ ] **Step 1: Run all eval-lib tests**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/eval-lib test
```

Expected: All tests pass (including new `parseCSVFromString` tests).

- [ ] **Step 2: Run all backend tests**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm -C packages/backend test
```

Expected: All tests pass (including new `livechat.test.ts`).

- [ ] **Step 3: Typecheck backend**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm typecheck:backend
```

Expected: No errors.

- [ ] **Step 4: Build eval-lib and frontend**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm build && pnpm -C packages/frontend build
```

Expected: Both builds succeed.

- [ ] **Step 5: Deploy Convex schema to dev**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith/packages/backend && npx convex dev --once
```

Expected: Convex pushes the new `livechatUploads` table and the new `livechatAnalysisPool` component without errors.

If the push fails with a schema validation error on an unrelated table (e.g., stale fields in `generationJobs` / `documents` like the `currentDocName` / `priority` issue seen earlier), that is a pre-existing problem unrelated to this migration. Document it and move on — either clean up the stale docs via the Convex dashboard or let the user resolve it.

- [ ] **Step 6: Set ANTHROPIC_API_KEY in Convex dev deployment**

If not already set, add `ANTHROPIC_API_KEY` in the Convex dashboard env vars for the dev deployment. (This is a manual step — the user must do it in the browser.)

- [ ] **Step 7: Manual smoke test**

Start the dev servers:

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm dev:backend
```

In a second terminal:

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && pnpm dev
```

Then in the browser:

1. Navigate to the KB page, click the livechat icon in the rail.
2. Click "+ Upload CSV" and select a small CSV (e.g., the 100-conversation VFQ file).
3. Watch the sidebar: the row should appear with `status: pending` → `parsing` → `ready`. The `microtopicsStatus` badge should go from `pending` → `running` → `ready`.
4. Click the row. The Stats tab should populate immediately. The Transcripts tab should populate after the raw transcripts JSON downloads. The Microtopics tab should populate after the microtopics JSON downloads.
5. Try deleting the upload. The confirmation modal should appear; typing "delete" should confirm the delete and the row should disappear from the sidebar.
6. Upload another CSV, but before clicking: temporarily clear `ANTHROPIC_API_KEY` in the Convex dashboard. Upload the CSV and verify `status` ends at `ready` but `microtopicsStatus` ends at `failed`. The Microtopics tab should show an error message. Restore the env var afterwards.

- [ ] **Step 8: Final commit (no-op if tree is clean)**

```bash
cd /Users/vinit/Tars/Development/exp/cx-agent-evals/.claude/worktrees/smith && git status
```

If there are any uncommitted files from the smoke test (e.g., local config tweaks), leave them uncommitted. Otherwise no action needed.
