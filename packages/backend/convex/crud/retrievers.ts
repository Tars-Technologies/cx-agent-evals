import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

// ─── Queries ───

export const byKb = query({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const kb = await ctx.db.get(args.kbId);
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found");
    }

    return await ctx.db
      .query("retrievers")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .order("desc")
      .collect();
  },
});

export const byOrg = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("configuring"),
        v.literal("indexing"),
        v.literal("ready"),
        v.literal("error"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const all = await ctx.db
      .query("retrievers")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();

    if (args.status) {
      return all.filter((r) => r.status === args.status);
    }
    return all;
  },
});

export const get = query({
  args: { id: v.id("retrievers") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const retriever = await ctx.db.get(args.id);
    if (!retriever || retriever.orgId !== orgId) {
      throw new Error("Retriever not found");
    }
    return retriever;
  },
});

// ─── Internal Queries/Mutations ───

export const getInternal = internalQuery({
  args: { id: v.id("retrievers") },
  handler: async (ctx, args) => {
    const retriever = await ctx.db.get(args.id);
    if (!retriever) throw new Error("Retriever not found");
    return retriever;
  },
});

/**
 * Insert a new retriever record. Called from the "use node" create action
 * after hash computation.
 */
export const insertRetriever = internalMutation({
  args: {
    orgId: v.string(),
    kbId: v.id("knowledgeBases"),
    name: v.string(),
    retrieverConfig: v.any(),
    indexConfigHash: v.string(),
    retrieverConfigHash: v.string(),
    defaultK: v.number(),
    indexingJobId: v.optional(v.id("indexingJobs")),
    status: v.union(
      v.literal("configuring"),
      v.literal("indexing"),
      v.literal("ready"),
      v.literal("error"),
    ),
    chunkCount: v.optional(v.number()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("retrievers", {
      orgId: args.orgId,
      kbId: args.kbId,
      name: args.name,
      retrieverConfig: args.retrieverConfig,
      indexConfigHash: args.indexConfigHash,
      retrieverConfigHash: args.retrieverConfigHash,
      defaultK: args.defaultK,
      indexingJobId: args.indexingJobId,
      status: args.status,
      chunkCount: args.chunkCount,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
  },
});

/**
 * Update retriever with indexing job info. Called from startIndexing action.
 */
export const updateIndexingStatus = internalMutation({
  args: {
    retrieverId: v.id("retrievers"),
    indexingJobId: v.id("indexingJobs"),
    status: v.union(
      v.literal("configuring"),
      v.literal("indexing"),
      v.literal("ready"),
      v.literal("error"),
    ),
    chunkCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.retrieverId, {
      indexingJobId: args.indexingJobId,
      status: args.status,
      chunkCount: args.chunkCount,
      error: undefined,
    });
  },
});

/**
 * Check for existing retriever by (kbId, retrieverConfigHash) for dedup.
 */
export const findByConfigHash = internalQuery({
  args: {
    kbId: v.id("knowledgeBases"),
    retrieverConfigHash: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("retrievers")
      .withIndex("by_kb_config_hash", (q) =>
        q
          .eq("kbId", args.kbId)
          .eq("retrieverConfigHash", args.retrieverConfigHash),
      )
      .first();
  },
});

// ─── Mutations ───

export const remove = mutation({
  args: { id: v.id("retrievers") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const retriever = await ctx.db.get(args.id);
    if (!retriever || retriever.orgId !== orgId) {
      throw new Error("Retriever not found");
    }

    // Cascade: delete index if it exists and no other retriever shares it
    if (retriever.indexingJobId && (retriever.status === "ready" || retriever.status === "indexing")) {
      const allForKb = await ctx.db
        .query("retrievers")
        .withIndex("by_kb", (q) => q.eq("kbId", retriever.kbId))
        .collect();

      const sharingChunks = allForKb.filter(
        (r) =>
          r._id !== args.id &&
          r.indexConfigHash === retriever.indexConfigHash,
      );

      // Only cleanup if no other retriever shares this index
      if (sharingChunks.length === 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.retrieval.indexingActions.cleanupAction,
          {
            kbId: retriever.kbId,
            indexConfigHash: retriever.indexConfigHash,
            jobId: retriever.indexingJobId,
          },
        );
      }
    }

    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});

/**
 * Reset retriever status after indexing is canceled.
 * Called from frontend after indexing.cancelIndexing completes.
 */
export const resetAfterCancel = mutation({
  args: { id: v.id("retrievers") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const retriever = await ctx.db.get(args.id);
    if (!retriever || retriever.orgId !== orgId) {
      throw new Error("Retriever not found");
    }

    await ctx.db.patch(args.id, {
      status: "configuring",
      indexingJobId: undefined,
      chunkCount: undefined,
      error: undefined,
    });

    return { reset: true };
  },
});

/**
 * Delete only the index (chunks) for a retriever, resetting it to "configuring".
 * Preserves the retriever record itself.
 */
export const deleteIndex = mutation({
  args: { id: v.id("retrievers") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const retriever = await ctx.db.get(args.id);
    if (!retriever || retriever.orgId !== orgId) {
      throw new Error("Retriever not found");
    }

    if (retriever.status !== "ready" && retriever.status !== "error") {
      throw new Error(`Cannot delete index: retriever is ${retriever.status}`);
    }

    // Check if another retriever shares the same (kbId, indexConfigHash)
    const allForKb = await ctx.db
      .query("retrievers")
      .withIndex("by_kb", (q) => q.eq("kbId", retriever.kbId))
      .collect();

    const sharingChunks = allForKb.filter(
      (r) =>
        r._id !== args.id &&
        r.indexConfigHash === retriever.indexConfigHash,
    );

    if (sharingChunks.length > 0) {
      throw new Error(
        `Cannot delete index: ${sharingChunks.length} other retriever(s) share the same index. Delete them first.`,
      );
    }

    if (retriever.indexingJobId) {
      await ctx.scheduler.runAfter(
        0,
        internal.retrieval.indexingActions.cleanupAction,
        {
          kbId: retriever.kbId,
          indexConfigHash: retriever.indexConfigHash,
          jobId: retriever.indexingJobId,
        },
      );
    }

    await ctx.db.patch(args.id, {
      status: "configuring",
      chunkCount: undefined,
      indexingJobId: undefined,
      error: undefined,
    });

    return { deleted: true };
  },
});

// ─── Internal: Update retriever status on indexing completion ───

export const syncStatusFromIndexingJob = internalMutation({
  args: { retrieverId: v.id("retrievers") },
  handler: async (ctx, args) => {
    const retriever = await ctx.db.get(args.retrieverId);
    if (!retriever || retriever.status !== "indexing") return;
    if (!retriever.indexingJobId) return;

    const job = await ctx.db.get(retriever.indexingJobId);
    if (!job) return;

    if (job.status === "completed" || job.status === "completed_with_errors") {
      await ctx.db.patch(args.retrieverId, {
        status: "ready",
        chunkCount: job.totalChunks,
      });
    } else if (job.status === "failed") {
      await ctx.db.patch(args.retrieverId, {
        status: "error",
        error: job.error ?? "Indexing failed",
      });
    }
    // Note: "canceled" status is intentionally not handled here.
    // resetAfterCancel owns the cancel path to avoid race conditions.
  },
});
