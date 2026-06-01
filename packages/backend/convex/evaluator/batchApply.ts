"use node";
import OpenAI from "openai";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { getAuthContext } from "../lib/auth";
import { scoreOneAsync, type JudgeLlmClient } from "./llmJudge";
import { buildFewShotForEvaluator } from "./fewShotForEvaluator";
import { correctedPassRate, scoreBCI } from "./metrics";

type RunSummary = {
  evaluatorId: Id<"evaluators">;
  n: number;
  observedPassRate: number;
  correctedPassRate: number;
  ci: { lower: number; upper: number };
  corrected: boolean;
};

/**
 * Reconstruct representative (label,pred) arrays from stored test confusion metrics.
 * Uses the EXACT per-class test counts from `evaluator.labelCounts` (passTest/failTest)
 * when present, making the resulting bootstrap CI exact. Only falls back to the
 * approximate ~50/50 pass/fail split assumption when those counts are absent.
 */
function reconstructPairs(
  testMetrics?: { tpr: number; tnr: number; n: number },
  counts?: { passTest: number; failTest: number },
): {
  testLabels: number[];
  testPreds: number[];
} {
  const testLabels: number[] = [];
  const testPreds: number[] = [];
  if (!testMetrics) return { testLabels, testPreds };
  // Prefer exact per-class counts; fall back to an even split only if absent.
  let nPass: number;
  let nFail: number;
  if (counts && counts.passTest + counts.failTest > 0) {
    nPass = counts.passTest;
    nFail = counts.failTest;
  } else {
    const n = testMetrics.n ?? 0;
    nPass = Math.round(n / 2);
    nFail = n - nPass;
  }
  const tp = Math.round(testMetrics.tpr * nPass);
  const tn = Math.round(testMetrics.tnr * nFail);
  for (let i = 0; i < tp; i++) { testLabels.push(1); testPreds.push(1); }
  for (let i = 0; i < nPass - tp; i++) { testLabels.push(1); testPreds.push(0); }
  for (let i = 0; i < tn; i++) { testLabels.push(0); testPreds.push(0); }
  for (let i = 0; i < nFail - tn; i++) { testLabels.push(0); testPreds.push(1); }
  return { testLabels, testPreds };
}

export const runOnCohort = action({
  args: {
    evaluatorIds: v.array(v.id("evaluators")),
    cohort: v.object({
      kind: v.literal("simulation"),
      simulationId: v.id("conversationSimulations"),
    }),
    sampleSize: v.optional(v.number()),
  },
  handler: async (ctx, { evaluatorIds, cohort, sampleSize }): Promise<{ runs: RunSummary[] }> => {
    const { orgId } = await getAuthContext(ctx);

    const sim = await ctx.runQuery(internal.conversationSim.orchestration.getInternal, {
      id: cohort.simulationId,
    });
    if (!sim || sim.orgId !== orgId) throw new Error("Simulation not found");

    const runsRows = await ctx.runQuery(internal.conversationSim.runs.bySimulationInternal, {
      simulationId: cohort.simulationId,
    });
    let cohortConvIds = runsRows
      .filter((r: any) => r.status === "completed" && r.conversationId)
      .map((r: any) => r.conversationId as Id<"conversations">);
    if (sampleSize && sampleSize < cohortConvIds.length) {
      cohortConvIds = cohortConvIds.slice(0, sampleSize);
    }

    const client = new OpenAI() as unknown as JudgeLlmClient;
    const runs: RunSummary[] = [];

    for (const evaluatorId of evaluatorIds) {
      const evaluator = await ctx.runQuery(internal.evaluator.crud.getInternal, { id: evaluatorId });
      if (!evaluator || evaluator.orgId !== orgId) continue;

      const labels = await ctx.runQuery(internal.evaluator.labels.byEvaluatorInternal, {
        evaluatorId,
      });
      const labeledConvIds = new Set(
        labels
          .filter((l: any) => l.source.kind === "conversation")
          .map((l: any) => l.source.conversationId as string),
      );
      const measured = cohortConvIds.filter((id: Id<"conversations">) => !labeledConvIds.has(id));

      const fewShot = await buildFewShotForEvaluator(ctx, evaluator, labels);

      const resultRows: {
        source: { kind: "conversation"; conversationId: Id<"conversations"> };
        passed: boolean;
        justification: string;
      }[] = [];
      let passes = 0;
      // Fail-fast: a judge error here aborts the whole cohort run (intentional for
      // Slice 1; per-conversation isolation/partial results is deferred).
      for (const conversationId of measured) {
        const messages = await ctx.runQuery(internal.evaluator.sources.getMessagesForSource, {
          source: { kind: "conversation", conversationId },
        });
        const verdict = await scoreOneAsync(client, evaluator, messages, fewShot);
        if (verdict.passed) passes++;
        resultRows.push({
          source: { kind: "conversation", conversationId },
          passed: verdict.passed,
          justification: verdict.justification,
        });
      }

      const n = measured.length;
      const observed = n > 0 ? passes / n : 0;

      // A corrected claim requires held-out testMetrics: corrected === true ⟺
      // testMetrics present ⟺ a real correctedPassRate AND a real scoreBCI were
      // computed. devMetrics-only (or unvalidated) evaluators stay uncorrected with
      // the vacuous {0,1} CI (the UI treats uncorrected rows as "no CI").
      const tm = evaluator.testMetrics;
      const canCorrect =
        (evaluator.status === "ready" || evaluator.status === "validated") && !!tm;
      let corrected = observed;
      let ci = { lower: 0, upper: 1 };
      if (canCorrect && tm) {
        corrected = correctedPassRate(observed, tm.tpr, tm.tnr);
        const cohortPreds = resultRows.map((r) => (r.passed ? 1 : 0));
        const { testLabels, testPreds } = reconstructPairs(tm, evaluator.labelCounts);
        ci = scoreBCI(cohortPreds, testLabels, testPreds, 20000, evaluator.splitSeed ?? 42);
      }

      await ctx.runMutation(internal.evaluator.evaluationRuns.insertRunInternal, {
        orgId,
        agentId: evaluator.agentId,
        evaluatorId,
        simulationId: cohort.simulationId,
        n,
        observedPassRate: observed,
        correctedPassRate: corrected,
        ci,
        corrected: canCorrect,
        results: resultRows,
      });

      runs.push({
        evaluatorId,
        n,
        observedPassRate: observed,
        correctedPassRate: corrected,
        ci,
        corrected: canCorrect,
      });
    }

    return { runs };
  },
});
