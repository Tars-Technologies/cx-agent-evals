"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { streamText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { composeSystemPrompt } from "./promptTemplate";
import { vectorSearchWithFilter } from "../lib/vectorSearch";

// Helper: resolve AI SDK model from model ID string
function resolveModel(modelId: string): LanguageModel {
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3") || modelId.startsWith("o4")) {
    return openai(modelId);
  }
  return anthropic(modelId);
}

// Helper: slugify a retriever name for use as a tool name
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

// Helper: convert stored messages to AI SDK format
function toAIMessages(
  messages: Array<{
    role: string;
    content: string;
    toolCall?: { toolCallId: string; toolName: string; toolArgs: string } | null;
    toolResult?: { toolCallId: string; toolName: string; result: string } | null;
  }>,
): Array<any> {
  const aiMessages: any[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === "user") {
      aiMessages.push({ role: "user", content: msg.content });
      i++;
    } else if (msg.role === "assistant") {
      // Look ahead for tool_call messages that follow
      const toolCalls: any[] = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool_call") {
        const tc = messages[j].toolCall!;
        toolCalls.push({
          type: "tool-call",
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: JSON.parse(tc.toolArgs),
        });
        j++;
      }

      if (toolCalls.length > 0) {
        const parts: any[] = [];
        if (msg.content) parts.push({ type: "text", text: msg.content });
        parts.push(...toolCalls);
        aiMessages.push({ role: "assistant", content: parts });

        while (j < messages.length && messages[j].role === "tool_result") {
          const tr = messages[j].toolResult!;
          aiMessages.push({
            role: "tool",
            content: [
              { type: "tool-result", toolCallId: tr.toolCallId, result: tr.result },
            ],
          });
          j++;
        }
        i = j;
      } else {
        aiMessages.push({ role: "assistant", content: msg.content });
        i++;
      }
    } else {
      i++;
    }
  }
  return aiMessages;
}

