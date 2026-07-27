import { v } from "convex/values"
import type { Id } from "../_generated/dataModel"
import { internalQuery, mutation, query } from "../_generated/server"
import { getAuthContext } from "../lib/auth"

// ─── Shared validators ───

const codeConfigValidator = v.object({
  checkType: v.union(
    v.literal("tool_call_match"),
    v.literal("string_contains"),
    v.literal("regex_match"),
    v.literal("response_format"),
    v.literal("image_hygiene")
  ),
  params: v.any()
})

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
      v.literal("shown_images")
    )
  )
})

const typeValidator = v.union(v.literal("code"), v.literal("llm_judge"))
const scopeValidator = v.union(v.literal("session"), v.literal("turn"))
const createdFromValidator = v.union(
  v.literal("template"),
  v.literal("error_analysis"),
  v.literal("manual")
)

// ─── Queries ───

export const byOrg = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx)
    return await ctx.db
      .query("evaluators")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
  }
})

export const get = query({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx)
    const evaluator = await ctx.db.get(id)
    if (!evaluator || evaluator.orgId !== orgId) {
      throw new Error("Evaluator not found")
    }
    return evaluator
  }
})

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
    tags: v.array(v.string())
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx)
    return await ctx.db.insert("evaluators", { orgId, ...args })
  }
})

export const update = mutation({
  args: {
    id: v.id("evaluators"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    type: v.optional(typeValidator),
    scope: v.optional(scopeValidator),
    codeConfig: v.optional(codeConfigValidator),
    judgeConfig: v.optional(judgeConfigValidator),
    tags: v.optional(v.array(v.string()))
  },
  handler: async (ctx, { id, ...updates }) => {
    const { orgId } = await getAuthContext(ctx)
    const existing = await ctx.db.get(id)
    if (!existing || existing.orgId !== orgId) {
      throw new Error("Evaluator not found")
    }
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    )
    await ctx.db.patch(id, filtered)
  }
})

export const remove = mutation({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => {
    const { orgId } = await getAuthContext(ctx)
    const existing = await ctx.db.get(id)
    if (!existing || existing.orgId !== orgId) {
      throw new Error("Evaluator not found")
    }
    await ctx.db.delete(id)
  }
})

// ─── Internal ───

export const getInternal = internalQuery({
  args: { id: v.id("evaluators") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id)
  }
})

// ─── Template seeding ───

