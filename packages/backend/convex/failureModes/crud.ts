import { query, mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getAuthContext } from "../lib/auth";

// ─── Queries ───

export const byExperiment = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) throw new Error("Experiment not found");

    const modes = await ctx.db
      .query("failureModes")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();

    return modes.sort((a, b) => a.order - b.order);
  },
});

export const mappingsByExperiment = query({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) throw new Error("Experiment not found");

    return await ctx.db
      .query("failureModeQuestionMappings")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();
  },
});

// ─── Mutations ───

export const create = mutation({
  args: {
    experimentId: v.id("experiments"),
    name: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) throw new Error("Experiment not found");

    const existing = await ctx.db
      .query("failureModes")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();
    const maxOrder = existing.reduce((max, m) => Math.max(max, m.order), -1);

    return await ctx.db.insert("failureModes", {
      orgId,
      experimentId: args.experimentId,
      name: args.name,
      description: args.description,
      order: maxOrder + 1,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    failureModeId: v.id("failureModes"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const mode = await ctx.db.get(args.failureModeId);
    if (!mode || mode.orgId !== orgId)
      throw new Error("Failure mode not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name;
    if (args.description !== undefined) patch.description = args.description;

    await ctx.db.patch(args.failureModeId, patch);
  },
});

export const remove = mutation({
  args: { failureModeId: v.id("failureModes") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const mode = await ctx.db.get(args.failureModeId);
    if (!mode || mode.orgId !== orgId)
      throw new Error("Failure mode not found");

    // Delete all mappings for this failure mode
    const mappings = await ctx.db
      .query("failureModeQuestionMappings")
      .withIndex("by_failure_mode", (q) =>
        q.eq("failureModeId", args.failureModeId),
      )
      .collect();
    for (const m of mappings) {
      await ctx.db.delete(m._id);
    }

    await ctx.db.delete(args.failureModeId);
  },
});

export const assignQuestion = mutation({
  args: {
    failureModeId: v.id("failureModes"),
    questionId: v.id("questions"),
    experimentId: v.id("experiments"),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) throw new Error("Experiment not found");

    // Check for duplicate mapping
    const existing = await ctx.db
      .query("failureModeQuestionMappings")
      .withIndex("by_failure_mode", (q) =>
        q.eq("failureModeId", args.failureModeId),
      )
      .collect();
    if (existing.some((m) => m.questionId === args.questionId)) {
      return; // Already mapped
    }

    return await ctx.db.insert("failureModeQuestionMappings", {
      orgId,
      failureModeId: args.failureModeId,
      questionId: args.questionId,
      experimentId: args.experimentId,
      createdAt: Date.now(),
    });
  },
});

export const unassignQuestion = mutation({
  args: {
    failureModeId: v.id("failureModes"),
    questionId: v.id("questions"),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const mappings = await ctx.db
      .query("failureModeQuestionMappings")
      .withIndex("by_failure_mode", (q) =>
        q.eq("failureModeId", args.failureModeId),
      )
      .collect();
    const mapping = mappings.find((m) => m.questionId === args.questionId);
    if (!mapping || mapping.orgId !== orgId) return;

    await ctx.db.delete(mapping._id);
  },
});

export const startGeneration = mutation({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const exp = await ctx.db.get(args.experimentId);
    if (!exp || exp.orgId !== orgId) throw new Error("Experiment not found");

    // Verify >= 50% annotated
    const stats = await ctx.db
      .query("annotations")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();
    const results = await ctx.db
      .query("agentExperimentResults")
      .withIndex("by_experiment", (q) =>
        q.eq("experimentId", args.experimentId),
      )
      .collect();

    if (results.length === 0) throw new Error("No results to analyze");
    if (stats.length / results.length < 0.5) {
      throw new Error("Annotate at least 50% of results before generating failure modes");
    }

    await ctx.scheduler.runAfter(
      0,
      internal.failureModes.actions.generate,
      { experimentId: args.experimentId },
    );
  },
});

// ─── Internal mutations (for use by actions) ───

export const createInternal = internalMutation({
  args: {
    orgId: v.string(),
    experimentId: v.id("experiments"),
    name: v.string(),
    description: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("failureModes", {
      orgId: args.orgId,
      experimentId: args.experimentId,
      name: args.name,
      description: args.description,
      order: args.order,
      createdAt: Date.now(),
    });
  },
});

export const createMappingInternal = internalMutation({
  args: {
    orgId: v.string(),
    failureModeId: v.id("failureModes"),
    questionId: v.id("questions"),
    experimentId: v.id("experiments"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("failureModeQuestionMappings", {
      orgId: args.orgId,
      failureModeId: args.failureModeId,
      questionId: args.questionId,
      experimentId: args.experimentId,
      createdAt: Date.now(),
    });
  },
});
