"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import { toBinaryLabel } from "../lib/labels";
import { computeSplit } from "./splits";
import {
  computeTPRTNR,
  correctedPassRate,
  bootstrapCI,
  type JudgmentPair,
} from "./metrics";

// ─── Model Resolution ───

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

// Call the LLM judge and return parsed verdict + metadata
async function callJudge(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{
  verdict: "pass" | "fail";
  reasoning: string;
  promptTokens?: number;
  completionTokens?: number;
}> {
  const model = resolveModel(modelId);

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    temperature: 0,
  });

  const parsed = parseJudgeResponse(result.text);

  return {
    verdict: parsed.verdict,
    reasoning: parsed.reasoning,
    promptTokens: result.usage?.promptTokens,
    completionTokens: result.usage?.completionTokens,
  };
}

// ─── Prompt Generation Helper ───

async function buildDefaultPrompt(
  ctx: any,
  failureModeId: string,
): Promise<string> {
  const failureMode = await ctx.runQuery(
    internal.failureModes.crud.getInternal,
    { id: failureModeId },
  );
  if (!failureMode) throw new Error("Failure mode not found");

  return `You are an expert evaluator assessing outputs from an AI agent.

Your Task: Determine if the agent's response exhibits the following failure mode.

Failure Mode: ${failureMode.name}
Description: ${failureMode.description}

Definition of Pass/Fail:
- Fail: The agent's response clearly exhibits this failure mode — ${failureMode.description.toLowerCase()}
- Pass: The agent's response does NOT exhibit this failure mode. The response may have other issues, but this specific failure pattern is absent.

Output Format: Return your evaluation as a JSON object with exactly two keys:
1. "reasoning": A brief explanation (1-2 sentences) for your decision.
2. "answer": Either "Pass" or "Fail".

Do NOT include any other text outside the JSON object.`;
}

export const generateDefaultPrompt = internalAction({
  args: { failureModeId: v.id("failureModes") },
  handler: async (ctx, args): Promise<string> => {
    return buildDefaultPrompt(ctx, args.failureModeId);
  },
});

// ─── Public-facing action to generate prompt (called from mutation scheduler) ───

export const generateAndCreateConfig = internalAction({
  args: {
    orgId: v.string(),
    experimentId: v.id("experiments"),
    failureModeId: v.id("failureModes"),
    modelId: v.string(),
  },
  handler: async (ctx, args) => {
    const prompt = await buildDefaultPrompt(ctx, args.failureModeId);

    // Get annotated questions mapped to this failure mode to pick training examples
    const mappings = await ctx.runQuery(
      internal.failureModes.crud.mappingsByExperimentInternal,
      { experimentId: args.experimentId },
    );
    const fmMappings = mappings.filter(
      (m: any) => m.failureModeId === args.failureModeId,
    );
    const questionIds = fmMappings.map((m: any) => m.questionId as string);

    // Also include passing questions from annotations
    const annotations = await ctx.runQuery(
      internal.annotations.crud.byExperimentInternal,
      { experimentId: args.experimentId },
    );
    const annotatedQuestionIds = new Set(
      annotations.map((a: any) => a.questionId as string),
    );
    // All annotated questions that are either in failure mode mappings OR pass
    const allEligibleIds = [...annotatedQuestionIds].filter((qId) => {
      const annotation = annotations.find((a: any) => a.questionId === qId);
      if (!annotation) return false;
      const label = toBinaryLabel(annotation.rating);
      // Include if it's mapped to this failure mode (fail) or is a pass
      return questionIds.includes(qId) || label === "pass";
    });

    const splitConfig = { trainPct: 15, devPct: 43, testPct: 42 };
    const seed = Math.floor(Math.random() * 2147483647);
    const split = computeSplit(allEligibleIds, splitConfig, seed);

    // Pick up to 5 training examples (mix of pass and fail)
    const fewShotIds = split.train.slice(0, 5) as any;

    await ctx.runMutation(internal.evaluator.crud.createConfigInternal, {
      orgId: args.orgId,
      experimentId: args.experimentId,
      failureModeId: args.failureModeId,
      name: "", // will be filled from failure mode
      judgePrompt: prompt,
      fewShotExampleIds: fewShotIds,
      modelId: args.modelId,
      splitConfig,
      splitSeed: seed,
    });
  },
});

