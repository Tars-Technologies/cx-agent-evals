import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";

// Max docs deleted per transaction. Convex mutations have per-transaction
// read/write limits (guidelines.md), so we delete in bounded batches and
// reschedule until the tables are empty.
const WIPE_BATCH = 200;

// One-shot wipe of all conversationSim data. Run manually via the Convex
// dashboard after deploying the scenarioSets schema change. New schema fields
// are required, so existing rows would fail validation — clear them first.
// Self-reschedules via ctx.scheduler until every table is drained.
export const wipeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "conversationSimRuns",
      "conversationSimulations",
      "conversationScenarios",
      "scenarioGenJobs",
    ] as const;

    for (const table of tables) {
      const batch = await ctx.db.query(table).take(WIPE_BATCH);
      for (const doc of batch) {
        await ctx.db.delete(doc._id);
      }
      if (batch.length === WIPE_BATCH) {
        // This table may have more rows than one transaction can delete.
        // Reschedule from the top; already-drained tables are cheap no-ops.
        await ctx.scheduler.runAfter(0, internal.conversationSim.wipe.wipeAll, {});
        return;
      }
    }
  },
});
