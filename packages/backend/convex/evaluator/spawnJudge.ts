import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext, lookupUser } from "../lib/auth";

// Deterministic split assignment from (seed, index).
function assignSplit(index: number, seed: number): "train" | "dev" | "test" {
  let x = (seed ^ (index * 2654435761)) >>> 0;
  x = ((x * 1664525) + 1013904223) >>> 0;
  const r = x / 0xffffffff;
  if (r < 0.6) return "train";
  if (r < 0.8) return "dev";
  return "test";
}

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
      source: { kind: "error_analysis" as const, failureModeId: fm._id },
      status: "draft" as const,
      splitConfig: { trainPct: 0.6, devPct: 0.2, testPct: 0.2 },
      splitSeed: seed,
      tags: [],
      createdAt: Date.now(),
    });

    // 2. Inherit FAIL labels from failure mode members.
    const members = await ctx.db
      .query("failureModeMemberships")
      .withIndex("by_failure_mode", (q) => q.eq("failureModeId", fm._id))
      .collect();

    const memberKeys = new Set(
      members.map((m) =>
        m.source.kind === "conversation"
          ? `c:${m.source.conversationId}`
          : `t:${m.source.transcriptId}`,
      ),
    );

    let idx = 0;
    for (const m of members) {
      await ctx.db.insert("evaluatorLabels", {
        orgId,
        evaluatorId: evalId,
        failureModeId: fm._id,
        source: m.source,
        humanLabel: "fail" as const,
        splitAssignment: assignSplit(idx++, seed),
        origin: { kind: "axial_coding" as const, failureModeId: fm._id },
        ratedBy: user._id,
        createdAt: Date.now(),
      });
    }

    // 3. Inherit PASS labels from agent-scoped annotated conversations
    // that are NOT members of this failure mode.
    const allOrgAnnotations = await ctx.db
      .query("annotations")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    for (const a of allOrgAnnotations) {
      if (a.source.kind !== "conversation") continue;
      const conv = await ctx.db.get(a.source.conversationId);
      if (!conv || !conv.agentIds.includes(fm.agentId)) continue;
      const key = `c:${a.source.conversationId}`;
      if (memberKeys.has(key)) continue;

      await ctx.db.insert("evaluatorLabels", {
        orgId,
        evaluatorId: evalId,
        failureModeId: fm._id,
        source: a.source,
        humanLabel: "pass" as const,
        splitAssignment: assignSplit(idx++, seed),
        origin: { kind: "inferred_negative" as const },
        ratedBy: a.ratedBy,
        createdAt: Date.now(),
      });
    }

    return evalId;
  },
});
