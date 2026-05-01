"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { generateText } from "ai";
import { resolveModel } from "../lib/agentLoop";
import type { Id } from "../_generated/dataModel";
import { wordCount, median, p90 } from "./lengthStats";
import { BEHAVIOR_ANCHORS_INSTRUCTION } from "./anchorPrompt";
import { sampleCorpusExemplars } from "./sampleCorpusExemplars";
import { extractJson } from "./extractJson";

// ─── Types ───

interface TranscriptProfile {
  personaClusters: string[];
  commonIntents: string[];
  topicDistribution: string[];
  conversationPatterns: string[];
  languagesUsed: string[];
}

// ─── Helpers ───

function validateLevel(val: unknown): "low" | "medium" | "high" {
  if (val === "low" || val === "medium" || val === "high") return val;
  return "medium";
}

function distributeComplexity(
  count: number,
  dist: { low: number; medium: number; high: number },
): Array<"low" | "medium" | "high"> {
  const result: Array<"low" | "medium" | "high"> = [];
  const lowCount = Math.round(count * dist.low);
  const medCount = Math.round(count * dist.medium);
  const highCount = count - lowCount - medCount;

  for (let i = 0; i < lowCount; i++) result.push("low");
  for (let i = 0; i < medCount; i++) result.push("medium");
  for (let i = 0; i < highCount; i++) result.push("high");

  // Shuffle
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function extractPersona(s: Record<string, unknown>) {
  const p = (s.persona && typeof s.persona === "object" ? s.persona : {}) as Record<string, unknown>;
  return {
    type: String(p.type ?? "General User"),
    traits: Array.isArray(p.traits) ? (p.traits as unknown[]).map(String) : [],
    communicationStyle: String(p.communicationStyle ?? "neutral"),
    patienceLevel: validateLevel(p.patienceLevel),
  };
}


function sampleTranscripts<T>(transcripts: T[], count: number): T[] {
  if (count <= 0) return [];
  if (transcripts.length === 0) return [];

  // Shuffle a copy
  const shuffled = [...transcripts];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  if (count <= shuffled.length) {
    return shuffled.slice(0, count);
  }

  // Repeat cyclically
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    result.push(shuffled[i % shuffled.length]);
  }
  return result;
}

async function analyzeTranscriptCorpus(
  transcripts: Array<{ _id: string; messages: Array<{ role: string; text: string }>; botFlowInput?: { intent: string; language: string } | null; labels?: string[] }>,
  model: string,
): Promise<TranscriptProfile> {
  const summaries = transcripts.slice(0, 30).map((t, i) => {
    const userMsgs = t.messages.filter((m) => m.role === "user").map((m) => m.text).slice(0, 5);
    const intent = t.botFlowInput?.intent ?? "unknown";
    const language = t.botFlowInput?.language ?? "unknown";
    const labels = t.labels?.join(", ") ?? "";
    return `[${i + 1}] intent=${intent}, lang=${language}, labels=${labels}\nUser messages: ${userMsgs.join(" | ")}`;
  });

  const result = await generateText({
    model: resolveModel(model),
    system:
      "You analyze customer support transcript corpora to identify patterns and clusters. Always respond with valid JSON only.",
    prompt: `Analyze these ${summaries.length} customer support transcript summaries and identify patterns:

${summaries.join("\n\n")}

Return a JSON object:
{
  "personaClusters": ["description of persona cluster", ...],   // 4-8 clusters
  "commonIntents": ["intent description", ...],                  // 5-10 common intents
  "topicDistribution": ["topic area", ...],                      // 5-10 topic areas
  "conversationPatterns": ["pattern description", ...],          // 3-6 patterns
  "languagesUsed": ["language", ...]                             // all languages observed
}

Respond ONLY with the JSON object.`,
    temperature: 0.3,
  });

  return extractJson(result.text) as TranscriptProfile;
}

