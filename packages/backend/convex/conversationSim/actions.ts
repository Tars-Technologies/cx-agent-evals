"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { generateText } from "ai";
import { resolveModel, runAgentLoop } from "../lib/agentLoop";
import type { RetrieverInfo, AgentLoopConfig } from "../lib/agentLoop";
import { composeSystemPrompt } from "../agents/promptTemplate";
import { runCodeEvaluator } from "./evaluation";
import type { EvalInput } from "./evaluation";
import { runLLMJudge } from "./judge";
import type { JudgeConfig, JudgeContext } from "./judge";

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

    const evalSet = await ctx.runQuery(
      internal.conversationSim.evaluatorSets.getInternal,
      { id: simulation.evaluatorSetId },
    );
    if (!evalSet) throw new Error("Evaluator set not found");

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
    const allToolCalls: Array<{ toolName: string; args: Record<string, any>; result: string }> = [];

    const maxTurnPairs = simulation.maxTurns;
    const timeoutMs = simulation.timeoutMs;

    for (let turnPair = 0; turnPair < maxTurnPairs; turnPair++) {
      // Timeout check
      if (Date.now() - startTime > timeoutMs) {
        terminationReason = "timeout";
        break;
      }

      // === USER TURN ===
      let userMessage: string;

      console.log(`[SIM DEBUG] runId=${runId} turnPair=${turnPair} messages.length=${messages.length} hasRefMessages=${!!scenario.referenceMessages?.[0]}`);

      if (turnPair === 0 && scenario.referenceMessages?.[0]) {
        // First turn: use verbatim reference message
        userMessage = scenario.referenceMessages[0].content;
        console.log(`[SIM DEBUG] runId=${runId} Using reference message: "${userMessage.slice(0, 80)}..."`);
      } else {
        // Generate user message via LLM
        // Role-flip messages for user-sim (agent becomes "user", user becomes "assistant")
        const flippedMessages = messages.length > 0
          ? messages.map(m => ({
              role: (m.role === "user" ? "assistant" : "user") as "user" | "assistant",
              content: m.content,
            }))
          : [{ role: "user" as const, content: "Begin the conversation." }];

        console.log(`[SIM DEBUG] runId=${runId} flippedMessages.length=${flippedMessages.length} roles=${flippedMessages.map(m => m.role).join(",")}`);

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
      console.log(`[SIM DEBUG] runId=${runId} calling runAgentLoop with messages.length=${messages.length}`);
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
      allToolCalls.push(...agentResult.toolCalls);

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

    // 3. EVALUATE
    const evalInput: EvalInput = {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      toolCalls: allToolCalls,
    };

    // Build transcript string for LLM judges
    const transcript = messages.map(m => `${m.role}: ${m.content}`).join("\n\n");
    const toolCallsStr = allToolCalls.length > 0
      ? allToolCalls.map(tc => `${tc.toolName}(${JSON.stringify(tc.args)}) → ${tc.result.slice(0, 500)}`).join("\n")
      : undefined;

    // Collect KB documents from tool call results for judge context
    const kbDocs = allToolCalls.map(tc => {
      try { return JSON.parse(tc.result).map((r: any) => r.content).join("\n---\n"); }
      catch { return tc.result; }
    }).join("\n===\n");

    const evaluatorResults: Array<{
      evaluatorId: any;
      evaluatorName: string;
      passed: boolean;
      justification: string;
      required: boolean;
    }> = [];

    for (const evalId of evalSet.evaluatorIds) {
      const evaluator = await ctx.runQuery(
        internal.conversationSim.evaluators.getInternal,
        { id: evalId },
      );
      if (!evaluator) continue;

      const isRequired = evalSet.requiredEvaluatorIds.some(
        (rid: any) => rid.toString() === evalId.toString(),
      );

      let result;
      if (evaluator.type === "code" && evaluator.codeConfig) {
        result = runCodeEvaluator(evaluator.codeConfig.checkType, evaluator.codeConfig.params, evalInput);
      } else if (evaluator.type === "llm_judge" && evaluator.judgeConfig) {
        const judgeConfig: JudgeConfig = {
          rubric: evaluator.judgeConfig.rubric,
          passExamples: evaluator.judgeConfig.passExamples,
          failExamples: evaluator.judgeConfig.failExamples,
          model: evaluator.judgeConfig.model,
          inputContext: evaluator.judgeConfig.inputContext,
        };
        const judgeContext: JudgeContext = {
          transcript,
          toolCalls: toolCallsStr,
          kbDocuments: kbDocs || undefined,
        };
        result = await runLLMJudge(judgeConfig, judgeContext);
      } else {
        result = { passed: false, justification: "Invalid evaluator configuration" };
      }

      evaluatorResults.push({
        evaluatorId: evalId,
        evaluatorName: evaluator.name,
        passed: result.passed,
        justification: result.justification,
        required: isRequired,
      });
    }

    // Compute score and pass/fail
    const score = evaluatorResults.length > 0
      ? evaluatorResults.filter(r => r.passed).length / evaluatorResults.length
      : 1;

    const allRequiredPassed = evaluatorResults
      .filter(r => r.required)
      .every(r => r.passed);
    const passed = allRequiredPassed && score >= simulation.passThreshold;

    // 4. SAVE
    const latencyMs = Date.now() - startTime;
    const turnCount = Math.ceil(messages.length / 2); // turn pairs

    await ctx.runMutation(internal.conversationSim.runs.updateRun, {
      runId,
      status: "completed",
      terminationReason,
      turnCount,
      evaluatorResults,
      score,
      passed,
      toolCallCount,
      totalTokens,
      latencyMs,
    });
  },
});

