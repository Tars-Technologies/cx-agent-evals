"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { resolveModel } from "../lib/agentLoop";
import { BEHAVIOR_ANCHORS_INSTRUCTION } from "./anchorPrompt";
import { sampleCorpusExemplars } from "./sampleCorpusExemplars";
import { wordCount, median, p90 } from "./lengthStats";

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

export const backfillSynthetic = internalAction({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  handler: async (
    ctx,
    { cursor, batchSize },
  ): Promise<{ migrated: number; isDone: boolean; continueCursor: string | null }> => {
    const page = await ctx.runQuery(internal.conversationSim.migrations.pageSyntheticScenarios, {
      cursor: cursor ?? null,
      batchSize: batchSize ?? 15,
    });

    // Cache transcript pool per batch by orgId
    const orgPools = new Map<string, { transcripts: any[]; exemplars: any[]; stats?: { median: number; p90: number } }>();

    let migrated = 0;
    for (const s of page.page) {
      if (s.sourceType !== "synthetic") continue;
      if (s.referenceExemplars && s.referenceExemplars.length > 0) continue;

      // Load corpus pool once per orgId
      let pool = orgPools.get(s.orgId);
      if (!pool) {
        const transcripts = await ctx.runQuery(internal.conversationSim.migrations.listOrgTranscripts, {
          orgId: s.orgId,
          limit: 50,
        });
        const exemplars = sampleCorpusExemplars(transcripts as any, 8);
        const allUserWords = (transcripts as any[]).flatMap((t) =>
          t.messages.filter((m: any) => m.role === "user").map((m: any) => wordCount(m.text)),
        );
        const stats = allUserWords.length > 0
          ? { median: median(allUserWords), p90: p90(allUserWords) }
          : undefined;
        pool = { transcripts, exemplars, stats };
        orgPools.set(s.orgId, pool);
      }

      if (pool.exemplars.length === 0) {
        // No transcripts in this org → can't backfill exemplars; skip with a warning
        console.warn(`backfillSynthetic: no transcripts available for org ${s.orgId}; skipping ${s._id}`);
        continue;
      }

      // Generate behavior anchors
      let anchors: string[] = [];
      try {
        const transcriptText = pool.exemplars
          .flatMap((ex: any) =>
            ex.messages
              .filter((m: any) => m.role === "human_agent" || m.role === "user")
              .map((m: any) => `${m.role === "user" ? "user" : "agent"}: ${m.text}`),
          )
          .join("\n");
        const prompt = `Persona: ${s.persona.type} (${s.persona.traits.join(", ")}, ${s.persona.communicationStyle}, ${s.persona.patienceLevel} patience)
Intent: ${s.intent}
Topic: ${s.topic}

Sampled real exchanges (use these to ground anchor patterns):
${transcriptText}

${BEHAVIOR_ANCHORS_INSTRUCTION}`;
        const result = await generateText({
          model: resolveModel("claude-sonnet-4-20250514"),
          system: "Output only a JSON array of strings. No prose.",
          prompt,
          temperature: 0.3,
        });
        const parsed = extractJson(result.text);
        if (Array.isArray(parsed)) anchors = parsed.map(String).slice(0, 6);
      } catch (e) {
        console.error(`backfillSynthetic anchor generation failed for ${s._id}:`, e);
        // proceed with empty anchors; exemplars+stats still backfill
      }

      await ctx.runMutation(internal.conversationSim.migrations.patchSyntheticBackfill, {
        id: s._id,
        referenceExemplars: pool.exemplars,
        userMessageLengthStats: pool.stats,
        behaviorAnchors: anchors,
      });
      migrated++;
    }

    return {
      migrated,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
