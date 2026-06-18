import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext, lookupUser } from "../lib/auth";
import { computeSplit } from "./splits";
import type { Id } from "../_generated/dataModel";

export const fromFailureMode = mutation({
  args: {
    failureModeId: v.id("failureModes"),
    rubricOverride: v.optional(v.string()),
    nameOverride: v.optional(v.string()),
    splitSeed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx, userId);

    const fm = await ctx.db.get(args.failureModeId);
    if (!fm || fm.orgId !== orgId) throw new Error("Failure mode not found");

    const seed = args.splitSeed ?? Math.floor(Math.random() * 0xffffffff);

    // 1. Create the evaluator.
    const evalId = await ctx.db.insert("evaluators", {
      orgId,
      agentId: fm.agentId,
      name: args.nameOverride ?? fm.name,
      description: fm.description,
      type: "llm_judge" as const,
      llmJudgeConfig: {
        dimensions: [
          {
            failureModeId: fm._id,
            name: fm.name,
            rubric:
              args.rubricOverride ??
              `Pass if the conversation does NOT exhibit "${fm.name}". Fail if it does.\n\n${fm.description}`,
            passExamples: [],
            failExamples: [],
          },
        ],
        outputFormat: "per_dimension" as const,
        model: "gpt-4o-mini",
        inputContext: ["transcript" as const],
      },
      source: {
        kind: "error_analysis" as const,
        failureModeId: fm._id,
        errorAnalysisId: fm.errorAnalysisId,
      },
      status: "draft" as const,
      splitConfig: { trainPct: 0.6, devPct: 0.2, testPct: 0.2 },
      splitSeed: seed,
      tags: [],
      createdAt: Date.now(),
    });

    // 2. Gather inherited labels: FAIL from failure-mode members, PASS from the
    //    other annotations in this analysis (non-members of this mode).
    const members = await ctx.db
      .query("failureModeMemberships")
      .withIndex("by_failure_mode", (q) => q.eq("failureModeId", fm._id))
      .collect();

    type LabelSource = (typeof members)[number]["source"];

    const keyOf = (s: LabelSource) =>
      s.kind === "conversation" ? `c:${s.conversationId}` : `t:${s.transcriptId}`;

    const memberKeys = new Set(members.map((m) => keyOf(m.source)));

    const analysisAnnotations = await ctx.db
      .query("annotations")
      .withIndex("by_analysis", (q) => q.eq("errorAnalysisId", fm.errorAnalysisId))
      .collect();

    type Pending = {
      source: LabelSource;
      humanLabel: "pass" | "fail";
      origin:
        | { kind: "axial_coding"; failureModeId: Id<"failureModes"> }
        | { kind: "inferred_negative" };
      ratedBy: Id<"users">;
    };
    const pending: Pending[] = [];
    for (const m of members) {
      pending.push({
        source: m.source,
        humanLabel: "fail",
        origin: { kind: "axial_coding", failureModeId: fm._id },
        ratedBy: user._id,
      });
    }
    for (const a of analysisAnnotations) {
      if (memberKeys.has(keyOf(a.source))) continue;
      pending.push({
        source: a.source,
        humanLabel: "pass",
        origin: { kind: "inferred_negative" },
        ratedBy: a.ratedBy,
      });
    }

    // 3. Assign train/dev/test PER CLASS (stratified) so a scarce class is
    //    represented proportionally in dev/test instead of landing entirely in
    //    one bucket. Reuses the existing class-aware splitter (splits.computeSplit)
    //    instead of the old single-running-index hash, which starved the test split.
    const ids = pending.map((p) => keyOf(p.source));
    const labelMap = new Map(
      pending.map((p) => [keyOf(p.source), p.humanLabel] as const),
    );
    const split = computeSplit(
      ids,
      { trainPct: 60, devPct: 20, testPct: 20 },
      seed,
      labelMap,
    );
    const splitOf = new Map<string, "train" | "dev" | "test">();
    for (const id of split.train) splitOf.set(id, "train");
    for (const id of split.dev) splitOf.set(id, "dev");
    for (const id of split.test) splitOf.set(id, "test");

    for (const p of pending) {
      await ctx.db.insert("evaluatorLabels", {
        orgId,
        evaluatorId: evalId,
        failureModeId: fm._id,
        source: p.source,
        humanLabel: p.humanLabel,
        splitAssignment: splitOf.get(keyOf(p.source)) ?? "train",
        origin: p.origin,
        ratedBy: p.ratedBy,
        createdAt: Date.now(),
      });
    }

    return evalId;
  },
});