// ─── Helper: Build User Sim Prompt ───

function buildUserSimPrompt(
  scenario: {
    persona: { type: string; traits: string[]; communicationStyle: string; patienceLevel: string };
    topic: string;
    intent: string;
    complexity: string;
    reasonForContact: string;
    knownInfo: string;
    unknownInfo: string;
    instruction: string;
    referenceMessages?: Array<{ role: string; content: string; turnIndex: number }>;
  },
  seed: number,
): string {
  const sections: string[] = [];

  sections.push(`# Role
You are simulating an end-user contacting customer support. Stay in character throughout.`);

  sections.push(`# Your Persona
- Type: ${scenario.persona.type}
- Traits: ${scenario.persona.traits.join(", ")}
- Communication style: ${scenario.persona.communicationStyle}
- Patience level: ${scenario.persona.patienceLevel}`);

  sections.push(`# Scenario
- Topic: ${scenario.topic}
- Intent: ${scenario.intent}
- Complexity: ${scenario.complexity}
- Reason for contact: ${scenario.reasonForContact}`);

  sections.push(`# What You Know
${scenario.knownInfo}`);

  sections.push(`# What You Don't Know (what you're trying to find out)
${scenario.unknownInfo}`);

  sections.push(`# Instructions
${scenario.instruction}`);

  // Reference style examples (skip first one since it's used verbatim)
  const styleExamples = scenario.referenceMessages?.slice(1);
  if (styleExamples && styleExamples.length > 0) {
    const examples = styleExamples.map((m, i) => `Example ${i + 1}: "${m.content}"`).join("\n");
    sections.push(`# Reference Style Examples
Match the tone and style of these messages:
${examples}`);
  }

  sections.push(`# Variation Seed: ${seed}
Vary your approach slightly based on this seed number. Different seeds should produce somewhat different conversation paths while staying true to the scenario.`);

  sections.push(`# Rules
- Stay in character as the described persona at all times
- Do NOT reveal that you are an AI or a simulator
- Do NOT mention evaluators, scores, or the simulation system
- When your issue is resolved or you have no more questions, respond with exactly "###STOP###"
- If the agent asks you to do something you can't simulate (like checking email, visiting a URL), improvise a reasonable response
- Keep messages concise and realistic — real users don't write essays`);

  return sections.join("\n\n");
}
