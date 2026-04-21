"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { generateText } from "ai";
import { resolveModel } from "../lib/agentLoop";

export const generateScenarios = internalAction({
  args: {
    datasetId: v.id("datasets"),
    kbId: v.id("knowledgeBases"),
    orgId: v.string(),
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
    }),
  },
  handler: async (ctx, { datasetId, kbId, orgId, config }) => {
    const model = config.model ?? "claude-sonnet-4-20250514";
    const targetCount = config.count;

    // 1. Load KB documents (take up to 20 docs, truncate content for context window)
    const docs = await ctx.runQuery(
      internal.crud.documents.listByKbInternal,
      { kbId },
    );
    if (docs.length === 0) throw new Error("No documents in knowledge base");

    const docSummaries = docs.slice(0, 20).map((d) => ({
      title: d.title,
      content: d.content.slice(0, 2000),
    }));

    const kbContext = docSummaries
      .map((d) => `### ${d.title}\n${d.content}`)
      .join("\n\n---\n\n");

    // 2. Dimension discovery
    const dimensionResult = await generateText({
      model: resolveModel(model),
      system:
        "You analyze knowledge base content to discover dimensions for customer support conversation scenarios.",
      prompt: `Analyze the following knowledge base content and identify dimensions for generating realistic customer support scenarios.

${kbContext}

Return a JSON object with these arrays:
{
  "personaTypes": ["description of persona type", ...],  // 5-8 diverse persona types
  "topics": ["topic name", ...],                          // 5-10 topics covered in the KB
  "intents": ["intent description", ...],                 // 5-8 user intents (what they want to achieve)
  "communicationStyles": ["style", ...],                  // 3-5 styles (formal, casual, etc.)
  "emotionalStates": ["state", ...]                       // 3-5 emotional states (frustrated, curious, etc.)
}

Respond ONLY with the JSON object.`,
      temperature: 0.3,
    });

    let dimensions;
    try {
      dimensions = JSON.parse(dimensionResult.text.trim());
    } catch {
      // Try to extract JSON from response
      const match = dimensionResult.text.match(/\{[\s\S]*\}/);
      if (match) dimensions = JSON.parse(match[0]);
      else throw new Error("Failed to parse dimension discovery response");
    }

    // 3. Generate combinations and scenarios in batches
    const complexityDist = config.complexityDistribution ?? {
      low: 0.3,
      medium: 0.5,
      high: 0.2,
    };
    const complexities = distributeComplexity(targetCount, complexityDist);

    const batchSize = 5;
    let generatedCount = 0;

    for (let i = 0; i < targetCount; i += batchSize) {
      const batchCount = Math.min(batchSize, targetCount - i);
      const batchComplexities = complexities.slice(i, i + batchCount);

      const scenarioResult = await generateText({
        model: resolveModel(model),
        system:
          "You generate realistic customer support conversation scenarios based on knowledge base content. Each scenario describes a simulated end-user who will contact support.",
        prompt: `Based on these dimensions discovered from the knowledge base:
${JSON.stringify(dimensions, null, 2)}

And this knowledge base content:
${kbContext.slice(0, 3000)}

Generate exactly ${batchCount} conversation scenarios. For each scenario, use a different combination of dimensions.

Complexity levels for this batch: ${JSON.stringify(batchComplexities)}

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
    "instruction": "string - detailed instruction for the LLM user-simulator (2-3 paragraphs describing exactly how to play this role, what to ask, how to respond)"
  }
]

Make each scenario unique and realistic. The instruction field should be detailed enough for an LLM to roleplay the user convincingly.

Respond ONLY with the JSON array.`,
        temperature: 0.7,
      });

      let scenarios;
      try {
        scenarios = JSON.parse(scenarioResult.text.trim());
      } catch {
        const match = scenarioResult.text.match(/\[[\s\S]*\]/);
        if (match) scenarios = JSON.parse(match[0]);
        else continue; // Skip this batch on parse failure
      }

      if (!Array.isArray(scenarios)) continue;

      // Save each scenario
      for (const s of scenarios) {
        try {
          const persona = {
            type: String(s.persona?.type ?? "General User"),
            traits: Array.isArray(s.persona?.traits)
              ? s.persona.traits.map(String)
              : [],
            communicationStyle: String(
              s.persona?.communicationStyle ?? "neutral",
            ),
            patienceLevel: validateLevel(s.persona?.patienceLevel),
          };

          await ctx.runMutation(
            internal.conversationSim.scenarios.createInternal,
            {
              datasetId,
              orgId,
              persona,
              topic: String(s.topic ?? "General"),
              intent: String(s.intent ?? "Get help"),
              complexity: validateLevel(s.complexity),
              reasonForContact: String(
                s.reasonForContact ?? "Needs assistance",
              ),
              knownInfo: String(
                s.knownInfo ?? "Basic information about the service",
              ),
              unknownInfo: String(
                s.unknownInfo ?? "Specific details about their issue",
              ),
              instruction: String(
                s.instruction ?? "Contact support about your issue",
              ),
            },
          );
          generatedCount++;
        } catch (e) {
          console.error("Failed to save scenario:", e);
        }
      }
    }

    // Update dataset scenario count
    await ctx.runMutation(internal.crud.datasets.updateScenarioCount, {
      datasetId,
      scenarioCount: generatedCount,
    });

    return { generated: generatedCount };
  },
});

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