// ─── Run Validation (Dev or Test) ───

export const runValidation = internalAction({
  args: {
    configId: v.id("evaluatorConfigs"),
    runId: v.id("evaluatorRuns"),
    runType: v.union(v.literal("dev"), v.literal("test")),
  },
  handler: async (ctx, args) => {
    const config = await ctx.runQuery(
      internal.evaluator.crud.getConfigInternal,
      { id: args.configId },
    );
    if (!config) throw new Error("Config not found");

    try {
      // Mark run as running
      await ctx.runMutation(internal.evaluator.crud.updateRunStatusInternal, {
        runId: args.runId,
        status: "running",
      });

      // Get all eligible question IDs for this evaluator
      const eligibleIds = await getEligibleQuestionIds(ctx, config);

      // Compute split
      const split = computeSplit(
        eligibleIds,
        config.splitConfig,
        config.splitSeed,
      );
      const targetIds =
        args.runType === "dev" ? split.dev : split.test;

      // Update total traces
      await ctx.runMutation(internal.evaluator.crud.updateRunStatusInternal, {
        runId: args.runId,
        status: "running",
        totalTraces: targetIds.length,
      });

      // Load required data
      const annotations = await ctx.runQuery(
        internal.annotations.crud.byExperimentInternal,
        { experimentId: config.experimentId },
      );
      const annotationMap = new Map(
        annotations.map((a: any) => [a.questionId as string, a]),
      );

      const agentResults = await ctx.runQuery(
        internal.experiments.agentResults.byExperimentInternal,
        { experimentId: config.experimentId },
      );
      const resultByQuestion = new Map(
        agentResults.map((r: any) => [r.questionId as string, r]),
      );

      const questions = await ctx.runQuery(
        internal.crud.questions.byDatasetInternal,
        { datasetId: (await ctx.runQuery(
          internal.experiments.orchestration.getInternal,
          { id: config.experimentId },
        ))!.datasetId },
      );
      const questionMap = new Map(
        questions.map((q: any) => [q._id as string, q]),
      );

      // Build few-shot examples
      const fewShotExamples = buildFewShotExamples(
        config.fewShotExampleIds as string[],
        questionMap,
        resultByQuestion,
        annotationMap,
      );

      // Run judge on each target question
      const judgments: JudgmentPair[] = [];
      let processed = 0;
      let failed = 0;

      for (const qId of targetIds) {
        try {
          const question = questionMap.get(qId);
          const result = resultByQuestion.get(qId);
          const annotation = annotationMap.get(qId);

          if (!question || !result || !annotation) {
            failed++;
            processed++;
            continue;
          }

          const humanLabel = toBinaryLabel(annotation.rating);
          const context = (result.retrievedChunks ?? [])
            .map((c: any) => c.content)
            .join("\n---\n")
            .slice(0, 3000);

          const fullPrompt = assembleJudgePrompt(
            config.judgePrompt,
            fewShotExamples,
            {
              question: question.queryText,
              answer: result.answerText ?? "(no answer)",
              context,
            },
          );

          const startMs = Date.now();
          const judgeResult = await callJudge(
            config.modelId,
            config.judgePrompt,
            fullPrompt,
          );
          const latencyMs = Date.now() - startMs;

          await ctx.runMutation(
            internal.evaluator.crud.insertResultInternal,
            {
              orgId: config.orgId,
              runId: args.runId,
              questionId: qId as any,
              resultId: result._id,
              judgeVerdict: judgeResult.verdict,
              judgeReasoning: judgeResult.reasoning,
              humanLabel,
              agreesWithHuman: judgeResult.verdict === humanLabel,
              usage:
                judgeResult.promptTokens !== undefined &&
                judgeResult.completionTokens !== undefined
                  ? {
                      promptTokens: judgeResult.promptTokens,
                      completionTokens: judgeResult.completionTokens,
                    }
                  : undefined,
              latencyMs,
            },
          );

          judgments.push({ humanLabel, judgeVerdict: judgeResult.verdict });
          processed++;
        } catch (e) {
          failed++;
          processed++;
        }

        // Update progress every 5 items
        if (processed % 5 === 0 || processed === targetIds.length) {
          await ctx.runMutation(
            internal.evaluator.crud.updateRunProgressInternal,
            { runId: args.runId, processedTraces: processed, failedTraces: failed },
          );
        }
      }

      // Compute metrics
      const metrics = computeTPRTNR(judgments);
      const rawPass =
        judgments.filter((j) => j.judgeVerdict === "pass").length /
        (judgments.length || 1);

      // Update config metrics
      await ctx.runMutation(
        internal.evaluator.crud.updateConfigMetricsInternal,
        {
          configId: args.configId,
          metricsType: args.runType,
          metrics: {
            tpr: metrics.tpr,
            tnr: metrics.tnr,
            accuracy: metrics.accuracy,
            total: metrics.total,
          },
        },
      );

      // Complete run
      await ctx.runMutation(internal.evaluator.crud.updateRunStatusInternal, {
        runId: args.runId,
        status: "completed",
        processedTraces: processed,
        failedTraces: failed,
        rawPassRate: rawPass,
        tprUsed: metrics.tpr,
        tnrUsed: metrics.tnr,
      });
    } catch (e: any) {
      await ctx.runMutation(internal.evaluator.crud.updateRunStatusInternal, {
        runId: args.runId,
        status: "failed",
        error: e.message ?? "Unknown error",
      });
    }
  },
});

