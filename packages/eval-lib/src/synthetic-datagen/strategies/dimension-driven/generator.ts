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

    this._onProgress({
      phase: "sampling",
      totalQuestions: this._options.totalQuestions,
    });

    const sampled = stratifiedSample(
      matrix.assignments,
      this._options.totalQuestions,
    );

    // Group sampled assignments by document
    const byDoc = new Map<string, DocComboAssignment[]>();
    for (const assignment of sampled) {
      const list = byDoc.get(assignment.docId) || [];
      list.push(assignment);
      byDoc.set(assignment.docId, list);
    }

    const results: GeneratedQuery[] = [];
    const docEntries = [...byDoc.entries()];

    for (let docIdx = 0; docIdx < docEntries.length; docIdx++) {
      const [docId, assignments] = docEntries[docIdx];
      const doc = context.corpus.documents.find(
        (d) => String(d.id) === docId,
      );
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

      const prompt = `Document content:\n${doc.content.substring(0, 6000)}\n\nUser profiles (generate one question per profile):\n${profiles.join("\n")}`;

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

    return results;
  }
}
