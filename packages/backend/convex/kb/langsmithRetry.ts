/**
 * Manual dataset-sync retry mutation (tenantMutation).
 */
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { tenantMutation } from "../lib/auth/tenant"

export const retryDatasetSync = tenantMutation({
  args: { datasetId: v.id("datasets") },
  handler: async (ctx, args) => {
    const { orgId } = ctx

    const dataset = await ctx.db.get(args.datasetId)
    if (!dataset || dataset.orgId !== orgId) {
      throw new Error("Dataset not found")
    }

    await ctx.scheduler.runAfter(0, internal.kb.langsmith_actions.syncDataset, {
      datasetId: args.datasetId
    })
  }
})
