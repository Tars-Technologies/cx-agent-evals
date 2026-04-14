import type { LLMClient } from "../base.js";
import type {
  GenerationScenario,
  MatchedRealWorldQuestion,
  PromptPreferences,
  UnifiedQuestion,
} from "./types.js";

// ---------------------------------------------------------------------------
// determineScenario
// ---------------------------------------------------------------------------

/**
 * Determines which of the 4 generation scenarios applies:
 *  1 — matched >= quota: top-quota real-world questions, extract citations only
 *  2 — 0 < matched < quota: partial real-world + generate remainder
 *  3 — matched == 0, combos available: generate all with diversity guidance
 *  4 — matched == 0, no combos: generate all with preferences only
 */
export function determineScenario(
  matchedCount: number,
  quota: number,
  hasValidCombos: boolean,
): GenerationScenario {
  if (matchedCount >= quota) return 1;
  if (matchedCount > 0) return 2;
  if (hasValidCombos) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

export interface BuildPromptParams {
  readonly scenario: GenerationScenario;
  readonly docContent: string;
  readonly quota: number;
  readonly matched: readonly MatchedRealWorldQuestion[];
  readonly combos: ReadonlyArray<Record<string, string>>;
  readonly preferences: PromptPreferences;
  readonly model: string;
  readonly excludeQuestions?: readonly string[];
}

function formatCombos(combos: ReadonlyArray<Record<string, string>>): string {
  return combos
    .map((combo, i) => {
      const pairs = Object.entries(combo)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `  Profile ${i + 1}: ${pairs}`;
    })
    .join("\n");
}

/**
 * Builds the system + user prompt for per-document question generation.
 */
export function buildPrompt(params: BuildPromptParams): {
  system: string;
  user: string;
} {
  const { scenario, docContent, quota, matched, combos, preferences } = params;

  const system =
    "You are an expert question generator for RAG (Retrieval-Augmented Generation) evaluation systems. " +
    "Your goal is to create high-quality questions that test whether a retrieval system can surface the relevant information from a document. " +
    "For each question you must provide a verbatim citation — an exact excerpt from the document that answers the question. " +
    "Always respond with valid JSON matching the requested output schema.";

  const parts: string[] = [];

  // [DOCUMENT]
  parts.push("[DOCUMENT]");
  parts.push(docContent);
  parts.push("");

  // [STYLE EXAMPLES] — scenarios 1 and 2
  if (scenario === 1 || scenario === 2) {
    const examples =
      scenario === 1 ? matched.slice(0, quota) : matched;
    parts.push("[STYLE EXAMPLES]");
    parts.push("Real questions from actual users (use these as style references):");
    examples.forEach((m, i) => {
      parts.push(`  ${i + 1}. ${m.question}`);
    });
    parts.push("");
  }

  // [DIVERSITY GUIDANCE] — scenarios 2 and 3
  if ((scenario === 2 || scenario === 3) && combos.length > 0) {
    parts.push("[DIVERSITY GUIDANCE]");
    parts.push("User profiles for question diversity:");
    parts.push(formatCombos(combos));
    parts.push("");
  }

  // [PREFERENCES]
  parts.push("[PREFERENCES]");
  parts.push(`Question types: ${preferences.questionTypes.join(", ")}`);
  parts.push(`Tone: ${preferences.tone}`);
  parts.push(`Focus areas: ${preferences.focusAreas}`);
  parts.push("");

  // [TASK]
  parts.push("[TASK]");

  if (scenario === 1) {
    // Only citation extraction — no new questions generated
    const topMatched = matched.slice(0, quota);
    parts.push(
      `Extract a verbatim citation from the document for each of the following ${quota} existing questions:`,
    );
    topMatched.forEach((m, i) => {
      parts.push(`  ${i + 1}. ${m.question}`);
    });
    parts.push("");
    parts.push(
      `For each question set "source" to "real-world" and provide the "citation" as a verbatim excerpt from the document.`,
    );
  } else if (scenario === 2) {
    const generateCount = quota - matched.length;
    parts.push(
      `Generate exactly ${generateCount} new questions based on the document. ` +
        `Use the style examples above as inspiration for tone and framing.`,
    );
    if (combos.length > 0) {
      parts.push(
        `Use the diversity profiles above to vary the perspective of new questions.`,
      );
    }
    parts.push("");
    parts.push(
      `Additionally, extract a verbatim citation from the document for each of these existing questions:`,
    );
    matched.forEach((m, i) => {
      parts.push(`  ${i + 1}. ${m.question}`);
    });
    parts.push(
      `For existing questions set "source" to "real-world". For new questions set "source" to "generated".`,
    );
  } else {
    // Scenarios 3 and 4 — generate all quota questions
    parts.push(`Generate exactly ${quota} questions based on the document.`);
    if (scenario === 3 && combos.length > 0) {
      parts.push(
        `Use the diversity profiles above to vary the perspective of questions.`,
      );
    }
    parts.push(`Set "source" to "generated" for all questions.`);
  }

  parts.push("");
  parts.push(
    `For each question, provide a "citation" as a verbatim excerpt from the document that answers the question.`,
  );

  // Exclusions for retry rounds
  if (params.excludeQuestions && params.excludeQuestions.length > 0) {
    parts.push("");
    parts.push(
      "IMPORTANT: Do NOT generate questions similar to the following (these have already been generated):",
    );
    params.excludeQuestions.forEach((q, i) => {
      parts.push(`  ${i + 1}. ${q}`);
    });
  }

  parts.push("");
  parts.push("Output JSON in this exact format:");
  parts.push(
    JSON.stringify(
      {
        questions: [
          {
            question: "...",
            citation: "exact verbatim excerpt from the document",
            source: "generated",
            profile: "persona=developer, intent=troubleshooting or null",
          },
        ],
      },
      null,
      2,
    ),
  );

  return { system, user: parts.join("\n") };
}

// ---------------------------------------------------------------------------
// parseGenerationResponse
// ---------------------------------------------------------------------------

export interface ParsedQuestion {
  question: string;
  citation: string;
  source: string;
  profile: string | null;
}

/**
 * Parses the LLM JSON response into an array of questions.
 * Returns an empty array if parsing fails.
 */
export function parseGenerationResponse(response: string): ParsedQuestion[] {
  if (!response || response.trim() === "") return [];

  let text = response.trim();

  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1];
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>)["questions"])
    ) {
      return [];
    }

    const questions = (parsed as Record<string, unknown>)[
      "questions"
    ] as unknown[];

    return questions
      .filter(
        (q): q is Record<string, unknown> =>
          typeof q === "object" && q !== null,
      )
      .map((q) => ({
        question: String(q["question"] ?? ""),
        citation: String(q["citation"] ?? ""),
        source: String(q["source"] ?? "generated"),
        profile:
          q["profile"] == null ? null : String(q["profile"]),
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// splitLargeDocument
// ---------------------------------------------------------------------------

/**
 * Splits a document into chunks of at most maxChars characters with optional overlap.
 * If the document is smaller than maxChars, returns a single-element array.
 */
export function splitLargeDocument(
  content: string,
  maxChars = 20000,
  overlap = 200,
): string[] {
  if (content.length <= maxChars) return [content];

  const chunks: string[] = [];
  let start = 0;

  while (start < content.length) {
    const end = Math.min(start + maxChars, content.length);
    chunks.push(content.slice(start, end));
    if (end === content.length) break;
    start = end - overlap;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// generateForDocument
// ---------------------------------------------------------------------------

export interface GenerateForDocumentParams {
  readonly docId: string;
  readonly docContent: string;
  readonly quota: number;
  readonly matched: readonly MatchedRealWorldQuestion[];
  readonly combos: ReadonlyArray<Record<string, string>>;
  readonly preferences: PromptPreferences;
  readonly llmClient: LLMClient;
  readonly model: string;
  readonly excludeQuestions?: readonly string[];
}

/**
 * Main entry point for per-document question generation.
 * Determines the scenario, builds the prompt, calls the LLM, and parses results.
 */
export async function generateForDocument(
  params: GenerateForDocumentParams,
): Promise<UnifiedQuestion[]> {
  const {
    docId,
    docContent,
    quota,
    matched,
    combos,
    preferences,
    llmClient,
    model,
  } = params;

  const scenario = determineScenario(
    matched.length,
    quota,
    combos.length > 0,
  );

  // For large documents, use the first chunk for question generation
  const chunks = splitLargeDocument(docContent);
  const contentForPrompt = chunks[0];

  const { system, user } = buildPrompt({
    scenario,
    docContent: contentForPrompt,
    quota,
    matched,
    combos,
    preferences,
    model,
    excludeQuestions: params.excludeQuestions,
  });

  let response: string;
  try {
    response = await llmClient.complete({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: "json",
    });
  } catch {
    return [];
  }

  const parsed = parseGenerationResponse(response);

  return parsed.map((q) => ({
    question: q.question,
    citation: q.citation,
    source: q.source === "real-world" ? "real-world" : "generated",
    profile: q.profile,
    docId,
  }));
}
