import type { Corpus } from "../../../types/index.js";
import type { Embedder } from "../../../embedders/embedder.interface.js";
import type { MatchedQuestion } from "../types.js";
import { cosineSimilarity } from "../../../utils/similarity.js";

/**
 * Maximum character length for a single passage when splitting documents.
 * Paragraphs are accumulated until this limit is reached, then flushed.
 * Lower values produce more granular passages (better precision, slower);
 * higher values capture more context per passage (better recall, faster).
 */
const PASSAGE_MAX_LENGTH = 500;

/**
 * Number of texts to embed in a single call to the embedder.
 * Increase for throughput (if your API rate-limit allows); decrease to
 * avoid request-size limits or to reduce memory pressure.
 */
const EMBED_BATCH_SIZE = 100;

export interface PassageInfo {
  readonly docId: string;
  readonly text: string;
}

/**
 * Break a single oversized text block into chunks that fit within maxLen.
 * Tries progressively smaller split boundaries: single newlines → sentences → hard cut.
 */
function chunkOversizedBlock(block: string, maxLen: number): string[] {
  if (block.length <= maxLen) return [block];

  // Try splitting on single newlines first
  const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    return accumulateChunks(lines, maxLen, "\n");
  }

  // Try splitting on sentence boundaries
  const sentences = block.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 1) {
    return accumulateChunks(sentences, maxLen, " ");
  }

  // Hard truncate as last resort
  const chunks: string[] = [];
  for (let i = 0; i < block.length; i += maxLen) {
    chunks.push(block.slice(i, i + maxLen));
  }
  return chunks;
}

/** Accumulate fragments into chunks that stay under maxLen. */
function accumulateChunks(fragments: string[], maxLen: number, sep: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const frag of fragments) {
    if (current.length > 0 && current.length + frag.length + sep.length > maxLen) {
      chunks.push(current);
      current = "";
    }
    current = current.length > 0 ? current + sep + frag : frag;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  // Any chunk still oversized gets hard-truncated
  return chunks.flatMap((c) =>
    c.length > maxLen
      ? Array.from({ length: Math.ceil(c.length / maxLen) }, (_, i) =>
          c.slice(i * maxLen, (i + 1) * maxLen),
        )
      : [c],
  );
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
    // If accumulated text exceeds max, break it down properly
    if (current.length >= maxLen) {
      passages.push(...chunkOversizedBlock(current, maxLen));
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
  /**
   * Minimum cosine-similarity score for a question-passage pair to be
   * considered a match.  Raise toward 1.0 for stricter matching (fewer
   * but higher-quality matches); lower toward 0.0 for broader coverage.
   */
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
