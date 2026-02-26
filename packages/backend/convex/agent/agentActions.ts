"use node";

import { internalAction } from "../_generated/server";
import { internal, components } from "../_generated/api";
import { v } from "convex/values";
import { Agent } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { createKBRetrieverTool } from "./retrieverTool";
import { stepCountIs } from "ai";

const SYSTEM_INSTRUCTIONS = `You are a knowledgeable Q&A assistant with access to one or more knowledge base search tools.

When a user asks a question:
1. Use the appropriate search tool(s) to find relevant information
2. Synthesize a clear, accurate answer based on the retrieved content
3. Cite your sources by referencing the document names and relevant sections
4. If the search returns no relevant results, say so honestly

Always ground your answers in the retrieved content. Do not make up information.`;

export const streamResponse = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, args) => {
    // Load thread config to get KB tools
    const threadConfig = await ctx.runQuery(
      internal.agent.threads.getConfigByThread,
      { threadId: args.threadId },
    );

    if (!threadConfig) {
      throw new Error("Thread config not found");
    }

    // Build tools dynamically based on configured KBs
    const tools: Record<string, ReturnType<typeof createKBRetrieverTool>> = {};

    for (const kbConfig of threadConfig.kbConfigs) {
      const kb = await ctx.runQuery(internal.agent.threads.getKBInternal, {
        kbId: kbConfig.kbId,
      });
      if (!kb) continue;

      // Create a tool name from KB name (sanitize for use as identifier)
      const toolName = `search_${kb.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

      tools[toolName] = createKBRetrieverTool({
        kbId: kbConfig.kbId,
        kbName: kb.name,
        indexConfigHash: undefined,
        embeddingModel: "text-embedding-3-small",
      });
    }

    // Create agent dynamically with the thread's tools
    const agent = new Agent(components.agent, {
      name: "QA Agent",
      languageModel: openai.chat("gpt-4o-mini"),
      instructions: SYSTEM_INSTRUCTIONS,
      tools,
      stopWhen: stepCountIs(5),
    });

    // Stream the response
    const result = await agent.streamText(
      ctx,
      { threadId: args.threadId },
      { promptMessageId: args.promptMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );

    await result.consumeStream();
  },
});
