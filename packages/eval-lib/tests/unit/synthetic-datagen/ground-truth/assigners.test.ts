import { describe, it, expect } from "vitest";
import { GroundTruthAssigner } from "../../../../src/synthetic-datagen/ground-truth/token-level.js";
import type { LLMClient } from "../../../../src/synthetic-datagen/base.js";
import type { GeneratedQuery } from "../../../../src/synthetic-datagen/strategies/types.js";
import { createDocument, createCorpus } from "../../../../src/types/documents.js";

const content =
  "RAG combines retrieval with generation. It uses relevant documents to answer questions.";
const doc = createDocument({ id: "test.md", content });
const corpus = createCorpus([doc]);

function makeLLM(response: string): LLMClient {
  return {
    name: "MockLLM",
    async complete() {
      return response;
    },
  };
}

describe("GroundTruthAssigner", () => {
  it("should assign valid spans to queries", async () => {
    const llm = makeLLM(
      JSON.stringify({
        excerpts: ["RAG combines retrieval with generation"],
      }),
    );

    const assigner = new GroundTruthAssigner();
    const queries: GeneratedQuery[] = [
      {
        query: "What does RAG combine?",
        targetDocId: "test.md",
        metadata: {},
      },
    ];

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results).toHaveLength(1);
    expect(results[0].relevantSpans).toHaveLength(1);
    expect(results[0].relevantSpans[0].start).toBe(0);
    expect(results[0].relevantSpans[0].text).toBe(
      "RAG combines retrieval with generation",
    );
  });

  it("should skip excerpts not found in document", async () => {
    const llm = makeLLM(
      JSON.stringify({
        excerpts: ["This text does not exist in the document at all"],
      }),
    );

    const assigner = new GroundTruthAssigner();
    const queries: GeneratedQuery[] = [
      { query: "test?", targetDocId: "test.md", metadata: {} },
    ];

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results).toHaveLength(0);
  });

  it("should return multiple spans when LLM provides multiple excerpts", async () => {
    const llm = makeLLM(
      JSON.stringify({
        excerpts: [
          "RAG combines retrieval with generation",
          "It uses relevant documents to answer questions",
        ],
      }),
    );

    const assigner = new GroundTruthAssigner();
    const queries: GeneratedQuery[] = [
      { query: "What is RAG?", targetDocId: "test.md", metadata: {} },
    ];

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results).toHaveLength(1);
    expect(results[0].relevantSpans).toHaveLength(2);
    expect(results[0].relevantSpans[0].text).toBe(
      "RAG combines retrieval with generation",
    );
    expect(results[0].relevantSpans[1].text).toBe(
      "It uses relevant documents to answer questions",
    );
  });

  it("should fuzzy-match excerpts with minor differences", async () => {
    // The excerpt has a small difference ("combines" → "combined") — within 15% threshold
    const llm = makeLLM(
      JSON.stringify({
        excerpts: ["RAG combined retrieval with generation."],
      }),
    );

    const assigner = new GroundTruthAssigner();
    const queries: GeneratedQuery[] = [
      { query: "What does RAG do?", targetDocId: "test.md", metadata: {} },
    ];

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    expect(results).toHaveLength(1);
    expect(results[0].relevantSpans.length).toBeGreaterThanOrEqual(1);
    // The span should be from the actual document text, not the LLM's paraphrase
    expect(results[0].relevantSpans[0].text).toContain("RAG combines retrieval");
  });

  it("should report failed excerpts without crashing", async () => {
    const llm = makeLLM(
      JSON.stringify({
        excerpts: [
          "RAG combines retrieval with generation",
          "Completely unrelated text that is absolutely nowhere in the document whatsoever at all",
        ],
      }),
    );

    const assigner = new GroundTruthAssigner();
    const queries: GeneratedQuery[] = [
      { query: "What is RAG?", targetDocId: "test.md", metadata: {} },
    ];

    const results = await assigner.assign(queries, {
      corpus,
      llmClient: llm,
      model: "gpt-4o",
    });

    // Should still return the one valid span
    expect(results).toHaveLength(1);
    expect(results[0].relevantSpans).toHaveLength(1);
    expect(results[0].relevantSpans[0].text).toBe(
      "RAG combines retrieval with generation",
    );
  });
});
