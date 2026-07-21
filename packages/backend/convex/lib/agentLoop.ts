"use node"

import { anthropic } from "@ai-sdk/anthropic"
import { openai } from "@ai-sdk/openai"
import { generateText, type LanguageModel, tool } from "ai"
import { z } from "zod"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"
import { vectorSearchWithFilter } from "./vectorSearch"
import { buildGetImagesTool, resolveAnswerImageMarkers } from "./vision"
import { rankMediaForDocs } from "../kb/media_runtime"
import {
  MENU_IMAGE_CAP,
  parseRenderedMediaIds,
  whitelistImageMarkdown
} from "@tars-inc/eval-lib/multimodal"

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
  imageScope?: { kbIds: string[]; orgId: string }
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
  /** Media actually rendered in the final answer (marker present and resolved),
   *  including images cited inline from chunk text — not just get_images fetches. */
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

// A marker target that is a real KB media id (vs. a fabricated/external URL).
const MEDIA_ID_RE = /^(?:img|vid|doc)_[0-9a-f]+$/

/**
 * Shared image-answer finalize used by BOTH the live-chat loop (agents/actions.ts)
 * and the simulation loop (runAgentLoop) so they can't drift. Steps:
 *
 * 1. Corrective retry — if the model wrote an `![alt](target)` whose target isn't
 *    a real media id (it fabricated a URL) yet a real menu existed this turn, give
 *    it one chance to rewrite using only valid ids.
 * 2. Backstop — strip any remaining image OR link reference to a target we already
 *    proved fabricated this turn, regardless of whether the retry cooperated.
 * 3. Resolve inline markers against the KB registry, compute `shownImages` (what
 *    the model actually rendered, pre-whitelist), then whitelist markers → urls
 *    and drop hallucinated/external ones (V4/V9).
 *
 * `onCorrectionText` lets the streaming caller flush the rewritten text as a
 * delta; the non-streaming caller omits it.
 */
