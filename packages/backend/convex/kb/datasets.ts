/**
 * Evaluation dataset CRUD (org-scoped).
 */
import { v } from "convex/values"
import { internalMutation, internalQuery } from "../_generated/server"
import { tenantMutation, tenantQuery } from "../lib/auth/tenant"

export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const { orgId } = ctx

    return await ctx.db
      .query("datasets")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect()
  }
})

export const byKb = tenantQuery({
  args: { kbId: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    const { orgId } = ctx

    const kb = await ctx.db.get(args.kbId)
    if (!kb || kb.orgId !== orgId) {
      throw new Error("Knowledge base not found")
    }

    return await ctx.db
      .query("datasets")
      .withIndex("by_kb", (q) => q.eq("kbId", args.kbId))
      .order("desc")
      .collect()
  }
})

export const get = tenantQuery({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    const { orgId } = ctx

    const dataset = await ctx.db.get(args.id)
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found")
    }
    return dataset
  }
})

/**
 * Internal query: get a dataset by ID (no auth check).
 */
export const getInternal = internalQuery({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.id)
    if (!dataset) throw new Error("Dataset not found")
    return dataset
  }
})

export const createSimDataset = tenantMutation({
  args: {
    kbId: v.id("knowledgeBases"),
    name: v.string()
  },
  handler: async (ctx, { kbId, name }) => {
    const { orgId, userId } = ctx
    const kb = await ctx.db.get(kbId)
    if (!kb || kb.orgId !== orgId) throw new Error("KB not found")
    return ctx.db.insert("datasets", {
      orgId,
      kbId,
      name,
      type: "conversation_sim",
      strategy: "conversation_sim",
      strategyConfig: {},
      questionCount: 0,
      scenarioCount: 0,
      metadata: {},
      createdBy: userId,
      createdAt: Date.now()
    })
  }
})

export const updateScenarioCount = internalMutation({
  args: {
    datasetId: v.id("datasets"),
    scenarioCount: v.number()
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.datasetId, { scenarioCount: args.scenarioCount })
  }
})

/**
 * Delete a dataset and all its questions.
 * Guards against deletion if experiments reference this dataset.
 */
export const deleteDataset = tenantMutation({
  args: { id: v.id("datasets") },
  handler: async (ctx, args) => {
    const { orgId } = ctx

    const dataset = await ctx.db.get(args.id)
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found")
    }

    // Guard: check for experiments referencing this dataset
    const experiments = await ctx.db
      .query("experiments")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.id))
      .collect()

    if (experiments.length > 0) {
      const names = experiments.map((e) => e.name).join(", ")
      throw new Error(
        `Cannot delete dataset — used by ${experiments.length} experiment(s): ${names}. Delete the experiments first.`
      )
    }

    // Cancel any running generation jobs for this dataset
    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.id))
      .collect()

    for (const job of jobs) {
      if (job.status === "running" || job.status === "pending") {
        await ctx.db.patch(job._id, {
          status: "canceled",
          completedAt: Date.now()
        })
      }
    }

    // Delete all questions in the dataset
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_dataset", (q) => q.eq("datasetId", args.id))
      .collect()

    for (const q of questions) {
      await ctx.db.delete(q._id)
    }

    // Delete the dataset record
    await ctx.db.delete(args.id)

    return { deleted: true, questionsRemoved: questions.length }
  }
})
