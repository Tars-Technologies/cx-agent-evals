import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
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

// ─── Internal mutations (parse pipeline) ───

export const markParsing = internalMutation({
  args: { uploadId: v.id("livechatUploads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, {
      status: "parsing",
      startedAt: Date.now(),
    });
  },
});

export const markParsingProgress = internalMutation({
  args: {
    uploadId: v.id("livechatUploads"),
    processed: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, {
      parsedConversations: args.processed,
    });
  },
});

export const markReady = internalMutation({
  args: {
    uploadId: v.id("livechatUploads"),
    basicStats: v.any(),
    conversationCount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadId, {
      status: "ready",
      basicStats: args.basicStats,
      conversationCount: args.conversationCount,
      completedAt: Date.now(),
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

// ─── Internal mutations (classify / translate) ───

export const patchClassificationStatus = internalMutation({
  args: {
    conversationId: v.id("livechatConversations"),
    status: v.union(
      v.literal("none"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    messageTypes: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      classificationStatus: args.status,
      ...(args.messageTypes !== undefined ? { messageTypes: args.messageTypes } : {}),
      ...(args.error !== undefined ? { classificationError: args.error } : {}),
    });
  },
});

export const patchTranslationStatus = internalMutation({
  args: {
    conversationId: v.id("livechatConversations"),
    status: v.union(
      v.literal("none"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
    ),
    translatedMessages: v.optional(
      v.array(
        v.object({
          id: v.number(),
          text: v.string(),
        }),
      ),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      translationStatus: args.status,
      ...(args.translatedMessages !== undefined
        ? { translatedMessages: args.translatedMessages }
        : {}),
      ...(args.error !== undefined ? { translationError: args.error } : {}),
    });
  },
});

export const deleteConversationBatch = internalMutation({
  args: {
    ids: v.array(v.id("livechatConversations")),
  },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
  },
});

// ─── Internal queries (needed by actions) ───

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

// ─── Internal mutation (cascade delete) ───

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
        onComplete: internal.livechat.orchestration.onParseComplete,
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

export const classifyBatch = mutation({
  args: {
    uploadId: v.id("livechatUploads"),
    conversationIds: v.array(v.id("livechatConversations")),
  },
  handler: async (ctx, args): Promise<{ workId: string }> => {
    const { orgId } = await getAuthContext(ctx);
    if (args.conversationIds.length > 100) {
      throw new Error("Cannot classify more than 100 conversations at once");
    }
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
    return { workId: workId as string };
  },
});

export const translateBatch = mutation({
  args: {
    uploadId: v.id("livechatUploads"),
    conversationIds: v.array(v.id("livechatConversations")),
  },
  handler: async (ctx, args): Promise<{ workId: string }> => {
    const { orgId } = await getAuthContext(ctx);
    if (args.conversationIds.length > 100) {
      throw new Error("Cannot translate more than 100 conversations at once");
    }
    for (const convId of args.conversationIds) {
      const conv = await ctx.db.get(convId);
      if (!conv || conv.uploadId !== args.uploadId || conv.orgId !== orgId) {
        throw new Error(`Conversation ${convId} not found or access denied`);
      }
    }
    const workId = await pool.enqueueAction(
      ctx,
      internal.livechat.actions.translateConversations,
      { conversationIds: args.conversationIds },
      {
        context: { conversationIds: args.conversationIds },
        onComplete: internal.livechat.orchestration.onTranslateComplete,
      },
    );
    return { workId: workId as string };
  },
});

export const classifySingle = mutation({
  args: { conversationId: v.id("livechatConversations") },
  handler: async (ctx, args): Promise<{ workId: string }> => {
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.orgId !== orgId) throw new Error("Conversation not found");
    const workId = await pool.enqueueAction(
      ctx,
      internal.livechat.actions.classifyConversations,
      { conversationIds: [args.conversationId] },
      {
        context: { conversationIds: [args.conversationId] },
        onComplete: internal.livechat.orchestration.onClassifyComplete,
      },
    );
    return { workId: workId as string };
  },
});

export const translateSingle = mutation({
  args: { conversationId: v.id("livechatConversations") },
  handler: async (ctx, args): Promise<{ workId: string }> => {
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.orgId !== orgId) throw new Error("Conversation not found");
    const workId = await pool.enqueueAction(
      ctx,
      internal.livechat.actions.translateConversations,
      { conversationIds: [args.conversationId] },
      {
        context: { conversationIds: [args.conversationId] },
        onComplete: internal.livechat.orchestration.onTranslateComplete,
      },
    );
    return { workId: workId as string };
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

export const listConversations = query({
  args: {
    uploadId: v.id("livechatUploads"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.orgId !== orgId)
      return { page: [], isDone: true, continueCursor: "" };

    return await ctx.db
      .query("livechatConversations")
      .withIndex("by_upload", (q) => q.eq("uploadId", args.uploadId))
      .paginate(args.paginationOpts);
  },
});

export const getConversation = query({
  args: { id: v.id("livechatConversations") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.orgId !== orgId) return null;
    return row;
  },
});

export const getClassificationCounts = query({
  args: { uploadId: v.id("livechatUploads") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.orgId !== orgId)
      return { total: 0, classified: 0, running: 0, failed: 0 };
    const all = await ctx.db
      .query("livechatConversations")
      .withIndex("by_upload", (q) => q.eq("uploadId", args.uploadId))
      .collect();
    return {
      total: all.length,
      classified: all.filter((c) => c.classificationStatus === "done").length,
      running: all.filter((c) => c.classificationStatus === "running").length,
      failed: all.filter((c) => c.classificationStatus === "failed").length,
    };
  },
});

export const listByMessageType = query({
  args: { uploadId: v.id("livechatUploads"), type: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.orgId !== orgId) return [];
    const classified = await ctx.db
      .query("livechatConversations")
      .withIndex("by_upload_classification", (q) =>
        q.eq("uploadId", args.uploadId).eq("classificationStatus", "done"),
      )
      .collect();
    return classified.filter(
      (c) =>
        Array.isArray(c.messageTypes) &&
        c.messageTypes.some((mt: any) => mt.type === args.type),
    );
  },
});

// ─── WorkPool onComplete callbacks ───

export const onParseComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      uploadId: v.id("livechatUploads"),
    }),
  ),
  handler: async (
    ctx,
    {
      context,
      result,
    }: {
      workId: string;
      context: { uploadId: Id<"livechatUploads"> };
      result: RunResult;
    },
  ) => {
    const row = await ctx.db.get(context.uploadId);
    if (!row) return;

    const alreadyTerminal = row.status === "ready" || row.status === "failed";
    if (alreadyTerminal) return;

    if (result.kind === "failed") {
      await ctx.db.patch(context.uploadId, {
        status: "failed",
        error: result.error ?? "Parse action crashed without writing status",
        completedAt: Date.now(),
      });
    } else if (result.kind === "canceled") {
      await ctx.db.patch(context.uploadId, {
        status: "failed",
        error: "Parse was canceled",
        completedAt: Date.now(),
      });
    }
  },
});