async function generateGroundedScenarios(
  transcriptBatch: Array<{ _id: Id<"livechatConversations">; messages: Array<{ id: number; role: string; text: string }>; botFlowInput?: { intent: string; language: string } | null; labels?: string[]; visitorName?: string }>,
  complexities: Array<"low" | "medium" | "high">,
  fidelity: number,
  model: string,
): Promise<Array<Record<string, unknown>>> {
  let fidelityInstruction: string;
  if (fidelity >= 80) {
    fidelityInstruction =
      "Stay very close to the original transcript. Preserve the language, intent, and style.";
  } else if (fidelity >= 50) {
    fidelityInstruction =
      "Capture the essence of the original transcript but allow moderate variation in wording and detail.";
  } else {
    fidelityInstruction =
      "Use the transcript as loose inspiration only. Keep the general topic and intent but create a distinct variation with different wording and angle.";
  }

  const transcriptContexts = transcriptBatch.map((t, i) => {
    const userMsgs = t.messages.filter((m) => m.role === "user");
    const agentMsgs = t.messages.filter((m) => m.role === "human_agent");
    const intent = t.botFlowInput?.intent ?? "unknown";
    const language = t.botFlowInput?.language ?? "unknown";
    return `--- Transcript ${i + 1} (ID: ${t._id}) ---
Intent: ${intent}, Language: ${language}, Labels: ${(t.labels ?? []).join(", ")}
Visitor: ${t.visitorName ?? "unknown"}
Complexity target: ${complexities[i] ?? "medium"}
User messages:
${userMsgs.map((m) => `  [user] ${m.text}`).join("\n")}
Agent messages:
${agentMsgs.slice(0, 5).map((m) => `  [agent] ${m.text}`).join("\n")}`;
  });

  const result = await generateText({
    model: resolveModel(model),
    system:
      "You generate conversation scenarios grounded in real customer support transcripts. Always respond with valid JSON only.",
    prompt: `Convert each transcript below into a conversation scenario configuration.

${fidelityInstruction}

${transcriptContexts.join("\n\n")}

For each transcript, generate a scenario object. Return a JSON array:
[
  {
    "persona": {
      "type": "string - persona type derived from the visitor",
      "traits": ["trait1", "trait2"],
      "communicationStyle": "formal/casual/etc based on transcript",
      "patienceLevel": "low/medium/high"
    },
    "topic": "string - the topic from the transcript",
    "intent": "string - what the user wants to achieve",
    "complexity": "low/medium/high - must match the complexity target",
    "reasonForContact": "string - why they're reaching out",
    "knownInfo": "string - what the user already knows",
    "unknownInfo": "string - what the user doesn't know and wants to find out",
    "behaviorAnchors": ["bullet phrase", ...],
    "_sourceTranscriptId": "string - the transcript ID",
    "_languages": ["string - detected languages"]
  }
]

For behaviorAnchors: ${BEHAVIOR_ANCHORS_INSTRUCTION}

Respond ONLY with the JSON array.`,
    temperature: 0.6,
  });

  return extractJson(result.text) as Array<Record<string, unknown>>;
}

