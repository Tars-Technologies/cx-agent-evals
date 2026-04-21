"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";

// Placeholder — full implementation in Task 7
export const runConversationSim = internalAction({
  args: { runId: v.id("conversationSimRuns") },
  handler: async (_ctx, _args) => {
    throw new Error("Not implemented — see Task 7");
  },
});
