import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

// Sidebar list cap. The conversations sidebar shows most-recent first; older
// history is out of scope for this reactive query (guidelines.md: prefer bounded
// reads). Bump or switch to .paginate() if a "load more" affordance is added.
const CONVERSATION_LIST_LIMIT = 100;

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

export const listForOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(CONVERSATION_LIST_LIMIT);

    return Promise.all(
      conversations.map(async (conv) => {
        const agents = await Promise.all(
          conv.agentIds.map(async (id) => {
            const a = await ctx.db.get(id);
            return a ? { _id: a._id, name: a.name } : null;
          }),
        );
        const lastMessage = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) =>
            q.eq("conversationId", conv._id),
          )
          .order("desc")
          .first();
        return {
          _id: conv._id,
          title: conv.title,
          status: conv.status,
          source: conv.source,
          createdAt: conv.createdAt,
          agents: agents.filter((a): a is { _id: typeof conv.agentIds[number]; name: string } => a !== null),
          lastMessagePreview: lastMessage?.content?.slice(0, 120) ?? null,
          lastMessageAt: lastMessage?.createdAt ?? conv.createdAt,
        };
      }),
    );
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

export const countByAgentAndSource = query({
  args: {
    agentId: v.id("agents"),
    source: v.union(v.literal("playground"), v.literal("simulation")),
  },
  handler: async (ctx, { agentId, source }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.filter(
      (c) => c.source === source && c.agentIds.includes(agentId),
    ).length;
  },
});

export const listByAgentAndSource = query({
  args: {
    agentId: v.id("agents"),
    source: v.union(v.literal("playground"), v.literal("simulation")),
  },
  handler: async (ctx, { agentId, source }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.filter(
      (c) => c.source === source && c.agentIds.includes(agentId),
    );
  },
});

// Internal mutation for creating conversations from actions (no auth needed)
export const createInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentIds: v.array(v.id("agents")),
    title: v.optional(v.string()),
    source: v.optional(v.union(
      v.literal("playground"), v.literal("simulation"),
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
    usage: v.optional(
      v.object({
        promptTokens: v.number(),
        completionTokens: v.number(),
      }),
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