export const onClassifyComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      conversationIds: v.array(v.id("livechatConversations")),
    }),
  ),
  handler: async (
    ctx,
    {
      context,
      result,
    }: {
      workId: string;
      context: { conversationIds: Id<"livechatConversations">[] };
      result: RunResult;
    },
  ) => {
    if (result.kind === "success") return;

    // Action crashed — patch any conversations still in "running" to "failed"
    for (const convId of context.conversationIds) {
      const conv = await ctx.db.get(convId);
      if (conv && conv.classificationStatus === "running") {
        await ctx.db.patch(convId, {
          classificationStatus: "failed",
          classificationError:
            result.kind === "failed"
              ? (result.error ?? "Classification action crashed")
              : "Classification was canceled",
        });
      }
    }
  },
});

export const onTranslateComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      conversationIds: v.array(v.id("livechatConversations")),
    }),
  ),
  handler: async (
    ctx,
    {
      context,
      result,
    }: {
      workId: string;
      context: { conversationIds: Id<"livechatConversations">[] };
      result: RunResult;
    },
  ) => {
    if (result.kind === "success") return;

    // Action crashed — patch any conversations still in "running" to "failed"
    for (const convId of context.conversationIds) {
      const conv = await ctx.db.get(convId);
      if (conv && conv.translationStatus === "running") {
        await ctx.db.patch(convId, {
          translationStatus: "failed",
          translationError:
            result.kind === "failed"
              ? (result.error ?? "Translation action crashed")
              : "Translation was canceled",
        });
      }
    }
  },
});
