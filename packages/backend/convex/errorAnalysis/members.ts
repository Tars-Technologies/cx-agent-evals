import { internalMutation, MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

const hintValidator = v.union(
  v.object({
    kind: v.literal("simulation"),
    simulationId: v.id("conversationSimulations"),
  }),
  v.object({
    kind: v.literal("upload"),
    uploadId: v.id("livechatUploads"),
  }),
  v.object({ kind: v.literal("playground") }),
  v.object({
    kind: v.literal("analysis"),
    errorAnalysisId: v.id("errorAnalyses"),
  }),
);

const memberSourceValidator = v.union(
  v.object({
    kind: v.literal("conversation"),
    conversationId: v.id("conversations"),
  }),
  v.object({
    kind: v.literal("transcript"),
    transcriptId: v.id("livechatConversations"),
  }),
);

export const resolveContainerInternal = internalMutation({
  args: {
    orgId: v.string(),
    agentId: v.id("agents"),
    hint: hintValidator,
  },
  handler: async (ctx, { orgId, agentId, hint }) => {
    if (hint.kind === "analysis") return hint.errorAnalysisId;

    if (hint.kind === "simulation") {
      const existing = await ctx.db
        .query("errorAnalyses")
        .withIndex("by_agent_origin_simulation", (q) =>
          q
            .eq("agentId", agentId)
            .eq("origin.simulationId", hint.simulationId),
        )
        .first();
      if (existing) return existing._id;
    } else if (hint.kind === "upload") {
      const existing = await ctx.db
        .query("errorAnalyses")
        .withIndex("by_agent_origin_upload", (q) =>
          q.eq("agentId", agentId).eq("origin.uploadId", hint.uploadId),
        )
        .first();
      if (existing) return existing._id;
    } else {
      const candidates = await ctx.db
        .query("errorAnalyses")
        .withIndex("by_agent", (q) => q.eq("agentId", agentId))
        .collect();
      const existing = candidates.find((c) => c.origin.kind === "playground");
      if (existing) return existing._id;
    }

    const name =
      hint.kind === "simulation"
        ? await defaultSimName(ctx, hint.simulationId)
        : hint.kind === "upload"
          ? await defaultUploadName(ctx, hint.uploadId)
          : "Playground conversations";

    return await ctx.db.insert("errorAnalyses", {
      orgId,
      agentId,
      name,
      origin:
        hint.kind === "simulation"
          ? { kind: "simulation", simulationId: hint.simulationId }
          : hint.kind === "upload"
            ? { kind: "upload", uploadId: hint.uploadId }
            : { kind: "playground" },
      createdAt: Date.now(),
    });
  },
});

async function defaultSimName(
  ctx: MutationCtx,
  _id: Id<"conversationSimulations">,
): Promise<string> {
  // conversationSimulations has no `name` field today; use a generic label.
  return "Simulation run";
}

async function defaultUploadName(
  ctx: MutationCtx,
  id: Id<"livechatUploads">,
): Promise<string> {
  const u = await ctx.db.get(id);
  return u?.filename ?? "Upload";
}

export const addMemberInternal = internalMutation({
  args: {
    orgId: v.string(),
    errorAnalysisId: v.id("errorAnalyses"),
    source: memberSourceValidator,
    addedVia: v.union(v.literal("annotation"), v.literal("import")),
  },
  handler: async (ctx, args) => {
    const existing =
      args.source.kind === "conversation"
        ? await ctx.db
            .query("errorAnalysisMembers")
            .withIndex("by_analysis_conversation", (q) =>
              q
                .eq("errorAnalysisId", args.errorAnalysisId)
                .eq(
                  "source.conversationId",
                  (args.source as { kind: "conversation"; conversationId: Id<"conversations"> })
                    .conversationId,
                ),
            )
            .first()
        : await ctx.db
            .query("errorAnalysisMembers")
            .withIndex("by_analysis_transcript", (q) =>
              q
                .eq("errorAnalysisId", args.errorAnalysisId)
                .eq(
                  "source.transcriptId",
                  (args.source as { kind: "transcript"; transcriptId: Id<"livechatConversations"> })
                    .transcriptId,
                ),
            )
            .first();
    if (existing) return existing._id;
    return await ctx.db.insert("errorAnalysisMembers", {
      orgId: args.orgId,
      errorAnalysisId: args.errorAnalysisId,
      source: args.source,
      addedVia: args.addedVia,
      addedAt: Date.now(),
    });
  },
});
