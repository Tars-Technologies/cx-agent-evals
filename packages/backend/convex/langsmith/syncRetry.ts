import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Cron job action: retry failed LangSmith syncs.
 * Finds datasets and experiments with failed sync status and retries.
 */
export const retryFailed = internalAction({
  args: {},
  handler: async (ctx) => {
    // Find datasets with failed sync status (uses by_sync_status index)
    const datasets = await ctx.runQuery(
      internal.langsmith.syncRetry.getFailedDatasets,
    );

    for (const dataset of datasets) {
      await ctx.scheduler.runAfter(
        0,
        internal.langsmith.sync.syncDataset,
        { datasetId: dataset._id },
      );
    }
  },
});

import { internalQuery } from "../_generated/server";

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
      .collect();
    return withStatus.filter(
      (d) => d.langsmithSyncStatus?.startsWith("failed:"),
    );
  },
});
