import type { Corpus } from "../../types/index.js";
import type { Embedder } from "../../embedders/embedder.interface.js";
import type { MatchedRealWorldQuestion } from "./types.js";
import {
  splitIntoPassages,
  embedInBatches,
  cosineSimilarity,
  type PassageInfo,
} from "../strategies/real-world-grounded/matching.js";

export interface MatchingResult {
  readonly matchedByDoc: Record<string, MatchedRealWorldQuestion[]>;
  readonly unmatchedQuestions: string[];
}

export async function matchRealWorldQuestions(
  corpus: Corpus,
  questions: readonly string[],
  embedder: Embedder,
  options?: { threshold?: number },
): Promise<MatchingResult> {
  const threshold = options?.threshold ?? 0.35;

  // Build passage index (reuse existing splitIntoPassages)
  const allPassages: PassageInfo[] = [];
  for (const doc of corpus.documents) {
    const passages = splitIntoPassages(doc.content);
    for (const text of passages) {
      allPassages.push({ docId: String(doc.id), text });
    }
  }

  // Embed all passages + questions (reuse existing embedInBatches)
  const passageTexts = allPassages.map((p) => p.text);
  const passageEmbeddings = await embedInBatches(passageTexts, embedder);
  const questionEmbeddings = await embedInBatches(questions, embedder);

  // Match each question to best passage
  const matchedByDoc: Record<string, MatchedRealWorldQuestion[]> = {};
  const unmatchedQuestions: string[] = [];

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
      if (!matchedByDoc[bestPassage.docId]) matchedByDoc[bestPassage.docId] = [];
      matchedByDoc[bestPassage.docId].push({
        question: questions[qi],
        score: bestScore,
        passageText: bestPassage.text,
      });
    } else {
      unmatchedQuestions.push(questions[qi]);
    }
  }

  // Sort each doc's matches by score descending
  for (const docId of Object.keys(matchedByDoc)) {
    matchedByDoc[docId].sort((a, b) => b.score - a.score);
  }

  return { matchedByDoc, unmatchedQuestions };
}
