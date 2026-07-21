"use node"

import {
  type CharacterSpan,
  DocumentId,
  f1,
  iou,
  precision,
  recall
} from "@tars-inc/eval-lib"
import { generateText, tool } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { internalAction } from "../_generated/server"
import { composeSystemPrompt } from "../agents/promptTemplate"
import { finalizeMediaAnswer, resolveModel } from "../lib/agentLoop"
import { vectorSearchWithFilter } from "../lib/vectorSearch"
import { buildGetImagesTool } from "../lib/vision"
import { isVisionCapable, MENU_IMAGE_CAP } from "@tars-inc/eval-lib/multimodal"
import { rankMediaForDocs } from "../kb/media_runtime"

// ─── Helpers ───

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64)
}

const metricFns = [recall, precision, iou, f1]

function computePerQuestionScores(
  retrievedChunks: Array<{
    docId: string
    start: number
    end: number
    content: string
  }>,
  groundTruthSpans: Array<{
    docId: string
    start: number
    end: number
    text: string
  }>
): Record<string, number> {
  const retrieved: CharacterSpan[] = retrievedChunks.map((c) => ({
    docId: DocumentId(c.docId),
    start: c.start,
    end: c.end,
    text: c.content
  }))

  const groundTruth: CharacterSpan[] = groundTruthSpans.map((s) => ({
    docId: DocumentId(s.docId),
    start: s.start,
    end: s.end,
    text: s.text
  }))

  const scores: Record<string, number> = {}
  for (const metric of metricFns) {
    scores[metric.name] = metric.calculate(retrieved, groundTruth)
  }
  return scores
}

// ─── Setup Action (lightweight orchestrator) ───

/**
 * Loads questions and enqueues one WorkPool item per question.
 * Scheduled by startAgentExperiment mutation.
 */
export const runAgentExperimentSetup = internalAction({
  args: {
    experimentId: v.id("experiments"),
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases")
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.kb.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "initializing"
      })

      const experiment = await ctx.runQuery(
        internal.kb.experiments.getInternal,
        { id: args.experimentId }
      )

      if (!experiment.agentId) {
        throw new Error("Agent experiment missing agentId")
      }
      // experiments.agentId is stored as a plain string in kb.schema (so the KB
      // schema stays agent-free); cast back to Id<"agents"> for agent-domain use.
      const agentId = experiment.agentId as Id<"agents">

      // Verify agent exists and has ready retrievers
      const agent = await ctx.runQuery(internal.crud.agents.getInternal, {
        id: agentId
      })
      if (!agent) throw new Error("Agent not found")

      let hasReadyRetriever = false
      for (const retrieverId of agent.retrieverIds) {
        const retriever = await ctx.runQuery(
          internal.kb.retrievers.getInternal,
          { id: retrieverId }
        )
        if (retriever && retriever.status === "ready") {
          hasReadyRetriever = true
          break
        }
      }
      if (!hasReadyRetriever) {
        throw new Error("Agent has no ready retrievers")
      }

      // Load questions, filter by ground truth
      const allQuestions = await ctx.runQuery(
        internal.kb.questions.byDatasetInternal,
        { datasetId: args.datasetId }
      )
      const questions = allQuestions.filter(
        (q: any) => Array.isArray(q.relevantSpans) && q.relevantSpans.length > 0
      )

      if (questions.length === 0) {
        await ctx.runMutation(internal.kb.experiments.updateStatus, {
          experimentId: args.experimentId,
          status: "completed",
          phase: "done",
          totalQuestions: 0,
          scores: { recall: 0, precision: 0, iou: 0, f1: 0 }
        })
        return
      }

      await ctx.runMutation(internal.kb.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "evaluating",
        totalQuestions: questions.length
      })

      // Enqueue all questions into the WorkPool
      await ctx.runMutation(
        internal.experiments.orchestration.enqueueAgentQuestions,
        {
          experimentId: args.experimentId,
          questionIds: questions.map((q: any) => q._id),
          agentId,
          kbId: args.kbId
        }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[runAgentExperimentSetup] FAILED:", message)
      await ctx.runMutation(internal.kb.experiments.updateStatus, {
        experimentId: args.experimentId,
        status: "failed",
        error: message
      })
    }
  }
})