// ─── Run on Full Experiment ───

export const runOnExperiment = internalAction({
  args: {
    configId: v.id("evaluatorConfigs"),
    runId: v.id("evaluatorRuns"),
    targetExperimentId: v.id("experiments"),
  },
  handler: async (ctx, args) => {
    const config = await ctx.runQuery(
      internal.evaluator.crud.getConfigInternal,
      { id: args.configId },
    );
    if (!config) throw new Error("Config not found");
    if (!config.testMetrics) throw new Error("Config not validated on test set");

    try {
      await ctx.runMutation(internal.evaluator.crud.updateRunStatusInternal, {
        runId: args.runId,
        status: "running",
      });

      // Load target experiment results
      const targetResults = await ctx.runQuery(
        internal.experiments.agentResults.byExperimentInternal,
        { experimentId: args.targetExperimentId },
      );

      const targetExp = await ctx.runQuery(
        internal.experiments.orchestration.getInternal,
        { id: args.targetExperimentId },
      );
      if (!targetExp) throw new Error("Target experiment not found");

      const questions = await ctx.runQuery(
        internal.crud.questions.byDatasetInternal,
        { datasetId: targetExp.datasetId },
      );
      const questionMap = new Map(
        questions.map((q: any) => [q._id as string, q]),
      );

      // Build few-shot from source experiment
      const sourceAnnotations = await ctx.runQuery(
        internal.annotations.crud.byExperimentInternal,
        { experimentId: config.experimentId },
      );
      const sourceAnnotationMap = new Map(
        sourceAnnotations.map((a: any) => [a.questionId as string, a]),
      );
      const sourceResults = await ctx.runQuery(
        internal.experiments.agentResults.byExperimentInternal,
        { experimentId: config.experimentId },
      );
      const sourceResultByQuestion = new Map(
        sourceResults.map((r: any) => [r.questionId as string, r]),
      );

      const sourceExp = await ctx.runQuery(
        internal.experiments.orchestration.getInternal,
        { id: config.experimentId },
      );
      const sourceQuestions = await ctx.runQuery(
        internal.crud.questions.byDatasetInternal,
        { datasetId: sourceExp!.datasetId },
      );
      const sourceQuestionMap = new Map(
        sourceQuestions.map((q: any) => [q._id as string, q]),
      );

      const fewShotExamples = buildFewShotExamples(
        config.fewShotExampleIds as string[],
        sourceQuestionMap,
        sourceResultByQuestion,
        sourceAnnotationMap,
      );

      // Update total
      await ctx.runMutation(internal.evaluator.crud.updateRunStatusInternal, {
        runId: args.runId,
        status: "running",
        totalTraces: targetResults.length,
      });

      let processed = 0;
      let failed = 0;
      let passCount = 0;

      for (const result of targetResults) {
        try {
          const question = questionMap.get(result.questionId as string);
          if (!question) {
            failed++;
            processed++;
            continue;
          }

          const context = (result.retrievedChunks ?? [])
            .map((c: any) => c.content)
            .join("\n---\n")
            .slice(0, 3000);

          const fullPrompt = assembleJudgePrompt(
            config.judgePrompt,
            fewShotExamples,
            {
              question: question.queryText,
              answer: result.answerText ?? "(no answer)",
              context,
            },
          );

          const startMs = Date.now();
          const judgeResult = await callJudge(
            config.modelId,
            config.judgePrompt,
            fullPrompt,
          );
          const latencyMs = Date.now() - startMs;

          if (judgeResult.verdict === "pass") passCount++;

          await ctx.runMutation(
            internal.evaluator.crud.insertResultInternal,
            {
              orgId: config.orgId,
              runId: args.runId,
              questionId: result.questionId,
              resultId: result._id,
              judgeVerdict: judgeResult.verdict,
              judgeReasoning: judgeResult.reasoning,
              usage:
                judgeResult.promptTokens !== undefined &&
                judgeResult.completionTokens !== undefined
                  ? {
                      promptTokens: judgeResult.promptTokens,
                      completionTokens: judgeResult.completionTokens,
                    }
                  : undefined,
              latencyMs,
            },
          );

          processed++;
        } catch (e) {
          failed++;
          processed++;
        }

        if (processed % 5 === 0 || processed === targetResults.length) {
          await ctx.runMutation(
            internal.evaluator.crud.updateRunProgressInternal,
            { runId: args.runId, processedTraces: processed, failedTraces: failed },
          );
        }
      }

      // Compute corrected pass rate
      const totalJudged = processed - failed;
      const pObs = totalJudged > 0 ? passCount / totalJudged : 0;
      const tpr = config.testMetrics.tpr;
      const tnr = config.testMetrics.tnr;
      const theta = correctedPassRate(pObs, tpr, tnr);

      // Bootstrap CI using test set results
      const eligibleIds = await getEligibleQuestionIds(ctx, config);
      const split = computeSplit(
        eligibleIds,
        config.splitConfig,
        config.splitSeed,
      );
      const testAnnotations = await ctx.runQuery(
        internal.annotations.crud.byExperimentInternal,
        { experimentId: config.experimentId },
      );
      const testAnnotationMap = new Map(
        testAnnotations.map((a: any) => [a.questionId as string, a]),
      );

      // Get test set results from the most recent test run
      const testRuns = await ctx.runQuery(
        internal.evaluator.crud.runsByConfigInternal,
        { evaluatorConfigId: args.configId },
      );
      const lastTestRun = testRuns.find(
        (r: any) => r.runType === "test" && r.status === "completed",
      );

      let ci = { lower: 0, upper: 1 };
      if (lastTestRun) {
        const testResults = await ctx.runQuery(
          internal.evaluator.crud.resultsByRunInternal,
          { runId: lastTestRun._id },
        );
        const testLabels = testResults
          .filter((r: any) => r.humanLabel)
          .map((r: any) => (r.humanLabel === "pass" ? 1 : 0));
        const testPreds = testResults
          .filter((r: any) => r.humanLabel)
          .map((r: any) => (r.judgeVerdict === "pass" ? 1 : 0));

        if (testLabels.length > 0) {
          ci = bootstrapCI(testLabels, testPreds, pObs);
        }
      }

      await ctx.runMutation(internal.evaluator.crud.updateRunStatusInternal, {
        runId: args.runId,
        status: "completed",
        processedTraces: processed,
        failedTraces: failed,
        rawPassRate: pObs,
        correctedPassRate: theta,
        confidenceInterval: ci,
        tprUsed: tpr,
        tnrUsed: tnr,
      });
    } catch (e: any) {
      await ctx.runMutation(internal.evaluator.crud.updateRunStatusInternal, {
        runId: args.runId,
        status: "failed",
        error: e.message ?? "Unknown error",
      });
    }
  },
});

