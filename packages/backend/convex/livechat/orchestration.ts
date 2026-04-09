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
