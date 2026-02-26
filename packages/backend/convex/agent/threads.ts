import {
  mutation,
  query,
  internalQuery,
} from "../_generated/server";
import { internal, components } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";
import {
  createThread as agentCreateThread,
  listUIMessages,
  syncStreams,
  vStreamArgs,
  saveMessage,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";

// ─── Public mutations/queries ───

export const createThread = mutation({
  args: {
    title: v.optional(v.string()),
    kbConfigs: v.array(
      v.object({
        kbId: v.id("knowledgeBases"),
        retrieverConfig: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await getAuthContext(ctx);

    // Create thread in agent component
    const threadId = await agentCreateThread(ctx, components.agent, {
      userId,
      title: args.title ?? "New conversation",
    });

    // Store our custom config
    await ctx.db.insert("agentThreadConfigs", {
      threadId,
      orgId,
      userId,
      title: args.title ?? "New conversation",
      kbConfigs: args.kbConfigs,
      createdAt: Date.now(),
    });

    return { threadId };
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await getAuthContext(ctx); // Verify auth

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt: args.content,
    });

    // Schedule the streaming action
    await ctx.scheduler.runAfter(
      0,
      internal.agent.agentActions.streamResponse,
      {
        threadId: args.threadId,
        promptMessageId: messageId,
      },
    );

    return { messageId };
  },
});

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    await getAuthContext(ctx); // Verify auth
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });
    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    return { ...paginated, streams };
  },
});

export const listThreads = query({
  args: {},
  handler: async (ctx) => {
    const { userId, orgId } = await getAuthContext(ctx);

    return await ctx.db
      .query("agentThreadConfigs")
      .withIndex("by_user_org", (q) => q.eq("userId", userId).eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});

export const getThreadConfig = query({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    await getAuthContext(ctx);

    return await ctx.db
      .query("agentThreadConfigs")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .unique();
  },
});

// ─── Internal queries (used by agentActions) ───

export const getConfigByThread = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentThreadConfigs")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .unique();
  },
});

export const getKBInternal = internalQuery({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.kbId);
  },
});