async function generateSyntheticScenarios(
  transcriptProfile: TranscriptProfile | null,
  kbContent: Array<{ title: string; content: string }>,
  exemplars: Array<{ messages: Array<{ role: string; text: string }> }>,
  complexities: Array<"low" | "medium" | "high">,
  model: string,
): Promise<Array<Record<string, unknown>>> {
  const kbContext = kbContent
    .map((d) => `### ${d.title}\n${d.content}`)
    .join("\n\n---\n\n");

  let profileContext = "";
  if (transcriptProfile) {
    profileContext = `
You also have insight from real customer transcripts. Generate scenarios that COMPLEMENT (not duplicate) these patterns:
- Persona clusters seen: ${transcriptProfile.personaClusters.join(", ")}
- Common intents seen: ${transcriptProfile.commonIntents.join(", ")}
- Topics seen: ${transcriptProfile.topicDistribution.join(", ")}
- Patterns seen: ${transcriptProfile.conversationPatterns.join(", ")}
- Languages used: ${transcriptProfile.languagesUsed.join(", ")}

Try to cover gaps — generate personas, intents, and topics NOT already well-represented in the transcript data.
`;
  }

  let exemplarContext = "";
  if (exemplars.length > 0) {
    exemplarContext = `
Real exchanges sampled from the corpus (use these to ground your behavior anchors in observable patterns):
${exemplars.slice(0, 8).map((ex, i) =>
  `Exemplar ${i + 1}:\n${ex.messages.map((m) => `  [${m.role}] ${m.text}`).join("\n")}`,
).join("\n\n")}
`;
  }

  const result = await generateText({
    model: resolveModel(model),
    system:
      "You generate realistic customer support conversation scenarios based on knowledge base content. Each scenario describes a simulated end-user who will contact support. Always respond with valid JSON only.",
    prompt: `Based on this knowledge base content:
${kbContext.slice(0, 12000)}
${profileContext}
${exemplarContext}

Generate exactly ${complexities.length} conversation scenarios.

Complexity levels for this batch: ${JSON.stringify(complexities)}

Return a JSON array of scenarios:
[
  {
    "persona": {
      "type": "string - the persona type",
      "traits": ["trait1", "trait2"],
      "communicationStyle": "formal/casual/etc",
      "patienceLevel": "low/medium/high"
    },
    "topic": "string - the topic",
    "intent": "string - what the user wants to achieve",
    "complexity": "low/medium/high",
    "reasonForContact": "string - why they're reaching out",
    "knownInfo": "string - what the user already knows",
    "unknownInfo": "string - what the user doesn't know and wants to find out",
    "behaviorAnchors": ["bullet phrase", ...]
  }
]

For behaviorAnchors: ${BEHAVIOR_ANCHORS_INSTRUCTION}

Make each scenario unique and realistic.

Respond ONLY with the JSON array.`,
    temperature: 0.7,
  });

  return extractJson(result.text) as Array<Record<string, unknown>>;
}

// ─── Main action ───

const TIMEOUT_SAFETY_MS = 8 * 60 * 1000;

