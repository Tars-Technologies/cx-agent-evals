"use node";
import OpenAI from "openai";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { scoreOneAsync, type JudgeLlmClient } from "./llmJudge";
import { selectFewShot, renderFewShotBlock, type FewShotExample } from "./fewShot";

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

    for (const ev of ready as any[]) {
      let fewShot = "";
      if (ev.type === "llm_judge") {
        const labels = await ctx.runQuery(
          internal.evaluator.labels.byEvaluatorInternal,
          { evaluatorId: ev._id },
        );
        const train = labels.filter((l: any) => l.splitAssignment === "train");
        const byId = new Map<string, any>(train.map((l: any) => [l._id, l]));
        const ids = selectFewShot(
          train.filter((l: any) => l.humanLabel === "pass").map((l: any) => l._id),
          train.filter((l: any) => l.humanLabel === "fail").map((l: any) => l._id),
          4,
          ev.splitSeed ?? 42,
        );
        const examples: FewShotExample[] = [];
        for (const id of ids) {
          const lbl = byId.get(id);
          if (!lbl) continue;
          const m = await ctx.runQuery(
            internal.evaluator.sources.getMessagesForSource,
            { source: lbl.source },
          );
          examples.push({ label: lbl.humanLabel, messages: m });
        }
        fewShot = renderFewShotBlock(examples);
      }

      const verdict = await scoreOneAsync(client, ev, messages, fewShot);
      results.push({
        evaluatorId: ev._id,
        evaluatorName: ev.name,
        passed: verdict.passed,
        justification: verdict.justification,
        required: false,
      });
    }

    await ctx.runMutation(
      internal.conversationSim.runs.appendEvaluatorResultsInternal,
      { runId: simRunId, results },
    );
  },
});
