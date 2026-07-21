"use node"

import { anthropic } from "@ai-sdk/anthropic"
import { generateText, streamText, tool } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { internalAction } from "../_generated/server"
import { resolveModel, slugify } from "../lib/agentLoop"
import { vectorSearchWithFilter } from "../lib/vectorSearch"
import {
  buildGetImagesTool,
  isVisionCapable,
  resolveAnswerImageMarkers
} from "../lib/vision"
import { MENU_IMAGE_CAP, whitelistImageMarkdown } from "@tars-inc/eval-lib/multimodal"
import { rankMediaForDocs } from "../kb/media_runtime"
import { composeSystemPrompt } from "./promptTemplate"

// Helper: convert stored messages to AI SDK format
function toAIMessages(
  messages: Array<{
    role: string
    content: string
    toolCall?: { toolCallId: string; toolName: string; toolArgs: string } | null
    toolResult?: { toolCallId: string; toolName: string; result: string } | null
  }>
): Array<any> {
  const aiMessages: any[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg.role === "user") {
      aiMessages.push({ role: "user", content: msg.content })
      i++
    } else if (msg.role === "assistant") {
      const toolCalls: any[] = []
      let j = i + 1
      while (j < messages.length && messages[j].role === "tool_call") {
        const tc = messages[j].toolCall!
        toolCalls.push({
          type: "tool-call",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: JSON.parse(tc.toolArgs)
        })
        j++
      }

      if (toolCalls.length > 0) {
        const parts: any[] = []
        if (msg.content) parts.push({ type: "text", text: msg.content })
        parts.push(...toolCalls)
        aiMessages.push({ role: "assistant", content: parts })

        while (j < messages.length && messages[j].role === "tool_result") {
          const tr = messages[j].toolResult!
          aiMessages.push({
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: tr.toolCallId,
                toolName: tr.toolName,
                result: tr.result
              }
            ]
          })
          j++
        }
        i = j
      } else {
        aiMessages.push({ role: "assistant", content: msg.content })
        i++
      }
    } else {
      i++
    }
  }
  return aiMessages
}

