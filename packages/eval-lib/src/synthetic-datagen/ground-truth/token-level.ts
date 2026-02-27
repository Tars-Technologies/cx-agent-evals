import type { GroundTruth, CharacterSpan } from "../../types/index.js";
import { QueryId, QueryText } from "../../types/primitives.js";
import { createCharacterSpan } from "../../types/chunks.js";
import type { GroundTruthAssignerInterface, GroundTruthAssignerContext } from "./types.js";
import type { GeneratedQuery } from "../strategies/types.js";
import { safeParseLLMResponse } from "../../utils/json.js";

const EXCERPT_PROMPT = `You are an expert at identifying relevant text.
Given a document and question, extract exact passages that answer it.
Copy text VERBATIM - do not paraphrase. Each excerpt must appear exactly in the document.

Output JSON: { "excerpts": ["exact text from document...", ...] }`;

export class GroundTruthAssigner implements GroundTruthAssignerInterface<GroundTruth> {
  readonly name = "ground-truth-assigner";

  async assign(
    queries: GeneratedQuery[],
    context: GroundTruthAssignerContext,
  ): Promise<GroundTruth[]> {
    const results: GroundTruth[] = [];

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const doc = context.corpus.documents.find(
        (d) => String(d.id) === query.targetDocId,
      );
      if (!doc) continue;

      const excerpts = await this._extractExcerpts(
        doc.content,
        query.query,
        query.targetDocId,
        context,
      );
      const spans = this._findSpanPositions(
        doc.content,
        query.targetDocId,
        excerpts,
      );

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
    _docId: string,
    context: GroundTruthAssignerContext,
  ): Promise<string[]> {
    const prompt = `Document:\n${docContent.substring(0, 8000)}\n\nQuestion: ${question}\n\nExtract exact passages.`;
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
  ): CharacterSpan[] {
    const spans: CharacterSpan[] = [];

    for (const excerpt of excerpts) {
      let start = docContent.indexOf(excerpt);

      if (start === -1) {
        start = normalizedFind(docContent, excerpt);
      }

      if (start === -1) {
        console.warn(
          `Could not locate excerpt in document ${docId}: ${excerpt.substring(0, 50)}...`,
        );
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
        console.warn(
          `Span validation failed for excerpt in document ${docId}: ${excerpt.substring(0, 50)}...`,
        );
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
