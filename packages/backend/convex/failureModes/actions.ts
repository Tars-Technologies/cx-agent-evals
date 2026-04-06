"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import OpenAI from "openai";

export const generate = internalAction({
  args: { experimentId: v.id("experiments") },
  handler: async (ctx, args) => {
    const experiment = await ctx.runQuery(
      internal.experiments.orchestration.getInternal,
      { id: args.experimentId },
    );
    if (!experiment) throw new Error("Experiment not found");

    const annotations = await ctx.runQuery(
      internal.annotations.crud.byExperimentInternal,
      { experimentId: args.experimentId },
    );

    const agentResults = await ctx.runQuery(
      internal.experiments.agentResults.byExperimentInternal,
      { experimentId: args.experimentId },
    );

    const questions = await ctx.runQuery(
      internal.crud.questions.byDatasetInternal,
      { datasetId: experiment.datasetId },
    );

    // Build lookup maps
    const questionMap = new Map(questions.map((q: any) => [q._id, q]));
    const resultMap = new Map(agentResults.map((r: any) => [r._id, r]));

    // Collect failing annotations with context
    const failingItems: Array<{
      questionId: string;
      questionText: string;
      answerText: string;
      tags: string[];
      comment: string;
    }> = [];

    for (const annotation of annotations) {
      const isFailing =
        annotation.rating === "fail" || annotation.rating === "bad";
      if (!isFailing) continue;

      const question = questionMap.get(annotation.questionId);
      const result = resultMap.get(annotation.resultId);
      if (!question || !result) continue;

      failingItems.push({
        questionId: annotation.questionId,
        questionText: question.queryText,
        answerText: result.answerText,
        tags: annotation.tags ?? [],
        comment: annotation.comment ?? "",
      });
    }

    if (failingItems.length === 0) {
      // No failures to analyze — create a single "No failures" mode
      await ctx.runMutation(internal.failureModes.crud.createInternal, {
        orgId: experiment.orgId,
        experimentId: args.experimentId,
        name: "No failures detected",
        description:
          "All annotated results were rated as passing. No failure patterns to analyze.",
        order: 0,
      });
      return;
    }

    // Build prompt for LLM
    const itemDescriptions = failingItems
      .map(
        (item, i) =>
          `[${i + 1}] Question: ${item.questionText}\nAnswer: ${item.answerText.slice(0, 500)}${item.answerText.length > 500 ? "..." : ""}\nTags: ${item.tags.length > 0 ? item.tags.join(", ") : "none"}\nComment: ${item.comment || "none"}`,
      )
      .join("\n\n");

    const openai = new OpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert at analyzing AI system failures. Given a set of failing question-answer pairs with human annotations (tags and comments), identify distinct failure modes — recurring patterns or categories of failure.

Return a JSON object with this structure:
{
  "failureModes": [
    {
      "name": "Short descriptive name",
      "description": "Detailed description of this failure pattern, what characterizes it, and why the AI fails in these cases.",
      "itemIndices": [1, 3, 5]  // 1-based indices of items that belong to this failure mode
    }
  ]
}

Guidelines:
- Create 3-8 failure modes (fewer if the failures are homogeneous)
- Each failure mode should represent a distinct pattern, not just a single question
- A question can belong to multiple failure modes if applicable
- Names should be concise (2-5 words)
- Descriptions should be 1-3 sentences explaining the pattern
- Use the tags and comments as signals for grouping`,
        },
        {
          role: "user",
          content: `Analyze these ${failingItems.length} failing results and identify failure modes:\n\n${itemDescriptions}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response from LLM");

    const parsed = JSON.parse(content) as {
      failureModes: Array<{
        name: string;
        description: string;
        itemIndices: number[];
      }>;
    };

    // Create failure modes and mappings one by one (enables real-time UI updates)
    for (let i = 0; i < parsed.failureModes.length; i++) {
      const fm = parsed.failureModes[i];

      const failureModeId = await ctx.runMutation(
        internal.failureModes.crud.createInternal,
        {
          orgId: experiment.orgId,
          experimentId: args.experimentId,
          name: fm.name,
          description: fm.description,
          order: i,
        },
      );

      // Map questions to this failure mode
      for (const idx of fm.itemIndices) {
        const item = failingItems[idx - 1]; // 1-based index
        if (!item) continue;

        await ctx.runMutation(
          internal.failureModes.crud.createMappingInternal,
          {
            orgId: experiment.orgId,
            failureModeId,
            questionId: item.questionId as any,
            experimentId: args.experimentId,
          },
        );
      }
    }
  },
});
