import {
  mutation,
  query,
  internalQuery,
  MutationCtx,
} from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext, lookupUser } from "../lib/auth";
import { Doc, Id } from "../_generated/dataModel";

const sourceValidator = v.union(
  v.object({
    kind: v.literal("conversation"),
    conversationId: v.id("conversations"),
  }),
  v.object({
    kind: v.literal("transcript"),
    transcriptId: v.id("livechatConversations"),
  }),
);

const ratingValidator = v.union(
  v.literal("great"),
  v.literal("good_enough"),
  v.literal("bad"),
  v.literal("pass"),
  v.literal("fail"),
);

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

type AnnotationSource =
  | { kind: "conversation"; conversationId: Doc<"conversations">["_id"] }
  | { kind: "transcript"; transcriptId: Doc<"livechatConversations">["_id"] };

type Hint =
  | { kind: "simulation"; simulationId: Id<"conversationSimulations"> }
  | { kind: "upload"; uploadId: Id<"livechatUploads"> }
  | { kind: "playground" }
  | { kind: "analysis"; errorAnalysisId: Id<"errorAnalyses"> };

async function queryAnnotationsBySource(
  ctx: any,
  source: AnnotationSource,
): Promise<Doc<"annotations">[]> {
  if (source.kind === "conversation") {
    return await ctx.db
      .query("annotations")
      .withIndex("by_conversation", (q: any) =>
        q.eq("source.conversationId", source.conversationId),
      )
      .collect();
  }
  return await ctx.db
    .query("annotations")
    .withIndex("by_transcript", (q: any) =>
      q.eq("source.transcriptId", source.transcriptId),
    )
    .collect();
}

// ─── Inline helpers (mirror of errorAnalysis/members.ts internal mutations). ───
// Convex mutations can't call internalMutation in the same transaction without
// losing transactionality, so we duplicate the logic here. The canonical source
// remains errorAnalysis/members.ts and is unit-tested.

async function resolveContainerInline(
  ctx: MutationCtx,
  orgId: string,
  agentId: Id<"agents">,
  hint: Hint,
): Promise<Id<"errorAnalyses">> {
  if (hint.kind === "analysis") return hint.errorAnalysisId;

  if (hint.kind === "simulation") {
    const existing = await ctx.db
      .query("errorAnalyses")
      .withIndex("by_agent_origin_simulation", (q) =>
        q.eq("agentId", agentId).eq("origin.simulationId", hint.simulationId),
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

  let name: string;
  if (hint.kind === "simulation") {
    name = "Simulation run";
  } else if (hint.kind === "upload") {
    const u = await ctx.db.get(hint.uploadId);
    name = u?.filename ?? "Upload";
  } else {
    name = "Playground conversations";
  }

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
}

async function addMemberInline(
  ctx: MutationCtx,
  orgId: string,
  errorAnalysisId: Id<"errorAnalyses">,
  source: AnnotationSource,
  addedVia: "annotation" | "import",
): Promise<Id<"errorAnalysisMembers">> {
  const existing =
    source.kind === "conversation"
      ? await ctx.db
          .query("errorAnalysisMembers")
          .withIndex("by_analysis_conversation", (q) =>
            q
              .eq("errorAnalysisId", errorAnalysisId)
              .eq("source.conversationId", source.conversationId),
          )
          .first()
      : await ctx.db
          .query("errorAnalysisMembers")
          .withIndex("by_analysis_transcript", (q) =>
            q
              .eq("errorAnalysisId", errorAnalysisId)
              .eq("source.transcriptId", source.transcriptId),
          )
          .first();
  if (existing) return existing._id;
  return await ctx.db.insert("errorAnalysisMembers", {
    orgId,
    errorAnalysisId,
    source,
    addedVia,
    addedAt: Date.now(),
  });
}

export const upsertWithAutoContainer = mutation({
  args: {
    agentId: v.id("agents"),
    source: sourceValidator,
    hint: hintValidator,
    rating: ratingValidator,
    comment: v.optional(v.string()),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx, userId);

    // Verify source row belongs to org
    if (args.source.kind === "conversation") {
      const conv = await ctx.db.get(args.source.conversationId);
      if (!conv || conv.orgId !== orgId) {
        throw new Error("Conversation not found");
      }
    } else {
      const tr = await ctx.db.get(args.source.transcriptId);
      if (!tr || tr.orgId !== orgId) {
        throw new Error("Transcript not found");
      }
    }

    // Resolve container + add membership idempotently
    const errorAnalysisId = await resolveContainerInline(
      ctx,
      orgId,
      args.agentId,
      args.hint as Hint,
    );
    await addMemberInline(
      ctx,
      orgId,
      errorAnalysisId,
      args.source as AnnotationSource,
      "annotation",
    );

    // Upsert annotation
    const existing = await queryAnnotationsBySource(
      ctx,
      args.source as AnnotationSource,
    );
    const mine = existing.find((a) => a.ratedBy === user._id);

    if (mine) {
      await ctx.db.patch(mine._id, {
        rating: args.rating,
        comment: args.comment,
        tags: args.tags,
        errorAnalysisId,
        updatedAt: Date.now(),
      });
      return mine._id;
    }

    return await ctx.db.insert("annotations", {
      orgId,
      errorAnalysisId,
      source: args.source,
      rating: args.rating,
      comment: args.comment,
      tags: args.tags,
      ratedBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("annotations") },
  handler: async (ctx, { id }) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx, userId);
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Annotation not found");
    if (row.ratedBy !== user._id) {
      throw new Error("Cannot remove someone else's annotation");
    }
    await ctx.db.delete(id);
  },
});

export const bySource = query({
  args: { source: sourceValidator },
  handler: async (ctx, { source }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await queryAnnotationsBySource(
      ctx,
      source as AnnotationSource,
    );
    return rows.filter((r) => r.orgId === orgId);
  },
});

export const allTagsForOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db
      .query("annotations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const tagSet = new Set<string>();
    for (const r of rows) for (const t of r.tags) tagSet.add(t);
    return Array.from(tagSet).sort();
  },
});

export const statsForSources = query({
  args: { sources: v.array(sourceValidator) },
  handler: async (ctx, { sources }) => {
    const { orgId } = await getAuthContext(ctx);
    let annotated = 0;
    let great = 0;
    let good_enough = 0;
    let bad = 0;
    let pass = 0;
    let fail = 0;
    for (const s of sources) {
      const rows = await queryAnnotationsBySource(ctx, s as AnnotationSource);
      for (const r of rows) {
        if (r.orgId !== orgId) continue;
        annotated++;
        if (r.rating === "great") great++;
        else if (r.rating === "good_enough") good_enough++;
        else if (r.rating === "bad") bad++;
        else if (r.rating === "pass") pass++;
        else if (r.rating === "fail") fail++;
      }
    }
    return {
      total: sources.length,
      annotated,
      great,
      good_enough,
      bad,
      pass,
      fail,
    };
  },
});

// ─── Internal (no auth, for use by actions) ───

export const bySourceInternal = internalQuery({
  args: { source: sourceValidator },
  handler: async (ctx, { source }) => {
    return await queryAnnotationsBySource(ctx, source as AnnotationSource);
  },
});

export const byAnalysisInternal = internalQuery({
  args: { errorAnalysisId: v.id("errorAnalyses") },
  handler: async (ctx, { errorAnalysisId }) => {
    return await ctx.db
      .query("annotations")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", errorAnalysisId))
      .collect();
  },
});

export const allForOrgInternal = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    return await ctx.db
      .query("annotations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
  },
});
