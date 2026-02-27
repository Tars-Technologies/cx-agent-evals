import type { Corpus } from "../../../types/index.js";
import type { LLMClient } from "../../base.js";
import type { DimensionCombo, DocComboAssignment, RelevanceMatrix } from "../types.js";
import { safeParseLLMResponse } from "../../../utils/json.js";

const SUMMARY_PROMPT = `Summarize this document in one line: its topic, target audience, and purpose. Be specific and concise.

Output JSON: { "summary": "..." }`;

const ASSIGNMENT_PROMPT = `You are matching user question profiles to documents.

Given document summaries and dimension combinations (user profiles), determine which combinations are plausible for each document — meaning a user with that profile would realistically ask a question about that document.

A combination can match 0, 1, or many documents. Be selective: only assign combinations where the document content is genuinely relevant to someone with that profile.

Output JSON format:
{
  "assignments": [
    { "doc_id": "...", "combo_index": 0 },
    { "doc_id": "...", "combo_index": 1 }
  ]
}`;

export async function buildRelevanceMatrix(
  corpus: Corpus,
  combos: DimensionCombo[],
  llmClient: LLMClient,
  model: string,
): Promise<RelevanceMatrix> {
  const docSummaries = await summarizeDocuments(corpus, llmClient, model);
  const assignments = await assignCombosToDocuments(
    docSummaries,
    combos,
    llmClient,
    model,
  );

  return { assignments, docSummaries };
}

async function summarizeDocuments(
  corpus: Corpus,
  llmClient: LLMClient,
  model: string,
): Promise<ReadonlyMap<string, string>> {
  const results = await Promise.all(
    corpus.documents.map(async (doc) => {
      const content = doc.content.substring(0, 3000);
      const response = await llmClient.complete({
        model,
        messages: [
          { role: "system", content: SUMMARY_PROMPT },
          { role: "user", content: content },
        ],
        responseFormat: "json",
      });
      const data = safeParseLLMResponse(response, { summary: "" });
      return [String(doc.id), data.summary ?? ""] as const;
    }),
  );

  return new Map(results);
}

async function assignCombosToDocuments(
  docSummaries: ReadonlyMap<string, string>,
  combos: DimensionCombo[],
  llmClient: LLMClient,
  model: string,
): Promise<DocComboAssignment[]> {
  const summaryList = [...docSummaries.entries()]
    .map(([id, summary]) => `- ${id}: ${summary}`)
    .join("\n");

  // Batch into groups to avoid exceeding context limits
  const BATCH_SIZE = 50;
  const batches: Array<{ offset: number; batchCombos: DimensionCombo[] }> = [];
  for (let offset = 0; offset < combos.length; offset += BATCH_SIZE) {
    batches.push({ offset, batchCombos: combos.slice(offset, offset + BATCH_SIZE) });
  }

  const batchResults = await Promise.all(
    batches.map(async ({ offset, batchCombos }) => {
      const batchList = batchCombos
        .map((combo, i) => {
          const desc = Object.entries(combo)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
          return `[${offset + i}] ${desc}`;
        })
        .join("\n");

      const prompt = `Document summaries:\n${summaryList}\n\nDimension combinations:\n${batchList}\n\nAssign each combination to the documents where it's plausible.`;

      const response = await llmClient.complete({
        model,
        messages: [
          { role: "system", content: ASSIGNMENT_PROMPT },
          { role: "user", content: prompt },
        ],
        responseFormat: "json",
      });

      const data = safeParseLLMResponse(response, { assignments: [] as Array<{ doc_id: string; combo_index: number }> });
      const rawAssignments: Array<{ doc_id: string; combo_index: number }> =
        data.assignments ?? [];

      const results: DocComboAssignment[] = [];
      for (const a of rawAssignments) {
        if (a.combo_index >= 0 && a.combo_index < combos.length) {
          results.push({
            docId: a.doc_id,
            combo: combos[a.combo_index],
          });
        }
      }
      return results;
    }),
  );

  return batchResults.flat();
}
