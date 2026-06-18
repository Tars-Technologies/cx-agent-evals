"use node";
import OpenAI from "openai";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { scoreOneAsync, type JudgeLlmClient } from "./llmJudge";
import { buildFewShotForEvaluator } from "./fewShotForEvaluator";

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

    const client = new OpenAI() as unknown as JudgeLlmClient;
    const results: EvaluatorResult[] = [];

    for (const ev of ready) {
      const fewShot = await buildFewShotForEvaluator(ctx, ev);

      const verdict = await scoreOneAsync(client, ev, messages, fewShot);
      results.push({
        evaluatorId: ev._id,
        evaluatorName: ev.name,
        passed: verdict.passed,
        justification: verdict.justification,
        required: false,
      });
    }

    // Aggregate the per-evaluator verdicts into the run-level score/passed scalars
    // the UI reads (mirrors main's deleted two-phase evaluator: score = pass ratio,
    // passed = every evaluator passed). Without this, run.passed stays undefined and
    // the Evaluation tab stamps every scenario FAIL regardless of verdicts.
    const passedCount = results.filter((r) => r.passed).length;
    const score = results.length > 0 ? passedCount / results.length : 1;
    const passed = results.length > 0 ? results.every((r) => r.passed) : true;

    await ctx.runMutation(internal.conversationSim.runs.updateRun, {
      runId: simRunId,
      evaluatorResults: results,
      score,
      passed,
    });
  },
});
