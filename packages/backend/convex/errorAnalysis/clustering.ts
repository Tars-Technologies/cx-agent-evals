"use node";

/**
 * LLM-driven re-clustering of failure modes for an errorAnalysis.
 *
 * Replace semantics: this action DELETES all existing failureModes (and their
 * memberships) for the analysis before writing a new LLM-generated set. This
 * is intentional — re-cluster is destructive. Manually authored modes are
 * also wiped, since we do not track creation provenance on failureModes.
 *
 * Pipeline:
 *   1. Load analysis + annotations (annotations live in the by_analysis index).
 *   2. Hydrate the conversation/transcript text for each annotated source.
 *   3. Filter to FAILING annotations (rating "fail" or "bad").
 *   4. Prompt gpt-4o with the failing items; expect json_object back.
 *   5. Wipe existing failure modes for this analysis.
 *   6. Write new modes + memberships (memberships carry polymorphic source).
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import OpenAI from "openai";

const MAX_TRANSCRIPT_CHARS = 2000;
const MAX_TURNS = 20;

type AnnotationSource = Doc<"annotations">["source"];

function summarizeConversationTurns(
  messages: Array<{ role: string; content: string }>,
): string {
  const lines: string[] = [];
  let used = 0;
  for (const m of messages) {
    if (m.role === "system" || m.role === "tool_call" || m.role === "tool_result") continue;
    const role = m.role === "assistant" ? "Agent" : "User";
    const line = `${role}: ${m.content}`;
    if (used + line.length > MAX_TRANSCRIPT_CHARS) {
      lines.push("…[truncated]");
      break;
    }
    lines.push(line);
    used += line.length;
    if (lines.length >= MAX_TURNS) {
      lines.push("…[truncated]");
      break;
    }
  }
  return lines.join("\n");
}

function summarizeLivechatTurns(
  messages: Array<{ role: string; text: string }>,
): string {
  const lines: string[] = [];
  let used = 0;
  for (const m of messages) {
    const role = m.role === "human_agent" ? "Agent" : "User";
    const line = `${role}: ${m.text}`;
    if (used + line.length > MAX_TRANSCRIPT_CHARS) {
      lines.push("…[truncated]");
      break;
    }
    lines.push(line);
    used += line.length;
    if (lines.length >= MAX_TURNS) {
      lines.push("…[truncated]");
      break;
    }
  }
  return lines.join("\n");
}

export const recluster = action({
  args: { errorAnalysisId: v.id("errorAnalyses") },
  handler: async (ctx, { errorAnalysisId }): Promise<{ failureModesCreated: number }> => {
    const analysis = await ctx.runQuery(
      internal.errorAnalysis.orchestration.getInternal,
      { id: errorAnalysisId },
    );
    if (!analysis) throw new Error("Error analysis not found");

    const annotations = await ctx.runQuery(
      internal.annotations.crud.byAnalysisInternal,
      { errorAnalysisId },
    );

    // Hydrate transcript text + collect failing items.
    type FailingItem = {
      transcript: string;
      tags: string[];
      comment: string;
      source: AnnotationSource;
    };
    const failingItems: FailingItem[] = [];

    for (const ann of annotations) {
      const isFailing = ann.rating === "fail" || ann.rating === "bad";
      if (!isFailing) continue;

      let transcript = "";
      if (ann.source.kind === "conversation") {
        const conv = await ctx.runQuery(
          internal.errorAnalysis.clusteringHelpers.getConversationInternal,
          { id: ann.source.conversationId },
        );
        if (!conv) continue;
        const msgs = await ctx.runQuery(
          internal.errorAnalysis.clusteringHelpers.listConversationMessagesInternal,
          { conversationId: ann.source.conversationId },
        );
        transcript = summarizeConversationTurns(
          msgs.map((m: Doc<"messages">) => ({ role: m.role, content: m.content })),
        );
      } else {
        const tr = await ctx.runQuery(
          internal.errorAnalysis.clusteringHelpers.getLivechatInternal,
          { id: ann.source.transcriptId },
        );
        if (!tr) continue;
        transcript = summarizeLivechatTurns(tr.messages);
      }

      failingItems.push({
        transcript,
        tags: ann.tags ?? [],
        comment: ann.comment ?? "",
        source: ann.source,
      });
    }

    // Always wipe old modes first so empty-failing-set leaves the analysis clean.
    await ctx.runMutation(
      internal.errorAnalysis.clusteringHelpers.deleteFailureModesForAnalysisInternal,
      { errorAnalysisId },
    );

    if (failingItems.length === 0) {
      await ctx.runMutation(internal.failureModes.crud.createInternal, {
        orgId: analysis.orgId,
        agentId: analysis.agentId,
        errorAnalysisId,
        name: "No failures detected",
        description:
          "All annotated conversations were rated as passing. No failure patterns to analyze.",
        order: 0,
      });
      return { failureModesCreated: 1 };
    }

    const itemDescriptions = failingItems
      .map((item, i) => {
        const tagsStr = item.tags.length > 0 ? item.tags.join(", ") : "none";
        const commentStr = item.comment || "none";
        return `[${i + 1}] Conversation:\n${item.transcript}\nTags: ${tagsStr}\nAnnotator comment: ${commentStr}`;
      })
      .join("\n\n---\n\n");

    const openai = new OpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an expert at analyzing AI agent failures. Given a set of failing AI agent conversations with human annotations (tags and comments), identify distinct failure modes — recurring patterns or categories of failure in the agent's behavior.

Return a JSON object with this structure:
{
  "failureModes": [
    {
      "name": "Short descriptive name",
      "description": "Detailed description of this failure pattern, what characterizes it, and why the agent fails in these cases.",
      "itemIndices": [1, 3, 5]  // 1-based indices of items that belong to this failure mode
    }
  ]
}

Guidelines:
- Create 3-8 failure modes (fewer if the failures are homogeneous)
- Each failure mode should represent a distinct pattern, not just a single conversation
- A conversation can belong to multiple failure modes if applicable
- Names should be concise (2-5 words)
- Descriptions should be 1-3 sentences explaining the pattern
- Use the tags and annotator comments as primary signals for grouping`,
        },
        {
          role: "user",
          content: `Analyze these ${failingItems.length} failing AI agent conversations and identify failure modes:\n\n${itemDescriptions}`,
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

    let created = 0;
    for (let i = 0; i < parsed.failureModes.length; i++) {
      const fm = parsed.failureModes[i];

      const failureModeId: Id<"failureModes"> = await ctx.runMutation(
        internal.failureModes.crud.createInternal,
        {
          orgId: analysis.orgId,
          agentId: analysis.agentId,
          errorAnalysisId,
          name: fm.name,
          description: fm.description,
          order: i,
        },
      );
      created++;

      for (const idx of fm.itemIndices) {
        const item = failingItems[idx - 1];
        if (!item) continue;
        await ctx.runMutation(internal.failureModes.memberships.addInternal, {
          orgId: analysis.orgId,
          failureModeId,
          source: item.source,
        });
      }
    }

    return { failureModesCreated: created };
  },
});
