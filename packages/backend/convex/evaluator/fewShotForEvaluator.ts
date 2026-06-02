import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { selectFewShot, renderFewShotBlock, type FewShotExample } from "./fewShot";

const FEWSHOT_TARGET = 4;

/**
 * Build the few-shot prompt block for an evaluator from its TRAIN-split labels.
 * Returns "" for non-llm_judge evaluators or when there are no usable train labels.
 *
 * Pass `labels` if the caller already fetched the evaluator's labels (avoids a
 * redundant query); otherwise they are fetched here.
 *
 * Requires an action `ctx` (uses ctx.runQuery). Not pure.
 */
export async function buildFewShotForEvaluator(
  ctx: ActionCtx,
  evaluator: Pick<Doc<"evaluators">, "_id" | "type" | "splitSeed">,
  labels?: Doc<"evaluatorLabels">[],
): Promise<string> {
  if (evaluator.type !== "llm_judge") return "";

  const rows =
    labels ??
    (await ctx.runQuery(internal.evaluator.labels.byEvaluatorInternal, {
      evaluatorId: evaluator._id,
    }));

  const train = rows.filter((l) => l.splitAssignment === "train");
  const byId = new Map<string, Doc<"evaluatorLabels">>(train.map((l) => [l._id, l]));
  const ids = selectFewShot(
    train.filter((l) => l.humanLabel === "pass").map((l) => l._id),
    train.filter((l) => l.humanLabel === "fail").map((l) => l._id),
    FEWSHOT_TARGET,
    evaluator.splitSeed ?? 42,
  );

  const examples: FewShotExample[] = [];
  for (const id of ids) {
    const lbl = byId.get(id);
    if (!lbl) continue;
    const messages = await ctx.runQuery(
      internal.evaluator.sources.getMessagesForSource,
      { source: lbl.source },
    );
    examples.push({ label: lbl.humanLabel, messages });
  }
  return renderFewShotBlock(examples);
}
