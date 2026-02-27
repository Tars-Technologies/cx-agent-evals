import type { LLMClient } from "../../base.js";
import type { Dimension, DimensionCombo } from "../types.js";
import { safeParseLLMResponse } from "../../../utils/json.js";

const FILTER_PROMPT = `You are evaluating whether pairs of dimension values represent realistic user profiles for question generation.

Given two dimensions and all possible value pairs between them, identify which pairs are UNREALISTIC — combinations that a real user would almost never exhibit.

Be conservative: only mark truly implausible pairs. If a combination is uncommon but possible, keep it.

Output JSON format:
{
  "unrealistic_pairs": [
    { "dim_a_value": "new_user", "dim_b_value": "advanced_config" }
  ]
}`;

interface PairFilter {
  dimA: string;
  dimB: string;
  unrealistic: Set<string>;
}

export async function filterCombinations(
  dimensions: Dimension[],
  llmClient: LLMClient,
  model: string,
): Promise<DimensionCombo[]> {
  const pairFilters = await buildPairwiseFilters(dimensions, llmClient, model);
  const allCombos = generateAllCombinations(dimensions);
  return allCombos.filter((combo) => isValidCombo(combo, pairFilters));
}

async function buildPairwiseFilters(
  dimensions: Dimension[],
  llmClient: LLMClient,
  model: string,
): Promise<PairFilter[]> {
  const tasks: Array<{ dimA: Dimension; dimB: Dimension }> = [];
  for (let i = 0; i < dimensions.length; i++) {
    for (let j = i + 1; j < dimensions.length; j++) {
      tasks.push({ dimA: dimensions[i], dimB: dimensions[j] });
    }
  }

  return Promise.all(
    tasks.map(async ({ dimA, dimB }) => {
      const pairs = dimA.values.flatMap((a) =>
        dimB.values.map((b) => `${a} × ${b}`),
      );

      const prompt = `Dimension A: "${dimA.name}" (${dimA.description})
Values: ${dimA.values.join(", ")}

Dimension B: "${dimB.name}" (${dimB.description})
Values: ${dimB.values.join(", ")}

All possible pairs:
${pairs.join("\n")}

Which pairs are unrealistic?`;

      const response = await llmClient.complete({
        model,
        messages: [
          { role: "system", content: FILTER_PROMPT },
          { role: "user", content: prompt },
        ],
        responseFormat: "json",
      });

      const data = safeParseLLMResponse(response, { unrealistic_pairs: [] as Array<{ dim_a_value: string; dim_b_value: string }> });
      const unrealisticPairs: Array<{
        dim_a_value: string;
        dim_b_value: string;
      }> = data.unrealistic_pairs ?? [];

      const unrealistic = new Set(
        unrealisticPairs.map((p) => `${p.dim_a_value}|${p.dim_b_value}`),
      );

      return { dimA: dimA.name, dimB: dimB.name, unrealistic };
    }),
  );
}

function isValidCombo(
  combo: DimensionCombo,
  filters: PairFilter[],
): boolean {
  for (const filter of filters) {
    const valA = combo[filter.dimA];
    const valB = combo[filter.dimB];
    if (valA && valB && filter.unrealistic.has(`${valA}|${valB}`)) {
      return false;
    }
  }
  return true;
}

function generateAllCombinations(dimensions: Dimension[]): DimensionCombo[] {
  if (dimensions.length === 0) return [{}];

  const [first, ...rest] = dimensions;
  const restCombos = generateAllCombinations(rest);

  return first.values.flatMap((value) =>
    restCombos.map((combo) => ({ [first.name]: value, ...combo })),
  );
}
