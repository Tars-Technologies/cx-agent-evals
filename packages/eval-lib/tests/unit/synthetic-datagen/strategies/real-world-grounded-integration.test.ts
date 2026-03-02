import { describe, it, expect } from "vitest";
import { RealWorldGroundedStrategy } from "../../../../src/synthetic-datagen/strategies/real-world-grounded/generator.js";
import type { LLMClient } from "../../../../src/synthetic-datagen/base.js";
import type { Embedder } from "../../../../src/embedders/embedder.interface.js";
import { createDocument, createCorpus } from "../../../../src/types/documents.js";

describe("RealWorldGroundedStrategy integration", () => {
  // Mock embedder: auth-related → [1,0], setup-related → [0,1], else → [0.5,0.5]
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

  const mockLLM: LLMClient = {
    name: "MockLLM",
    async complete() {
      return JSON.stringify({
        questions: [
          "What is the OAuth refresh flow?",
          "How do I revoke an auth token?",
        ],
      });
    },
  };

  it("should produce both direct and generated queries", async () => {
    const corpus = createCorpus([
      createDocument({
        id: "auth.md",
        content: "OAuth2 authentication guide.\n\nHow to configure auth tokens and manage sessions.",
      }),
    ]);

    const strategy = new RealWorldGroundedStrategy({
      questions: ["How do I reset my OAuth token?", "What auth methods are supported?"],
      totalSyntheticQuestions: 2,
    });

    const results = await strategy.generate({
      corpus,
      llmClient: mockLLM,
      model: "gpt-4o",
      embedder: mockEmbedder,
    });

    const direct = results.filter((r) => r.metadata.mode === "direct");
    const generated = results.filter((r) => r.metadata.mode === "generated");

    expect(direct.length).toBeGreaterThanOrEqual(1);
    expect(generated.length).toBeGreaterThanOrEqual(1);

    for (const q of direct) {
      expect(q.metadata.strategy).toBe("real-world-grounded");
      expect(q.metadata.matchScore).toBeDefined();
      expect(q.targetDocId).toBe("auth.md");
    }

    for (const q of generated) {
      expect(q.metadata.strategy).toBe("real-world-grounded");
      expect(q.metadata.mode).toBe("generated");
    }
  });

  it("should throw if embedder is missing", async () => {
    const corpus = createCorpus([
      createDocument({ id: "doc.md", content: "Some content." }),
    ]);

    const strategy = new RealWorldGroundedStrategy({
      questions: ["A question"],
      totalSyntheticQuestions: 1,
    });

    await expect(
      strategy.generate({ corpus, llmClient: mockLLM, model: "gpt-4o" }),
    ).rejects.toThrow("requires an embedder");
  });

  it("should emit progress events", async () => {
    const corpus = createCorpus([
      createDocument({
        id: "auth.md",
        content: "OAuth2 authentication guide.",
      }),
    ]);

    const phases: string[] = [];
    const strategy = new RealWorldGroundedStrategy({
      questions: ["How does OAuth work?"],
      totalSyntheticQuestions: 1,
      onProgress: (event) => phases.push(event.phase),
    });

    await strategy.generate({
      corpus,
      llmClient: mockLLM,
      model: "gpt-4o",
      embedder: mockEmbedder,
    });

    expect(phases).toEqual(["embedding-questions", "embedding-passages", "matching", "generating", "done"]);
  });
});