// ─── Per-Question Action ───

/**
 * Evaluates a single question against the agent.
 * Enqueued by WorkPool — runs independently with retry support.
 */
export const evaluateAgentQuestion = internalAction({
  args: {
    experimentId: v.id("experiments"),
    questionId: v.id("questions"),
    agentId: v.id("agents"),
    kbId: v.id("knowledgeBases")
  },
  handler: async (ctx, args) => {
    const startTime = Date.now()

    // 1. Load agent config
    const agent = await ctx.runQuery(internal.crud.agents.getInternal, {
      id: args.agentId
    })
    if (!agent) throw new Error("Agent not found")

    // 2. Load agent's retrievers + KB info
    const retrieverInfos: Array<{
      id: string
      name: string
      kbName: string
      kbId: string
      indexConfigHash: string
      indexStrategy: string
      embeddingModel: string
      defaultK: number
    }> = []

    for (const retrieverId of agent.retrieverIds) {
      const retriever = await ctx.runQuery(internal.kb.retrievers.getInternal, {
        id: retrieverId
      })
      if (!retriever || retriever.status !== "ready") continue
      const kb = await ctx.runQuery(internal.kb.core.getInternal, {
        id: retriever.kbId
      })
      retrieverInfos.push({
        id: retriever._id,
        name: retriever.name,
        kbName: kb?.name ?? "Unknown KB",
        kbId: retriever.kbId,
        indexConfigHash: retriever.indexConfigHash,
        indexStrategy: retriever.retrieverConfig.index.strategy,
        embeddingModel:
          retriever.retrieverConfig.index.embeddingModel ??
          "text-embedding-3-small",
        defaultK: retriever.defaultK ?? 5
      })
    }

    if (retrieverInfos.length === 0) {
      throw new Error("Agent has no ready retrievers")
    }

    // 3. Build system prompt. Vision degrades to text on a non-vision model.
    const hasVision =
      (agent.enableMultimodal ?? false) && isVisionCapable(agent.model)
    const systemPrompt = composeSystemPrompt(
      agent,
      retrieverInfos.map((r) => ({ name: r.name, kbName: r.kbName })),
      { hasVision }
    )
    // Images the model fetched via get_images, for whitelist + shownImages.
    const resolvedImages = new Map<string, { url: string; alt: string }>()
    // Every imageId offered this turn, so the shared finalize's corrective retry
    // can list the ids that actually exist.
    const lastImageMenu = new Map<
      string,
      { imageId: string; alt: string; type?: string }
    >()

    // 4. Build AI SDK tools — one per retriever
    const allToolCallResults: Array<{
      toolName: string
      query: string
      retrieverId: string | undefined
      chunks: Array<{
        content: string
        docId: string
        start: number
        end: number
        images?: Array<{ imageId: string; alt: string }>
      }>
    }> = []

    const tools: Record<string, any> = {}

    for (const info of retrieverInfos) {
      const toolName = slugify(info.name)
      tools[toolName] = tool({
        description: `Search ${info.kbName} using ${info.name}`,
        parameters: z.object({
          query: z.string().describe("The search query"),
          k: z.number().optional().describe("Number of results to return")
        }),
        execute: async ({ query, k }) => {
          const topK = k ?? info.defaultK

          const { createEmbedder } = await import("@tars-inc/eval-lib/llm")
          const embedder = createEmbedder(info.embeddingModel)
          const queryEmbedding = await embedder.embedQuery(query)

          const { chunks } = await vectorSearchWithFilter(ctx, {
            queryEmbedding,
            kbId: info.kbId as any,
            indexConfigHash: info.indexConfigHash,
            topK,
            indexStrategy: info.indexStrategy
          })

          // Doc-gated image menu (E9): docs ordered by best chunk rank.
          // Ranking happens DB-side so embeddings never ship to the action.
          const docOrder: Id<"documents">[] = []
          const seenDoc = new Set<string>()
          for (const c of chunks) {
            const id = c.documentId as Id<"documents">
            if (!seenDoc.has(id)) {
              seenDoc.add(id)
              docOrder.push(id)
            }
          }
          const images = await rankMediaForDocs(ctx, {
            kbId: info.kbId as Id<"knowledgeBases">,
            documentIds: docOrder,
            queryEmbedding,
            cap: MENU_IMAGE_CAP
          })

          const mappedChunks = chunks.map((c: any) => ({
            content: c.content,
            docId: c.docId,
            start: c.start,
            end: c.end
          }))
          for (const img of images) lastImageMenu.set(img.imageId, img)

          allToolCallResults.push({
            toolName,
            query,
            retrieverId: info.id,
            chunks: mappedChunks
          })

          return { chunks: mappedChunks, images }
        }
      })
    }

    // Scope images to every KB this agent can search (not just the first).
    const imageKbIds = [
      ...new Set(retrieverInfos.map((r) => r.kbId))
    ] as Id<"knowledgeBases">[]
    if (hasVision && imageKbIds.length > 0) {
      tools.get_images = buildGetImagesTool(
        ctx,
        { kbIds: imageKbIds, orgId: agent.orgId },
        (resolved) => {
          for (const r of resolved)
            resolvedImages.set(r.imageId, { url: r.url, alt: r.alt })
        }
      )
    }

    // 5. Load question
    const question = await ctx.runQuery(internal.kb.questions.getInternal, {
      id: args.questionId
    })
    if (!question) throw new Error("Question not found")

    // 6. Call generateText
    try {
      const result = await generateText({
        model: resolveModel(agent.model),
        system: systemPrompt,
        messages: [{ role: "user", content: question.queryText }],
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        maxSteps: 8
      })

      const latencyMs = Date.now() - startTime

      // Shared finalize (corrective retry + backstop + whitelist + shownImages),
      // identical to live chat and the simulation loop so the experiment scores
      // the same image behavior. shownImages = what the model actually rendered
      // (D8: recorded, not scored).
      const { finalText: answerText, shownImages } = await finalizeMediaAnswer(
        ctx,
        {
          rawText: result.text,
          aiMessages: [{ role: "user", content: question.queryText }],
          systemPrompt,
          modelId: agent.model,
          hasVision: hasVision && imageKbIds.length > 0,
          imageScope:
            hasVision && imageKbIds.length > 0
              ? { kbIds: imageKbIds, orgId: agent.orgId }
              : undefined,
          resolvedImages,
          lastImageMenu
        }
      )

      // 7. Extract tool calls + chunks
      const toolCalls = [...allToolCallResults]
      const retrievedChunks = toolCalls.flatMap((tc) => tc.chunks)

      // 8. Compute metrics
      const scores = computePerQuestionScores(
        retrievedChunks,
        question.relevantSpans
      )

      // 9. Insert result
      await ctx.runMutation(internal.experiments.agentResults.insert, {
        experimentId: args.experimentId,
        questionId: args.questionId,
        answerText,
        toolCalls: toolCalls.map((tc) => ({
          toolName: tc.toolName,
          query: tc.query,
          retrieverId: tc.retrieverId,
          chunks: tc.chunks
        })),
        retrievedChunks,
        scores,
        shownImages: shownImages.length > 0 ? shownImages : undefined,
        usage: result.usage
          ? {
              promptTokens: result.usage.promptTokens,
              completionTokens: result.usage.completionTokens
            }
          : undefined,
        latencyMs,
        status: "complete"
      })

      return { status: "complete", scores }
    } catch (error: any) {
      const latencyMs = Date.now() - startTime
      await ctx.runMutation(internal.experiments.agentResults.insert, {
        experimentId: args.experimentId,
        questionId: args.questionId,
        answerText: "",
        toolCalls: [],
        retrievedChunks: [],
        latencyMs,
        status: "error",
        error: error?.message ?? "Unknown error"
      })
      // Re-throw so WorkPool marks this as failed (triggers retry)
      throw error
    }
  }
})