// ─── Helpers ───

async function getEligibleQuestionIds(
  ctx: any,
  config: any,
): Promise<string[]> {
  const mappings = await ctx.runQuery(
    internal.failureModes.crud.mappingsByExperimentInternal,
    { experimentId: config.experimentId },
  );
  const fmQuestionIds = new Set(
    mappings
      .filter((m: any) => m.failureModeId === config.failureModeId)
      .map((m: any) => m.questionId as string),
  );

  const annotations = await ctx.runQuery(
    internal.annotations.crud.byExperimentInternal,
    { experimentId: config.experimentId },
  );

  // Eligible: annotated questions that are either mapped to this failure mode or pass
  return annotations
    .map((a: any) => a.questionId as string)
    .filter((qId: string) => {
      const annotation = annotations.find(
        (a: any) => (a.questionId as string) === qId,
      );
      if (!annotation) return false;
      const label = toBinaryLabel(annotation.rating);
      return fmQuestionIds.has(qId) || label === "pass";
    });
}

interface FewShotExample {
  question: string;
  answer: string;
  context: string;
  humanLabel: "pass" | "fail";
}

function buildFewShotExamples(
  exampleIds: string[],
  questionMap: Map<string, any>,
  resultByQuestion: Map<string, any>,
  annotationMap: Map<string, any>,
): FewShotExample[] {
  const examples: FewShotExample[] = [];

  for (const qId of exampleIds) {
    const question = questionMap.get(qId);
    const result = resultByQuestion.get(qId);
    const annotation = annotationMap.get(qId);
    if (!question || !result || !annotation) continue;

    const context = (result.retrievedChunks ?? [])
      .map((c: any) => c.content)
      .join("\n---\n")
      .slice(0, 1500);

    examples.push({
      question: question.queryText,
      answer: result.answerText ?? "(no answer)",
      context,
      humanLabel: toBinaryLabel(annotation.rating),
    });
  }

  return examples;
}

