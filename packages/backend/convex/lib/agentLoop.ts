"use node";

import type { ActionCtx } from "../_generated/server";
import { generateText, tool, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { vectorSearchWithFilter } from "./vectorSearch";

// === Shared types ===

export interface RetrieverInfo {
  id: string;
  name: string;
  kbName: string;
  kbId: string;
  indexConfigHash: string;
  indexStrategy: string;
  embeddingModel: string;
  defaultK: number;
}

export interface AgentLoopConfig {
  modelId: string;
  systemPrompt: string;
  retrieverInfos: RetrieverInfo[];
}

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  retrieverId?: string;
}

export interface AgentLoopResult {
  text: string;
  toolCalls: ToolCallRecord[];
  usage: { promptTokens: number; completionTokens: number };
  done: boolean;
  error?: string;
}

// === Shared helpers ===

export function resolveModel(modelId: string): LanguageModel {
  if (
    modelId.startsWith("gpt-") ||
    modelId.startsWith("o1") ||
    modelId.startsWith("o3") ||
    modelId.startsWith("o4")
  ) {
    return openai(modelId);
  }
  return anthropic(modelId);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

// === Agent loop ===

export async function runAgentLoop(
  ctx: ActionCtx,
  config: AgentLoopConfig,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<AgentLoopResult> {
  const collectedToolCalls: ToolCallRecord[] = [];

  // Build tools from retriever infos (same pattern as agents/actions.ts)
  const tools: Record<string, any> = {};
  for (const info of config.retrieverInfos) {
    const toolName = slugify(info.name);
    tools[toolName] = tool({
      description: `Search ${info.kbName} using ${info.name}`,
      parameters: z.object({
        query: z.string().describe("The search query"),
        k: z.number().optional().describe("Number of results to return"),
      }),
      execute: async ({ query, k }) => {
        const { createEmbedder } = await import("rag-evaluation-system/llm");
        const embedder = createEmbedder(info.embeddingModel);
        const queryEmbedding = await embedder.embedQuery(query);

        const { chunks } = await vectorSearchWithFilter(ctx, {
          queryEmbedding,
          kbId: info.kbId as any,
          indexConfigHash: info.indexConfigHash,
          topK: k ?? info.defaultK,
          indexStrategy: info.indexStrategy,
        });

        const result = chunks.map((c: any) => ({
          content: c.content,
          documentId: c.documentId,
          start: c.start,
          end: c.end,
        }));

        collectedToolCalls.push({
          toolName,
          args: { query, k },
          result: JSON.stringify(result),
          retrieverId: info.id,
        });

        return result;
      },
    });
  }

  try {
    const result = await generateText({
      model: resolveModel(config.modelId),
      system: config.systemPrompt,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      maxSteps: 5,
    });

    return {
      text: result.text,
      toolCalls: collectedToolCalls,
      usage: {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
      },
      done: !result.text || result.text.trim().length === 0,
    };
  } catch (err: any) {
    return {
      text: "",
      toolCalls: collectedToolCalls,
      usage: { promptTokens: 0, completionTokens: 0 },
      done: false,
      error: err.message ?? String(err),
    };
  }
}
