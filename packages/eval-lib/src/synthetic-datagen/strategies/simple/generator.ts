import type {
  QuestionStrategy,
  StrategyContext,
  GeneratedQuery,
  SimpleStrategyOptions,
} from "../types.js";
import { safeParseLLMResponse } from "../../../utils/json.js";

const SYSTEM_PROMPT = `You are an expert at generating evaluation questions for RAG (Retrieval-Augmented Generation) systems.

Your task: Given document content, generate diverse, high-quality questions that would require retrieving this document to answer.

QUESTION QUALITY REQUIREMENTS:
- Each question must be answerable from the provided document content
- Questions must require actual retrieval — avoid questions answerable from a title alone
- Do NOT copy-paste or trivially rephrase sentences from the document
- Use natural language a real user would type or say
- Vary question structure across these types:
  • Factoid: "What is the default timeout for X?"
  • Comparison: "How does X differ from Y?"
  • Procedural: "How do I configure X for Y?"
  • Conditional: "Under what conditions does X happen?"
  • Multi-hop: Questions requiring information from multiple parts of the document
  • Yes/No: "Does X support Y?"

DO NOT:
- Ask about the document itself ("What does this document describe?")
- Generate questions that are trivially similar to each other
- Use overly formal or robotic phrasing
- Ask about information not present in the document

EXAMPLES OF GOOD QUESTIONS:
- "What happens if a Kubernetes pod exceeds its memory limit?"
- "How do I migrate from API v1 to v2?"
- "Can I use SSO with the free tier?"

EXAMPLES OF BAD QUESTIONS:
- "What is mentioned in the document about pods?" (meta-question)
- "Describe Kubernetes pods." (not a retrieval question)
- "What are the smallest deployable units?" (trivial rephrasing)

Output JSON format:
{
  "questions": ["question 1", "question 2", ...]
}`;

export class SimpleStrategy implements QuestionStrategy {
  readonly name = "simple";
  private _options: SimpleStrategyOptions;

  constructor(options: SimpleStrategyOptions) {
    this._options = options;
  }

  async generate(context: StrategyContext): Promise<GeneratedQuery[]> {
    const results: GeneratedQuery[] = [];

    for (const doc of context.corpus.documents) {
      const docContent = doc.content.substring(0, 8000);
      const prompt = `Document:\n${docContent}\n\nGenerate ${this._options.queriesPerDoc} diverse questions following the requirements above.`;

      const response = await context.llmClient.complete({
        model: context.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        responseFormat: "json",
      });

      const data = safeParseLLMResponse(response, { questions: [] as string[] });
      const questions: string[] = data.questions ?? [];

      for (const question of questions) {
        results.push({
          query: question,
          targetDocId: String(doc.id),
          metadata: { strategy: "simple" },
        });
      }
    }

    return results;
  }
}
