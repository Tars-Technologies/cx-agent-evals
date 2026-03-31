import { describe, it, expect } from "vitest";
import {
  splitIntoPassages,
  cosineSimilarity,
  matchQuestionsToDocuments,
  embedInBatches,
} from "../../../../src/synthetic-datagen/strategies/real-world-grounded/matching.js";
import { createDocument, createCorpus } from "../../../../src/types/documents.js";
import type { Embedder } from "../../../../src/embedders/embedder.interface.js";

describe("splitIntoPassages", () => {
  it("should split on double newlines when paragraphs are long enough", () => {
    const para1 = "A".repeat(300);
    const para2 = "B".repeat(300);
    const para3 = "C".repeat(300);
    const text = `${para1}\n\n${para2}\n\n${para3}`;
    const passages = splitIntoPassages(text);
    expect(passages).toHaveLength(3);
    expect(passages[0]).toBe(para1);
    expect(passages[1]).toBe(para2);
    expect(passages[2]).toBe(para3);
  });

  it("should merge short consecutive paragraphs", () => {
    const text = "Short.\n\nAlso short.\n\nStill short.";
    const passages = splitIntoPassages(text, 500);
    // All three are well under 500, so they merge
    expect(passages).toHaveLength(1);
    expect(passages[0]).toContain("Short.");
    expect(passages[0]).toContain("Also short.");
  });

  it("should chunk oversized single paragraph into pieces within maxLen", () => {
    const longPara = "A".repeat(600);
    const passages = splitIntoPassages(longPara, 500);
    // Oversized paragraph gets split into chunks that fit within maxLen
    expect(passages).toHaveLength(2);
    expect(passages[0].length).toBe(500);
    expect(passages[1].length).toBe(100);
    // All content preserved
    expect(passages.join("")).toBe(longPara);
  });

  it("should split oversized paragraph on newlines and sentences before hard-truncating", () => {
    // Paragraph with sentence boundaries, total > 500 chars
    const sentence = "This is a test sentence. ";
    const longPara = sentence.repeat(30); // ~750 chars
    const passages = splitIntoPassages(longPara, 500);
    expect(passages.length).toBeGreaterThan(1);
    for (const p of passages) {
      expect(p.length).toBeLessThanOrEqual(500);
    }
  });

  it("should handle empty text", () => {
    expect(splitIntoPassages("")).toHaveLength(0);
  });
});

describe("cosineSimilarity", () => {
  it("should return 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it("should return 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("should return correct value for known vectors", () => {
    // [1,2,3] · [4,5,6] = 32, |a|=sqrt(14), |b|=sqrt(77)
    const result = cosineSimilarity([1, 2, 3], [4, 5, 6]);
    expect(result).toBeCloseTo(32 / (Math.sqrt(14) * Math.sqrt(77)));
  });

  it("should return 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("embedInBatches", () => {
  it("should batch texts and flatten results", async () => {
    let callCount = 0;
    const mockEmbedder: Embedder = {
      name: "mock",
      dimension: 2,
      async embed(texts) {
        callCount++;
        return texts.map(() => [1, 0]);
      },
      async embedQuery(q) {
        return [1, 0];
      },
    };

    const texts = Array.from({ length: 250 }, (_, i) => `text-${i}`);
    const result = await embedInBatches(texts, mockEmbedder);
    expect(result).toHaveLength(250);
    expect(callCount).toBe(3); // 100 + 100 + 50
  });
});

describe("matchQuestionsToDocuments", () => {
  // Mock embedder: returns a vector based on the text content
  // "auth" docs get [1,0], "setup" docs get [0,1]
  const mockEmbedder: Embedder = {
    name: "mock",
    dimension: 2,
    async embed(texts) {
      return texts.map((t) => {
        if (t.toLowerCase().includes("auth") || t.toLowerCase().includes("oauth")) return [1, 0];
        if (t.toLowerCase().includes("setup") || t.toLowerCase().includes("install")) return [0, 1];
        return [0.5, 0.5];
      });
    },
    async embedQuery(q) {
      return (await this.embed([q]))[0];
    },
  };

  it("should match questions to correct documents", async () => {
    const corpus = createCorpus([
      createDocument({ id: "auth.md", content: "OAuth2 authentication guide.\n\nHow to configure auth tokens." }),
      createDocument({ id: "setup.md", content: "Installation and setup guide.\n\nHow to install dependencies." }),
    ]);

    const questions = ["How do I reset my OAuth token?", "How do I install the package?"];
    const matches = await matchQuestionsToDocuments(corpus, questions, mockEmbedder, { threshold: 0.1 });

    expect(matches.get("auth.md")).toBeDefined();
    expect(matches.get("auth.md")![0].question).toBe("How do I reset my OAuth token?");
    expect(matches.get("setup.md")).toBeDefined();
    expect(matches.get("setup.md")![0].question).toBe("How do I install the package?");
  });

  it("should filter questions below threshold", async () => {
    const corpus = createCorpus([
      createDocument({ id: "auth.md", content: "OAuth2 authentication guide." }),
    ]);

    // "unrelated" maps to [0.5, 0.5], auth maps to [1, 0], cosine ≈ 0.707
    // but with threshold 0.99, should be filtered
    const questions = ["Something completely unrelated about cooking"];
    const matches = await matchQuestionsToDocuments(corpus, questions, mockEmbedder, { threshold: 0.99 });

    const authMatches = matches.get("auth.md") ?? [];
    expect(authMatches).toHaveLength(0);
  });

  it("should sort matches by score descending", async () => {
    const corpus = createCorpus([
      createDocument({ id: "auth.md", content: "OAuth2 authentication guide.\n\nAdvanced auth config." }),
    ]);

    const questions = ["How does OAuth work?", "Tell me about auth setup"];
    const matches = await matchQuestionsToDocuments(corpus, questions, mockEmbedder, { threshold: 0.1 });

    const authMatches = matches.get("auth.md") ?? [];
    if (authMatches.length >= 2) {
      expect(authMatches[0].score).toBeGreaterThanOrEqual(authMatches[1].score);
    }
  });
});
