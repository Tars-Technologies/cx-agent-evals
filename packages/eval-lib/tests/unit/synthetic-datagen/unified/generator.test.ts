import { describe, it, expect } from "vitest";
import { UnifiedQuestionGenerator } from "../../../../src/synthetic-datagen/unified/generator.js";
import type {
  UnifiedGenerationConfig,
  UnifiedGeneratorContext,
  PromptPreferences,
} from "../../../../src/synthetic-datagen/unified/types.js";
import { createCorpusFromDocuments } from "../../../../src/types/documents.js";
import type { LLMClient } from "../../../../src/synthetic-datagen/base.js";
import type { Embedder } from "../../../../src/embedders/embedder.interface.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testCorpus = createCorpusFromDocuments([
  {
    id: "doc1",
    content:
      "Kubernetes pods are the smallest deployable units. Each pod runs one or more containers.",
  },
  {
    id: "doc2",
    content:
      "Docker images are templates for containers. Images are built from Dockerfiles.",
  },
]);

const basePreferences: PromptPreferences = {
  questionTypes: ["factual", "conceptual"],
  tone: "professional",
  focusAreas: "core concepts",
};

/**
 * Mock LLM client that returns well-formed JSON with citations from the document.
 * It parses the prompt to find the document content and the requested count,
 * then uses the first sentence of the document as the citation.
 */
