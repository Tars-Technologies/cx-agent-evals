"use node";
import OpenAI from "openai";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";
import { scoreOneAsync, type JudgeLlmClient } from "./llmJudge";
import { computeTPRTNR, wilsonCI, type JudgmentPair } from "./metrics";
import { buildFewShotForEvaluator } from "./fewShotForEvaluator";

const TPR_THRESHOLD = 0.85;
const TNR_THRESHOLD = 0.85;
const MIN_PER_CLASS = 5;

type Metrics = { tpr: number; tnr: number; agreement: number };
type CIPair = {
  tpr: { lower: number; upper: number };
  tnr: { lower: number; upper: number };
};

export const run = action({
  args: { evaluatorId: v.id("evaluators") },
  handler: async (
    ctx,
    { evaluatorId },
  ): Promise<{
    status: "ready" | "validated" | "calibrating";
    reason?: "insufficient_labels";
    needed?: { pass: number; fail: number };
    devMetrics: Metrics;
    testMetrics: (Metrics & { n: number }) | null;
  }> => {
    const { orgId } = await getAuthContext(ctx);
    const evaluator = await ctx.runQuery(internal.evaluator.crud.getInternal, {
      id: evaluatorId,
    });
    if (!evaluator || evaluator.orgId !== orgId) {
      throw new Error("Evaluator not found");
    }

    const allLabels = await ctx.runQuery(
      internal.evaluator.labels.byEvaluatorInternal,
      { evaluatorId },
    );

    const client = new OpenAI() as unknown as JudgeLlmClient;

    // Build few-shot once from the TRAIN split.
    const fewShot = await buildFewShotForEvaluator(ctx, evaluator, allLabels);

    const scoreSplit = async (split: "dev" | "test"): Promise<JudgmentPair[]> => {
      const labels = allLabels.filter((l: any) => l.splitAssignment === split);
      const pairs: JudgmentPair[] = [];
      for (const label of labels) {
        const messages = await ctx.runQuery(
          internal.evaluator.sources.getMessagesForSource,
          { source: label.source },
        );
        const verdict = await scoreOneAsync(client, evaluator, messages, fewShot);
        pairs.push({
          humanLabel: label.humanLabel,
          judgeVerdict: verdict.passed ? "pass" : "fail",
        });
      }
      return pairs;
    };

    const devPairs = await scoreSplit("dev");
    const testPairs = await scoreSplit("test");

    if (devPairs.length === 0) {
      throw new Error("No dev labels — calibrate this evaluator first.");
    }

    const dev = computeTPRTNR(devPairs);
    const test = testPairs.length > 0 ? computeTPRTNR(testPairs) : null;

    const ciFor = (m: typeof dev): CIPair => ({
      tpr: wilsonCI(m.tp, m.tp + m.fn),
      tnr: wilsonCI(m.tn, m.tn + m.fp),
    });
    const devCI = ciFor(dev);
    const testCI = test ? ciFor(test) : undefined;

    const devMetrics: Metrics = { tpr: dev.tpr, tnr: dev.tnr, agreement: dev.accuracy };
    const testMetrics =
      test !== null
        ? { tpr: test.tpr, tnr: test.tnr, agreement: test.accuracy, n: test.total }
        : null;

    const finalMatrix = test ?? dev;
    const finalPass = finalMatrix.tp + finalMatrix.fn;
    const finalFail = finalMatrix.tn + finalMatrix.fp;
    const sufficient = finalPass >= MIN_PER_CLASS && finalFail >= MIN_PER_CLASS;

    const labelCounts = {
      passDev: dev.tp + dev.fn,
      failDev: dev.tn + dev.fp,
      passTest: test ? test.tp + test.fn : 0,
      failTest: test ? test.tn + test.fp : 0,
    };

    if (!sufficient) {
      await ctx.runMutation(internal.evaluator.crud.updateValidation, {
        evaluatorId,
        devMetrics,
        testMetrics: testMetrics ?? undefined,
        devMetricsCI: devCI,
        testMetricsCI: testCI,
        labelCounts,
        status: "calibrating",
      });
      return {
        status: "calibrating",
        reason: "insufficient_labels",
        needed: {
          pass: Math.max(0, MIN_PER_CLASS - finalPass),
          fail: Math.max(0, MIN_PER_CLASS - finalFail),
        },
        devMetrics,
        testMetrics,
      };
    }

    const status: "ready" | "validated" =
      finalMatrix.tpr >= TPR_THRESHOLD && finalMatrix.tnr >= TNR_THRESHOLD
        ? "ready"
        : "validated";

    await ctx.runMutation(internal.evaluator.crud.updateValidation, {
      evaluatorId,
      devMetrics,
      testMetrics: testMetrics ?? undefined,
      devMetricsCI: devCI,
      testMetricsCI: testCI,
      labelCounts,
      status,
      validatedAt: Date.now(),
    });

    return { status, devMetrics, testMetrics };
  },
});
