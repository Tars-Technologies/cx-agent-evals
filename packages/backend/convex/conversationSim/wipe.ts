import { internalMutation } from "../_generated/server";

// One-shot wipe of all conversationSim data. Run manually via the Convex
// dashboard after deploying the scenarioSets schema change. New schema fields
// are required, so existing rows would fail validation — clear them first.
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
      const docs = await ctx.db.query(table).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
      }
    }
  },
});
