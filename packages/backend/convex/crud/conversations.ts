import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

export const create = mutation({
  args: {
    agentIds: v.array(v.id("agents")),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { agentIds, title }) => {
    const { orgId } = await getAuthContext(ctx);
    return ctx.db.insert("conversations", {
      orgId,
      agentIds,
      title,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const get = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(id);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }
    return conv;
  },
});

export const listMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }
    return ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .collect();
  },
});

export const getStreamDeltas = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found");
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(message.conversationId);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }
    return ctx.db
      .query("streamDeltas")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .order("asc")
      .collect();
  },
});

// Internal mutation for creating conversations from actions (no auth needed)
export const createInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentIds: v.array(v.id("agents")),
    title: v.optional(v.string()),
    source: v.optional(v.union(
      v.literal("playground"), v.literal("simulation"), v.literal("experiment"),
    )),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("conversations", {
      ...args,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

// Internal mutations used by the agent action
export const insertMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    order: v.number(),
    role: v.union(
      v.literal("system"),
      v.literal("user"),
      v.literal("assistant"),
      v.literal("tool_call"),
      v.literal("tool_result"),
    ),
    content: v.string(),
    agentId: v.optional(v.id("agents")),
    toolCall: v.optional(
      v.object({
        toolCallId: v.string(),
        toolName: v.string(),
        toolArgs: v.string(),
        retrieverId: v.optional(v.id("retrievers")),
      }),
    ),
    toolResult: v.optional(
      v.object({
        toolCallId: v.string(),
        toolName: v.string(),
        result: v.string(),
        retrieverId: v.optional(v.id("retrievers")),
      }),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("streaming"),
      v.literal("complete"),
      v.literal("error"),
    ),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("messages", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const updateMessage = internalMutation({
  args: {
    messageId: v.id("messages"),
    content: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("streaming"),
        v.literal("complete"),
        v.literal("error"),
      ),
    ),
    usage: v.optional(
      v.object({
        promptTokens: v.number(),
        completionTokens: v.number(),
      }),
    ),
  },
  handler: async (ctx, { messageId, ...patch }) => {
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) updates[key] = value;
    }
    await ctx.db.patch(messageId, updates);
  },
});

export const insertStreamDelta = internalMutation({
  args: {
    messageId: v.id("messages"),
    start: v.number(),
    end: v.number(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("streamDeltas", args);
  },
});

export const cleanupStreamDeltas = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const deltas = await ctx.db
      .query("streamDeltas")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .collect();
    for (const delta of deltas) {
      await ctx.db.delete(delta._id);
    }
  },
});

export const listMessagesInternal = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    return ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .collect();
  },
});
