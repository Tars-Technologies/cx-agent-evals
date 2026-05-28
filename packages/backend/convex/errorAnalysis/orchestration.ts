import { mutation, query, MutationCtx, QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { getAuthContext } from "../lib/auth";

const sourcePoolValidator = v.union(
  v.object({ kind: v.literal("playground") }),
  v.object({
    kind: v.literal("simulation"),
    simulationId: v.id("conversationSimulations"),
  }),
  v.object({
    kind: v.literal("upload"),
    uploadId: v.id("livechatUploads"),
  }),
);

const sizeValidator = v.union(
  v.literal(10),
  v.literal(20),
  v.literal(50),
  v.literal(100),
  v.literal(200),
);

type SourcePool =
  | { kind: "playground" }
  | { kind: "simulation"; simulationId: Id<"conversationSimulations"> }
  | { kind: "upload"; uploadId: Id<"livechatUploads"> };

type MemberSource =
  | { kind: "conversation"; conversationId: Id<"conversations"> }
  | { kind: "transcript"; transcriptId: Id<"livechatConversations"> };

export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);
    const rows = await ctx.db
      .query("errorAnalyses")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .collect();
    const filtered = rows.filter((r) => r.orgId === orgId);

    // Fetch evaluators for this agent once (needed for judgeCount per analysis).
    const evaluators = await ctx.db
      .query("evaluators")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .collect();

    return await Promise.all(
      filtered.map(async (r) => {
        const members = await ctx.db
          .query("errorAnalysisMembers")
          .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", r._id))
          .collect();
        const annotatedCount = members.filter(
          (m) => m.addedVia === "annotation",
        ).length;
        const failureModes = await ctx.db
          .query("failureModes")
          .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", r._id))
          .collect();
        const judgeCount = evaluators.filter(
          (e) =>
            e.source.kind === "error_analysis" &&
            e.source.errorAnalysisId === r._id,
        ).length;
        return {
          ...r,
          memberCount: members.length,
          annotatedCount,
          failureModeCount: failureModes.length,
          judgeCount,
        };
      }),
    );
  },
});

export const get = query({
  args: { id: v.id("errorAnalyses") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const r = await ctx.db.get(id);
    if (!r || r.orgId !== orgId) return null;
    return r;
  },
});

export const createCustom = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    sourcePool: sourcePoolValidator,
    size: sizeValidator,
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");

    const now = Date.now();
    const id = await ctx.db.insert("errorAnalyses", {
      orgId,
      agentId: args.agentId,
      name: args.name,
      origin: { kind: "custom" },
      createdAt: now,
    });

    const sampled = await samplePool(
      ctx,
      orgId,
      args.agentId,
      args.sourcePool,
      args.size,
      new Set(),
    );
    for (const s of sampled) {
      await ctx.db.insert("errorAnalysisMembers", {
        orgId,
        errorAnalysisId: id,
        source: s,
        addedVia: "import",
        addedAt: Date.now(),
      });
    }
    return id;
  },
});

export const importMore = mutation({
  args: {
    errorAnalysisId: v.id("errorAnalyses"),
    sourcePool: sourcePoolValidator,
    size: sizeValidator,
  },
  handler: async (ctx, { errorAnalysisId, sourcePool, size }) => {
    const { orgId } = await getAuthContext(ctx);
    const a = await ctx.db.get(errorAnalysisId);
    if (!a || a.orgId !== orgId) throw new Error("Analysis not found");

    const existing = await ctx.db
      .query("errorAnalysisMembers")
      .withIndex("by_analysis", (q) =>
        q.eq("errorAnalysisId", errorAnalysisId),
      )
      .collect();
    const excludeSet = new Set<string>();
    for (const m of existing) {
      excludeSet.add(
        m.source.kind === "conversation"
          ? `c:${m.source.conversationId}`
          : `t:${m.source.transcriptId}`,
      );
    }

    const sampled = await samplePool(
      ctx,
      orgId,
      a.agentId,
      sourcePool,
      size,
      excludeSet,
    );
    for (const s of sampled) {
      await ctx.db.insert("errorAnalysisMembers", {
        orgId,
        errorAnalysisId,
        source: s,
        addedVia: "import",
        addedAt: Date.now(),
      });
    }
    return sampled.length;
  },
});