export async function finalizeMediaAnswer(
  ctx: ActionCtx,
  opts: {
    rawText: string
    aiMessages: any[]
    systemPrompt: string
    modelId: string
    hasVision: boolean
    imageScope?: { kbIds: string[]; orgId: string }
    resolvedImages: Map<string, { url: string; alt: string }>
    lastImageMenu: Map<string, { imageId: string; alt: string; type?: string }>
    onCorrectionText?: (text: string) => Promise<void>
  }
): Promise<{
  finalText: string
  shownImages: Array<{ imageId: string; url: string; alt: string }>
}> {
  let rawText = opts.rawText

  // (1) Fabricated-target detection + one corrective retry.
  const firstPassInvalidTargets = new Set(
    [...rawText.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)]
      .map((m) => m[1])
      .filter((t) => !MEDIA_ID_RE.test(t))
  )
  if (firstPassInvalidTargets.size > 0 && opts.lastImageMenu.size > 0) {
    const validIds = [...opts.lastImageMenu.keys()].join(", ")
    // The instruction must land as a trailing `user` message, not appended to
    // `system` with the reply left as the last `assistant` message — a message
    // array ending in `assistant` is treated as a prefill by the AI SDK, so the
    // model would just CONTINUE rawText's text instead of rewriting it.
    const correction = await generateText({
      model: resolveModel(opts.modelId),
      system: opts.systemPrompt,
      messages: [
        ...opts.aiMessages,
        { role: "assistant", content: rawText },
        {
          role: "user",
          content: `Your previous reply referenced media using a URL or id that does not exist — it will not display. The ONLY valid media ids right now are: ${validIds}. Rewrite your ENTIRE reply: use the exact marker ![alt](imageId) with one of those ids wherever you meant to show media. Do not cite the broken reference as a plain link either — if none of the valid ids fit, drop the reference completely and say in one short sentence that the image isn't available, without a URL of any kind.`
        }
      ]
    })
    if (correction.text) {
      rawText = correction.text
      if (opts.onCorrectionText) await opts.onCorrectionText(correction.text)
    }
  }

  // (2) Backstop: neutralize any image OR link reference to a proven-fabricated
  // target, whatever the retry produced (or if it never ran). Only ever matches
  // strings the model itself already emitted this turn, so real citations survive.
  for (const target of firstPassInvalidTargets) {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    rawText = rawText
      .replace(new RegExp(`!\\[([^\\]]*)\\]\\(${escaped}\\)`, "g"), "$1")
      .replace(new RegExp(`(?<!!)\\[([^\\]]*)\\]\\(${escaped}\\)`, "g"), "$1")
  }

  // (3) Resolve → shownImages (pre-whitelist) → whitelist.
  const resolved =
    opts.hasVision && opts.imageScope
      ? await resolveAnswerImageMarkers(
          ctx,
          {
            kbIds: opts.imageScope.kbIds as Id<"knowledgeBases">[],
            orgId: opts.imageScope.orgId
          },
          rawText,
          opts.resolvedImages
        )
      : new Map<string, { url: string; alt: string }>()
  const shownImages = parseRenderedMediaIds(rawText)
    .filter((id) => resolved.has(id))
    .map((id) => ({ imageId: id, ...resolved.get(id)! }))
  const finalText = whitelistImageMarkdown(rawText, resolved).text
  return { finalText, shownImages }
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
  // Every imageId offered across this turn's retrieval calls, so the shared
  // finalize can tell the model which ids are real on a corrective retry.
  const lastImageMenu = new Map<
    string,
    { imageId: string; alt: string; type?: string }
  >()

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
        // Skip the Qdrant round-trip entirely for non-vision runs — they get no
        // media instructions or get_images tool, so the menu would be dead weight.
        const images =
          config.hasVision && config.imageScope
            ? await rankMediaForDocs(ctx, {
                kbId: info.kbId as Id<"knowledgeBases">,
                documentIds: docOrder,
                queryEmbedding,
                cap: MENU_IMAGE_CAP
              })
            : []

        const cleanChunks = chunks.map((c: any) => ({
          content: c.content,
          documentId: c.documentId,
          start: c.start,
          end: c.end
        }))
        // Track the media menu offered this turn so the shared finalize's
        // corrective retry can list the ids that actually exist.
        for (const img of images) lastImageMenu.set(img.imageId, img)
        const result = { chunks: cleanChunks, images }

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
        kbIds: config.imageScope.kbIds as Id<"knowledgeBases">[],
        orgId: config.imageScope.orgId
      },
      (resolved) => {
        for (const r of resolved)
          resolvedImages.set(r.imageId, { url: r.url, alt: r.alt })
      }
    )
  }

  try {
    const hasTools = Object.keys(tools).length > 0
    const result = await generateText({
      model: resolveModel(config.modelId),
      system: config.systemPrompt,
      messages,
      tools: hasTools ? tools : undefined,
      maxSteps: 8
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

    // Shared finalize (corrective retry + backstop + whitelist + shownImages),
    // identical to the live-chat path so simulations evaluate production behavior.
    const { finalText: outText, shownImages } = await finalizeMediaAnswer(ctx, {
      rawText: finalText,
      aiMessages: messages,
      systemPrompt: config.systemPrompt,
      modelId: config.modelId,
      hasVision: !!(config.hasVision && config.imageScope),
      imageScope: config.imageScope,
      resolvedImages,
      lastImageMenu
    })

    return {
      text: outText,
      toolCalls: collectedToolCalls,
      usage: { promptTokens, completionTokens },
      // Only flag done when we genuinely have nothing to say (recovery also
      // failed). A normal "agent finished its turn with text" must NOT mark
      // the conversation as done — the user-sim drives termination.
      done: !outText || outText.trim().length === 0,
      shownImages
    }
  } catch (err: any) {
    return {
      text: "",
      toolCalls: collectedToolCalls,
      usage: { promptTokens: 0, completionTokens: 0 },
      done: false,
      error: err.message ?? String(err),
      shownImages: []
    }
  }
}