export const runAgent = internalAction({
  args: {
    conversationId: v.id("conversations"),
    agentId: v.id("agents"),
    assistantMessageId: v.id("messages")
  },
  handler: async (ctx, { conversationId, agentId, assistantMessageId }) => {
    try {
      // 1. Load agent config
      const agent = await ctx.runQuery(internal.crud.agents.getInternal, {
        id: agentId
      })
      if (!agent) throw new Error("Agent not found")

      // 2. Load linked retrievers with KB info
      const retrieverInfos: Array<{
        id: string
        name: string
        kbName: string
        kbId: string
        indexConfigHash: string
        indexStrategy: string
        embeddingModel: string
        defaultK: number
        description?: string
      }> = []

      for (const retrieverId of agent.retrieverIds) {
        const retriever = await ctx.runQuery(
          internal.kb.retrievers.getInternal,
          {
            id: retrieverId
          }
        )
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

      // 3. Build system prompt. Vision degrades to text-only on a non-vision
      // model — it never re-routes the user-chosen model.
      const hasVision =
        (agent.enableMultimodal ?? false) &&
        isVisionCapable(agent.model) &&
        retrieverInfos.length > 0
      const systemPrompt = composeSystemPrompt(
        agent,
        retrieverInfos.map((r) => ({
          name: r.name,
          kbName: r.kbName
        })),
        { hasVision }
      )

      // 4. Build AI SDK tools — one per retriever
      const tools: Record<string, any> = {}
      const retrieverMap = new Map(
        retrieverInfos.map((r) => [slugify(r.name), r])
      )
      // Image ids the model fetched via get_images, for finalize whitelist (V4).
      const resolvedImages = new Map<string, { url: string; alt: string }>()
      // Every imageId offered across this turn's retrieval calls, for the
      // corrective-retry prompt below (a model sometimes fabricates a
      // plausible-looking URL instead of copying a real menu id).
      const lastImageMenu = new Map<
        string,
        { imageId: string; alt: string; type?: string }
      >()

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

            const cleanChunks = chunks.map((c: any) => ({
              content: c.content,
              documentId: c.documentId,
              start: c.start,
              end: c.end
            }))
            // Track the media menu offered this turn so a corrective retry (below)
            // can tell the model exactly which imageIds are actually valid.
            for (const img of images) lastImageMenu.set(img.imageId, img)
            return { chunks: cleanChunks, images }
          }
        })
      }

      // Images are scoped to every KB this agent can search (one agent may link
      // retrievers across several KBs; getImagesByIds validates kb+org).
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

      // 5. Load conversation history
      const allMessages = await ctx.runQuery(
        internal.crud.conversations.listMessagesInternal,
        { conversationId }
      )
      const historyMessages = allMessages.filter(
        (m: any) => m._id !== assistantMessageId
      )
      const aiMessages = toAIMessages(historyMessages)

      // 6. Track order for new messages
      const lastOrder =
        allMessages.length > 0
          ? Math.max(...allMessages.map((m: any) => m.order))
          : -1
      let nextOrder = lastOrder + 1

      // 7. Stream the response using fullStream (handles multi-step tool use properly)
      let streamCursor = 0
      let toolCallCount = 0
      let buffer = ""
      const FLUSH_INTERVAL_MS = 200
      const FLUSH_CHAR_THRESHOLD = 50
      let lastFlushTime = Date.now()

      const flushBuffer = async () => {
        if (buffer.length === 0) return
        const text = buffer
        const start = streamCursor
        const end = streamCursor + text.length
        streamCursor = end
        buffer = ""
        lastFlushTime = Date.now()
        await ctx.runMutation(internal.crud.conversations.insertStreamDelta, {
          messageId: assistantMessageId,
          start,
          end,
          text
        })
      }

      const result = streamText({
        model: resolveModel(agent.model),
        system: systemPrompt,
        messages: aiMessages,
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        maxSteps: 8
      })

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          buffer += part.textDelta
          const now = Date.now()
          if (
            buffer.length >= FLUSH_CHAR_THRESHOLD ||
            now - lastFlushTime >= FLUSH_INTERVAL_MS
          ) {
            await flushBuffer()
          }
        } else if (part.type === "tool-call") {
          toolCallCount++
          const retrieverInfo = retrieverMap.get(part.toolName)
          await ctx.runMutation(internal.crud.conversations.insertMessage, {
            conversationId,
            order: nextOrder++,
            role: "tool_call",
            content: "",
            agentId,
            toolCall: {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              toolArgs: JSON.stringify(part.args),
              retrieverId: retrieverInfo?.id as any
            },
            status: "complete"
          })
        } else if (part.type === "tool-result") {
          const retrieverInfo = retrieverMap.get(part.toolName)
          await ctx.runMutation(internal.crud.conversations.insertMessage, {
            conversationId,
            order: nextOrder++,
            role: "tool_result",
            content: "",
            agentId,
            toolResult: {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              result: JSON.stringify(part.result),
              retrieverId: retrieverInfo?.id as any
            },
            status: "complete"
          })
        }
      }
      await flushBuffer()

      // 8. Finalize the assistant message.
      let rawFinalText = (await result.text) ?? ""
      const usage = await result.usage

      // Recovery: if the step budget was spent on tool calls (e.g. retrieve +
      // get_images) without producing text, force one text-only pass so live
      // chat never silently truncates to empty. Mirrors lib/agentLoop.ts.
      if (
        (!rawFinalText || rawFinalText.trim().length === 0) &&
        toolCallCount > 0
      ) {
        const responseMessages = (await result.response)?.messages
        const recovery = await generateText({
          model: resolveModel(agent.model),
          system:
            systemPrompt +
            "\n\nYou have already gathered information using tools. Provide your best response to the user based on what you found. Do not call any more tools.",
          messages: responseMessages
            ? [...aiMessages, ...(responseMessages as any)]
            : aiMessages
        })
        rawFinalText = recovery.text ?? ""
        // Streaming already finished; flush the recovered text as one delta.
        if (rawFinalText) {
          buffer += rawFinalText
          await flushBuffer()
        }
      }

      // Corrective retry (image reliability): a model occasionally fabricates a
      // plausible-looking URL (e.g. a Wikipedia-style path) from its own general
      // knowledge instead of copying the real imageId it was given — the
      // whitelist below correctly strips that (it's not a real, retrieved
      // target), but the user is left with a promised-then-missing image. If the
      // model attempted to show media (wrote an `![alt](...)` marker) but none of
      // it references a real menu id, despite a real menu being available this
      // turn, give it exactly one chance to rewrite using only the ids that
      // actually exist before we finalize.
      //
      // A model can also comply with the letter but not the spirit: instead of
      // fixing the marker it may downgrade the SAME fabricated URL to a plain
      // hyperlink (`[text](url)`), which the whitelist deliberately leaves alone
      // (it must not mangle the legitimate citation links a model writes all the
      // time). So beyond re-prompting, we track the exact fabricated targets from
      // the ORIGINAL attempt and, as a backstop that doesn't depend on model
      // cooperation, strip any later reference — image or link — to those exact
      // same targets. Real, unrelated citations are untouched since we only ever
      // match strings the model itself already produced this turn.
      const MEDIA_ID_RE = /^(?:img|vid|doc)_[0-9a-f]+$/
      const firstPassInvalidTargets = new Set(
        [...rawFinalText.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)]
          .map((m) => m[1])
          .filter((t) => !MEDIA_ID_RE.test(t))
      )
      const attemptedMedia = firstPassInvalidTargets.size > 0
      if (attemptedMedia && lastImageMenu.size > 0) {
        const validIds = [...lastImageMenu.keys()].join(", ")
        const correction = await generateText({
          model: resolveModel(agent.model),
          system:
            systemPrompt +
            `\n\nYour previous reply referenced media using a URL or id that does not exist — it will not display. The ONLY valid media ids right now are: ${validIds}. Rewrite your ENTIRE reply: use the exact marker ![alt](imageId) with one of those ids wherever you meant to show media. Do not cite the broken reference as a plain link either — if none of the valid ids fit, drop the reference completely and say in one short sentence that the image isn't available, without a URL of any kind.`,
          messages: [...aiMessages, { role: "assistant", content: rawFinalText }]
        })
        if (correction.text) {
          rawFinalText = correction.text
          buffer += rawFinalText
          await flushBuffer()
        }
      }
      // Backstop: neutralize any remaining image OR link reference to a target
      // we already proved fabricated this turn, regardless of what the
      // corrective retry produced (or whether it ran at all).
      for (const target of firstPassInvalidTargets) {
        const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        rawFinalText = rawFinalText
          .replace(new RegExp(`!\\[([^\\]]*)\\]\\(${escaped}\\)`, "g"), "$1")
          .replace(new RegExp(`(?<!!)\\[([^\\]]*)\\]\\(${escaped}\\)`, "g"), "$1")
      }

      // Whitelist rewrites known image markers → urls and drops
      // hallucinated/external ones (V4/V9). Resolve markers the model wrote
      // inline (even without a get_images call) against the KB registry so a
      // relevant image still renders. Always run it so stray img_ markers from
      // retrieved chunk text can't leak as broken images on text-only agents.
      const resolvedForFinalize =
        hasVision && imageKbIds.length > 0
          ? await resolveAnswerImageMarkers(
              ctx,
              { kbIds: imageKbIds, orgId: agent.orgId },
              rawFinalText,
              resolvedImages
            )
          : new Map<string, { url: string; alt: string }>()
      const { text: finalText } = whitelistImageMarkdown(rawFinalText, resolvedForFinalize)
      await ctx.runMutation(internal.crud.conversations.updateMessage, {
        messageId: assistantMessageId,
        content: finalText,
        status: "complete",
        usage: usage
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens
            }
          : undefined
      })

      // Schedule delta cleanup
      await ctx.scheduler.runAfter(
        5000,
        internal.crud.conversations.cleanupStreamDeltas,
        { messageId: assistantMessageId }
      )
    } catch (error: any) {
      const errorDetail = {
        name: error?.name,
        message: error?.message,
        statusCode: error?.statusCode,
        responseBody: error?.responseBody,
        cause: error?.cause?.message ?? error?.cause,
        agentId
      }
      console.error("[runAgent] FAILED:", JSON.stringify(errorDetail, null, 2))
      if (error?.stack)
        console.error(
          "[runAgent] Stack:",
          error.stack.split("\n").slice(0, 5).join("\n")
        )
      try {
        await ctx.runMutation(internal.crud.conversations.updateMessage, {
          messageId: assistantMessageId,
          content: `Error: ${error.message ?? "Unknown error"}. Please try again.`,
          status: "error"
        })
      } catch (updateError: any) {
        console.error(
          "[runAgent] Failed to save error to message:",
          updateError?.message
        )
      }
      throw error
    }
  }
})

