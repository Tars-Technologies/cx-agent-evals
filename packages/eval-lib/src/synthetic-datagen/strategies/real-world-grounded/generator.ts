import type {
  QuestionStrategy,
  StrategyContext,
  GeneratedQuery,
  RealWorldGroundedStrategyOptions,
  ProgressCallback,
  MatchedQuestion,
} from "../types.js";
import { matchQuestionsToDocuments } from "./matching.js";
import { generateFewShotQuestions, distributeBudget } from "./few-shot.js";

export class RealWorldGroundedStrategy implements QuestionStrategy {
  readonly name = "real-world-grounded";
  private _options: RealWorldGroundedStrategyOptions;
  private _onProgress: ProgressCallback;

  constructor(options: RealWorldGroundedStrategyOptions) {
    this._options = options;
    this._onProgress = options.onProgress ?? (() => {});
  }

  async generate(context: StrategyContext): Promise<GeneratedQuery[]> {
    if (!context.embedder) {
      throw new Error(
        "RealWorldGroundedStrategy requires an embedder in StrategyContext. " +
        "Pass an Embedder instance via context.embedder.",
      );
    }

    const {
      questions,
      totalSyntheticQuestions,
      matchThreshold,
      fewShotExamplesPerDoc = 5,
    } = this._options;

    // Phase 1: Embedding & matching
    this._onProgress({ phase: "embedding-questions", totalQuestions: questions.length });

    // embedding-passages event is emitted inside matching, but we approximate here
    const totalPassages = context.corpus.documents.reduce((sum, doc) => {
      // rough estimate: 1 passage per 500 chars
      return sum + Math.max(1, Math.ceil(doc.content.length / 500));
    }, 0);
    this._onProgress({ phase: "embedding-passages", totalPassages });

    const matches = await matchQuestionsToDocuments(
      context.corpus,
      questions,
      context.embedder,
      { threshold: matchThreshold },
    );

    const totalMatched = [...matches.values()].reduce((s, m) => s + m.length, 0);
    this._onProgress({ phase: "matching", totalQuestions: totalMatched });

    const results: GeneratedQuery[] = [];

    // Mode A: Direct reuse — all matched questions
    for (const [docId, matched] of matches) {
      for (const m of matched) {
        results.push({
          query: m.question,
          targetDocId: docId,
          metadata: {
            strategy: "real-world-grounded",
            mode: "direct",
            matchScore: m.score.toFixed(3),
          },
        });
      }
    }

    // Mode B: Few-shot synthetic generation
    if (totalSyntheticQuestions > 0) {
      const allDocIds = context.corpus.documents.map((d) => String(d.id));
      const matchCountByDoc = new Map<string, number>();
      for (const [docId, matched] of matches) {
        matchCountByDoc.set(docId, matched.length);
      }

      const budget = distributeBudget(matchCountByDoc, allDocIds, totalSyntheticQuestions);

      // Collect global top-K for docs with no matches
      const allMatches: MatchedQuestion[] = [...matches.values()].flat()
        .sort((a, b) => b.score - a.score);
      const globalTopK = allMatches.slice(0, fewShotExamplesPerDoc);

      const docsWithBudget = [...budget.entries()].filter(([, count]) => count > 0);

      const docIndex = new Map(context.corpus.documents.map(d => [String(d.id), d]));

      for (let docIdx = 0; docIdx < docsWithBudget.length; docIdx++) {
        const [docId, count] = docsWithBudget[docIdx];
        const doc = docIndex.get(docId);
        if (!doc) continue;

        this._onProgress({
          phase: "generating",
          docId,
          docIndex: docIdx,
          totalDocs: docsWithBudget.length,
          questionsForDoc: count,
        });

        // Use doc-specific matches as few-shot, fall back to global
        const docMatches = matches.get(docId) ?? [];
        const fewShot = docMatches.length > 0
          ? docMatches.slice(0, fewShotExamplesPerDoc)
          : globalTopK;

        if (fewShot.length === 0) continue; // no examples at all, skip

        const generated = await generateFewShotQuestions(
          doc.content,
          fewShot,
          count,
          context.llmClient,
          context.model,
          { maxDocumentChars: this._options.maxDocumentChars, docId },
        );

        for (const q of generated) {
          results.push({
            query: q,
            targetDocId: docId,
            metadata: {
              strategy: "real-world-grounded",
              mode: "generated",
            },
          });
        }
      }
    }

    this._onProgress({ phase: "done", totalQuestions: results.length });

    return results;
  }
}
