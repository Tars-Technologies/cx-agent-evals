"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { generateText } from "ai";
import { resolveModel, runAgentLoop } from "../lib/agentLoop";
import type { RetrieverInfo, AgentLoopConfig } from "../lib/agentLoop";
import { composeSystemPrompt } from "../agents/promptTemplate";
import { buildUserSimPrompt } from "./prompt";

export const runConversationSim = internalAction({
  args: { runId: v.id("conversationSimRuns") },
  handler: async (ctx, { runId }) => {
    const startTime = Date.now();

    // 1. SETUP — Load all required data
    const run = await ctx.runQuery(internal.conversationSim.runs.getInternal, { id: runId });
    if (!run) throw new Error("Run not found");

    const simulation = await ctx.runQuery(
      internal.conversationSim.orchestration.getInternal,
      { id: run.simulationId },
    );
    if (!simulation) throw new Error("Simulation not found");

    const scenario = await ctx.runQuery(
      internal.conversationSim.scenarios.getInternal,
      { id: run.scenarioId },
    );
    if (!scenario) throw new Error("Scenario not found");

    const agent = await ctx.runQuery(internal.crud.agents.getInternal, { id: run.agentId });
    if (!agent) throw new Error("Agent not found");

    // Load retrievers for agent
    const retrieverInfos: RetrieverInfo[] = [];
    for (const retrieverId of agent.retrieverIds) {
      const retriever = await ctx.runQuery(internal.crud.retrievers.getInternal, { id: retrieverId });
      if (!retriever || retriever.status !== "ready") continue;
      const kb = await ctx.runQuery(internal.crud.knowledgeBases.getInternal, { id: retriever.kbId });
      retrieverInfos.push({
        id: retriever._id,
        name: retriever.name,
        kbName: kb?.name ?? "Unknown KB",
        kbId: retriever.kbId,
        indexConfigHash: retriever.indexConfigHash,
        indexStrategy: retriever.retrieverConfig.index.strategy,
        embeddingModel: retriever.retrieverConfig.index.embeddingModel ?? "text-embedding-3-small",
        defaultK: retriever.defaultK ?? 5,
      });
    }

    // Create conversation record (source: "simulation")
    const conversationId = await ctx.runMutation(
      internal.crud.conversations.createInternal,
      {
        orgId: simulation.orgId,
        agentIds: [run.agentId],
        title: `Sim: ${scenario.topic} (k=${run.kIndex})`,
        source: "simulation" as const,
      },
    );

    // Update run: set conversationId and status to running
    await ctx.runMutation(internal.conversationSim.runs.updateRun, {
      runId,
      conversationId,
      status: "running",
    });

    // Build user-sim system prompt
    const userSimSystemPrompt = buildUserSimPrompt(scenario, run.seed);

    // Build agent config for agentLoop
    const systemPrompt = composeSystemPrompt(agent, retrieverInfos.map(r => ({
      name: r.name,
      kbName: r.kbName,
    })));

    const agentConfig: AgentLoopConfig = {
      modelId: agent.model,
      systemPrompt,
      retrieverInfos,
    };

    // 2. CONVERSATION LOOP
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    let messageOrder = 0;
    let terminationReason: "user_stop" | "agent_stop" | "max_turns" | "timeout" | "error" | undefined;
    let totalTokens = 0;
    let toolCallCount = 0;
    let consecutiveErrors = 0;

    const maxTurnPairs = simulation.maxTurns;
    const timeoutMs = simulation.timeoutMs;

    for (let turnPair = 0; turnPair < maxTurnPairs; turnPair++) {
      // Timeout check
      if (Date.now() - startTime > timeoutMs) {
        terminationReason = "timeout";
        break;
      }

      // === USER TURN ===
      const verbatimOpener = (() => {
        if (turnPair !== 0) return undefined;
        // Resolution order:
        // 1. Grounded: first `user` message in referenceTranscript.
        // 2. Legacy: referenceMessages[0].content (un-backfilled scenarios).
        // 3. None: simulator generates turn 0.
        if (scenario.referenceTranscript) {
          const firstUser = scenario.referenceTranscript.find((m) => m.role === "user");
          if (firstUser) return firstUser.text;
        }
        if (scenario.referenceMessages?.[0]) {
          return scenario.referenceMessages[0].content;
        }
        return undefined;
      })();

      let userMessage: string;
      if (verbatimOpener !== undefined) {
        userMessage = verbatimOpener;
      } else {
        // Generate user message via LLM
        // Role-flip messages for user-sim (agent becomes "user", user becomes "assistant")
        const flippedMessages = messages.length > 0
          ? messages.map(m => ({
              role: (m.role === "user" ? "assistant" : "user") as "user" | "assistant",
              content: m.content,
            }))
          : [{ role: "user" as const, content: "Begin the conversation." }];

        const userSimResult = await generateText({
          model: resolveModel(simulation.userSimModel),
          system: userSimSystemPrompt,
          messages: flippedMessages,
        });

        userMessage = userSimResult.text;
      }

      // Check for stop signal
      if (userMessage.includes("###STOP###")) {
        terminationReason = "user_stop";
        break;
      }

      // Save user message
      await ctx.runMutation(internal.crud.conversations.insertMessage, {
        conversationId,
        order: messageOrder++,
        role: "user",
        content: userMessage,
        status: "complete",
      });
      messages.push({ role: "user", content: userMessage });

      // === AGENT TURN ===
      const agentResult = await runAgentLoop(ctx, agentConfig, messages);

      if (agentResult.error) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          terminationReason = "error";
          break;
        }
        // Save error as agent message
        await ctx.runMutation(internal.crud.conversations.insertMessage, {
          conversationId,
          order: messageOrder++,
          role: "assistant",
          content: agentResult.error,
          agentId: run.agentId,
          status: "error",
        });
        messages.push({ role: "assistant", content: agentResult.error });
      } else {
        consecutiveErrors = 0;

        // Save tool call/result messages
        for (const tc of agentResult.toolCalls) {
          await ctx.runMutation(internal.crud.conversations.insertMessage, {
            conversationId,
            order: messageOrder++,
            role: "tool_call",
            content: "",
            agentId: run.agentId,
            toolCall: {
              toolCallId: `tc_${messageOrder}`,
              toolName: tc.toolName,
              toolArgs: JSON.stringify(tc.args),
              retrieverId: tc.retrieverId as any,
            },
            status: "complete",
          });
          await ctx.runMutation(internal.crud.conversations.insertMessage, {
            conversationId,
            order: messageOrder++,
            role: "tool_result",
            content: "",
            agentId: run.agentId,
            toolResult: {
              toolCallId: `tc_${messageOrder - 1}`,
              toolName: tc.toolName,
              result: tc.result,
              retrieverId: tc.retrieverId as any,
            },
            status: "complete",
          });
        }

        // Save agent response
        await ctx.runMutation(internal.crud.conversations.insertMessage, {
          conversationId,
          order: messageOrder++,
          role: "assistant",
          content: agentResult.text,
          agentId: run.agentId,
          status: "complete",
          usage: agentResult.usage,
        });
        messages.push({ role: "assistant", content: agentResult.text });
      }

      // Accumulate stats
      totalTokens += agentResult.usage.promptTokens + agentResult.usage.completionTokens;
      toolCallCount += agentResult.toolCalls.length;

      // Check agent done
      if (agentResult.done) {
        terminationReason = "agent_stop";
        break;
      }
    }

    // If no termination reason, we hit max turns
    if (!terminationReason) {
      terminationReason = "max_turns";
    }

    // 3. SAVE
    const latencyMs = Date.now() - startTime;
    const turnCount = Math.ceil(messages.length / 2);

    await ctx.runMutation(internal.conversationSim.runs.updateRun, {
      runId,
      status: "completed",
      terminationReason,
      turnCount,
      toolCallCount,
      totalTokens,
      latencyMs,
    });
  },
});