export const runAgent = internalAction({
  args: {
    conversationId: v.id("conversations"),
    agentId: v.id("agents"),
    assistantMessageId: v.id("messages"),
  },
  handler: async (ctx, { conversationId, agentId, assistantMessageId }) => {
    try {
      // 1. Load agent config
      const agent = await ctx.runQuery(internal.crud.agents.getInternal, { id: agentId });
      if (!agent) throw new Error("Agent not found");

      // 2. Load linked retrievers with KB info
      const retrieverInfos: Array<{
        id: string;
        name: string;
        kbName: string;
        kbId: string;
        indexConfigHash: string;
        indexStrategy: string;
        embeddingModel: string;
        defaultK: number;
        description?: string;
      }> = [];

      for (const retrieverId of agent.retrieverIds) {
        const retriever = await ctx.runQuery(internal.crud.retrievers.getInternal, {
          id: retrieverId,
        });
        if (!retriever || retriever.status !== "ready") continue;
        const kb = await ctx.runQuery(internal.crud.knowledgeBases.getInternal, {
          id: retriever.kbId,
        });
        retrieverInfos.push({
          id: retriever._id,
          name: retriever.name,
          kbName: kb?.name ?? "Unknown KB",
          kbId: retriever.kbId,
          indexConfigHash: retriever.indexConfigHash,
          indexStrategy: retriever.retrieverConfig.index.strategy,
          embeddingModel:
            retriever.retrieverConfig.index.embeddingModel ?? "text-embedding-3-small",
          defaultK: retriever.defaultK ?? 5,
        });
      }

      // 3. Build system prompt
      const systemPrompt = composeSystemPrompt(
        agent,
        retrieverInfos.map((r) => ({
          name: r.name,
          kbName: r.kbName,
        })),
      );

      // 4. Build AI SDK tools — one per retriever
      const tools: Record<string, any> = {};
      const retrieverMap = new Map(retrieverInfos.map((r) => [slugify(r.name), r]));

      for (const info of retrieverInfos) {
        const toolName = slugify(info.name);
        tools[toolName] = tool({
          description: `Search ${info.kbName} using ${info.name}`,
          parameters: z.object({
            query: z.string().describe("The search query"),
            k: z.number().optional().describe("Number of results to return"),
          }),
          execute: async ({ query, k }) => {
            const topK = k ?? info.defaultK;

            // Embed the query
            const { createEmbedder } = await import("rag-evaluation-system/llm");
            const embedder = createEmbedder(info.embeddingModel);
            const queryEmbedding = await embedder.embedQuery(query);

            // Vector search
            const { chunks } = await vectorSearchWithFilter(ctx, {
              queryEmbedding,
              kbId: info.kbId as any,
              indexConfigHash: info.indexConfigHash,
              topK,
              indexStrategy: info.indexStrategy,
            });

            return chunks.map((c: any) => ({
              content: c.content,
              documentId: c.documentId,
              start: c.start,
              end: c.end,
            }));
          },
        });
      }

      // 5. Load conversation history
      const allMessages = await ctx.runQuery(
        internal.crud.conversations.listMessagesInternal,
        { conversationId },
      );
      const historyMessages = allMessages.filter(
        (m: any) => m._id !== assistantMessageId,
      );
      const aiMessages = toAIMessages(historyMessages);

      // 6. Track order for new messages
      const lastOrder = allMessages.length > 0
        ? Math.max(...allMessages.map((m: any) => m.order))
        : -1;
      let nextOrder = lastOrder + 1;

      // 7. Stream the response
      let streamCursor = 0;
      let buffer = "";
      const FLUSH_INTERVAL_MS = 200;
      const FLUSH_CHAR_THRESHOLD = 50;
      let lastFlushTime = Date.now();

      const flushBuffer = async () => {
        if (buffer.length === 0) return;
        const text = buffer;
        const start = streamCursor;
        const end = streamCursor + text.length;
        streamCursor = end;
        buffer = "";
        lastFlushTime = Date.now();
        await ctx.runMutation(internal.crud.conversations.insertStreamDelta, {
          messageId: assistantMessageId,
          start,
          end,
          text,
        });
      };

      const result = streamText({
        model: resolveModel(agent.model),
        system: systemPrompt,
        messages: aiMessages,
        tools,
        maxSteps: 5,
        onStepFinish: async (step) => {
          if (step.toolCalls && step.toolCalls.length > 0) {
            for (const tc of step.toolCalls) {
              const retrieverInfo = retrieverMap.get(tc.toolName);
              await ctx.runMutation(internal.crud.conversations.insertMessage, {
                conversationId,
                order: nextOrder++,
                role: "tool_call",
                content: "",
                agentId,
                toolCall: {
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  toolArgs: JSON.stringify(tc.args),
                  retrieverId: retrieverInfo?.id as any,
                },
                status: "complete",
              });
            }
          }
          if (step.toolResults && step.toolResults.length > 0) {
            for (const tr of step.toolResults) {
              const retrieverInfo = retrieverMap.get(tr.toolName);
              await ctx.runMutation(internal.crud.conversations.insertMessage, {
                conversationId,
                order: nextOrder++,
                role: "tool_result",
                content: "",
                agentId,
                toolResult: {
                  toolCallId: tr.toolCallId,
                  toolName: tr.toolName,
                  result: JSON.stringify(tr.result),
                  retrieverId: retrieverInfo?.id as any,
                },
                status: "complete",
              });
            }
          }
        },
      });

      for await (const chunk of result.textStream) {
        buffer += chunk;
        const now = Date.now();
        if (
          buffer.length >= FLUSH_CHAR_THRESHOLD ||
          now - lastFlushTime >= FLUSH_INTERVAL_MS
        ) {
          await flushBuffer();
        }
      }
      await flushBuffer();

      // 8. Finalize the assistant message
      const [finalText, usage] = await Promise.all([result.text, result.usage]);
      await ctx.runMutation(internal.crud.conversations.updateMessage, {
        messageId: assistantMessageId,
        content: finalText,
        status: "complete",
        usage: usage
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
            }
          : undefined,
      });

      // Schedule delta cleanup
      await ctx.scheduler.runAfter(
        5000,
        internal.crud.conversations.cleanupStreamDeltas,
        { messageId: assistantMessageId },
      );
    } catch (error: any) {
      await ctx.runMutation(internal.crud.conversations.updateMessage, {
        messageId: assistantMessageId,
        content: `Something went wrong: ${error.message ?? "Unknown error"}. Please try again.`,
        status: "error",
      });
    }
  },
});

export const extractUrlContext = internalAction({
  args: {
    agentId: v.id("agents"),
    url: v.string(),
  },
  handler: async (ctx, { agentId, url }) => {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "CXAgentEvals/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();

      const { Readability } = await import("@mozilla/readability");
      const { parseHTML } = await import("linkedom");
      const { document } = parseHTML(html);
      const reader = new Readability(document as any);
      const article = reader.parse();

      const textContent = article?.textContent?.slice(0, 5000) ?? "";
      const title = article?.title ?? document.title ?? "";

      const { generateText } = await import("ai");
      const result = await generateText({
        model: anthropic("claude-haiku-4-20250514"),
        system:
          "You are a research assistant. Summarize the following company information in 2-3 concise paragraphs. Focus on: what the company does, their industry, key products/services, and target audience.",
        prompt: `Company website: ${url}\nTitle: ${title}\n\nContent:\n${textContent}`,
      });

      const agent = await ctx.runQuery(internal.crud.agents.getInternal, { id: agentId });
      if (agent) {
        await ctx.runMutation(internal.crud.agents.updateInternal, {
          id: agentId,
          identity: {
            ...agent.identity,
            companyContext: result.text,
          },
        });
      }
    } catch (error: any) {
      console.error("URL context extraction failed:", error.message);
    }
  },
});
