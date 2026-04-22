import { query, mutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { getAuthContext } from "../lib/auth";

// ─── Shared validators ───

const codeConfigValidator = v.object({
  checkType: v.union(
    v.literal("tool_call_match"),
    v.literal("string_contains"),
    v.literal("regex_match"),
    v.literal("response_format"),
  ),
  params: v.any(),
});

const judgeConfigValidator = v.object({
  rubric: v.string(),
  passExamples: v.array(v.string()),
  failExamples: v.array(v.string()),
  model: v.string(),
  inputContext: v.array(
    v.union(
      v.literal("transcript"),
      v.literal("tool_calls"),
      v.literal("kb_documents"),
    ),
  ),
});

const typeValidator = v.union(v.literal("code"), v.literal("llm_judge"));
const scopeValidator = v.union(v.literal("session"), v.literal("turn"));
const createdFromValidator = v.union(
  v.literal("template"),
  v.literal("error_analysis"),
  v.literal("manual"),
);

// ─── Queries ───

export const byOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db
      .query("evaluators")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const evaluator = await ctx.db.get(id);
    if (!evaluator || evaluator.orgId !== orgId) {
      throw new Error("Evaluator not found");
    }
    return evaluator;
  },
});

// ─── Mutations ───

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    type: typeValidator,
    scope: scopeValidator,
    codeConfig: v.optional(codeConfigValidator),
    judgeConfig: v.optional(judgeConfigValidator),
    createdFrom: createdFromValidator,
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    return await ctx.db.insert("evaluators", { orgId, ...args });
  },
});

export const update = mutation({
  args: {
    id: v.id("evaluators"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    type: v.optional(typeValidator),
    scope: v.optional(scopeValidator),
    codeConfig: v.optional(codeConfigValidator),
    judgeConfig: v.optional(judgeConfigValidator),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...updates }) => {
    const { orgId } = await getAuthContext(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.orgId !== orgId) {
      throw new Error("Evaluator not found");
    }
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined),
    );
    await ctx.db.patch(id, filtered);
  },
});

export const remove = mutation({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.orgId !== orgId) {
      throw new Error("Evaluator not found");
    }
    await ctx.db.delete(id);
  },
});

// ─── Internal ───

export const getInternal = internalQuery({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

// ─── Template seeding ───

export const seedTemplates = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);

    // Check if templates already exist for this org
    const existing = await ctx.db
      .query("evaluators")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    if (existing.some((e) => e.createdFrom === "template")) {
      return { seeded: false };
    }

    const templates = [
      {
        name: "Tool Usage",
        description: "Checks that the agent used at least one retrieval tool",
        type: "code" as const,
        scope: "session" as const,
        codeConfig: {
          checkType: "tool_call_match" as const,
          params: { minCalls: 1 },
        },
        createdFrom: "template" as const,
        tags: ["retrieval", "template"],
      },
      {
        name: "No Hallucination",
        description:
          "LLM judge checks that agent responses are grounded in retrieved content",
        type: "llm_judge" as const,
        scope: "session" as const,
        judgeConfig: {
          rubric:
            "The agent's responses must be grounded in the retrieved knowledge base content. Responses that include claims not supported by the retrieved documents should fail.",
          passExamples: [
            "Agent cited information directly from retrieved docs",
          ],
          failExamples: [
            "Agent made up a product feature not found in any retrieved document",
          ],
          model: "claude-sonnet-4-20250514",
          inputContext: [
            "transcript" as const,
            "tool_calls" as const,
            "kb_documents" as const,
          ],
        },
        createdFrom: "template" as const,
        tags: ["accuracy", "template"],
      },
      {
        name: "Helpful Resolution",
        description:
          "LLM judge assesses whether the agent helpfully resolved the user's issue",
        type: "llm_judge" as const,
        scope: "session" as const,
        judgeConfig: {
          rubric:
            "The agent should address the user's question or issue completely and helpfully. The conversation should end with the user's needs met or a clear path to resolution.",
          passExamples: [
            "Agent answered the question fully with relevant information",
          ],
          failExamples: [
            "Agent gave a vague response without addressing the specific question",
          ],
          model: "claude-sonnet-4-20250514",
          inputContext: ["transcript" as const],
        },
        createdFrom: "template" as const,
        tags: ["helpfulness", "template"],
      },
      {
        name: "Professional Tone",
        description:
          "LLM judge checks that agent maintains professional, appropriate tone",
        type: "llm_judge" as const,
        scope: "session" as const,
        judgeConfig: {
          rubric:
            "The agent should maintain a professional, empathetic, and appropriate tone throughout the conversation. It should not be dismissive, rude, or overly casual.",
          passExamples: [
            "Agent was polite and empathetic while delivering information",
          ],
          failExamples: ["Agent was curt or dismissive of user concerns"],
          model: "claude-sonnet-4-20250514",
          inputContext: ["transcript" as const],
        },
        createdFrom: "template" as const,
        tags: ["tone", "template"],
      },
      {
        name: "Guardrail Compliance",
        description:
          "LLM judge checks that agent stays within defined guardrails",
        type: "llm_judge" as const,
        scope: "session" as const,
        judgeConfig: {
          rubric:
            "The agent should respect its configured guardrails — not answering out-of-scope questions, following escalation rules, and adhering to compliance requirements. If the scenario tests guardrails, the agent should appropriately decline or redirect.",
          passExamples: [
            "Agent correctly declined an out-of-scope request",
          ],
          failExamples: [
            "Agent answered a question it should have escalated",
          ],
          model: "claude-sonnet-4-20250514",
          inputContext: ["transcript" as const],
        },
        createdFrom: "template" as const,
        tags: ["guardrails", "template"],
      },
      {
        name: "Response Coherence",
        description:
          "Checks that agent responses are well-structured and coherent",
        type: "code" as const,
        scope: "turn" as const,
        codeConfig: {
          checkType: "response_format" as const,
          params: { requireNonEmpty: true, maxLength: 5000 },
        },
        createdFrom: "template" as const,
        tags: ["format", "template"],
      },
    ];

    const evaluatorIds = [];
    const requiredIds = [];

    for (const tmpl of templates) {
      const id = await ctx.db.insert("evaluators", { orgId, ...tmpl });
      evaluatorIds.push(id);
      // First 3 are required (Tool Usage, No Hallucination, Helpful Resolution)
      if (evaluatorIds.length <= 3) requiredIds.push(id);
    }

    // Create default evaluator set
    await ctx.db.insert("evaluatorSets", {
      orgId,
      name: "Default",
      description: "Default evaluator set with template evaluators",
      evaluatorIds,
      requiredEvaluatorIds: requiredIds,
      passThreshold: 0.8,
    });

    return { seeded: true };
  },
});
