"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { runCodeEvaluator } from "./evaluation";
import type { EvalInput } from "./evaluation";
import { runLLMJudge } from "./judge";
import type { JudgeConfig, JudgeContext } from "./judge";

export const runEvaluation = internalAction({
  args: {
    runId: v.id("conversationSimRuns"),
    evaluatorSetId: v.id("evaluatorSets"),
  },
  handler: async (ctx, { runId, evaluatorSetId }) => {
    const run = await ctx.runQuery(internal.conversationSim.runs.getInternal, { id: runId });
    if (!run || !run.conversationId) throw new Error("Run or conversation not found");

    const messages = await ctx.runQuery(
      internal.crud.conversations.listMessagesInternal,
      { conversationId: run.conversationId },
    );

    const evalSet = await ctx.runQuery(
      internal.conversationSim.evaluatorSets.getInternal,
      { id: evaluatorSetId },
    );
    if (!evalSet) throw new Error("Evaluator set not found");

    const userAssistantMsgs = messages.filter(
      (m: any) => m.role === "user" || m.role === "assistant",
    );
    const toolCallMsgs = messages.filter((m: any) => m.role === "tool_call");

    const evalInput: EvalInput = {
      messages: userAssistantMsgs.map((m: any) => ({ role: m.role, content: m.content })),
      toolCalls: toolCallMsgs.map((m: any) => ({
        toolName: m.toolCall?.toolName ?? "",
        args: JSON.parse(m.toolCall?.toolArgs ?? "{}"),
        result: "",
      })),
    };

    const transcript = userAssistantMsgs
      .map((m: any) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const toolCallsStr = toolCallMsgs.length > 0
      ? toolCallMsgs.map((m: any) =>
          `${m.toolCall?.toolName}(${m.toolCall?.toolArgs?.slice(0, 200)})`
        ).join("\n")
      : undefined;

    const toolResultMsgs = messages.filter((m: any) => m.role === "tool_result");
    const kbDocs = toolResultMsgs
      .map((m: any) => m.content)
      .join("\n===\n") || undefined;

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
        result = runCodeEvaluator(
          evaluator.codeConfig.checkType,
          evaluator.codeConfig.params,
          evalInput,
        );
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
          kbDocuments: kbDocs,
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

    const score = evaluatorResults.length > 0
      ? evaluatorResults.filter(r => r.passed).length / evaluatorResults.length
      : 1;

    const allRequiredPassed = evaluatorResults
      .filter(r => r.required)
      .every(r => r.passed);
    const passed = allRequiredPassed && score >= evalSet.passThreshold;

    await ctx.runMutation(internal.conversationSim.runs.updateRun, {
      runId,
      evaluatorResults,
      score,
      passed,
    });
  },
});
