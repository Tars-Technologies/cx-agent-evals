import type {
  UnifiedGenerationConfig,
  UnifiedGeneratorContext,
  MatchedRealWorldQuestion,
  ValidatedQuestion,
} from "./types.js";
import { calculateQuotas } from "./quota.js";
import { matchRealWorldQuestions } from "./matching.js";
import { filterCombinations } from "./filtering.js";
import { generateForDocument } from "./per-doc-generation.js";
import { findCitationSpan } from "./citation-validator.js";

/**
 * Orchestrates the unified question generation pipeline:
 *   1. Calculate per-document quotas
 *   2. Match real-world questions to documents (if provided + embedder available)
 *   3. Filter dimension combinations (if dimensions provided)
 *   4. Generate questions per document (scenarios 1–4)
 *   5. Validate citations and produce ValidatedQuestion[]
 */
export class UnifiedQuestionGenerator {
  constructor(
    private readonly config: UnifiedGenerationConfig,
    private readonly context: UnifiedGeneratorContext,
  ) {}

  async generate(): Promise<ValidatedQuestion[]> {
    const model = this.config.model ?? this.context.model;

    // 1. Calculate quotas
    const docs = this.context.corpus.documents.map((d) => ({
      id: String(d.id),
      priority: 3, // default priority
    }));
    const quotas = calculateQuotas(
      docs,
      this.config.totalQuestions,
      this.config.allocationOverrides,
    );

    // 2. Match real-world questions (if provided + embedder available)
    let matchedByDoc: Record<string, MatchedRealWorldQuestion[]> = {};
    if (this.config.realWorldQuestions?.length && this.context.embedder) {
      const result = await matchRealWorldQuestions(
        this.context.corpus,
        this.config.realWorldQuestions,
        this.context.embedder,
      );
      matchedByDoc = result.matchedByDoc;
    }

    // 3. Filter dimension combos (if provided)
    let validCombos: Record<string, string>[] = [];
    if (this.config.dimensions?.length) {
      validCombos = await filterCombinations(
        [...this.config.dimensions],
        this.context.llmClient,
        model,
      );
    }

    // 4. Generate per document
    const allQuestions: ValidatedQuestion[] = [];
    for (const doc of this.context.corpus.documents) {
      const docId = String(doc.id);
      const quota = quotas.get(docId) ?? 0;
      if (quota === 0) continue;

      const matched = matchedByDoc[docId] ?? [];

      const rawQuestions = await generateForDocument({
        docId,
        docContent: doc.content,
        quota,
        matched,
        combos: validCombos,
        preferences: this.config.promptPreferences,
        llmClient: this.context.llmClient,
        model,
      });

      // 5. Validate citations
      for (const q of rawQuestions) {
        const span = findCitationSpan(doc.content, q.citation);
        if (span) {
          allQuestions.push({
            ...q,
            span: {
              docId,
              start: span.start,
              end: span.end,
              text: span.text,
            },
          });
        }
        // Failed citations are silently dropped
      }
    }

    return allQuestions;
  }
}