export const generateScenarios = internalAction({
  args: {
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    orgId: v.string(),
    jobId: v.id("scenarioGenJobs"),
    config: v.object({
      count: v.number(),
      model: v.optional(v.string()),
      complexityDistribution: v.optional(
        v.object({
          low: v.number(),
          medium: v.number(),
          high: v.number(),
        }),
      ),
      transcriptConversationIds: v.optional(v.array(v.id("livechatConversations"))),
      distribution: v.number(),
      fidelity: v.number(),
    }),
  },
  handler: async (ctx, { datasetId, kbId, orgId, jobId, config }) => {
    const startTime = Date.now();
    const model = config.model ?? "claude-sonnet-4-20250514";
    const targetCount = config.count;

    const complexityDist = config.complexityDistribution ?? {
      low: 0.3,
      medium: 0.5,
      high: 0.2,
    };

    // ── Calculate split ──
    const hasTranscripts = (config.transcriptConversationIds?.length ?? 0) > 0;
    const groundedPct = hasTranscripts ? config.distribution : 0;
    const groundedCount = Math.round((targetCount * groundedPct) / 100);
    const syntheticCount = targetCount - groundedCount;

    // ── Load transcripts (if any) ──
    let transcripts: Array<{
      _id: Id<"livechatConversations">;
      messages: Array<{ id: number; role: string; text: string }>;
      botFlowInput?: { intent: string; language: string } | null;
      labels?: string[];
      visitorName?: string;
    }> = [];

    if (hasTranscripts) {
      const loaded = await Promise.all(
        config.transcriptConversationIds!.map((id) =>
          ctx.runQuery(internal.livechat.orchestration.getConversationInternal, { id }),
        ),
      );
      transcripts = loaded.filter(Boolean) as typeof transcripts;
    }

    // ── Phase 1: Transcript Analysis ──
    let transcriptProfile: TranscriptProfile | null = null;
    if (transcripts.length > 0) {
      try {
        transcriptProfile = await analyzeTranscriptCorpus(
          transcripts as Parameters<typeof analyzeTranscriptCorpus>[0],
          model,
        );
      } catch (e) {
        console.error("Transcript analysis failed, continuing without profile:", e);
      }
    }

    // ── Phase 1.5: Pre-sample exemplars & corpus length stats (synthetic only) ──
    let synthExemplars: Array<{ sourceTranscriptId: Id<"livechatConversations">; messages: Array<{ id: number; role: "user" | "human_agent" | "workflow_input"; text: string }> }> = [];
    let synthLengthStats: { median: number; p90: number } | undefined;

    if (syntheticCount > 0 && transcripts.length > 0) {
      synthExemplars = sampleCorpusExemplars(
        transcripts as Parameters<typeof sampleCorpusExemplars>[0],
        8,
      );

      const allUserWords = transcripts.flatMap((t) =>
        t.messages.filter((m) => m.role === "user").map((m) => wordCount(m.text)),
      );
      if (allUserWords.length > 0) {
        synthLengthStats = { median: median(allUserWords), p90: p90(allUserWords) };
      }
    }

    // ── Load KB docs (for synthetic track and dimension context) ──
    const docs = await ctx.runQuery(
      internal.crud.documents.listByKbInternal,
      { kbId },
    );
    if (docs.length === 0 && syntheticCount > 0) {
      throw new Error("No documents in knowledge base for synthetic generation");
    }
    const kbContent = docs.slice(0, 20).map((d) => ({
      title: d.title,
      content: (d.content ?? "").slice(0, 2000),
    }));

    const batchSize = 5;
    let generatedCount = 0;

    // ── Phase 2a: Grounded Track ──
    if (groundedCount > 0 && transcripts.length > 0) {
      const groundedComplexities = distributeComplexity(groundedCount, complexityDist);
      const sampled = sampleTranscripts(transcripts, groundedCount);

      for (let i = 0; i < groundedCount; i += batchSize) {
        if (Date.now() - startTime > TIMEOUT_SAFETY_MS) {
          console.warn("Timeout safety triggered during grounded track");
          break;
        }

        const batchEnd = Math.min(i + batchSize, groundedCount);
        const batchTranscripts = sampled.slice(i, batchEnd);
        const batchComplexities = groundedComplexities.slice(i, batchEnd);

        try {
          const scenarios = await generateGroundedScenarios(
            batchTranscripts,
            batchComplexities,
            config.fidelity,
            model,
          );

          if (!Array.isArray(scenarios)) continue;

          for (let j = 0; j < scenarios.length && generatedCount < targetCount; j++) {
            const s = scenarios[j];
            try {
              const persona = extractPersona(s);

              // Snapshot full transcript (no filtering) and length stats
              const sourceTranscript = batchTranscripts[j];
              const referenceTranscript = sourceTranscript?.messages.map((m) => ({
                id: m.id,
                role: m.role as "user" | "human_agent" | "workflow_input",
                text: m.text,
              })) ?? [];

              const userWordCounts = referenceTranscript
                .filter((m) => m.role === "user")
                .map((m) => wordCount(m.text));

              const userMessageLengthStats = userWordCounts.length > 0
                ? { median: median(userWordCounts), p90: p90(userWordCounts) }
                : undefined;

              const behaviorAnchors = Array.isArray(s.behaviorAnchors)
                ? (s.behaviorAnchors as unknown[]).map(String).slice(0, 6)
                : [];

              // Always use the actual transcript ID, not LLM output
              const sourceTranscriptId = batchTranscripts[j]?._id;

              const languages = Array.isArray(s._languages)
                ? (s._languages as string[]).map(String)
                : [];

              await ctx.runMutation(
                internal.conversationSim.scenarios.createInternal,
                {
                  datasetId,
                  orgId,
                  persona,
                  topic: String(s.topic ?? "General"),
                  intent: String(s.intent ?? "Get help"),
                  complexity: validateLevel(s.complexity),
                  reasonForContact: String(s.reasonForContact ?? "Needs assistance"),
                  knownInfo: String(s.knownInfo ?? "Basic information about the service"),
                  unknownInfo: String(s.unknownInfo ?? "Specific details about their issue"),
                  instruction: "",   // legacy field; new generation no longer authors prose
                  referenceTranscript,
                  userMessageLengthStats,
                  behaviorAnchors,
                  sourceType: "transcript_grounded",
                  sourceTranscriptId,
                  languages,
                },
              );
              generatedCount++;
            } catch (e) {
              console.error("Failed to save grounded scenario:", e);
            }
          }
        } catch (e) {
          console.error("Failed to generate grounded batch:", e);
        }

        // Report progress
        await ctx.runMutation(
          internal.conversationSim.generation.updateProgress,
          { jobId, generatedCount },
        );
      }
    }

    // ── Phase 2b: Synthetic Track ──
    if (syntheticCount > 0) {
      const syntheticComplexities = distributeComplexity(syntheticCount, complexityDist);

      for (let i = 0; i < syntheticCount; i += batchSize) {
        if (Date.now() - startTime > TIMEOUT_SAFETY_MS) {
          console.warn("Timeout safety triggered during synthetic track");
          break;
        }

        const batchEnd = Math.min(i + batchSize, syntheticCount);
        const batchComplexities = syntheticComplexities.slice(i, batchEnd);

        try {
          const scenarios = await generateSyntheticScenarios(
            transcriptProfile,
            kbContent,
            synthExemplars.map((ex) => ({
              messages: ex.messages.map((m) => ({ role: m.role, text: m.text })),
            })),
            batchComplexities,
            model,
          );

          if (!Array.isArray(scenarios)) continue;

          for (const s of scenarios) {
            if (generatedCount >= targetCount) break;
            try {
              const persona = extractPersona(s);
              const behaviorAnchors = Array.isArray(s.behaviorAnchors)
                ? (s.behaviorAnchors as unknown[]).map(String).slice(0, 6)
                : [];

              await ctx.runMutation(
                internal.conversationSim.scenarios.createInternal,
                {
                  datasetId,
                  orgId,
                  persona,
                  topic: String(s.topic ?? "General"),
                  intent: String(s.intent ?? "Get help"),
                  complexity: validateLevel(s.complexity),
                  reasonForContact: String(s.reasonForContact ?? "Needs assistance"),
                  knownInfo: String(s.knownInfo ?? "Basic information about the service"),
                  unknownInfo: String(s.unknownInfo ?? "Specific details about their issue"),
                  instruction: "",   // legacy field; no longer authored
                  referenceExemplars: synthExemplars,
                  userMessageLengthStats: synthLengthStats,
                  behaviorAnchors,
                  sourceType: "synthetic",
                  languages: [],
                },
              );
              generatedCount++;
            } catch (e) {
              console.error("Failed to save synthetic scenario:", e);
            }
          }
        } catch (e) {
          console.error("Failed to generate synthetic batch:", e);
        }

        // Report progress
        await ctx.runMutation(
          internal.conversationSim.generation.updateProgress,
          { jobId, generatedCount },
        );
      }
    }

    // ── Update dataset scenario count ──
    await ctx.runMutation(internal.crud.datasets.updateScenarioCount, {
      datasetId,
      scenarioCount: generatedCount,
    });

    return { generated: generatedCount };
  },
});
