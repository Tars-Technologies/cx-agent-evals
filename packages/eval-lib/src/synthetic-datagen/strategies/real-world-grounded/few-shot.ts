import type { LLMClient } from "../../base.js";
import type { MatchedQuestion } from "../types.js";

const FEW_SHOT_GENERATION_PROMPT = `You are generating synthetic user questions for evaluating a RAG system.
You will be given a document and REAL questions that users have asked about similar content.
Generate new questions that match the style, vocabulary, and complexity patterns of the real examples.

Your generated questions should:
- Sound like they came from the same population of users
- Cover different aspects of the document content
- NOT be rephrases of the example questions
- Be answerable from the provided document

Output JSON format:
{
  "questions": ["question1", "question2", ...]
}`;

export async function generateFewShotQuestions(
  docContent: string,
  fewShotExamples: readonly MatchedQuestion[],
  count: number,
  llmClient: LLMClient,
  model: string,
  options?: { maxDocumentChars?: number; docId?: string },
): Promise<string[]> {
  const maxChars = options?.maxDocumentChars ?? 6000;
  if (docContent.length > maxChars) {
    console.warn(`Document "${options?.docId ?? "unknown"}" truncated from ${docContent.length} to ${maxChars} chars`);
  }
  const exampleList = fewShotExamples
    .map((e, i) => `${i + 1}. "${e.question}"`)
    .join("\n");

  const prompt = `Document content:\n${docContent.substring(0, maxChars)}\n\nReal user questions about this content:\n${exampleList}\n\nGenerate ${count} new questions in the same style.`;

  const response = await llmClient.complete({
    model,
    messages: [
      { role: "system", content: FEW_SHOT_GENERATION_PROMPT },
      { role: "user", content: prompt },
    ],
    responseFormat: "json",
  });

  const data = JSON.parse(response);
  const questions: string[] = data.questions ?? [];
  return questions.filter((q) => typeof q === "string" && q.trim().length > 0);
}

export function distributeBudget(
  matchCountByDoc: Map<string, number>,
  allDocIds: string[],
  totalBudget: number,
): Map<string, number> {
  const result = new Map<string, number>();
  if (totalBudget <= 0) return result;

  const totalMatches = [...matchCountByDoc.values()].reduce((a, b) => a + b, 0);

  // Docs with no matches get minimum 1
  const unmatchedDocs = allDocIds.filter((id) => !matchCountByDoc.has(id) || matchCountByDoc.get(id) === 0);
  const minAllocation = Math.min(unmatchedDocs.length, totalBudget);
  const remainingBudget = totalBudget - minAllocation;

  for (const docId of unmatchedDocs) {
    if (minAllocation > 0) {
      result.set(docId, 1);
    }
  }

  // Distribute remaining proportionally to matched docs
  if (remainingBudget > 0 && totalMatches > 0) {
    const matchedDocs = allDocIds.filter((id) => matchCountByDoc.has(id) && matchCountByDoc.get(id)! > 0);
    let allocated = 0;

    for (let i = 0; i < matchedDocs.length; i++) {
      const docId = matchedDocs[i];
      const count = matchCountByDoc.get(docId)!;
      const share = i === matchedDocs.length - 1
        ? remainingBudget - allocated // last doc gets remainder to avoid rounding issues
        : Math.round((count / totalMatches) * remainingBudget);
      if (share > 0) {
        result.set(docId, (result.get(docId) ?? 0) + share);
        allocated += share;
      }
    }
  }

  return result;
}
