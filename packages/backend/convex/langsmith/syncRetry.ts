import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Cron job action: retry failed LangSmith syncs.
 * Finds datasets and experiments with failed sync status and retries.
 */
export const retryFailed = internalAction({
  args: {},
  handler: async (ctx) => {
    // Find datasets with failed sync status
    // We can't query by prefix, so we scan recent datasets
    // In production, we'd add an index on langsmithSyncStatus
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
 */
export const getFailedDatasets = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Scan all datasets and filter for failed sync status
    // For production, add a dedicated index
    const allDatasets = await ctx.db.query("datasets").collect();
    return allDatasets.filter(
      (d) =>
        d.langsmithSyncStatus &&
        d.langsmithSyncStatus.startsWith("failed:"),
    );
  },
});
