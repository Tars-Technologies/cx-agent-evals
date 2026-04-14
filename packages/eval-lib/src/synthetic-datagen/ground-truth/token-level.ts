import { distance } from "fastest-levenshtein";
import type { GroundTruth, CharacterSpan } from "../../types/index.js";
import { QueryId, QueryText } from "../../types/primitives.js";
import { createCharacterSpan } from "../../types/chunks.js";
import type { GroundTruthAssignerInterface, GroundTruthAssignerContext } from "./types.js";
import type { GeneratedQuery } from "../strategies/types.js";
import { safeParseLLMResponse } from "../../utils/json.js";

const EXCERPT_PROMPT = `You are an expert at identifying relevant text passages in documents.

Given a document and a question, find ALL passages in the document that are relevant to answering the question. Most questions can be answered or supported by 2–4 different passages — look for all of them, not just the most obvious one.

Rules:
- Copy each passage VERBATIM from the document — do not paraphrase, summarize, or reword
- Each excerpt must appear exactly as written in the document
- Include passages that directly answer the question AND passages that provide important supporting context
- Prefer complete sentences over sentence fragments
- Return at least 1 passage, ideally 2–4

Output JSON: { "excerpts": ["exact verbatim passage 1...", "exact verbatim passage 2...", ...] }`;

export class GroundTruthAssigner implements GroundTruthAssignerInterface<GroundTruth> {
  readonly name = "ground-truth-assigner";

  async assign(
    queries: GeneratedQuery[],
    context: GroundTruthAssignerContext,
  ): Promise<GroundTruth[]> {
    const results: GroundTruth[] = [];
    const docIndex = new Map(context.corpus.documents.map(d => [String(d.id), d]));

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const doc = docIndex.get(query.targetDocId);
      if (!doc) continue;

      const excerpts = await this._extractExcerpts(
        doc.content,
        query.query,
        query.targetDocId,
        context,
      );
      const { spans, failedExcerpts } = this._findSpanPositions(
        doc.content,
        query.targetDocId,
        excerpts,
      );

      if (failedExcerpts.length > 0) {
        console.warn(
          `GroundTruthAssigner: ${failedExcerpts.length} excerpt(s) failed span finding for "${query.query.substring(0, 40)}..."`,
        );
      }

      if (spans.length === 0) continue;

      results.push({
        query: {
          id: QueryId(`q_${i}`),
          text: QueryText(query.query),
          metadata: { sourceDoc: query.targetDocId, ...query.metadata },
        },
        relevantSpans: spans,
      });
    }

    return results;
  }

  private async _extractExcerpts(
    docContent: string,
    question: string,
    docId: string,
    context: GroundTruthAssignerContext,
  ): Promise<string[]> {
    const maxChars = context.maxDocumentChars ?? 15000;
    if (docContent.length > maxChars) {
      console.warn(`Document "${docId}" truncated from ${docContent.length} to ${maxChars} chars`);
    }
    const prompt = `Document:\n${docContent.substring(0, maxChars)}\n\nQuestion: ${question}\n\nFind all relevant passages from the document that answer or support this question. Return 2-4 passages if possible.`;
    const response = await context.llmClient.complete({
      model: context.model,
      messages: [
        { role: "system", content: EXCERPT_PROMPT },
        { role: "user", content: prompt },
      ],
      responseFormat: "json",
    });
    return safeParseLLMResponse(response, { excerpts: [] as string[] }).excerpts ?? [];
  }

  private _findSpanPositions(
    docContent: string,
    docId: string,
    excerpts: string[],
  ): { spans: CharacterSpan[]; failedExcerpts: string[] } {
    const spans: CharacterSpan[] = [];
    const failedExcerpts: string[] = [];

    for (const excerpt of excerpts) {
      // Tier 1: Exact match
      let start = docContent.indexOf(excerpt);

      // Tier 2: Normalized (whitespace + case)
      if (start === -1) {
        start = normalizedFind(docContent, excerpt);
      }

      // Tier 3: Sentence-level fuzzy match via Levenshtein
      if (start === -1) {
        const fuzzySpans = this._fuzzyFindSentences(docContent, docId, excerpt);
        if (fuzzySpans.length > 0) {
          spans.push(...fuzzySpans);
          continue; // Fuzzy found spans for this excerpt, move to next
        }
      }

      if (start === -1) {
        failedExcerpts.push(excerpt.substring(0, 80));
        continue;
      }

      const end = start + excerpt.length;
      const actualText = docContent.substring(start, end);

      try {
        spans.push(
          createCharacterSpan({
            docId,
            start,
            end,
            text: actualText,
          }),
        );
      } catch {
        failedExcerpts.push(excerpt.substring(0, 80));
      }
    }

    return { spans, failedExcerpts };
  }

  private _fuzzyFindSentences(
    docContent: string,
    docId: string,
    excerpt: string,
  ): CharacterSpan[] {
    const spans: CharacterSpan[] = [];
    const sentences = excerpt.match(/[^.!?]+[.!?]+/g) ?? [excerpt];

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 20) continue;

      const windowSize = trimmed.length;
      let bestScore = Infinity;
      let bestStart = -1;

      // Slide a window with step=10 for performance
      for (let i = 0; i <= docContent.length - windowSize; i += 10) {
        const windowText = docContent.substring(i, i + windowSize);
        const d = distance(trimmed.toLowerCase(), windowText.toLowerCase());
        if (d < bestScore) {
          bestScore = d;
          bestStart = i;
        }
      }

      // Accept if edit distance < 15% of string length
      const threshold = Math.ceil(trimmed.length * 0.15);
      if (bestScore <= threshold && bestStart !== -1) {
        // Snap to word boundaries
        while (bestStart > 0 && !/\s/.test(docContent[bestStart - 1])) bestStart--;
        let bestEnd = bestStart + windowSize;
        while (bestEnd < docContent.length && !/\s/.test(docContent[bestEnd])) bestEnd++;

        try {
          spans.push(
            createCharacterSpan({
              docId,
              start: bestStart,
              end: bestEnd,
              text: docContent.substring(bestStart, bestEnd),
            }),
          );
        } catch {
          // Skip invalid span
        }
      }
    }

    return spans;
  }
}

function normalizedFind(text: string, excerpt: string): number {
  const normalize = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
  const normText = normalize(text);
  const normExcerpt = normalize(excerpt);
  const idx = normText.indexOf(normExcerpt);
  if (idx === -1) return -1;

  let origPos = 0;
  let normPos = 0;
  while (normPos < idx && origPos < text.length) {
    if (/\s/.test(text[origPos])) {
      while (origPos < text.length - 1 && /\s/.test(text[origPos + 1])) {
        origPos++;
      }
    }
    origPos++;
    normPos++;
  }
  return origPos;
}