export const extractUrlContext = internalAction({
  args: {
    agentId: v.id("agents"),
    url: v.string()
  },
  handler: async (ctx, { agentId, url }) => {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "CXAgentEvals/1.0" },
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const html = await response.text()

      const { Readability } = await import("@mozilla/readability")
      const { parseHTML } = await import("linkedom")
      const { document } = parseHTML(html)
      const reader = new Readability(document as any)
      const article = reader.parse()

      const textContent = article?.textContent?.slice(0, 5000) ?? ""
      const title = article?.title ?? document.title ?? ""

      const { generateText } = await import("ai")
      const result = await generateText({
        model: anthropic("claude-haiku-4-5-20251001"),
        system:
          "You are a research assistant. Summarize the following company information in 2-3 concise paragraphs. Focus on: what the company does, their industry, key products/services, and target audience.",
        prompt: `Company website: ${url}\nTitle: ${title}\n\nContent:\n${textContent}`
      })

      const agent = await ctx.runQuery(internal.crud.agents.getInternal, {
        id: agentId
      })
      if (agent) {
        await ctx.runMutation(internal.crud.agents.updateInternal, {
          id: agentId,
          identity: {
            ...agent.identity,
            companyContext: result.text
          }
        })
      }
    } catch (error: any) {
      console.error("URL context extraction failed:", error.message)
    }
  }
})
