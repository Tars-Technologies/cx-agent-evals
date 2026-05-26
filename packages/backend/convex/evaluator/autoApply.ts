import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { scoreOne } from "./scoreOne";

type EvaluatorResult = {
  evaluatorId: Id<"evaluators">;
  evaluatorName: string;
  passed: boolean;
  justification: string;
  required: boolean;
};

export const applyReadyEvaluatorsToSimRun = internalAction({
  args: { simRunId: v.id("conversationSimRuns") },
  handler: async (ctx, { simRunId }) => {
    const simRun = await ctx.runQuery(
      internal.conversationSim.runs.getInternal,
      { id: simRunId },
    );
    if (!simRun || !simRun.conversationId) return;

    const ready = await ctx.runQuery(
      internal.evaluator.crud.byAgentStatusInternal,
      { agentId: simRun.agentId, status: "ready" },
    );
    if (ready.length === 0) return;

    const messages = await ctx.runQuery(
      internal.crud.conversations.listMessagesInternal,
      { conversationId: simRun.conversationId },
    );

    const results: EvaluatorResult[] = ready.map((ev: any) => {
      const verdict = scoreOne(ev, messages);
      return {
        evaluatorId: ev._id,
        evaluatorName: ev.name,
        passed: verdict.passed,
        justification: verdict.justification,
        required: false,
      };
    });

    await ctx.runMutation(
      internal.conversationSim.runs.appendEvaluatorResultsInternal,
      { runId: simRunId, results },
    );
  },
});