export const rename = mutation({
  args: { id: v.id("errorAnalyses"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const { orgId } = await getAuthContext(ctx);
    const r = await ctx.db.get(id);
    if (!r || r.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { name, updatedAt: Date.now() });
  },
});

export const deleteAnalysis = mutation({
  args: { id: v.id("errorAnalyses") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const r = await ctx.db.get(id);
    if (!r || r.orgId !== orgId) throw new Error("Not found");

    const members = await ctx.db
      .query("errorAnalysisMembers")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", id))
      .collect();
    for (const m of members) await ctx.db.delete(m._id);

    const anns = await ctx.db
      .query("annotations")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", id))
      .collect();
    for (const a of anns) await ctx.db.delete(a._id);

    const modes = await ctx.db
      .query("failureModes")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", id))
      .collect();
    for (const m of modes) {
      const mships = await ctx.db
        .query("failureModeMemberships")
        .withIndex("by_failure_mode", (q) => q.eq("failureModeId", m._id))
        .collect();
      for (const mm of mships) await ctx.db.delete(mm._id);
      await ctx.db.delete(m._id);
    }

    await ctx.db.delete(id);
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────
//
// Sample newest-first up to `size` items from the requested pool, excluding
// any items already represented in `exclude` (encoded as `c:<convId>` for
// conversation rows and `t:<transcriptId>` for livechat rows).
//
// Index notes (see schema.ts):
//   - `conversations` only has a `by_org` index; we filter in-memory by
//     `source` ("playground"/"simulation") and `agentIds.includes(agentId)`.
//     Acceptable for dev volumes; revisit when conversation counts grow.
//   - `conversationSimRuns.by_simulation` is used to find conversations for
//     a simulation pool.
//   - `livechatConversations.by_upload` is used for the upload pool.
async function samplePool(
  ctx: MutationCtx | QueryCtx,
  orgId: string,
  agentId: Id<"agents">,
  pool: SourcePool,
  size: number,
  exclude: Set<string>,
): Promise<MemberSource[]> {
  if (pool.kind === "playground") {
    const all = await ctx.db
      .query("conversations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const filtered = all
      .filter(
        (c) =>
          c.source === "playground" &&
          c.agentIds.includes(agentId) &&
          !exclude.has(`c:${c._id}`),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    return filtered.slice(0, size).map((c) => ({
      kind: "conversation" as const,
      conversationId: c._id,
    }));
  }

  if (pool.kind === "simulation") {
    const runs = await ctx.db
      .query("conversationSimRuns")
      .withIndex("by_simulation", (q) =>
        q.eq("simulationId", pool.simulationId),
      )
      .collect();
    // Hydrate the underlying conversation rows so we can sort by createdAt.
    const convs: Array<{ id: Id<"conversations">; createdAt: number }> = [];
    for (const run of runs) {
      if (!run.conversationId) continue;
      if (exclude.has(`c:${run.conversationId}`)) continue;
      const c = await ctx.db.get(run.conversationId);
      if (!c) continue;
      if (c.orgId !== orgId) continue;
      convs.push({ id: c._id, createdAt: c.createdAt });
    }
    convs.sort((a, b) => b.createdAt - a.createdAt);
    return convs.slice(0, size).map((c) => ({
      kind: "conversation" as const,
      conversationId: c.id,
    }));
  }

  // upload
  const rows = await ctx.db
    .query("livechatConversations")
    .withIndex("by_upload", (q) => q.eq("uploadId", pool.uploadId))
    .collect();
  const filtered = rows
    .filter((r) => r.orgId === orgId && !exclude.has(`t:${r._id}`))
    .sort((a, b) => b._creationTime - a._creationTime);
  return filtered.slice(0, size).map((r) => ({
    kind: "transcript" as const,
    transcriptId: r._id,
  }));
}
