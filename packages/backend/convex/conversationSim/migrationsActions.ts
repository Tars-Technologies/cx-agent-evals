"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { resolveModel } from "../lib/agentLoop";
import { BEHAVIOR_ANCHORS_INSTRUCTION } from "./anchorPrompt";

function extractJson(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*\n?/gm, "").replace(/\n?```\s*$/gm, "").trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const arrayMatch = stripped.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
  }
  throw new Error(`Failed to parse JSON: ${stripped.slice(0, 200)}`);
}

export const backfillBehaviorAnchors = internalAction({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  handler: async (ctx, { cursor, batchSize }): Promise<{
    migrated: number;
    isDone: boolean;
    continueCursor: string | null;
  }> => {
    const page = await ctx.runQuery(internal.conversationSim.migrations.pageScenariosForAnchors, {
      cursor: cursor ?? null,
      batchSize: batchSize ?? 15,
    });

    let migrated = 0;
    for (const s of page.page) {
      // Filter: grounded scenarios with referenceTranscript but no behaviorAnchors
      if (s.behaviorAnchors && s.behaviorAnchors.length > 0) continue;
      if (!s.referenceTranscript || s.referenceTranscript.length === 0) continue;

      const transcriptText = s.referenceTranscript
        .filter((m: any) => m.role === "human_agent" || m.role === "user")
        .map((m: any) => `${m.role === "user" ? "user" : "agent"}: ${m.text}`)
        .join("\n");

      const prompt = `Persona: ${s.persona.type} (${s.persona.traits.join(", ")}, ${s.persona.communicationStyle}, ${s.persona.patienceLevel} patience)
Intent: ${s.intent}
Topic: ${s.topic}

Transcript:
${transcriptText}

${BEHAVIOR_ANCHORS_INSTRUCTION}`;

      try {
        const result = await generateText({
          model: resolveModel("claude-sonnet-4-20250514"),
          system: "Output only a JSON array of strings. No prose.",
          prompt,
          temperature: 0.3,
        });
        const anchors = extractJson(result.text);
        if (Array.isArray(anchors)) {
          await ctx.runMutation(internal.conversationSim.migrations.patchBehaviorAnchors, {
            id: s._id,
            behaviorAnchors: anchors.map(String).slice(0, 6),
          });
          migrated++;
        }
      } catch (e) {
        console.error(`backfillBehaviorAnchors failed for ${s._id}:`, e);
        // continue; don't poison the batch
      }
    }

    return {
      migrated,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
