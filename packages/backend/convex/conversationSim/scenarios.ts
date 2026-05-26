import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

// ─── Shared validators ───

const personaValidator = v.object({
  type: v.string(),
  traits: v.array(v.string()),
  communicationStyle: v.string(),
  patienceLevel: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
  ),
});

const complexityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

const referenceMessagesArrayValidator = v.array(
  v.object({
    role: v.literal("user"),
    content: v.string(),
    turnIndex: v.number(),
  }),
);
const referenceMessagesValidator = v.optional(referenceMessagesArrayValidator);

const messageValidator = v.object({
  id: v.number(),
  role: v.union(
    v.literal("user"),
    v.literal("human_agent"),
    v.literal("workflow_input"),
  ),
  text: v.string(),
});

const referenceTranscriptValidator = v.optional(v.array(messageValidator));
const referenceExemplarsValidator = v.optional(
  v.array(
    v.object({
      sourceTranscriptId: v.id("livechatConversations"),
      messages: v.array(messageValidator),
    }),
  ),
);
const userMessageLengthStatsValidator = v.optional(
  v.object({
    median: v.number(),
    p90: v.number(),
  }),
);
const behaviorAnchorsValidator = v.optional(v.array(v.string()));
const languagesValidator = v.optional(v.array(v.string()));

const sourceValidator = v.union(
  v.object({ kind: v.literal("synthetic"), kbId: v.id("knowledgeBases") }),
  v.object({
    kind: v.literal("grounded"),
    transcriptUploadId: v.id("livechatUploads"),
  }),
  v.object({ kind: v.literal("manual") }),
);

const contentFields = {
  persona: personaValidator,
  topic: v.string(),
  intent: v.string(),
  complexity: complexityValidator,
  reasonForContact: v.string(),
  knownInfo: v.string(),
  unknownInfo: v.string(),
  instruction: v.string(),
  referenceMessages: referenceMessagesValidator,
  languages: languagesValidator,
  referenceTranscript: referenceTranscriptValidator,
  referenceExemplars: referenceExemplarsValidator,
  userMessageLengthStats: userMessageLengthStatsValidator,
  behaviorAnchors: behaviorAnchorsValidator,
};

// ─── Queries ───

export const get = query({
  args: { id: v.id("conversationScenarios") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const scenario = await ctx.db.get(id);
    if (!scenario || scenario.orgId !== orgId) {
      throw new Error("Scenario not found");
    }
    return scenario;
  },
});

// Like `get`, but returns null instead of throwing when the scenario is missing
// or belongs to a different org. Used by views that link to scenarios which may
// be deleted independently.
export const getMaybe = query({
  args: { id: v.id("conversationScenarios") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const scenario = await ctx.db.get(id);
    if (!scenario || scenario.orgId !== orgId) return null;
    return scenario;
  },
});

export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    return await ctx.db
      .query("conversationScenarios")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .collect();
  },
});

// Impact analysis: which scenarios depend on a given KB?
export const byKb = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, { kbId }) => {
    const { orgId } = await getAuthContext(ctx);
    const kb = await ctx.db.get(kbId);
    if (!kb || kb.orgId !== orgId) throw new Error("Knowledge base not found");
    return await ctx.db
      .query("conversationScenarios")
      .withIndex("by_kb", (q) => q.eq("source.kbId", kbId))
      .collect();
  },
});

// Impact analysis: which scenarios depend on a given transcript upload?
export const byTranscriptUpload = query({
  args: { transcriptUploadId: v.id("livechatUploads") },
  handler: async (ctx, { transcriptUploadId }) => {
    const { orgId } = await getAuthContext(ctx);
    const upload = await ctx.db.get(transcriptUploadId);
    if (!upload || upload.orgId !== orgId)
      throw new Error("Transcript upload not found");
    return await ctx.db
      .query("conversationScenarios")
      .withIndex("by_transcript_upload", (q) =>
        q.eq("source.transcriptUploadId", transcriptUploadId),
      )
      .collect();
  },
});

// ─── Mutations ───

export const create = mutation({
  args: {
    agentId: v.id("agents"),
    source: sourceValidator,
    ...contentFields,
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    return await ctx.db.insert("conversationScenarios", {
      orgId,
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("conversationScenarios"),
    persona: v.optional(personaValidator),
    topic: v.optional(v.string()),
    intent: v.optional(v.string()),
    complexity: v.optional(complexityValidator),
    reasonForContact: v.optional(v.string()),
    knownInfo: v.optional(v.string()),
    unknownInfo: v.optional(v.string()),
    instruction: v.optional(v.string()),
    referenceMessages: v.optional(referenceMessagesArrayValidator),
    languages: languagesValidator,
    referenceTranscript: referenceTranscriptValidator,
    referenceExemplars: referenceExemplarsValidator,
    userMessageLengthStats: userMessageLengthStatsValidator,
    behaviorAnchors: behaviorAnchorsValidator,
  },
  handler: async (ctx, { id, ...updates }) => {
    const { orgId } = await getAuthContext(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.orgId !== orgId) {
      throw new Error("Scenario not found");
    }
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    );
    await ctx.db.patch(id, filtered);
  },
});

export const remove = mutation({
  args: { id: v.id("conversationScenarios") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.orgId !== orgId) {
      throw new Error("Scenario not found");
    }
    await ctx.db.delete(id);
  },
});

// ─── Internal ───

export const getInternal = internalQuery({
  args: { id: v.id("conversationScenarios") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const createInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentId: v.id("agents"),
    source: sourceValidator,
    ...contentFields,
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversationScenarios", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
