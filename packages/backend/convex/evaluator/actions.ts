"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import { toBinaryLabel } from "../lib/labels";
import { computeSplit, stratifiedFewShot } from "./splits";
import {
  computeTPRTNR,
  correctedPassRate,
  bootstrapCI,
  type JudgmentPair,
} from "./metrics";
import { parseJudgeResponse } from "./parseJudge";

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

      // Get all eligible question IDs (with labels) for this evaluator
      const eligible = await getEligibleQuestionIds(ctx, config);

      // Stratified split (passes and fails split independently)
      const split = computeSplit(
        eligible.ids,
        config.splitConfig,
        config.splitSeed,
        eligible.labels,
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

      // Stratified few-shot from training split (capped at maxFewShotExamples)
      const trainPasses: string[] = [];
      const trainFails: string[] = [];
      for (const qId of split.train) {
        const ann = annotationMap.get(qId);
        if (!ann) continue;
        if (toBinaryLabel(ann.rating) === "pass") trainPasses.push(qId);
        else trainFails.push(qId);
      }
      const sampled = stratifiedFewShot(
        trainPasses,
        trainFails,
        config.maxFewShotExamples ?? 8,
        config.splitSeed,
      );
      const fewShotExamples = buildFewShotExamples(
        sampled.ids,
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
            fewShotExamples,
            config.outputFormatJson,
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
          console.error(
            `[evaluator] Judge evaluation failed for question ${qId}:`,
            e,
          );
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

      // Compute stratified training split from source experiment annotations
      const sourceEligible = await getEligibleQuestionIds(ctx, config);
      const sourceSplit = computeSplit(
        sourceEligible.ids,
        config.splitConfig,
        config.splitSeed,
        sourceEligible.labels,
      );

      // Stratified few-shot from training split (capped at maxFewShotExamples)
      const sourceTrainPasses: string[] = [];
      const sourceTrainFails: string[] = [];
      for (const qId of sourceSplit.train) {
        const ann = sourceAnnotationMap.get(qId);
        if (!ann) continue;
        if (toBinaryLabel(ann.rating) === "pass") sourceTrainPasses.push(qId);
        else sourceTrainFails.push(qId);
      }
      const sourceSampled = stratifiedFewShot(
        sourceTrainPasses,
        sourceTrainFails,
        config.maxFewShotExamples ?? 8,
        config.splitSeed,
      );
      const fewShotExamples = buildFewShotExamples(
        sourceSampled.ids,
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
            fewShotExamples,
            config.outputFormatJson,
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
          console.error(
            `[evaluator] Judge execution failed for result ${result._id}:`,
            e,
          );
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

      // Bootstrap CI using the most recent completed test run's per-result labels
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
          ci = bootstrapCI(testLabels, testPreds, pObs, 20000, config.splitSeed);
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

interface EligibleQuestions {
  ids: string[];
  labels: Map<string, "pass" | "fail">;
}

async function getEligibleQuestionIds(
  ctx: any,
  config: any,
): Promise<EligibleQuestions> {
  const mappings = await ctx.runQuery(
    internal.failureModes.crud.mappingsByExperimentInternal,
    { experimentId: config.experimentId },
  );
  const fmQuestionIds = new Set<string>(
    mappings
      .filter((m: any) => m.failureModeId === config.failureModeId)
      .map((m: any) => m.questionId as string),
  );

  const annotations = await ctx.runQuery(
    internal.annotations.crud.byExperimentInternal,
    { experimentId: config.experimentId },
  );

  const ids: string[] = [];
  const labels = new Map<string, "pass" | "fail">();
  const seen = new Set<string>();
  for (const a of annotations) {
    const qId = a.questionId as string;
    if (seen.has(qId)) continue;
    seen.add(qId);
    const label = toBinaryLabel(a.rating);
    if (fmQuestionIds.has(qId) || label === "pass") {
      ids.push(qId);
      labels.set(qId, label);
    }
  }
  return { ids, labels };
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

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function assembleJudgePrompt(
  fewShotExamples: FewShotExample[],
  outputFormatJson: string | undefined,
  target: { question: string; answer: string; context: string },
): string {
  const parts: string[] = [];

  // Few-shot examples
  if (fewShotExamples.length > 0) {
    parts.push("<examples>");
    for (const ex of fewShotExamples) {
      parts.push("  <example>");
      parts.push(`    <question>${escapeXml(ex.question)}</question>`);
      parts.push(`    <agent_answer>${escapeXml(ex.answer)}</agent_answer>`);
      if (ex.context) {
        parts.push(
          `    <retrieved_context>${escapeXml(ex.context)}</retrieved_context>`,
        );
      }
      const verdict = ex.humanLabel === "pass" ? "Pass" : "Fail";
      const reasoning = `This is a ${ex.humanLabel === "pass" ? "passing" : "failing"} example.`;
      parts.push(
        `    <evaluation>{"reasoning": "${reasoning}", "answer": "${verdict}"}</evaluation>`,
      );
      parts.push("  </example>");
    }
    parts.push("</examples>");
    parts.push("");
  }

  // Target
  parts.push("<input>");
  parts.push(`  <question>${escapeXml(target.question)}</question>`);
  parts.push(`  <agent_answer>${escapeXml(target.answer)}</agent_answer>`);
  if (target.context) {
    parts.push(
      `  <retrieved_context>${escapeXml(target.context)}</retrieved_context>`,
    );
  }
  parts.push("</input>");
  parts.push("");

  // Output format
  if (outputFormatJson && outputFormatJson.trim().length > 0) {
    parts.push("<output_format>");
    parts.push(outputFormatJson);
    parts.push("</output_format>");
    parts.push("");
    parts.push(
      "Evaluate the <input> above and return a JSON object matching <output_format>.",
    );
  } else {
    parts.push(
      "Evaluate the <input> above and return your evaluation as a JSON object.",
    );
  }

  return parts.join("\n");
}

