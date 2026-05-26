import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { scoreOne } from "./scoreOne";

const TPR_THRESHOLD = 0.85;
const TNR_THRESHOLD = 0.85;

export const run = action({
  args: { evaluatorId: v.id("evaluators") },
  handler: async (ctx, { evaluatorId }) => {
    const evaluator = await ctx.runQuery(
      internal.evaluator.crud.getInternal,
      { id: evaluatorId },
    );
    if (!evaluator) throw new Error("Evaluator not found");

    const allLabels = await ctx.runQuery(
      internal.evaluator.labels.byEvaluatorInternal,
      { evaluatorId },
    );
    const devLabels = allLabels.filter(
      (l: any) => l.splitAssignment === "dev",
    );
    if (devLabels.length === 0) {
      throw new Error("No dev labels — calibrate this evaluator first.");
    }

    let tp = 0,
      tn = 0,
      fp = 0,
      fn = 0;

    for (const label of devLabels) {
      let messages: any[] = [];
      if (label.source.kind === "conversation") {
        messages = await ctx.runQuery(
          internal.crud.conversations.listMessagesInternal,
          { conversationId: label.source.conversationId },
        );
      }
      // For transcript-sourced labels we do not yet have a unified
      // message-fetcher. scoreOne handles empty messages safely.

      const verdict = scoreOne(evaluator, messages);
      const predicted = verdict.passed ? "pass" : "fail";

      if (predicted === "pass" && label.humanLabel === "pass") tp++;
      else if (predicted === "fail" && label.humanLabel === "fail") tn++;
      else if (predicted === "pass" && label.humanLabel === "fail") fp++;
      else fn++;
    }

    const tpr = tp + fn === 0 ? 0 : tp / (tp + fn);
    const tnr = tn + fp === 0 ? 0 : tn / (tn + fp);
    const agreement =
      devLabels.length === 0 ? 0 : (tp + tn) / devLabels.length;

    const newStatus =
      tpr >= TPR_THRESHOLD && tnr >= TNR_THRESHOLD ? "ready" : "validated";

    await ctx.runMutation(internal.evaluator.crud.updateMetrics, {
      evaluatorId,
      devMetrics: { tpr, tnr, agreement },
      status: newStatus,
    });

    return { tpr, tnr, agreement, status: newStatus };
  },
});
