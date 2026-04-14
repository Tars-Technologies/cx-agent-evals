import { describe, it, expect } from "vitest";
import {
  determineScenario,
  buildPrompt,
  parseGenerationResponse,
  splitLargeDocument,
  generateForDocument,
} from "../../../../src/synthetic-datagen/unified/per-doc-generation.js";
import type { MatchedRealWorldQuestion, PromptPreferences } from "../../../../src/synthetic-datagen/unified/types.js";

const mockLLMClient = {
  name: "mock",
  async complete() {
    return JSON.stringify({
      questions: [
        { question: "What is X?", citation: "X is a thing", source: "generated", profile: null },
      ],
    });
  },
};

const basePreferences: PromptPreferences = {
  questionTypes: ["factual", "conceptual"],
  tone: "professional",
  focusAreas: "core concepts",
};

const makeMatched = (n: number, score = 0.9): MatchedRealWorldQuestion[] =>
  Array.from({ length: n }, (_, i) => ({
    question: `Real question ${i + 1}?`,
    score,
    passageText: `Passage ${i + 1}`,
  }));

// ------------------------------------------------------------------ //
// determineScenario
// ------------------------------------------------------------------ //
describe("determineScenario", () => {
  it("returns 1 when matched >= quota", () => {
    expect(determineScenario(5, 5, false)).toBe(1);
    expect(determineScenario(6, 5, false)).toBe(1);
    expect(determineScenario(5, 5, true)).toBe(1);
  });

  it("returns 2 when 0 < matched < quota", () => {
    expect(determineScenario(3, 5, false)).toBe(2);
    expect(determineScenario(3, 5, true)).toBe(2);
    expect(determineScenario(1, 10, false)).toBe(2);
  });

  it("returns 3 when matched == 0 and combos available", () => {
    expect(determineScenario(0, 5, true)).toBe(3);
  });

  it("returns 4 when matched == 0 and no combos", () => {
    expect(determineScenario(0, 5, false)).toBe(4);
    expect(determineScenario(0, 1, false)).toBe(4);
  });
});

