import { internal } from "../_generated/api"
import { internalAction, internalQuery } from "../_generated/server"

/**
 * Cron job action: retry failed LangSmith dataset syncs.
 * Finds datasets with a "failed:" sync status and re-enqueues the sync.
 */
export const retryFailed = internalAction({
  args: {},
  handler: async (ctx) => {
    // Find datasets with failed sync status (uses by_sync_status index)
    const datasets = await ctx.runQuery(
      internal.kb.langsmith_sync_retry.getFailedDatasets
    )

    for (const dataset of datasets) {
      await ctx.scheduler.runAfter(
        0,
        internal.kb.langsmith_actions.syncDataset,
        {
          datasetId: dataset._id
        }
      )
    }
  }
})

/**
 * Internal query: find datasets with failed LangSmith sync status.
 * Uses the by_sync_status index to avoid full table scans.
 */
export const getFailedDatasets = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Use index to narrow scan to datasets that have a sync status set,
    // then filter in-memory for the "failed:" prefix (Convex indexes
    // don't support prefix matching)
    const withStatus = await ctx.db
      .query("datasets")
      .withIndex("by_sync_status")
      .filter((q) => q.neq(q.field("langsmithSyncStatus"), undefined))
      .collect()
    return withStatus.filter((d) =>
      d.langsmithSyncStatus?.startsWith("failed:")
    )
  }
})
