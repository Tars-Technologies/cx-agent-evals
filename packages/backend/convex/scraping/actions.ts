"use node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";

export const batchScrape = internalAction({
  args: { crawlJobId: v.id("crawlJobs") },
  handler: async () => {
    throw new Error("Not implemented yet — see Task 20");
  },
});
