import type {
  QuestionStrategy,
  StrategyContext,
  GeneratedQuery,
  DimensionDrivenStrategyOptions,
  ProgressCallback,
  DocComboAssignment,
} from "../types.js";
import { safeParseLLMResponse } from "../../../utils/json.js";
import { loadDimensions } from "./dimensions.js";
import { filterCombinations } from "./filtering.js";
import { buildRelevanceMatrix } from "./relevance.js";
import { stratifiedSample } from "./sampling.js";

const BATCH_GENERATION_PROMPT = `You are generating synthetic user questions for evaluating a RAG system.
Generate questions that match the user profiles described below and are answerable from the provided document content.

Each question should be natural-sounding — something a real user with that profile would actually type or ask.

Do NOT copy-paste or trivially rephrase the document text.

Output JSON format:
{
  "questions": [
    { "profile_index": 0, "question": "..." },
    { "profile_index": 1, "question": "..." }
  ]
}`;

export class DimensionDrivenStrategy implements QuestionStrategy {
  readonly name = "dimension-driven";
  private _options: DimensionDrivenStrategyOptions;
  private _onProgress: ProgressCallback;

  constructor(options: DimensionDrivenStrategyOptions) {
    this._options = options;
    this._onProgress = options.onProgress ?? (() => {});
  }

  async generate(context: StrategyContext): Promise<GeneratedQuery[]> {
    const dimensions = this._options.dimensions
      ? [...this._options.dimensions]
      : await loadDimensions(this._options.dimensionsFilePath!);

    this._onProgress({
      phase: "filtering",
      totalPairs: (dimensions.length * (dimensions.length - 1)) / 2,
    });

    const validCombos = await filterCombinations(
      dimensions,
      context.llmClient,
      context.model,
    );
    console.log(`[DimensionDriven] Funnel: ${validCombos.length} combos after filtering`);

    this._onProgress({
      phase: "summarizing",
      totalDocs: context.corpus.documents.length,
    });

    const matrix = await buildRelevanceMatrix(
      context.corpus,
      validCombos,
      context.llmClient,
      context.model,
    );
    console.log(`[DimensionDriven] Funnel: ${matrix.assignments.length} assignments from relevance matrix`);

    this._onProgress({
      phase: "sampling",
      totalQuestions: this._options.totalQuestions,
    });

    const sampled = stratifiedSample(
      matrix.assignments,
      this._options.totalQuestions,
    );

    // ── Deficit fill: if sampling produced fewer than requested, fill with unscoped questions ──
    const deficit = this._options.totalQuestions - sampled.length;
    console.log(`[DimensionDriven] Funnel: ${sampled.length} sampled (target: ${this._options.totalQuestions}), deficit: ${deficit}`);
    if (deficit > 0) {
      console.warn(
        `Dimension-driven pipeline: stratified sample produced ${sampled.length}/${this._options.totalQuestions}. ` +
        `Filling ${deficit} with unscoped questions.`
      );
    }

    // Group sampled assignments by document
    const byDoc = new Map<string, DocComboAssignment[]>();
    for (const assignment of sampled) {
      const list = byDoc.get(assignment.docId) || [];
      list.push(assignment);
      byDoc.set(assignment.docId, list);
    }

    const results: GeneratedQuery[] = [];
    const docEntries = [...byDoc.entries()];
    const docIndex = new Map(context.corpus.documents.map(d => [String(d.id), d]));

    for (let docIdx = 0; docIdx < docEntries.length; docIdx++) {
      const [docId, assignments] = docEntries[docIdx];
      const doc = docIndex.get(docId);
      if (!doc) continue;

      this._onProgress({
        phase: "generating",
        docId,
        docIndex: docIdx,
        totalDocs: docEntries.length,
        questionsForDoc: assignments.length,
      });

      // Build profiles for all assignments for this doc
      const profiles = assignments.map((a, i) => {
        const profileDesc = Object.entries(a.combo)
          .map(([dim, val]) => `${dim}: ${val}`)
          .join(", ");
        return `[${i}] ${profileDesc}`;
      });

      const maxChars = this._options.maxDocumentChars ?? 6000;
      if (doc.content.length > maxChars) {
        console.warn(`Document "${docId}" truncated from ${doc.content.length} to ${maxChars} chars`);
      }
      const prompt = `Document content:\n${doc.content.substring(0, maxChars)}\n\nUser profiles (generate one question per profile):\n${profiles.join("\n")}`;

      const response = await context.llmClient.complete({
        model: context.model,
        messages: [
          { role: "system", content: BATCH_GENERATION_PROMPT },
          { role: "user", content: prompt },
        ],
        responseFormat: "json",
      });

      const data = safeParseLLMResponse(response, { questions: [] as Array<{ profile_index: number; question: string }> });
      const questions: Array<{ profile_index: number; question: string }> =
        data.questions ?? [];

      for (const q of questions) {
        const assignment = assignments[q.profile_index];
        if (!assignment || !q.question) continue;

        const metadata: Record<string, string> = {
          strategy: "dimension-driven",
          ...Object.fromEntries(
            Object.entries(assignment.combo).map(([k, v]) => [k, String(v)]),
          ),
        };

        results.push({
          query: q.question,
          targetDocId: docId,
          metadata,
        });
      }
    }

    // ── Generate deficit fill questions (no specific profiles) ──
    if (deficit > 0) {
      // Distribute deficit across all documents proportionally
      const allDocIds = context.corpus.documents.map(d => String(d.id));
      const deficitPerDoc = Math.ceil(deficit / allDocIds.length);

      for (let dIdx = 0; dIdx < allDocIds.length && results.length < this._options.totalQuestions; dIdx++) {
        const docId = allDocIds[dIdx];
        const doc = docIndex.get(docId);
        if (!doc) continue;

        const needed = Math.min(deficitPerDoc, this._options.totalQuestions - results.length);
        if (needed <= 0) break;

        this._onProgress({
          phase: "generating",
          docId,
          docIndex: dIdx,
          totalDocs: allDocIds.length,
          questionsForDoc: needed,
        });

        const maxChars = this._options.maxDocumentChars ?? 6000;
        const docContent = doc.content.substring(0, maxChars);

        const fillPrompt = `Document:\n${docContent}\n\nGenerate ${needed} diverse evaluation questions for a RAG system. Questions should be answerable from this document and sound natural.\n\nOutput JSON: { "questions": ["q1", "q2", ...] }`;

        const fillResponse = await context.llmClient.complete({
          model: context.model,
          messages: [
            { role: "system", content: BATCH_GENERATION_PROMPT },
            { role: "user", content: fillPrompt },
          ],
          responseFormat: "json",
        });

        const fillData = safeParseLLMResponse(fillResponse, { questions: [] as string[] });
        for (const q of (fillData.questions ?? [])) {
          if (results.length >= this._options.totalQuestions) break;
          results.push({
            query: q,
            targetDocId: docId,
            metadata: { strategy: "dimension-driven", mode: "deficit-fill" },
          });
        }
      }
    }

    // Final safety trim
    return results.slice(0, this._options.totalQuestions);
  }
}
