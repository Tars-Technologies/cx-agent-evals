"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { composeSystemPrompt } from "../agents/promptTemplate";
import { vectorSearchWithFilter } from "../lib/vectorSearch";
import {
  recall,
  precision,
  iou,
  f1,
  type CharacterSpan,
  DocumentId,
} from "rag-evaluation-system";

// ─── Helpers ───

function resolveModel(modelId: string): LanguageModel {
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

const metricFns = [recall, precision, iou, f1];

function computePerQuestionScores(
  retrievedChunks: Array<{
    docId: string;
    start: number;
    end: number;
    content: string;
  }>,
  groundTruthSpans: Array<{
    docId: string;
    start: number;
    end: number;
    text: string;
  }>,
): Record<string, number> {
  const retrieved: CharacterSpan[] = retrievedChunks.map((c) => ({
    docId: DocumentId(c.docId),
    start: c.start,
    end: c.end,
    text: c.content,
  }));

  const groundTruth: CharacterSpan[] = groundTruthSpans.map((s) => ({
    docId: DocumentId(s.docId),
    start: s.start,
    end: s.end,
    text: s.text,
  }));

  const scores: Record<string, number> = {};
  for (const metric of metricFns) {
    scores[metric.name] = metric.calculate(retrieved, groundTruth);
  }
  return scores;
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
    kbId: v.id("knowledgeBases"),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "initializing",
      });

      const experiment = await ctx.runQuery(
        internal.experiments.orchestration.getInternal,
        { id: args.experimentId },
      );

      if (!experiment.agentId) {
        throw new Error("Agent experiment missing agentId");
      }

      // Verify agent exists and has ready retrievers
      const agent = await ctx.runQuery(internal.crud.agents.getInternal, {
        id: experiment.agentId,
      });
      if (!agent) throw new Error("Agent not found");

      let hasReadyRetriever = false;
      for (const retrieverId of agent.retrieverIds) {
        const retriever = await ctx.runQuery(
          internal.crud.retrievers.getInternal,
          { id: retrieverId },
        );
        if (retriever && retriever.status === "ready") {
          hasReadyRetriever = true;
          break;
        }
      }
      if (!hasReadyRetriever) {
        throw new Error("Agent has no ready retrievers");
      }

      // Load questions, filter by ground truth
      const allQuestions = await ctx.runQuery(
        internal.crud.questions.byDatasetInternal,
        { datasetId: args.datasetId },
      );
      const questions = allQuestions.filter(
        (q: any) =>
          Array.isArray(q.relevantSpans) && q.relevantSpans.length > 0,
      );

      if (questions.length === 0) {
        await ctx.runMutation(
          internal.experiments.orchestration.updateStatus,
          {
            experimentId: args.experimentId,
            status: "completed",
            phase: "done",
            totalQuestions: 0,
            scores: { recall: 0, precision: 0, iou: 0, f1: 0 },
          },
        );
        return;
      }

      await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
        experimentId: args.experimentId,
        status: "running",
        phase: "evaluating",
        totalQuestions: questions.length,
      });

      // Enqueue all questions into the WorkPool
      await ctx.runMutation(
        internal.experiments.orchestration.enqueueAgentQuestions,
        {
          experimentId: args.experimentId,
          questionIds: questions.map((q: any) => q._id),
          agentId: experiment.agentId,
          kbId: args.kbId,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[runAgentExperimentSetup] FAILED:", message);
      await ctx.runMutation(internal.experiments.orchestration.updateStatus, {
        experimentId: args.experimentId,
        status: "failed",
        error: message,
      });
    }
  },
});

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
    kbId: v.id("knowledgeBases"),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // 1. Load agent config
    const agent = await ctx.runQuery(internal.crud.agents.getInternal, {
      id: args.agentId,
    });
    if (!agent) throw new Error("Agent not found");

    // 2. Load agent's retrievers + KB info
    const retrieverInfos: Array<{
      id: string;
      name: string;
      kbName: string;
      kbId: string;
      indexConfigHash: string;
      indexStrategy: string;
      embeddingModel: string;
      defaultK: number;
    }> = [];

    for (const retrieverId of agent.retrieverIds) {
      const retriever = await ctx.runQuery(
        internal.crud.retrievers.getInternal,
        { id: retrieverId },
      );
      if (!retriever || retriever.status !== "ready") continue;
      const kb = await ctx.runQuery(
        internal.crud.knowledgeBases.getInternal,
        { id: retriever.kbId },
      );
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
        defaultK: retriever.defaultK ?? 5,
      });
    }

    if (retrieverInfos.length === 0) {
      throw new Error("Agent has no ready retrievers");
    }

    // 3. Build system prompt
    const systemPrompt = composeSystemPrompt(
      agent,
      retrieverInfos.map((r) => ({ name: r.name, kbName: r.kbName })),
    );

    // 4. Build AI SDK tools — one per retriever
    const allToolCallResults: Array<{
      toolName: string;
      query: string;
      retrieverId: string | undefined;
      chunks: Array<{
        content: string;
        docId: string;
        start: number;
        end: number;
      }>;
    }> = [];

    const tools: Record<string, any> = {};

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

          const { createEmbedder } = await import(
            "rag-evaluation-system/llm"
          );
          const embedder = createEmbedder(info.embeddingModel);
          const queryEmbedding = await embedder.embedQuery(query);

          const { chunks } = await vectorSearchWithFilter(ctx, {
            queryEmbedding,
            kbId: info.kbId as any,
            indexConfigHash: info.indexConfigHash,
            topK,
            indexStrategy: info.indexStrategy,
          });

          const mappedChunks = chunks.map((c: any) => ({
            content: c.content,
            docId: c.docId,
            start: c.start,
            end: c.end,
          }));

          allToolCallResults.push({
            toolName,
            query,
            retrieverId: info.id,
            chunks: mappedChunks,
          });

          return mappedChunks;
        },
      });
    }

    // 5. Load question
    const question = await ctx.runQuery(internal.crud.questions.getInternal, {
      id: args.questionId,
    });
    if (!question) throw new Error("Question not found");

    // 6. Call generateText
    try {
      const result = await generateText({
        model: resolveModel(agent.model),
        system: systemPrompt,
        messages: [{ role: "user", content: question.queryText }],
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        maxSteps: 5,
      });

      const latencyMs = Date.now() - startTime;

      // 7. Extract tool calls + chunks
      const toolCalls = [...allToolCallResults];
      const retrievedChunks = toolCalls.flatMap((tc) => tc.chunks);

      // 8. Compute metrics
      const scores = computePerQuestionScores(
        retrievedChunks,
        question.relevantSpans,
      );

      // 9. Insert result
      await ctx.runMutation(internal.experiments.agentResults.insert, {
        experimentId: args.experimentId,
        questionId: args.questionId,
        answerText: result.text,
        toolCalls: toolCalls.map((tc) => ({
          toolName: tc.toolName,
          query: tc.query,
          retrieverId: tc.retrieverId,
          chunks: tc.chunks,
        })),
        retrievedChunks,
        scores,
        usage: result.usage
          ? {
              promptTokens: result.usage.promptTokens,
              completionTokens: result.usage.completionTokens,
            }
          : undefined,
        latencyMs,
        status: "complete",
      });

      return { status: "complete", scores };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      await ctx.runMutation(internal.experiments.agentResults.insert, {
        experimentId: args.experimentId,
        questionId: args.questionId,
        answerText: "",
        toolCalls: [],
        retrievedChunks: [],
        latencyMs,
        status: "error",
        error: error?.message ?? "Unknown error",
      });
      // Re-throw so WorkPool marks this as failed (triggers retry)
      throw error;
    }
  },
});
