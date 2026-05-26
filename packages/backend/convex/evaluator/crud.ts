import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

// ─── Shared validators ───

const codeJudgeConfigValidator = v.object({
  checkType: v.union(
    v.literal("tool_call_match"),
    v.literal("string_contains"),
    v.literal("regex_match"),
    v.literal("response_format"),
  ),
  params: v.any(),
});

const llmJudgeConfigValidator = v.object({
  dimensions: v.array(
    v.object({
      failureModeId: v.optional(v.id("failureModes")),
      name: v.string(),
      rubric: v.string(),
      passExamples: v.array(v.string()),
      failExamples: v.array(v.string()),
    }),
  ),
  outputFormat: v.union(v.literal("per_dimension"), v.literal("aggregate")),
  model: v.string(),
  inputContext: v.array(
    v.union(
      v.literal("transcript"),
      v.literal("tool_calls"),
      v.literal("kb_documents"),
    ),
  ),
});

const sourceValidator = v.union(
  v.object({ kind: v.literal("manual") }),
  v.object({ kind: v.literal("template"), templateId: v.id("evaluatorTemplates") }),
  v.object({ kind: v.literal("error_analysis"), failureModeId: v.id("failureModes") }),
);

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("calibrating"),
  v.literal("validated"),
  v.literal("ready"),
);

const devMetricsValidator = v.object({
  tpr: v.number(),
  tnr: v.number(),
  agreement: v.number(),
});

// ─── Mutations ───

export const create = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    description: v.string(),
    type: v.union(v.literal("code"), v.literal("llm_judge")),
    codeJudgeConfig: v.optional(codeJudgeConfigValidator),
    llmJudgeConfig: v.optional(llmJudgeConfigValidator),
    source: sourceValidator,
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");

    if (args.type === "code" && !args.codeJudgeConfig) {
      throw new Error("codeJudgeConfig is required when type is 'code'");
    }
    if (args.type === "llm_judge" && !args.llmJudgeConfig) {
      throw new Error("llmJudgeConfig is required when type is 'llm_judge'");
    }

    return await ctx.db.insert("evaluators", {
      orgId,
      agentId: args.agentId,
      name: args.name,
      description: args.description,
      type: args.type,
      codeJudgeConfig: args.type === "code" ? args.codeJudgeConfig : undefined,
      llmJudgeConfig: args.type === "llm_judge" ? args.llmJudgeConfig : undefined,
      source: args.source,
      status: "draft" as const,
      tags: args.tags,
      createdAt: Date.now(),
    });
  },
});

export const createFromTemplate = mutation({
  args: {
    agentId: v.id("agents"),
    templateId: v.id("evaluatorTemplates"),
    nameOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    const tpl = await ctx.db.get(args.templateId);
    if (!tpl) throw new Error("Template not found");

    return await ctx.db.insert("evaluators", {
      orgId,
      agentId: args.agentId,
      name: args.nameOverride ?? tpl.name,
      description: tpl.description,
      type: tpl.type,
      codeJudgeConfig: tpl.type === "code" ? tpl.prefilledConfig : undefined,
      llmJudgeConfig: tpl.type === "llm_judge" ? tpl.prefilledConfig : undefined,
      source: { kind: "template" as const, templateId: tpl._id },
      status: "draft" as const,
      tags: [],
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("evaluators"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    codeJudgeConfig: v.optional(codeJudgeConfigValidator),
    llmJudgeConfig: v.optional(llmJudgeConfigValidator),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const { orgId } = await getAuthContext(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Evaluator not found");
    const filtered = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(id, { ...filtered, updatedAt: Date.now() });
  },
});

export const updateStatus = mutation({
  args: { id: v.id("evaluators"), status: statusValidator },
  handler: async (ctx, { id, status }) => {
    const { orgId } = await getAuthContext(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Evaluator not found");
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
  },
});

export const updateMetrics = internalMutation({
  args: {
    evaluatorId: v.id("evaluators"),
    devMetrics: devMetricsValidator,
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.evaluatorId, {
      devMetrics: args.devMetrics,
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Evaluator not found");
    const labels = await ctx.db
      .query("evaluatorLabels")
      .withIndex("by_evaluator", (q) => q.eq("evaluatorId", id))
      .collect();
    for (const l of labels) await ctx.db.delete(l._id);
    await ctx.db.delete(id);
  },
});

// ─── Queries ───

export const byAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    return await ctx.db
      .query("evaluators")
      .withIndex("by_agent", (q) => q.eq("agentId", agentId))
      .collect();
  },
});

export const byAgentStatus = query({
  args: { agentId: v.id("agents"), status: statusValidator },
  handler: async (ctx, { agentId, status }) => {
    const { orgId } = await getAuthContext(ctx);
    const agent = await ctx.db.get(agentId);
    if (!agent || agent.orgId !== orgId) throw new Error("Agent not found");
    return await ctx.db
      .query("evaluators")
      .withIndex("by_agent_status", (q) =>
        q.eq("agentId", agentId).eq("status", status),
      )
      .collect();
  },
});

export const get = query({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Evaluator not found");
    return row;
  },
});

// ─── Internal ───

export const getInternal = internalQuery({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const byAgentStatusInternal = internalQuery({
  args: { agentId: v.id("agents"), status: statusValidator },
  handler: async (ctx, { agentId, status }) => {
    return await ctx.db
      .query("evaluators")
      .withIndex("by_agent_status", (q) =>
        q.eq("agentId", agentId).eq("status", status),
      )
      .collect();
  },
});
