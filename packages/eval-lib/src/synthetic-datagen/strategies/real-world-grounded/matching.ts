import type { Corpus } from "../../../types/index.js";
import type { Embedder } from "../../../embedders/embedder.interface.js";
import type { MatchedQuestion } from "../types.js";
import { cosineSimilarity } from "../../../utils/similarity.js";

const PASSAGE_MAX_LENGTH = 500;
const PASSAGE_MERGE_THRESHOLD = 100;
const EMBED_BATCH_SIZE = 100;

export interface PassageInfo {
  readonly docId: string;
  readonly text: string;
}

export function splitIntoPassages(text: string, maxLen = PASSAGE_MAX_LENGTH): string[] {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const passages: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length > 0 && current.length + para.length + 2 > maxLen) {
      passages.push(current);
      current = "";
    }
    if (current.length > 0) {
      current += "\n\n" + para;
    } else {
      current = para;
    }
    // If single paragraph exceeds max, flush it as-is
    if (current.length >= maxLen) {
      passages.push(current);
      current = "";
    }
  }

  if (current.length > 0) {
    passages.push(current);
  }

  return passages;
}

export { cosineSimilarity } from "../../../utils/similarity.js";

export async function embedInBatches(
  texts: readonly string[],
  embedder: Embedder,
  batchSize = EMBED_BATCH_SIZE,
): Promise<number[][]> {
  const batches: Array<readonly string[]> = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }

  const batchResults = await Promise.all(
    batches.map((batch) => embedder.embed(batch)),
  );

  return batchResults.flat();
}

export async function matchQuestionsToDocuments(
  corpus: Corpus,
  questions: readonly string[],
  embedder: Embedder,
  options?: { threshold?: number },
): Promise<Map<string, MatchedQuestion[]>> {
  const threshold = options?.threshold ?? 0.35;

  // Build passage index
  const allPassages: PassageInfo[] = [];
  for (const doc of corpus.documents) {
    const passages = splitIntoPassages(doc.content);
    for (const text of passages) {
      allPassages.push({ docId: String(doc.id), text });
    }
  }

  // Embed everything
  const passageTexts = allPassages.map((p) => p.text);
  const passageEmbeddings = await embedInBatches(passageTexts, embedder);
  const questionEmbeddings = await embedInBatches(questions, embedder);

  // Match each question to best passage
  const results = new Map<string, MatchedQuestion[]>();

  for (let qi = 0; qi < questions.length; qi++) {
    let bestScore = -1;
    let bestPassage: PassageInfo | null = null;

    for (let pi = 0; pi < allPassages.length; pi++) {
      const score = cosineSimilarity(questionEmbeddings[qi], passageEmbeddings[pi]);
      if (score > bestScore) {
        bestScore = score;
        bestPassage = allPassages[pi];
      }
    }

    if (bestPassage && bestScore >= threshold) {
      const list = results.get(bestPassage.docId) ?? [];
      list.push({
        question: questions[qi],
        score: bestScore,
        passageText: bestPassage.text,
      });
      results.set(bestPassage.docId, list);
    }
  }

  // Sort each doc's matches by score descending
  for (const [docId, matches] of results) {
    results.set(
      docId,
      matches.sort((a, b) => b.score - a.score),
    );
  }

  return results;
}