const mockLLMClient: LLMClient = {
  name: "mock",
  async complete(params: {
    model: string;
    messages: ReadonlyArray<{ role: string; content: string }>;
    responseFormat?: "json" | "text";
  }) {
    const userMsg =
      params.messages.find((m) => m.role === "user")?.content ?? "";

    // Parse the requested count — handles both "Generate exactly N" and
    // "Extract a verbatim citation from the document for each of the following N"
    const generateMatch = userMsg.match(/Generate exactly (\d+)/);
    const extractMatch = userMsg.match(/following (\d+) existing questions/);
    const generateCount = generateMatch ? parseInt(generateMatch[1]) : 0;
    const extractCount = extractMatch ? parseInt(extractMatch[1]) : 0;

    // Extract document content from [DOCUMENT] block
    const docMatch = userMsg.match(
      /\[DOCUMENT\]\n([\s\S]*?)(?:\n\[|$)/,
    );
    const docContent = docMatch ? docMatch[1].trim() : "Sample text here.";
    // Use the first sentence as citation
    const citation = docContent.split(".")[0] + ".";

    // Build questions — direct-reuse for extracted, generated for new
    const questions: Array<{
      question: string;
      citation: string;
      source: string;
      profile: string | null;
    }> = [];

    // Extract existing questions from the prompt for direct-reuse
    if (extractCount > 0) {
      const existingQMatches = [
        ...userMsg.matchAll(/\d+\.\s+(.*?\?)/g),
      ];
      // Take the last extractCount matches (they appear after the extract instruction)
      const extracted = existingQMatches.slice(-extractCount);
      for (const m of extracted) {
        questions.push({
          question: m[1],
          citation,
          source: "direct-reuse",
          profile: null,
        });
      }
    }

    // Generate new questions
    for (let i = 0; i < generateCount; i++) {
      questions.push({
        question: `Generated question ${i + 1} about the document?`,
        citation,
        source: "generated",
        profile: null,
      });
    }

    // Scenario 4 / Scenario 3 — only "Generate exactly N" with no extract
    // Scenario 1 — only extract, no generate
    // If we ended up with 0 questions (scenario 1 with no extractMatch), parse differently
    if (questions.length === 0) {
      // Fallback: parse count from "Generate exactly N"
      const anyCount = userMsg.match(/exactly (\d+)/);
      const count = anyCount ? parseInt(anyCount[1]) : 1;
      for (let i = 0; i < count; i++) {
        questions.push({
          question: `Question ${i + 1} about the document?`,
          citation,
          source: "generated",
          profile: null,
        });
      }
    }

    return JSON.stringify({ questions });
  },
};

/**
 * Mock embedder returning orthogonal unit vectors.
 * Each text gets a unique direction so cosine similarity between different texts is 0.
 * For matching tests, we make the embedder assign high similarity to specific pairs.
 */
const mockEmbedder: Embedder = {
  name: "mock-embedder",
  dimension: 10,
  embed: async (texts: readonly string[]) =>
    texts.map((_, i) => {
      const vec = new Array(10).fill(0);
      vec[i % 10] = 1;
      return vec;
    }),
  embedQuery: async (_query: string) => {
    const vec = new Array(10).fill(0);
    vec[0] = 1;
    return vec;
  },
};

/**
 * Mock embedder that makes real-world questions match specific documents.
 * All texts containing "Kubernetes" get [1,0,...], all "Docker" get [0,1,...],
 * and questions are assigned similarly by keyword.
 */
const matchingEmbedder: Embedder = {
  name: "matching-embedder",
  dimension: 10,
  embed: async (texts: readonly string[]) =>
    texts.map((text) => {
      const vec = new Array(10).fill(0);
      if (text.toLowerCase().includes("kubernetes") || text.toLowerCase().includes("pod")) {
        vec[0] = 1;
      } else if (text.toLowerCase().includes("docker") || text.toLowerCase().includes("image")) {
        vec[1] = 1;
      } else {
        // Unrelated text — random direction
        vec[5] = 1;
      }
      return vec;
    }),
  embedQuery: async (query: string) => {
    const vec = new Array(10).fill(0);
    if (query.toLowerCase().includes("kubernetes") || query.toLowerCase().includes("pod")) {
      vec[0] = 1;
    } else if (query.toLowerCase().includes("docker") || query.toLowerCase().includes("image")) {
      vec[1] = 1;
    } else {
      vec[5] = 1;
    }
    return vec;
  },
};

function makeConfig(overrides: Partial<UnifiedGenerationConfig> = {}): UnifiedGenerationConfig {
  return {
    totalQuestions: 4,
    promptPreferences: basePreferences,
    ...overrides,
  };
}

function makeContext(overrides: Partial<UnifiedGeneratorContext> = {}): UnifiedGeneratorContext {
  return {
    corpus: testCorpus,
    llmClient: mockLLMClient,
    model: "test-model",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UnifiedQuestionGenerator", () => {
  // -----------------------------------------------------------------------
  // Scenario 4: Nothing provided (all defaults) — no dimensions, no real-world
  // -----------------------------------------------------------------------
  describe("no dimensions, no real-world questions (Scenario 4)", () => {
    it("generates questions for all documents", async () => {
      const generator = new UnifiedQuestionGenerator(
        makeConfig({ totalQuestions: 4 }),
        makeContext(),
      );
      const result = await generator.generate();

      expect(result.length).toBeGreaterThan(0);
      // Every question must have a valid span
      for (const q of result) {
        expect(q.span).toBeDefined();
        expect(q.span.start).toBeGreaterThanOrEqual(0);
        expect(q.span.end).toBeGreaterThan(q.span.start);
        expect(q.span.text.length).toBeGreaterThan(0);
      }
    });

    it("assigns questions to both documents", async () => {
      const generator = new UnifiedQuestionGenerator(
        makeConfig({ totalQuestions: 4 }),
        makeContext(),
      );
      const result = await generator.generate();
      const docIds = new Set(result.map((q) => q.span.docId));
      expect(docIds.size).toBe(2);
    });

    it("all questions have source=generated", async () => {
      const generator = new UnifiedQuestionGenerator(
        makeConfig({ totalQuestions: 4 }),
        makeContext(),
      );
      const result = await generator.generate();
      for (const q of result) {
        expect(q.source).toBe("generated");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3: Only dimensions provided
  // -----------------------------------------------------------------------
  describe("only dimensions (Scenario 3)", () => {
    // filterCombinations calls LLM — our mock returns empty unrealistic_pairs,
    // meaning all combos pass. We provide simple dimensions.
    const dimensions = [
      { name: "persona", description: "User type", values: ["developer", "admin"] },
      { name: "intent", description: "Query intent", values: ["troubleshooting", "learning"] },
    ];

    // LLM client that also handles filter prompts
    const filterAwareLLMClient: LLMClient = {
      name: "mock-filter",
      async complete(params) {
        const userMsg = params.messages.find((m) => m.role === "user")?.content ?? "";

        // If this is a filtering prompt, return empty unrealistic_pairs
        if (userMsg.includes("unrealistic") || userMsg.includes("UNREALISTIC")) {
          return JSON.stringify({ unrealistic_pairs: [] });
        }

        // Otherwise delegate to the normal mock
        return mockLLMClient.complete(params);
      },
    };

    it("generates questions with dimension combos available", async () => {
      const generator = new UnifiedQuestionGenerator(
        makeConfig({ totalQuestions: 4, dimensions }),
        makeContext({ llmClient: filterAwareLLMClient }),
      );
      const result = await generator.generate();

      expect(result.length).toBeGreaterThan(0);
      for (const q of result) {
        expect(q.span).toBeDefined();
        expect(q.span.text.length).toBeGreaterThan(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Scenarios 1/2: Only real-world questions provided
  // -----------------------------------------------------------------------
  describe("only real-world questions (Scenarios 1/2)", () => {
    it("matches real-world questions to documents and generates remainder", async () => {
      const realWorldQuestions = [
        "How do Kubernetes pods work?",
        "What are Docker images used for?",
      ];

      const generator = new UnifiedQuestionGenerator(
        makeConfig({ totalQuestions: 4, realWorldQuestions }),
        makeContext({ embedder: matchingEmbedder }),
      );
      const result = await generator.generate();

      expect(result.length).toBeGreaterThan(0);
      for (const q of result) {
        expect(q.span).toBeDefined();
        expect(q.span.start).toBeGreaterThanOrEqual(0);
        expect(q.span.end).toBeGreaterThan(q.span.start);
      }
    });

    it("falls back to Scenario 4 if no embedder provided", async () => {
      const generator = new UnifiedQuestionGenerator(
        makeConfig({
          totalQuestions: 4,
          realWorldQuestions: ["Some question?"],
        }),
        makeContext({ embedder: undefined }),
      );
      const result = await generator.generate();

      // Should still produce questions (Scenario 4 fallback)
      expect(result.length).toBeGreaterThan(0);
      for (const q of result) {
        expect(q.source).toBe("generated");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Mixed: Both dimensions + real-world questions
  // -----------------------------------------------------------------------
  describe("both dimensions and real-world questions", () => {
    const dimensions = [
      { name: "persona", description: "User type", values: ["developer", "admin"] },
    ];
    const realWorldQuestions = [
      "How do Kubernetes pods work?",
      "What are Docker images used for?",
    ];

    const filterAwareLLMClient: LLMClient = {
      name: "mock-filter",
      async complete(params) {
        const userMsg = params.messages.find((m) => m.role === "user")?.content ?? "";
        if (userMsg.includes("unrealistic") || userMsg.includes("UNREALISTIC")) {
          return JSON.stringify({ unrealistic_pairs: [] });
        }
        return mockLLMClient.complete(params);
      },
    };

    it("uses mixed scenarios across documents", async () => {
      const generator = new UnifiedQuestionGenerator(
        makeConfig({ totalQuestions: 4, dimensions, realWorldQuestions }),
        makeContext({ llmClient: filterAwareLLMClient, embedder: matchingEmbedder }),
      );
      const result = await generator.generate();

      expect(result.length).toBeGreaterThan(0);
      for (const q of result) {
        expect(q.span).toBeDefined();
        expect(q.span.text.length).toBeGreaterThan(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Citation validation
  // -----------------------------------------------------------------------
  describe("citation validation", () => {
    it("all questions have valid citation spans with correct fields", async () => {
      const generator = new UnifiedQuestionGenerator(
        makeConfig({ totalQuestions: 4 }),
        makeContext(),
      );
      const result = await generator.generate();

      for (const q of result) {
        expect(q.span).toHaveProperty("docId");
        expect(q.span).toHaveProperty("start");
        expect(q.span).toHaveProperty("end");
        expect(q.span).toHaveProperty("text");
        expect(typeof q.span.start).toBe("number");
        expect(typeof q.span.end).toBe("number");
        expect(typeof q.span.text).toBe("string");
        expect(q.span.end).toBeGreaterThan(q.span.start);

        // The text should be a substring of the source document
        const doc = testCorpus.documents.find(
          (d) => String(d.id) === q.span.docId,
        );
        expect(doc).toBeDefined();
        // span text should appear in the doc content (possibly normalized)
        expect(doc!.content).toContain(q.span.text);
      }
    });

    it("drops questions with invalid citations silently", async () => {
      // LLM client that returns a citation not in the document
      const badCitationLLM: LLMClient = {
        name: "bad-citation",
        async complete() {
          return JSON.stringify({
            questions: [
              {
                question: "Good question?",
                citation: "Kubernetes pods are the smallest deployable units.",
                source: "generated",
                profile: null,
              },
              {
                question: "Bad question?",
                citation: "This text does not appear anywhere in any document at all and is completely made up gibberish xyz123.",
                source: "generated",
                profile: null,
              },
            ],
          });
        },
      };

      const singleDocCorpus = createCorpusFromDocuments([
        {
          id: "doc1",
          content:
            "Kubernetes pods are the smallest deployable units. Each pod runs one or more containers.",
        },
      ]);

      const generator = new UnifiedQuestionGenerator(
        makeConfig({ totalQuestions: 2 }),
        makeContext({ llmClient: badCitationLLM, corpus: singleDocCorpus }),
      );
      const result = await generator.generate();

      // Only the good citation should survive
      expect(result.length).toBe(1);
      expect(result[0].question).toBe("Good question?");
    });
  });

  // -----------------------------------------------------------------------
  // Quota allocation with overrides
  // -----------------------------------------------------------------------
  describe("allocation overrides", () => {
    it("respects allocation overrides", async () => {
      const generator = new UnifiedQuestionGenerator(
        makeConfig({
          totalQuestions: 6,
          allocationOverrides: { doc1: 80, doc2: 20 },
        }),
        makeContext(),
      );
      const result = await generator.generate();

      const doc1Count = result.filter((q) => q.span.docId === "doc1").length;
      const doc2Count = result.filter((q) => q.span.docId === "doc2").length;

      // With 80/20 split of 6 questions: doc1 should get more than doc2
      expect(doc1Count).toBeGreaterThan(doc2Count);
    });
  });

  // -----------------------------------------------------------------------
  // Zero quota documents are skipped
  // -----------------------------------------------------------------------
  describe("zero quota", () => {
    it("skips documents with zero quota", async () => {
      const generator = new UnifiedQuestionGenerator(
        makeConfig({
          totalQuestions: 3,
          allocationOverrides: { doc1: 100 },
        }),
        makeContext(),
      );
      const result = await generator.generate();

      // All questions should be from doc1
      for (const q of result) {
        expect(q.span.docId).toBe("doc1");
      }
    });
  });
});