// ------------------------------------------------------------------ //
// buildPrompt — Scenario 4 (no matches, no combos)
// ------------------------------------------------------------------ //
describe("buildPrompt — Scenario 4", () => {
  const docContent = "This document explains basic networking concepts including TCP/IP.";

  it("contains DOCUMENT section", () => {
    const { user } = buildPrompt({
      scenario: 4,
      docContent,
      quota: 3,
      matched: [],
      combos: [],
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).toContain("[DOCUMENT]");
    expect(user).toContain(docContent);
  });

  it("contains PREFERENCES section", () => {
    const { user } = buildPrompt({
      scenario: 4,
      docContent,
      quota: 3,
      matched: [],
      combos: [],
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).toContain("[PREFERENCES]");
    expect(user).toContain("factual");
    expect(user).toContain("professional");
    expect(user).toContain("core concepts");
  });

  it("does NOT contain STYLE EXAMPLES or DIVERSITY GUIDANCE", () => {
    const { user } = buildPrompt({
      scenario: 4,
      docContent,
      quota: 3,
      matched: [],
      combos: [],
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).not.toContain("[STYLE EXAMPLES]");
    expect(user).not.toContain("[DIVERSITY GUIDANCE]");
  });

  it("asks to generate exactly quota questions", () => {
    const { user } = buildPrompt({
      scenario: 4,
      docContent,
      quota: 7,
      matched: [],
      combos: [],
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).toContain("7");
  });

  it("has a system prompt mentioning expert question generator", () => {
    const { system } = buildPrompt({
      scenario: 4,
      docContent,
      quota: 3,
      matched: [],
      combos: [],
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(system.toLowerCase()).toContain("question");
    expect(system.toLowerCase()).toContain("rag");
  });
});

// ------------------------------------------------------------------ //
// buildPrompt — Scenario 3 (no matches, combos available)
// ------------------------------------------------------------------ //
describe("buildPrompt — Scenario 3", () => {
  const docContent = "Cloud computing allows on-demand access to computing resources.";
  const combos: Record<string, string>[] = [
    { persona: "developer", intent: "troubleshooting" },
    { persona: "manager", intent: "evaluation" },
  ];

  it("contains DIVERSITY GUIDANCE section", () => {
    const { user } = buildPrompt({
      scenario: 3,
      docContent,
      quota: 4,
      matched: [],
      combos,
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).toContain("[DIVERSITY GUIDANCE]");
    expect(user).toContain("developer");
    expect(user).toContain("troubleshooting");
  });

  it("contains DOCUMENT and PREFERENCES but NOT STYLE EXAMPLES", () => {
    const { user } = buildPrompt({
      scenario: 3,
      docContent,
      quota: 4,
      matched: [],
      combos,
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).toContain("[DOCUMENT]");
    expect(user).toContain("[PREFERENCES]");
    expect(user).not.toContain("[STYLE EXAMPLES]");
  });
});

// ------------------------------------------------------------------ //
// buildPrompt — Scenario 2 (some matches, some combos)
// ------------------------------------------------------------------ //
describe("buildPrompt — Scenario 2", () => {
  const docContent = "Microservices architecture decomposes applications into small services.";
  const matched = makeMatched(2);
  const combos: Record<string, string>[] = [{ persona: "architect", intent: "design" }];

  it("contains STYLE EXAMPLES section with matched questions", () => {
    const { user } = buildPrompt({
      scenario: 2,
      docContent,
      quota: 5,
      matched,
      combos,
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).toContain("[STYLE EXAMPLES]");
    expect(user).toContain("Real question 1?");
    expect(user).toContain("Real question 2?");
  });

  it("contains DIVERSITY GUIDANCE when combos present", () => {
    const { user } = buildPrompt({
      scenario: 2,
      docContent,
      quota: 5,
      matched,
      combos,
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).toContain("[DIVERSITY GUIDANCE]");
  });

  it("asks to generate quota - matched new questions", () => {
    // quota=5, matched=2 → generate 3 new
    const { user } = buildPrompt({
      scenario: 2,
      docContent,
      quota: 5,
      matched,
      combos,
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).toContain("3");
  });

  it("instructs to also extract citations for matched questions", () => {
    const { user } = buildPrompt({
      scenario: 2,
      docContent,
      quota: 5,
      matched,
      combos,
      preferences: basePreferences,
      model: "gpt-4o",
    });
    // Should mention direct-reuse / citation extraction for existing questions
    expect(user.toLowerCase()).toMatch(/citation|direct.?reuse|existing/i);
  });
});

// ------------------------------------------------------------------ //
// buildPrompt — Scenario 1 (enough matches)
// ------------------------------------------------------------------ //
describe("buildPrompt — Scenario 1", () => {
  const docContent = "Container orchestration manages deployment of containers at scale.";
  const matched = makeMatched(6);

  it("contains DOCUMENT section", () => {
    const { user } = buildPrompt({
      scenario: 1,
      docContent,
      quota: 5,
      matched,
      combos: [],
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).toContain("[DOCUMENT]");
  });

  it("only lists top quota matched questions for citation extraction", () => {
    const { user } = buildPrompt({
      scenario: 1,
      docContent,
      quota: 5,
      matched,
      combos: [],
      preferences: basePreferences,
      model: "gpt-4o",
    });
    // Should mention citation extraction (no new generation)
    expect(user.toLowerCase()).toMatch(/citation|extract/i);
    // Should list the matched questions
    expect(user).toContain("Real question 1?");
  });

  it("does NOT ask to generate new questions (only citation extraction)", () => {
    const { user } = buildPrompt({
      scenario: 1,
      docContent,
      quota: 5,
      matched,
      combos: [],
      preferences: basePreferences,
      model: "gpt-4o",
    });
    // Should not contain a generate N new questions instruction
    expect(user).not.toMatch(/generate \d+ new/i);
  });
});

// ------------------------------------------------------------------ //
// buildPrompt — JSON output format
// ------------------------------------------------------------------ //
describe("buildPrompt — output format", () => {
  it("instructs to output JSON with questions array", () => {
    const { user } = buildPrompt({
      scenario: 4,
      docContent: "Some doc content.",
      quota: 2,
      matched: [],
      combos: [],
      preferences: basePreferences,
      model: "gpt-4o",
    });
    expect(user).toContain('"questions"');
    expect(user).toContain('"citation"');
    expect(user).toContain('"source"');
  });
});

// ------------------------------------------------------------------ //
// parseGenerationResponse
// ------------------------------------------------------------------ //
describe("parseGenerationResponse", () => {
  it("parses valid JSON response", () => {
    const response = JSON.stringify({
      questions: [
        { question: "What is Kubernetes?", citation: "Kubernetes manages containers", source: "generated", profile: null },
        { question: "How do pods work?", citation: "Pods are the smallest units", source: "direct-reuse", profile: "persona=developer" },
      ],
    });
    const result = parseGenerationResponse(response);
    expect(result).toHaveLength(2);
    expect(result[0].question).toBe("What is Kubernetes?");
    expect(result[0].citation).toBe("Kubernetes manages containers");
    expect(result[0].source).toBe("generated");
    expect(result[0].profile).toBeNull();
    expect(result[1].source).toBe("direct-reuse");
    expect(result[1].profile).toBe("persona=developer");
  });

  it("returns empty array for malformed JSON", () => {
    const result = parseGenerationResponse("not valid json at all {{{");
    expect(result).toEqual([]);
  });

  it("returns empty array for JSON without questions array", () => {
    const result = parseGenerationResponse(JSON.stringify({ data: [] }));
    expect(result).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseGenerationResponse("")).toEqual([]);
  });

  it("handles JSON wrapped in markdown code fences", () => {
    const inner = JSON.stringify({
      questions: [
        { question: "Test?", citation: "Test citation", source: "generated", profile: null },
      ],
    });
    const response = "```json\n" + inner + "\n```";
    const result = parseGenerationResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Test?");
  });
});

// ------------------------------------------------------------------ //
// splitLargeDocument
// ------------------------------------------------------------------ //
describe("splitLargeDocument", () => {
  it("returns single chunk when content is under maxChars", () => {
    const content = "Short document content.";
    const chunks = splitLargeDocument(content, 20000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(content);
  });

  it("splits large document into chunks", () => {
    const content = "A".repeat(25000);
    const chunks = splitLargeDocument(content, 20000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20000);
    }
  });

  it("uses default maxChars of 20000", () => {
    const content = "B".repeat(21000);
    const chunks = splitLargeDocument(content);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("chunks have overlap", () => {
    const content = "ABCDEFGHIJ".repeat(2500); // 25000 chars
    const overlap = 200;
    const chunks = splitLargeDocument(content, 20000, overlap);
    // End of first chunk should match beginning of second chunk
    if (chunks.length >= 2) {
      const endOfFirst = chunks[0].slice(-overlap);
      const startOfSecond = chunks[1].slice(0, overlap);
      expect(endOfFirst).toBe(startOfSecond);
    }
  });

  it("total content is preserved across chunks without overlap counting twice", () => {
    const content = "Hello world! ".repeat(2000); // ~26000 chars
    const chunks = splitLargeDocument(content, 20000, 0);
    const reconstructed = chunks.join("");
    expect(reconstructed).toBe(content);
  });
});

// ------------------------------------------------------------------ //
// generateForDocument
// ------------------------------------------------------------------ //
describe("generateForDocument", () => {
  it("returns UnifiedQuestion[] with correct docId", async () => {
    const result = await generateForDocument({
      docId: "doc-abc",
      docContent: "Kubernetes manages containerized workloads. X is a thing.",
      quota: 1,
      matched: [],
      combos: [],
      preferences: basePreferences,
      llmClient: mockLLMClient,
      model: "gpt-4o-mini",
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].docId).toBe("doc-abc");
  });

  it("sets source field from LLM response", async () => {
    const result = await generateForDocument({
      docId: "doc-xyz",
      docContent: "X is a thing that does stuff.",
      quota: 1,
      matched: [],
      combos: [],
      preferences: basePreferences,
      llmClient: mockLLMClient,
      model: "gpt-4o-mini",
    });
    expect(result[0].source).toBe("generated");
  });

  it("returns empty array when LLM returns invalid JSON", async () => {
    const badClient = {
      name: "bad",
      async complete() { return "not json"; },
    };
    const result = await generateForDocument({
      docId: "doc-bad",
      docContent: "Some content here.",
      quota: 2,
      matched: [],
      combos: [],
      preferences: basePreferences,
      llmClient: badClient,
      model: "gpt-4o-mini",
    });
    expect(result).toEqual([]);
  });

  it("scenario 1: uses direct-reuse source for matched questions when matched >= quota", async () => {
    const directReuseClient = {
      name: "direct-reuse-mock",
      async complete() {
        return JSON.stringify({
          questions: [
            { question: "Real question 1?", citation: "Passage 1", source: "direct-reuse", profile: null },
            { question: "Real question 2?", citation: "Passage 2", source: "direct-reuse", profile: null },
          ],
        });
      },
    };
    const matched = makeMatched(3);
    const result = await generateForDocument({
      docId: "doc-s1",
      docContent: "Passage 1. Passage 2. Passage 3.",
      quota: 2,
      matched,
      combos: [],
      preferences: basePreferences,
      llmClient: directReuseClient,
      model: "gpt-4o-mini",
    });
    expect(result.every((q) => q.docId === "doc-s1")).toBe(true);
  });
});
