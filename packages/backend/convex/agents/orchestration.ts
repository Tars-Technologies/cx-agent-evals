import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

/**
 * Sends a user message and triggers agent execution.
 * Returns the pending assistant message ID for stream subscription.
 */
export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    agentId: v.id("agents"),
    content: v.string(),
  },
  handler: async (ctx, { conversationId, agentId, content }) => {
    const { orgId } = await getAuthContext(ctx);

    // Verify conversation belongs to org
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }

    // Verify agent belongs to org
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }

    // Get next order number
    const lastMessage = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .first();
    const nextOrder = lastMessage ? lastMessage.order + 1 : 0;

    // Insert user message
    await ctx.db.insert("messages", {
      conversationId,
      order: nextOrder,
      role: "user",
      content,
      status: "complete",
      createdAt: Date.now(),
    });

    // Create pending assistant message
    const assistantMessageId = await ctx.db.insert("messages", {
      conversationId,
      order: nextOrder + 1,
      role: "assistant",
      content: "",
      agentId,
      status: "streaming",
      createdAt: Date.now(),
    });

    // Schedule agent action
    await ctx.scheduler.runAfter(0, internal.agents.actions.runAgent, {
      conversationId,
      agentId,
      assistantMessageId,
    });

    return assistantMessageId;
  },
});

/**
 * Gets or creates a playground conversation for an agent.
 * The playground is a single active conversation per agent.
 */
export const getOrCreatePlayground = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);

    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }

    // Look for existing active playground conversation for this agent.
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    const playground = existing.find(
      (c) => c.agentIds.length === 1 && c.agentIds[0] === agentId && (!c.source || c.source === "playground"),
    );

    if (playground) return playground._id;

    // Create new playground conversation
    return ctx.db.insert("conversations", {
      orgId,
      agentIds: [agentId],
      title: `${agent.name} Playground`,
      status: "active",
      createdAt: Date.now(),
    });
  },
});

/**
 * Triggers URL context extraction for an agent.
 * Public mutation that schedules the internal action.
 */
export const triggerUrlExtraction = mutation({
  args: {
    agentId: v.id("agents"),
    url: v.string(),
  },
  handler: async (ctx, { agentId, url }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) {
      throw new Error("Agent not found");
    }
    await ctx.scheduler.runAfter(0, internal.agents.actions.extractUrlContext, {
      agentId,
      url,
    });
  },
});

/**
 * Clears a playground conversation by archiving it.
 * Next getOrCreatePlayground call will create a fresh one.
 */
export const clearPlayground = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const { orgId } = await getAuthContext(ctx);
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== orgId) {
      throw new Error("Conversation not found");
    }
    await ctx.db.patch(conversationId, { status: "archived" });
  },
});
