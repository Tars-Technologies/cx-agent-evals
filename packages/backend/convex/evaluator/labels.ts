import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext, lookupUser } from "../lib/auth";
import type { Doc, Id } from "../_generated/dataModel";

// ─── Shared validators ───

const sourceValidator = v.union(
  v.object({ kind: v.literal("conversation"), conversationId: v.id("conversations") }),
  v.object({ kind: v.literal("transcript"),   transcriptId:   v.id("livechatConversations") }),
);

const originValidator = v.union(
  v.object({ kind: v.literal("axial_coding"),        failureModeId: v.id("failureModes") }),
  v.object({ kind: v.literal("inferred_negative") }),
  v.object({ kind: v.literal("calibration_pass") }),
  v.object({ kind: v.literal("imported_annotation"), annotationId:  v.id("annotations") }),
);

const splitValidator = v.union(
  v.literal("train"),
  v.literal("dev"),
  v.literal("test"),
);

type LabelSource =
  | { kind: "conversation"; conversationId: Id<"conversations"> }
  | { kind: "transcript"; transcriptId: Id<"livechatConversations"> };

async function findLabel(
  ctx: any,
  evaluatorId: Id<"evaluators">,
  source: LabelSource,
): Promise<Doc<"evaluatorLabels"> | undefined> {
  const rows: Doc<"evaluatorLabels">[] = await ctx.db
    .query("evaluatorLabels")
    .withIndex("by_evaluator", (q: any) => q.eq("evaluatorId", evaluatorId))
    .collect();
  if (source.kind === "conversation") {
    return rows.find(
      (r) =>
        r.source.kind === "conversation" &&
        r.source.conversationId === source.conversationId,
    );
  }
  return rows.find(
    (r) =>
      r.source.kind === "transcript" &&
      r.source.transcriptId === source.transcriptId,
  );
}

// ─── Mutations ───

export const upsert = mutation({
  args: {
    evaluatorId: v.id("evaluators"),
    failureModeId: v.optional(v.id("failureModes")),
    source: sourceValidator,
    humanLabel: v.union(v.literal("pass"), v.literal("fail")),
    splitAssignment: v.optional(splitValidator),
    origin: originValidator,
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const user = await lookupUser(ctx, userId);
    const ev = await ctx.db.get(args.evaluatorId);
    if (!ev || ev.orgId !== orgId) throw new Error("Evaluator not found");

    const existing = await findLabel(ctx, args.evaluatorId, args.source as LabelSource);
    if (existing) {
      await ctx.db.patch(existing._id, {
        humanLabel: args.humanLabel,
        splitAssignment: args.splitAssignment,
        origin: args.origin,
        failureModeId: args.failureModeId,
      });
      return existing._id;
    }
    return await ctx.db.insert("evaluatorLabels", {
      orgId,
      evaluatorId: args.evaluatorId,
      failureModeId: args.failureModeId,
      source: args.source,
      humanLabel: args.humanLabel,
      splitAssignment: args.splitAssignment,
      origin: args.origin,
      ratedBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("evaluatorLabels") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Label not found");
    await ctx.db.delete(id);
  },
});

// ─── Queries ───

export const byEvaluator = query({
  args: { evaluatorId: v.id("evaluators") },
  handler: async (ctx, { evaluatorId }) => {
    const { orgId } = await getAuthContext(ctx);
    const ev = await ctx.db.get(evaluatorId);
    if (!ev || ev.orgId !== orgId) throw new Error("Evaluator not found");
    return await ctx.db
      .query("evaluatorLabels")
      .withIndex("by_evaluator", (q) => q.eq("evaluatorId", evaluatorId))
      .collect();
  },
});

export const counts = query({
  args: { evaluatorId: v.id("evaluators") },
  handler: async (ctx, { evaluatorId }) => {
    const { orgId } = await getAuthContext(ctx);
    const ev = await ctx.db.get(evaluatorId);
    if (!ev || ev.orgId !== orgId) throw new Error("Evaluator not found");
    const rows = await ctx.db
      .query("evaluatorLabels")
      .withIndex("by_evaluator", (q) => q.eq("evaluatorId", evaluatorId))
      .collect();
    return {
      total: rows.length,
      pass: rows.filter((r) => r.humanLabel === "pass").length,
      fail: rows.filter((r) => r.humanLabel === "fail").length,
      train: rows.filter((r) => r.splitAssignment === "train").length,
      dev: rows.filter((r) => r.splitAssignment === "dev").length,
      test: rows.filter((r) => r.splitAssignment === "test").length,
    };
  },
});

export const bySplit = query({
  args: { evaluatorId: v.id("evaluators"), split: splitValidator },
  handler: async (ctx, { evaluatorId, split }) => {
    const { orgId } = await getAuthContext(ctx);
    const ev = await ctx.db.get(evaluatorId);
    if (!ev || ev.orgId !== orgId) throw new Error("Evaluator not found");
    return await ctx.db
      .query("evaluatorLabels")
      .withIndex("by_evaluator_split", (q) =>
        q.eq("evaluatorId", evaluatorId).eq("splitAssignment", split),
      )
      .collect();
  },
});

// ─── Internal (used by spawnJudge / calibration / etc.) ───

export const byEvaluatorInternal = internalQuery({
  args: { evaluatorId: v.id("evaluators") },
  handler: async (ctx, { evaluatorId }) => {
    return await ctx.db
      .query("evaluatorLabels")
      .withIndex("by_evaluator", (q) => q.eq("evaluatorId", evaluatorId))
      .collect();
  },
});

export const bulkInsertInternal = internalMutation({
  args: {
    rows: v.array(
      v.object({
        orgId: v.string(),
        evaluatorId: v.id("evaluators"),
        failureModeId: v.optional(v.id("failureModes")),
        source: sourceValidator,
        humanLabel: v.union(v.literal("pass"), v.literal("fail")),
        splitAssignment: v.optional(splitValidator),
        origin: originValidator,
        ratedBy: v.id("users"),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    for (const r of rows) {
      await ctx.db.insert("evaluatorLabels", { ...r, createdAt: Date.now() });
    }
  },
});