export const seedTemplates = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx)

    // Idempotent seed: add only templates this org doesn't already have (by
    // name), so re-running picks up newly-shipped templates (e.g. the image
    // evaluators) without duplicating the originals.
    const existing = await ctx.db
      .query("evaluators")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
    const existingTemplateNames = new Set(
      existing.filter((e) => e.createdFrom === "template").map((e) => e.name)
    )

    const templates = [
      {
        name: "Tool Usage",
        description: "Checks that the agent used at least one retrieval tool",
        type: "code" as const,
        scope: "session" as const,
        codeConfig: {
          checkType: "tool_call_match" as const,
          params: { minCalls: 1 }
        },
        createdFrom: "template" as const,
        tags: ["retrieval", "template"]
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
            "Agent cited information directly from retrieved docs"
          ],
          failExamples: [
            "Agent made up a product feature not found in any retrieved document"
          ],
          model: "claude-sonnet-4-20250514",
          inputContext: [
            "transcript" as const,
            "tool_calls" as const,
            "kb_documents" as const
          ]
        },
        createdFrom: "template" as const,
        tags: ["accuracy", "template"]
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
            "Agent answered the question fully with relevant information"
          ],
          failExamples: [
            "Agent gave a vague response without addressing the specific question"
          ],
          model: "claude-sonnet-4-20250514",
          inputContext: ["transcript" as const]
        },
        createdFrom: "template" as const,
        tags: ["helpfulness", "template"]
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
            "Agent was polite and empathetic while delivering information"
          ],
          failExamples: ["Agent was curt or dismissive of user concerns"],
          model: "claude-sonnet-4-20250514",
          inputContext: ["transcript" as const]
        },
        createdFrom: "template" as const,
        tags: ["tone", "template"]
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
          passExamples: ["Agent correctly declined an out-of-scope request"],
          failExamples: ["Agent answered a question it should have escalated"],
          model: "claude-sonnet-4-20250514",
          inputContext: ["transcript" as const]
        },
        createdFrom: "template" as const,
        tags: ["guardrails", "template"]
      },
      {
        name: "Response Coherence",
        description:
          "Checks that agent responses are well-structured and coherent",
        type: "code" as const,
        scope: "turn" as const,
        codeConfig: {
          checkType: "response_format" as const,
          params: { requireNonEmpty: true, maxLength: 5000 }
        },
        createdFrom: "template" as const,
        tags: ["format", "template"]
      },
      {
        name: "Image Hygiene",
        description:
          "Checks the agent only rendered whitelisted knowledge-base images and stayed within the per-turn image cap (no hallucinated/leaked image markers, no overuse)",
        type: "code" as const,
        scope: "turn" as const,
        codeConfig: {
          checkType: "image_hygiene" as const,
          params: {}
        },
        createdFrom: "template" as const,
        tags: ["multimodal", "template"]
      },
      {
        name: "Image Relevance",
        description:
          "Vision judge: assesses whether the images the agent showed were relevant to the user's question, and whether an obviously-relevant available image was skipped",
        type: "llm_judge" as const,
        scope: "session" as const,
        judgeConfig: {
          rubric:
            "Judge the agent's use of images. PRECISION: every image the agent showed should be clearly relevant to what the user asked — penalise decorative, off-topic, or padding images. RECALL: if the retrieval menu offered an image that clearly would have answered the user's question and the agent did not show it, that is a miss. A run with no relevant images available should pass as long as the agent did not force an irrelevant one.",
          passExamples: [
            "User asked what the dashboard looks like; agent showed the dashboard screenshot from the menu",
            "No relevant image was available and the agent answered in text without forcing one"
          ],
          failExamples: [
            "Agent showed a product logo that had nothing to do with the question",
            "The menu contained a wiring diagram that directly answered the question but the agent never showed it"
          ],
          // GPT-family so the vision judge can bill image parts at detail:"low".
          model: "gpt-4o",
          inputContext: ["transcript" as const, "shown_images" as const]
        },
        createdFrom: "template" as const,
        tags: ["multimodal", "template"]
      }
    ]

    // These three define a passing run; image evaluators are non-required.
    const requiredNames = new Set([
      "Tool Usage",
      "No Hallucination",
      "Helpful Resolution"
    ])
    const newIds: Array<Id<"evaluators">> = []
    const newRequiredIds: Array<Id<"evaluators">> = []
    for (const tmpl of templates) {
      if (existingTemplateNames.has(tmpl.name)) continue
      const id = await ctx.db.insert("evaluators", { orgId, ...tmpl })
      newIds.push(id)
      if (requiredNames.has(tmpl.name)) newRequiredIds.push(id)
    }

    if (newIds.length === 0) return { seeded: false, added: 0 }

    // Add the new templates to the Default set (create it if it doesn't exist).
    const sets = await ctx.db
      .query("evaluatorSets")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
    const defaultSet = sets.find((s) => s.name === "Default")

    if (defaultSet) {
      await ctx.db.patch(defaultSet._id, {
        evaluatorIds: [...defaultSet.evaluatorIds, ...newIds],
        requiredEvaluatorIds: [
          ...defaultSet.requiredEvaluatorIds,
          ...newRequiredIds
        ]
      })
    } else {
      await ctx.db.insert("evaluatorSets", {
        orgId,
        name: "Default",
        description: "Default evaluator set with template evaluators",
        evaluatorIds: newIds,
        requiredEvaluatorIds: newRequiredIds,
        passThreshold: 0.8
      })
    }

    return { seeded: true, added: newIds.length }
  }
})
