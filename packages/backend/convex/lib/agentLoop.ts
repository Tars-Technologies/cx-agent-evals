"use node"

import { anthropic } from "@ai-sdk/anthropic"
import { openai } from "@ai-sdk/openai"
import { generateText, type LanguageModel, tool } from "ai"
import { z } from "zod"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"
import { vectorSearchWithFilter } from "./vectorSearch"
import { buildGetImagesTool } from "./vision"

// === Shared types ===

export interface RetrieverInfo {
  id: string
  name: string
  kbName: string
  kbId: string
  indexConfigHash: string
  indexStrategy: string
  embeddingModel: string
  defaultK: number
}

export interface AgentLoopConfig {
  modelId: string
  systemPrompt: string
  retrieverInfos: RetrieverInfo[]
  /** When true (and imageScope set), register the get_images vision tool. */
  hasVision?: boolean
  imageScope?: { kbId: string; orgId: string }
}

export interface ToolCallRecord {
  toolName: string
  args: Record<string, unknown>
  result: string
  retrieverId?: string
}

export interface AgentLoopResult {
  text: string
  toolCalls: ToolCallRecord[]
  usage: { promptTokens: number; completionTokens: number }
  done: boolean
  error?: string
  /** Images the model fetched via get_images this turn (record-only). */
  shownImages: Array<{ imageId: string; url: string; alt: string }>
}

// === Shared helpers ===

export function resolveModel(modelId: string): LanguageModel {
  if (
    modelId.startsWith("gpt-") ||
    modelId.startsWith("o1") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4")
  ) {
    return openai(modelId)
  }
  return anthropic(modelId)
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64)
}

// === Agent loop ===

export async function runAgentLoop(
  ctx: ActionCtx,
  config: AgentLoopConfig,
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<AgentLoopResult> {
  const collectedToolCalls: ToolCallRecord[] = []
  // Images the model fetched via get_images this turn (whitelist + record).
  const resolvedImages = new Map<string, { url: string; alt: string }>()

  // Build tools from retriever infos (same pattern as agents/actions.ts)
  const tools: Record<string, any> = {}
  for (const info of config.retrieverInfos) {
    const toolName = slugify(info.name)
    tools[toolName] = tool({
      description: `Search ${info.kbName} using ${info.name}`,
      parameters: z.object({
        query: z.string().describe("The search query"),
        k: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe(
            "Number of chunks to return. Prefer 5–10; higher values dilute relevance with noise."
          )
      }),
      execute: async ({ query, k }) => {
        const { createEmbedder } = await import("@tars-inc/eval-lib/llm")
        const embedder = createEmbedder(info.embeddingModel)
        const queryEmbedding = await embedder.embedQuery(query)

        const { chunks } = await vectorSearchWithFilter(ctx, {
          queryEmbedding,
          kbId: info.kbId as any,
          indexConfigHash: info.indexConfigHash,
          topK: k ?? info.defaultK,
          indexStrategy: info.indexStrategy
        })

        const result = chunks.map((c: any) => ({
          content: c.content,
          documentId: c.documentId,
          start: c.start,
          end: c.end,
          ...(c.metadata?.images?.length
            ? {
                images: (
                  c.metadata.images as Array<{ imageId: string; alt: string }>
                ).map((i) => ({ imageId: i.imageId, alt: i.alt }))
              }
            : {})
        }))

        collectedToolCalls.push({
          toolName,
          args: { query, k },
          result: JSON.stringify(result),
          retrieverId: info.id
        })

        return result
      }
    })
  }

  if (config.hasVision && config.imageScope) {
    tools.get_images = buildGetImagesTool(
      ctx,
      {
        kbId: config.imageScope.kbId as Id<"knowledgeBases">,
        orgId: config.imageScope.orgId
      },
      (resolved) => {
        for (const r of resolved)
          resolvedImages.set(r.imageId, { url: r.url, alt: r.alt })
      }
    )
  }

  const shownImages = () =>
    Array.from(resolvedImages.entries()).map(([imageId, v]) => ({
      imageId,
      url: v.url,
      alt: v.alt
    }))

  try {
    const hasTools = Object.keys(tools).length > 0
    const result = await generateText({
      model: resolveModel(config.modelId),
      system: config.systemPrompt,
      messages,
      tools: hasTools ? tools : undefined,
      maxSteps: 12
    })

    let finalText = result.text
    let promptTokens = result.usage?.promptTokens ?? 0
    let completionTokens = result.usage?.completionTokens ?? 0

    // Recovery: if the step budget was exhausted on tool calls without producing
    // a final text response, force one more text-only call so the user-sim has
    // something to react to. Without this, the conversation silently truncates.
    const noText = !finalText || finalText.trim().length === 0
    if (noText && hasTools && collectedToolCalls.length > 0) {
      const followupMessages = result.response?.messages
        ? [
            ...messages,
            ...(result.response.messages as Array<{
              role: "user" | "assistant"
              content: any
            }>)
          ]
        : messages

      const recovery = await generateText({
        model: resolveModel(config.modelId),
        system:
          config.systemPrompt +
          "\n\nYou have already gathered information using tools. Provide your best response to the user based on what you found. Do not call any more tools.",
        messages: followupMessages as any
      })

      finalText = recovery.text
      promptTokens += recovery.usage?.promptTokens ?? 0
      completionTokens += recovery.usage?.completionTokens ?? 0
    }

    return {
      text: finalText,
      toolCalls: collectedToolCalls,
      usage: { promptTokens, completionTokens },
      // Only flag done when we genuinely have nothing to say (recovery also
      // failed). A normal "agent finished its turn with text" must NOT mark
      // the conversation as done — the user-sim drives termination.
      done: !finalText || finalText.trim().length === 0,
      shownImages: shownImages()
    }
  } catch (err: any) {
    return {
      text: "",
      toolCalls: collectedToolCalls,
      usage: { promptTokens: 0, completionTokens: 0 },
      done: false,
      error: err.message ?? String(err),
      shownImages: shownImages()
    }
  }
}
