"use node"

import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import type { EvalInput } from "./evaluation"
import { runCodeEvaluator } from "./evaluation"
import type { JudgeConfig, JudgeContext } from "./judge"
import { runLLMJudge } from "./judge"

export const runEvaluation = internalAction({
  args: {
    runId: v.id("conversationSimRuns"),
    evaluatorSetId: v.id("evaluatorSets")
  },
  handler: async (ctx, { runId, evaluatorSetId }) => {
    const run = await ctx.runQuery(internal.conversationSim.runs.getInternal, {
      id: runId
    })
    if (!run || !run.conversationId)
      throw new Error("Run or conversation not found")

    const messages = await ctx.runQuery(
      internal.crud.conversations.listMessagesInternal,
      { conversationId: run.conversationId }
    )

    const evalSet = await ctx.runQuery(
      internal.conversationSim.evaluatorSets.getInternal,
      { id: evaluatorSetId }
    )
    if (!evalSet) throw new Error("Evaluator set not found")

    const userAssistantMsgs = messages.filter(
      (m: any) => m.role === "user" || m.role === "assistant"
    )
    const toolCallMsgs = messages.filter((m: any) => m.role === "tool_call")
    const toolResultMsgs = messages.filter((m: any) => m.role === "tool_result")

    // Image menu = union of every image retrieval offered, recovered from the
    // persisted tool_result rows (result is JSON.stringify({ chunks, images })).
    // Parse defensively: a malformed/renamed payload yields no menu, never throws.
    const menuMap = new Map<
      string,
      { imageId: string; alt: string; type?: string }
    >()
    for (const m of toolResultMsgs) {
      const raw = m.toolResult?.result
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw)
        const imgs = Array.isArray(parsed?.images) ? parsed.images : []
        for (const im of imgs) {
          if (im && typeof im.imageId === "string" && !menuMap.has(im.imageId)) {
            menuMap.set(im.imageId, {
              imageId: im.imageId,
              alt: String(im.alt ?? ""),
              type: im.type
            })
          }
        }
      } catch {
        // malformed tool result — skip, contributes nothing to the menu
      }
    }
    const imageMenu = [...menuMap.values()]

    // Images the agent actually rendered, unioned across assistant turns.
    const shownMap = new Map<
      string,
      { imageId: string; url: string; alt: string }
    >()
    for (const m of userAssistantMsgs) {
      if (m.role !== "assistant" || !Array.isArray(m.shownImages)) continue
      for (const s of m.shownImages) {
        if (!shownMap.has(s.imageId)) shownMap.set(s.imageId, s)
      }
    }
    const shownImagesAll = [...shownMap.values()]

    const evalInput: EvalInput = {
      messages: userAssistantMsgs.map((m: any) => ({
        role: m.role,
        content: m.content,
        shownImages: m.shownImages
      })),
      toolCalls: toolCallMsgs.map((m: any) => ({
        toolName: m.toolCall?.toolName ?? "",
        args: JSON.parse(m.toolCall?.toolArgs ?? "{}"),
        result: ""
      })),
      imageMenu
    }

    const transcript = userAssistantMsgs
      .map((m: any) => `${m.role}: ${m.content}`)
      .join("\n\n")

    const toolCallsStr =
      toolCallMsgs.length > 0
        ? toolCallMsgs
            .map(
              (m: any) =>
                `${m.toolCall?.toolName}(${m.toolCall?.toolArgs?.slice(0, 200)})`
            )
            .join("\n")
        : undefined

    const kbDocs =
      toolResultMsgs.map((m: any) => m.content).join("\n===\n") || undefined

    const evaluatorResults: Array<{
      evaluatorId: any
      evaluatorName: string
      passed: boolean
      justification: string
      required: boolean
    }> = []

    for (const evalId of evalSet.evaluatorIds) {
      const evaluator = await ctx.runQuery(
        internal.conversationSim.evaluators.getInternal,
        { id: evalId }
      )
      if (!evaluator) continue

      const isRequired = evalSet.requiredEvaluatorIds.some(
        (rid: any) => rid.toString() === evalId.toString()
      )

      let result
      if (evaluator.type === "code" && evaluator.codeConfig) {
        result = runCodeEvaluator(
          evaluator.codeConfig.checkType,
          evaluator.codeConfig.params,
          evalInput
        )
      } else if (evaluator.type === "llm_judge" && evaluator.judgeConfig) {
        const judgeConfig: JudgeConfig = {
          rubric: evaluator.judgeConfig.rubric,
          passExamples: evaluator.judgeConfig.passExamples,
          failExamples: evaluator.judgeConfig.failExamples,
          model: evaluator.judgeConfig.model,
          inputContext: evaluator.judgeConfig.inputContext
        }
        const judgeContext: JudgeContext = {
          transcript,
          toolCalls: toolCallsStr,
          kbDocuments: kbDocs,
          shownImages: shownImagesAll,
          imageMenu
        }
        // A vision judge over a run that surfaced no images has nothing to
        // grade — neutral pass without spending an LLM call.
        if (
          judgeConfig.inputContext.includes("shown_images") &&
          shownImagesAll.length === 0 &&
          imageMenu.length === 0
        ) {
          result = {
            passed: true,
            justification: "No images surfaced in this run"
          }
        } else {
          try {
            result = await runLLMJudge(judgeConfig, judgeContext)
          } catch (err) {
            // Don't let one evaluator's failure (e.g. a rejected image format
            // reaching the model call) discard every other evaluator's verdict
            // for this run — updateRun only writes after the whole loop.
            result = {
              passed: false,
              justification: `Judge error: ${String((err as Error)?.message ?? err).slice(0, 200)}`
            }
          }
        }
      } else {
        result = {
          passed: false,
          justification: "Invalid evaluator configuration"
        }
      }

      evaluatorResults.push({
        evaluatorId: evalId,
        evaluatorName: evaluator.name,
        passed: result.passed,
        justification: result.justification,
        required: isRequired
      })
    }

    const score =
      evaluatorResults.length > 0
        ? evaluatorResults.filter((r) => r.passed).length /
          evaluatorResults.length
        : 1

    const allRequiredPassed = evaluatorResults
      .filter((r) => r.required)
      .every((r) => r.passed)
    const passed = allRequiredPassed && score >= evalSet.passThreshold

    await ctx.runMutation(internal.conversationSim.runs.updateRun, {
      runId,
      evaluatorResults,
      score,
      passed
    })
  }
})