function assembleJudgePrompt(
  _systemPrompt: string,
  fewShotExamples: FewShotExample[],
  target: { question: string; answer: string; context: string },
): string {
  const parts: string[] = [];

  // Few-shot examples
  if (fewShotExamples.length > 0) {
    parts.push("Here are some examples of how to evaluate:\n");
    for (let i = 0; i < fewShotExamples.length; i++) {
      const ex = fewShotExamples[i];
      parts.push(`--- Example ${i + 1} ---`);
      parts.push(`Question: ${ex.question}`);
      parts.push(`Agent Answer: ${ex.answer}`);
      if (ex.context) parts.push(`Retrieved Context: ${ex.context}`);
      parts.push(
        `Evaluation: {"reasoning": "This is a ${ex.humanLabel === "pass" ? "passing" : "failing"} example.", "answer": "${ex.humanLabel === "pass" ? "Pass" : "Fail"}"}`,
      );
      parts.push("");
    }
  }

  // Target
  parts.push("--- Now evaluate the following ---");
  parts.push(`Question: ${target.question}`);
  parts.push(`Agent Answer: ${target.answer}`);
  if (target.context) parts.push(`Retrieved Context: ${target.context}`);
  parts.push("\nReturn your evaluation as a JSON object:");

  return parts.join("\n");
}

function parseJudgeResponse(content: string): {
  verdict: "pass" | "fail";
  reasoning: string;
} {
  try {
    const parsed = JSON.parse(content);
    const answer = (parsed.answer ?? parsed.verdict ?? "").toLowerCase().trim();
    const verdict: "pass" | "fail" =
      answer === "pass" || answer === "yes" ? "pass" : "fail";
    const reasoning =
      parsed.reasoning ?? parsed.explanation ?? parsed.reason ?? "";
    return { verdict, reasoning };
  } catch {
    // If JSON parsing fails, try to extract from text
    const lower = content.toLowerCase();
    const verdict: "pass" | "fail" = lower.includes("pass") ? "pass" : "fail";
    return { verdict, reasoning: content.slice(0, 200) };
  }
}
