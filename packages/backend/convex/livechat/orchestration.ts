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
